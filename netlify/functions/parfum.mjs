// Netlify Function (v2): GET /api/parfum/:brand/:name  ->  JSON mit Noten, Accorden, Jahreszeiten, ...
import { parse, parseChartTokens, applyPieCharts } from "./lib/parfumo-parser.mjs";
import { isValidSlugParam, getClientIp, createRateLimiter } from "./lib/request-guard.mjs";

const BASE = "https://www.parfumo.de/Parfums";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
};

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
  let upstream;
  try {
    upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  } catch {
    return json({ error: "Parfumo nicht erreichbar" }, 502);
  }
  if (upstream.status === 404) return json({ error: "Duft nicht gefunden" }, 404);
  if (!upstream.ok) return json({ error: `Parfumo antwortete mit ${upstream.status}` }, 502);

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

  return json(data, 200, {
    "Cache-Control": "public, max-age=3600",
    // Netlify-CDN speichert die Antwort 30 Tage -> derselbe Duft wird nur einmal abgerufen
    "Netlify-CDN-Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
  });
};

export const config = { path: "/api/parfum/:brand/:name" };
