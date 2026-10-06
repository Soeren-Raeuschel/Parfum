// Netlify Function (v2): GET /api/parfum/:brand/:name  ->  JSON mit Noten, Accorden, Jahreszeiten, ...
import { parse } from "./lib/parfumo-parser.mjs";

const BASE = "https://www.parfumo.de/Parfums";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
};

const slug = (t) => encodeURIComponent(t.trim().replace(/\s+/g, "_"));
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

export default async (req, context) => {
  const brand = decodeURIComponent(context.params.brand ?? "").trim();
  const name = decodeURIComponent(context.params.name ?? "").trim();
  if (!brand || !name || brand.length > 80 || name.length > 80) {
    return json({ error: "Marke und Name angeben (max. 80 Zeichen)" }, 400);
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

  const data = parse(await upstream.text(), url);
  return json(data, 200, {
    "Cache-Control": "public, max-age=3600",
    // Netlify-CDN speichert die Antwort 30 Tage -> derselbe Duft wird nur einmal abgerufen
    "Netlify-CDN-Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
  });
};

export const config = { path: "/api/parfum/:brand/:name" };
