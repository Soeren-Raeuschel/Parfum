// Netlify Function (v2): POST /api/groq -> Proxy zur Groq-API.
// Der API-Key liegt ausschließlich serverseitig (Env GROQ_API_KEY) und
// gelangt nie in den Browser. Der Client ruft nur noch /api/groq auf.
import { getClientIp, createRateLimiter } from "./lib/request-guard.mjs";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

// Whitelist: nur die Modelle aus dem GTM-Pool des Clients (groqClient.js)
const ALLOWED_MODELS = new Set([
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
]);

const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);

const MAX_BODY_CHARS = 64_000;    // gesamter Request-Body
const MAX_MESSAGES = 12;          // Anzahl der Chat-Nachrichten
const MAX_TOTAL_CONTENT = 20_000; // Summe aller Message-Inhalte (Zeichen)
const MAX_TOKENS = 1_000;         // Obergrenze für max_tokens

// Rate-Limit pro IP: 12/min – bewusst unterhalb des Groq-Free-Tier-Limits
// (30/min), da sich alle Besucher einen serverseitigen Key teilen.
const rateLimiter = createRateLimiter({ max: 12, windowMs: 60_000 });

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

// Header, die vom Groq-Response an den Client durchgereicht werden –
// der Client nutzt sie für sein Rate-Limit-/Cooldown-Tracking (_gtmParseHeaders).
function forwardHeaders(upstream) {
  const out = { "Content-Type": "application/json; charset=utf-8" };
  const pass = [
    "retry-after",
    "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens",
  ];
  for (const h of pass) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

/**
 * Validiert den Request-Body und bereinigt ihn auf die erlaubten Felder.
 * @param {string} raw - Der rohe Request-Body
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateGroqBody(raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, error: "Ungültiges JSON" }; }
  if (!body || typeof body !== "object") return { ok: false, error: "Body muss ein JSON-Objekt sein" };
  if (typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model)) {
    return { ok: false, error: "Unbekanntes Modell" };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: `messages muss 1–${MAX_MESSAGES} Einträge enthalten` };
  }
  let total = 0;
  for (const m of body.messages) {
    if (!m || typeof m !== "object" || !ALLOWED_ROLES.has(m.role) || typeof m.content !== "string") {
      return { ok: false, error: "messages-Einträge brauchen role (system/user/assistant) und content (String)" };
    }
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CONTENT) return { ok: false, error: "Nachrichten insgesamt zu lang" };
  if (body.temperature !== undefined
    && (typeof body.temperature !== "number" || body.temperature < 0 || body.temperature > 2)) {
    return { ok: false, error: "temperature muss eine Zahl zwischen 0 und 2 sein" };
  }
  if (body.max_tokens !== undefined
    && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > MAX_TOKENS)) {
    return { ok: false, error: `max_tokens muss eine ganze Zahl 1–${MAX_TOKENS} sein` };
  }
  // Nur die bekannten Felder an Groq weiterreichen
  const clean = {
    model: body.model,
    messages: body.messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (body.temperature !== undefined) clean.temperature = body.temperature;
  if (body.max_tokens !== undefined) clean.max_tokens = body.max_tokens;
  return { ok: true, value: clean };
}

/**
 * Kern-Handler; limiter als Parameter, damit Tests mit frischem Limiter laufen.
 */
export async function handleGroqRequest(req, limiter = rateLimiter) {
  if (req.method !== "POST") {
    return json({ error: "Nur POST erlaubt" }, 405, { Allow: "POST" });
  }

  const rl = limiter.check(getClientIp(req));
  if (!rl.allowed) {
    return json({ error: "Zu viele Anfragen – bitte kurz warten." }, 429, {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  const raw = await req.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY_CHARS) {
    return json({ error: "Payload fehlt oder ist zu groß" }, 413);
  }

  const v = validateGroqBody(raw);
  if (!v.ok) return json({ error: v.error }, 400);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return json({ error: "KI-Proxy nicht konfiguriert (GROQ_API_KEY fehlt serverseitig)." }, 503);
  }

  let upstream;
  try {
    upstream = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(v.value),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const timedOut = e && e.name === "TimeoutError";
    return json({ error: timedOut ? "Groq-Zeitüberschreitung" : "Groq nicht erreichbar" }, 502);
  }

  const text = await upstream.text().catch(() => "");
  return new Response(text, { status: upstream.status, headers: forwardHeaders(upstream) });
}

export default async (req) => handleGroqRequest(req);

export const config = { path: "/api/groq" };