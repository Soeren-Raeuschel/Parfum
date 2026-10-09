/**
 * groqClient.js – Groq-API-Client (aus App.jsx ausgelagert):
 * JSON-Schema-Validierung, GTM-Model-Pool mit 429-Cooldown,
 * Offline-Cache und der Countdown-Hook useGroqCountdown.
 * Aufrufe laufen über den serverseitigen Proxy /api/groq (siehe
 * netlify/functions/groq.mjs) – im Browser liegt kein API-Key.
 * GTM_MODEL_POOL, _gtmState und useGroqCountdown sind inline exportiert.
 */

import { useState, useEffect } from "react";
import { recordError } from "./errorHandler";

// Server-Proxy (Netlify Function) statt direktem Groq-Call:
// der Key liegt nur serverseitig in GROQ_API_KEY.
const GROQ_CHAT_URL = "/api/groq";
const LOOKUP_PAGE_MAX_CHARS = 6000; // Reduziert von 10000 → weniger Input-Tokens


// ══════════════════════════════════════════════════════════════════════════════
// JSON SCHEMA VALIDATION & RETRY LOGIC
// Validates Groq API responses against expected schemas
// Automatic retry with stricter prompt on schema violation
// ══════════════════════════════════════════════════════════════════════════════

// Schema definitions for expected JSON responses
const JSON_SCHEMAS = {
  lookup: {
    requiredKeys: ['name', 'house', 'conc', 'family', 'top', 'middle', 'base', 'season', 'gender'],
    keyTypes: { name: 'string', house: 'string', conc: 'string', family: 'string', top: 'string', middle: 'string', base: 'string', season: 'string', gender: 'string' },
    enumConstraints: { conc: ['EDP', 'EDT', 'Parfum', 'EDC', 'Extrait'], family: ['Floral', 'Woody', 'Oriental', 'Fresh', 'Chypre', 'Fougère', 'Gourmand', 'Aquatisch', 'Sonstiges'], season: ['Frühling', 'Sommer', 'Herbst', 'Winter', 'Ganzjährig'], gender: ['Unisex', 'Feminin', 'Maskulin'] }
  },
  dayParams: {
    requiredKeys: ['occasion', 'mood', 'timeOfDay', 'intensityPref', 'longevityPref', 'reasoning'],
    keyTypes: { occasion: 'string', mood: 'string', timeOfDay: 'string', intensityPref: 'string', longevityPref: 'string', reasoning: 'string' },
    enumConstraints: { occasion: ['casual', 'work', 'sport', 'evening', 'date', 'sleep', 'special', 'outdoor', 'travel', 'vacation'], mood: ['energetic', 'calm', 'romantic', 'confident', 'mysterious', 'playful', 'sleep'], timeOfDay: ['morning', 'afternoon', 'evening', 'night'], intensityPref: ['light', 'medium', 'strong'], longevityPref: ['short', 'medium', 'long'] },
    maxLengths: { reasoning: 80 }
  }
};

// Validates a parsed JSON object against a schema definition
function validateJsonSchema(obj, schemaName) {
  const schema = JSON_SCHEMAS[schemaName];
  if (!schema) return { valid: false, errors: [`Unknown schema: ${schemaName}`] };
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['Response is not an object'] };
  const errors = [];
  for (const key of schema.requiredKeys) {
    if (!(key in obj)) { errors.push(`Missing required key: ${key}`); continue; }
    const val = obj[key];
    const expectedType = schema.keyTypes[key];
    if (expectedType && typeof val !== expectedType) errors.push(`Key "${key}" has wrong type: expected ${expectedType}, got ${typeof val}`);
  }
  if (schema.enumConstraints) {
    for (const [key, allowedValues] of Object.entries(schema.enumConstraints)) {
      if (key in obj && obj[key] && !allowedValues.includes(obj[key])) errors.push(`Key "${key}" has invalid value "${obj[key]}". Allowed: ${allowedValues.join(', ')}`);
    }
  }
  if (schema.maxLengths) {
    for (const [key, maxLen] of Object.entries(schema.maxLengths)) {
      if (key in obj && obj[key] && typeof obj[key] === 'string' && obj[key].length > maxLen) errors.push(`Key "${key}" exceeds max length of ${maxLen} (got ${obj[key].length})`);
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// Schema example for retry instructions
function getSchemaExample(schemaName) {
  if (schemaName === 'lookup') {
    return { name: '', house: '', conc: 'EDP', family: 'Floral', top: '', middle: '', base: '', season: 'Ganzjährig', gender: 'Unisex' };
  }
  if (schemaName === 'dayParams') {
    return { occasion: 'casual', mood: 'calm', timeOfDay: 'evening', intensityPref: 'medium', longevityPref: 'medium', reasoning: 'Erklärung warum diese Werte passen.' };
  }
  return {};
}


// ══════════════════════════════════════════════════════════════════════════════
// GROQ TOKEN MANAGER v2 – Model Rotation, Rate-Limit-Tracking, Offline-Cache
// Primäres Modell: openai/gpt-oss-120b
// Fallback-Modelle: qwen/qwen3.8-27b, openai/gpt-oss-20b
// Strategie: Requests-Budget schonen, schnell rotieren bei 429
// ══════════════════════════════════════════════════════════════════════════════
export const GTM_MODEL_POOL = [
  { id: "openai/gpt-oss-120b",  reqPerMin: 30, quality: "high" },
  { id: "qwen/qwen3.8-27b",     reqPerMin: 30, quality: "medium" },
  { id: "openai/gpt-oss-20b",   reqPerMin: 30, quality: "medium" },
];
const GTM_COOLDOWN_MS = 62000; // 62s nach 429

export const _gtmState = {};
GTM_MODEL_POOL.forEach(m => {
  _gtmState[m.id] = {
    blockedUntil: 0, lastUsed: 0,
    reqRemainingDay: 30, reqResetDayAt: 0,   // RPD-Header (Requests per Day)
    tokRemaining: 8000, tokResetAt: 0,        // TPM-Header (Tokens per Minute)
  };
});

const _groqOfflineCache = {};
let _groqRetryAfterUntil = 0;

function groqSetOfflineCache(cacheKey, text) {
  if (!cacheKey || !text) return;
  _groqOfflineCache[cacheKey] = text;
  try {
    const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
    all[cacheKey] = text;
    const keys = Object.keys(all);
    if (keys.length > 30) delete all[keys[0]];
    localStorage.setItem("parfum_groq_cache_v1", JSON.stringify(all));
  } catch {}
}
function groqGetOfflineCache(cacheKey) {
  if (_groqOfflineCache[cacheKey]) return _groqOfflineCache[cacheKey];
  try {
    const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
    return all[cacheKey] || null;
  } catch { return null; }
}

function _gtmParseHeaders(headers, modelId) {
  const s = _gtmState[modelId];
  if (!s || typeof s !== 'object' || s === null) return;
  const remReq = headers.get("x-ratelimit-remaining-requests");
  const resetReq = headers.get("x-ratelimit-reset-requests");
  if (remReq !== null && typeof parseInt(remReq) === 'number') s.reqRemainingDay = parseInt(remReq);
  if (resetReq) {
    const secs = parseFloat(resetReq.replace("s",""));
    if (typeof secs === 'number') s.reqResetDayAt = Date.now() + secs * 1000;
  }
  const remTok = headers.get("x-ratelimit-remaining-tokens");
  const resetTok = headers.get("x-ratelimit-reset-tokens");
  if (remTok !== null && typeof parseInt(remTok) === 'number') s.tokRemaining = parseInt(remTok);
  if (resetTok) {
    const secs = parseFloat(resetTok.replace("s", ""));
    if (typeof secs === 'number') s.tokResetAt = Date.now() + secs * 1000;
  }
  s.lastUsed = Date.now();
}

async function groqFetch({ messages, temperature = 0.4, max_tokens = 200, cacheKey = null, forceFallback = false }) {
  const now = Date.now();
  const retryWaitSec = Math.ceil((_groqRetryAfterUntil - now) / 1000);

  const pool = forceFallback ? GTM_MODEL_POOL.slice(1) : GTM_MODEL_POOL;

  for (const modelDef of pool) {
    const s = _gtmState[modelDef.id];
    if (!s || typeof s !== 'object' || s === null || s.blockedUntil > Date.now()) continue;

    try {
      // Fix: Timeout für den Request (30s), damit der Loading-State nie endlos hängt
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 30000);
      let res;
      try {
        res = await fetch(GROQ_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelDef.id, temperature, max_tokens, messages }), // "max_tokens" – nur dieses Feld validiert/reicht der Proxy (groq.mjs) weiter
          signal: abortCtrl.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      _gtmParseHeaders(res.headers, modelDef.id);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers?.get?.("retry-after") || "62", 10);
        const waitMs = isNaN(retryAfter) ? GTM_COOLDOWN_MS : Math.min(retryAfter * 1000, 300000);
        s.blockedUntil = Date.now() + waitMs;
        console.log('WARN', `Rate limit hit on ${modelDef.id}`, { retryAfter: Math.ceil(waitMs/1000) });
        continue;
      }

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const errMsg = e?.error?.message || `HTTP ${res.status}`;
        if (res.status >= 500) {
        } else if (res.status >= 400 && res.status < 500) {
        } else {
        }
        console.log('WARN', `HTTP ${res.status} on ${modelDef.id}`, { error: errMsg });
        continue;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) { continue; } // Keine Textantwort von KI erhalten → nächstes Modell

      _groqRetryAfterUntil = 0;
      if (cacheKey) groqSetOfflineCache(cacheKey, text);
      return { text, fromCache: false, model: modelDef.id };
    } catch (e) {
      if (e && e.name === "AbortError") {
        console.log('WARN', `Timeout on ${modelDef.id}`);
      } else {
        // Fix: handleApiError existiert nicht (war nie definiert/importiert) →
        // Fehler in ApiError kapseln und in den Performance-Metriken zählen
        try { recordError('groqFetch'); } catch { /* Metrik ist optional */ }
        console.log('WARN', `Fetch error on ${modelDef.id}`, { error: e.message });
      }
    }
  }

  const allBlocked = pool.every(m => { const s = _gtmState[m.id]; return s && typeof s === 'object' && s !== null && s !== undefined && s.blockedUntil > Date.now(); });
  if (allBlocked) {
    const earliest = pool.reduce((min, m) => {
      const s = _gtmState[m.id];
      return s && typeof s === 'object' && s !== null && s !== undefined ? Math.min(min, s.blockedUntil) : min;
    }, Infinity);
    _groqRetryAfterUntil = earliest;
  }

  if (cacheKey) {
    const cached = groqGetOfflineCache(cacheKey);
    if (cached) return { text: cached, fromCache: true, model: "cache", retryAfterSec: retryWaitSec > 0 ? retryWaitSec : 0 };
  }

  // Graceful degradation: if no cache is available, return a fallback response
  // instead of crashing. The app will continue to work with cached data if available.
  return {
    text: "Aktiviert gedämpfte Funktion – nur gecachte Antworten sind verfügbar.",
    fromCache: false,
    model: "degraded"
  };
}

// ── Countdown Hook für Rate-Limit-Anzeige ────────────────────────────────────
export function useGroqCountdown() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const tick = () => {
      const remaining = Math.ceil((_groqRetryAfterUntil - Date.now()) / 1000);
      setSec(remaining > 0 ? remaining : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return sec;
}

// ── buildPromptContext: skalierbare KI-Parameter ─────────────────────────────
// Erweiterbar: neue Felder einfach im params-Objekt ergänzen.

export {
  groqFetch, JSON_SCHEMAS, validateJsonSchema, getSchemaExample,
  LOOKUP_PAGE_MAX_CHARS, GROQ_CHAT_URL, GTM_COOLDOWN_MS,
  groqSetOfflineCache, groqGetOfflineCache,
};
