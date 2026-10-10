// Netlify Function (v2): GET /api/parfum/:brand/:name  ->  JSON mit Noten, Accorden, Jahreszeiten, ...
import { parse, parseChartTokens, applyPieCharts } from "./lib/parfumo-parser.mjs";
import { isValidSlugParam, getClientIp, createRateLimiter } from "./lib/request-guard.mjs";

// ── Supabase-Scrape-Cache (optional) ─────────────────────────────────────────
// Wenn SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY als Env-Vars im Netlify-Dashboard
// gesetzt sind, wird gescrapte Duftdaten in die Tabelle parfum_cache geschrieben
// und vor dem Scrapen aus ihr gelesen. Fehlt einer der Werte oder schlägt die
// Supabase-Verbindung fehl, läuft die Function wie bisher (Netlify-CDN-Cache).
const SB_URL = globalThis.Deno?.env?.get("SUPABASE_URL") ?? globalThis.Deno?.env?.get("SUPABASE_REST_URL") ?? "";
const SB_SERVICE_KEY = globalThis.Deno?.env?.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage, analog CDN-Cache

const cacheHeaders = SB_SERVICE_KEY
  ? { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`, "Content-Type": "application/json" }
  : null;

async function cacheGet(key) {
  if (!SB_URL || !cacheHeaders) return null;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/parfum_cache?key=eq.${encodeURIComponent(key)}&select=data,fetched_at`,
      { headers: cacheHeaders, signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // TTL: ältere Einträge ignorieren (werden beim nächsten Upsert ersetzt)
    if (Date.now() - Date.parse(rows[0].fetched_at) > CACHE_TTL_MS) return null;
    return rows[0].data;
  } catch {
    return null; // Supabase nicht erreichbar -> Fallback auf normales Scrapen
  }
}

async function cachePut(key, data) {
  if (!SB_URL || !cacheHeaders) return;
  try {
    await fetch(`${SB_URL}/rest/v1/parfum_cache`, {
      method: "POST",
      headers: { ...cacheHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, data, fetched_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Nicht kritisch: der Duft wurde trotzdem erfolgreich gescrapt
  }
}

// ── Vollständigkeits-Check & „more data wins“ ────────────────────────────────
// Zählt die gefüllten relevanten Felder eines Duft-Datensatzes. Je höher,
// desto vollständiger (Noten, Accorde, Seasons, Meta).
const RICHNESS_FIELDS = ["top", "middle", "base", "accords", "seasons", "year", "maker", "scent_character", "longevity_sillage"];
function dataRichness(d) {
  let n = 0;
  for (const f of RICHNESS_FIELDS) {
    const v = d?.[f];
    if (typeof v === "string" && v.trim()) n += 1;
    else if (Array.isArray(v) && v.length > 0) n += 1;
    else if (v && typeof v === "object" && Object.keys(v).length > 0) n += 1;
  }
  return n;
}
/** true, wenn der Datensatz merklich unvollständig ist → lohnt Revalidation. */
function isComplete(d) {
  return dataRichness(d) >= 5;
}

/**
 * Scraped frisch und überschreibt den Cache nur, wenn der neue Stand MEHR
 * Daten enthält als der bisherige („more data wins“ – ein unvollständiger
 * alter Eintrag, z. B. ohne Saison-Chart, heilt sich so selbst).
 */
async function revalidateCache(url, cacheKey, oldData) {
  try {
    const fresh = await scrapeDuft(url);
    if (fresh && dataRichness(fresh) > dataRichness(oldData)) {
      await cachePut(cacheKey, fresh);
    }
  } catch {
    // Nicht kritisch: der Cache-Eintrag bleibt, wie er ist
  }
}

// Konstanten vor die Scraper-Funktionen verschoben (no-use-before-define):
const BASE = "https://www.parfumo.de/Parfums";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
};

/**
 * Kompletter Scrape-Vorgang: Parfumo-Seite laden, parsen und die per AJAX
 * nachgeladenen Saison-/Kuchendiagramme ergänzen.
 * Wirft bei 404 (Duft existiert nicht) und Netzwerk-/Upstream-Fehlern.
 */
async function scrapeDuft(url) {
  let upstream;
  try {
    upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    e.upstreamStatus = 0; // Netzwerkfehler
    throw e;
  }
  if (upstream.status === 404) {
    const err = new Error("Duft nicht gefunden");
    err.upstreamStatus = 404;
    throw err;
  }
  if (!upstream.ok) {
    const err = new Error(`Parfumo antwortete mit ${upstream.status}`);
    err.upstreamStatus = upstream.status;
    throw err;
  }

  const html = await upstream.text();
  const data = parse(html, url);

  // Die Saison-/Kuchendiagramme liefert Parfumo NICHT im Seiten-HTML, sondern
  // per AJAX nach (get_classification_chart.php). Dafür werden p/h/csrf_key aus
  // dem Inline-Script der Seite und die Session-Cookies der Seitenantwort
  // benötigt – ohne beides antwortet der Endpunkt leer. Ein Fehlschlag ist
  // unkritisch: data.seasons bleibt dann ungesetzt (season -> "Ganzjährig").
  try {
    const tokens = parseChartTokens(html);
    if (tokens) {
      const setCookies = typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
      const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
      const chartRes = await fetch(new URL("/action/perfume/get_classification_chart.php", url), {
        method: "POST",
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Referer: url,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: new URLSearchParams({ type: "pie", p: tokens.p, h: tokens.h, csrf_key: tokens.csrf_key }),
        signal: AbortSignal.timeout(10_000),
      });
      if (chartRes.ok) applyPieCharts(data, await chartRes.text());
    }
  } catch {
    // Ohne Chart-Daten bleibt data.seasons ungesetzt -> season fällt auf "Ganzjährig"
  }

  return data;
}

// Rate-Limit: 30 Requests pro Minute pro IP. Schutz für Parfumo (und unsere
// eigene IP bei Netlify) – Antworten sind zusätzlich 30 Tage im CDN gecacht.
// In-memory-Limiter gilt pro Function-Instanz; für harte Limits zusätzlich
// "Rate Limit Rules" im Netlify-Dashboard setzen.
const rateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

const slug = (t) => encodeURIComponent(t.trim().replace(/\s+/g, "_"));
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

export default async (req, context) => {
  // Rate-Limit vor jeder weiteren Verarbeitung (auch vor teuren 400ern)
  const rl = rateLimiter.check(getClientIp(req));
  if (!rl.allowed) {
    return json({ error: "Zu viele Anfragen – bitte kurz warten." }, 429, {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  const brand = decodeURIComponent(context.params.brand ?? "").trim();
  const name = decodeURIComponent(context.params.name ?? "").trim();
  if (!brand || !name) {
    return json({ error: "Marke und Name angeben (max. 80 Zeichen)" }, 400);
  }
  // Zeichnen-Whitelist: verhindert Pfad-/URL-Manipulation zusätzlich zum encodeURIComponent
  if (!isValidSlugParam(brand) || !isValidSlugParam(name)) {
    return json({ error: "Ungültige Zeichen in Marke oder Name" }, 400);
  }

  const url = `${BASE}/${slug(brand)}/${slug(name)}`;
  const cacheKey = `${brand.trim().toLowerCase()}/${name.trim().toLowerCase()}`;

  // 1) Supabase-Cache prüfen (vor jedem Parfumo-Request)
  const cached = await cacheGet(cacheKey);
  if (cached) {
    // Background-Revalidation: Wenn die gecachten Daten unvollständig sind
    // (z. B. Saison-Chart beim damaligen Scrape fehlgeschlagen), frisch scrapen
    // und den Cache überschreiben, falls der neue Stand MEHR Daten enthält
    // („more data wins“). Die Antwort geht sofort aus dem Cache raus.
    if (!isComplete(cached)) {
      revalidateCache(url, cacheKey, cached);
    }
    return json(cached, 200, { "X-Cache": "supabase" });
  }

  // 2) Cache-Miss: frisch scrapen
  let data;
  try {
    data = await scrapeDuft(url);
  } catch (e) {
    if (e.upstreamStatus === 404) return json({ error: "Duft nicht gefunden" }, 404);
    if (e.upstreamStatus === 0) return json({ error: "Parfumo nicht erreichbar" }, 502);
    return json({ error: e.message || "Parfumo-Fehler" }, 502);
  }

  // 3) Ergebnis in den Supabase-Cache schreiben
  await cachePut(cacheKey, data);

  return json(data, 200, {
    "X-Cache": cacheHeaders ? "miss" : "off",
    "Cache-Control": "public, max-age=3600",
    // Netlify-CDN speichert die Antwort 30 Tage -> derselbe Duft wird nur einmal abgerufen
    "Netlify-CDN-Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
  });
};

export const config = { path: "/api/parfum/:brand/:name" };
