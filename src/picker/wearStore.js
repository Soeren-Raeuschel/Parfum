/**
 * wearStore.js – Kapselung der Trage-Daten ("zuletzt getragen" + Anzahl Trage-Tage).
 *
 * Alle anderen Dateien greifen NUR über die exportierten Funktionen auf diese
 * Daten zu, damit die Speicherung (lokal oder Supabase) später austauschbar ist
 * (→ setWearStoreBackend).
 *
 * Datenquellen:
 *  1. Eigener Store (Key "parfum_wear_store_v1"): { [id]: { lastWornTs, dayKeys } }
 *  2. Legacy-Trage-Log (Key "parfum_log_v2"): Array von { id, ts } – wird nur
 *     gelesen und mit dem eigenen Store zusammengeführt, damit bestehende Daten
 *     NICHT verloren gehen.
 *
 * Fehlende Werte bedeuten: "noch nie getragen" (getLastWornTs → null,
 * getDaysSinceLastWorn → null, getWearDayCount → 0).
 */

const WEAR_STORE_KEY = "parfum_wear_store_v1";
const LEGACY_LOG_KEY = "parfum_log_v2";
const FEEDBACK_STORE_KEY = "parfum_feedback_store_v1";
const DAY_MS = 86400000;
const MAX_DAY_KEYS = 2000; // Obergrenze pro Duft (Schutz vor unbegrenztem Wachstum)

// ── Lernschleife: persönlicher Bonus/Malus pro Duft & Kontext ────────────────
// Aus 1-Tap-Feedback ("Passte gut" / "Naja" / "Passte nicht") wächst ein Bonus
// zwischen −FEEDBACK_BONUS_MAX und +FEEDBACK_BONUS_MAX, der NUR den
// kriterienScore beeinflusst (nie den Aging-Faktor).
export const FEEDBACK_BONUS_MAX = 0.15;
export const FEEDBACK_STEP = 0.05; // Bonus-Schritt pro gut/schlecht-Abstand
// Feintuning: Gewicht von "Naja"-Feedback (0 = neutral; z.B. 0.25 = leicht negativ)
export const FEEDBACK_OK_WEIGHT = 0;
// Feintuning: Halbwertszeit (Tage) für Feedback-Events – älteres Feedback zählt
// exponentiell weniger (Zeit-Decay). 0 = kein Decay.
export const FEEDBACK_HALF_LIFE_DAYS = 120;

// ── Backend-Abstraktion (lokal jetzt, Supabase später) ───────────────────────
function createLocalStorageBackend() {
  return {
    load(key) {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(key, value) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Speichern darf den Picker nie crashen
      }
    },
  };
}

let backend = createLocalStorageBackend();

/**
 * Ersetzt das Speicher-Backend (z. B. durch einen Supabase-Adapter).
 * Erwartete Schnittstelle: { load(key) → any | null, save(key, value) }.
 */
export function setWearStoreBackend(nextBackend) {
  backend = nextBackend || createLocalStorageBackend();
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readOwnStore() {
  const raw = backend.load(WEAR_STORE_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function readLegacyLog() {
  const raw = backend.load(LEGACY_LOG_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(e => e && typeof e === "object" && typeof e.ts === "number" && e.id !== undefined && e.id !== null);
}

// ── Lese-Funktionen ──────────────────────────────────────────────────────────
/**
 * Liefert die zusammengeführte Trage-Map: { [id]: { lastWornTs, wearDays } }.
 * lastWornTs ist undefined, wenn der Duft noch nie getragen wurde.
 */
export function getWearMap() {
  const merged = new Map();

  const ensure = id => {
    if (!merged.has(id)) merged.set(id, { lastWornTs: 0, dayKeys: new Set() });
    return merged.get(id);
  };

  // 1. Legacy-Log (read-only) einfließen lassen – bestehende Daten bleiben erhalten
  for (const entry of readLegacyLog()) {
    const e = ensure(String(entry.id));
    if (entry.ts > e.lastWornTs) e.lastWornTs = entry.ts;
    e.dayKeys.add(dayKeyOf(entry.ts));
  }

  // 2. Eigener Store überschreibt/ergänzt (neuere Writes haben Vorrang)
  const own = readOwnStore();
  for (const [id, entry] of Object.entries(own)) {
    if (!entry || typeof entry !== "object") continue;
    const e = ensure(id);
    if (typeof entry.lastWornTs === "number" && entry.lastWornTs > e.lastWornTs) {
      e.lastWornTs = entry.lastWornTs;
    }
    if (Array.isArray(entry.dayKeys)) {
      for (const k of entry.dayKeys) if (typeof k === "string") e.dayKeys.add(k);
    }
  }

  const out = {};
  for (const [id, e] of merged.entries()) {
    out[id] = {
      lastWornTs: e.lastWornTs > 0 ? e.lastWornTs : undefined,
      wearDays: e.dayKeys.size,
    };
  }
  return out;
}

/** Timestamp des letzten Tragens oder null (= noch nie getragen). */
export function getLastWornTs(perfumeId, wearMap = null) {
  const map = wearMap || getWearMap();
  const entry = map[String(perfumeId)];
  return entry && typeof entry.lastWornTs === "number" ? entry.lastWornTs : null;
}

/** Tage seit dem letzten Tragen oder null (= noch nie getragen). */
export function getDaysSinceLastWorn(perfumeId, nowTs = Date.now(), wearMap = null) {
  const lastWornTs = getLastWornTs(perfumeId, wearMap);
  if (lastWornTs === null || lastWornTs === undefined) return null;
  return Math.max(0, (nowTs - lastWornTs) / DAY_MS);
}

/** Anzahl unterschiedlicher Trage-Tage (0 = noch nie getragen). */
export function getWearDayCount(perfumeId, wearMap = null) {
  const map = wearMap || getWearMap();
  const entry = map[String(perfumeId)];
  return entry && typeof entry.wearDays === "number" ? entry.wearDays : 0;
}

// ── Schreib-Funktionen ───────────────────────────────────────────────────────
/**
 * Vermerkt ein Tragen des Dufts (Tag + Timestamp) im eigenen Store.
 * Das Legacy-Log wird nicht angetastet (keine Daten gehen verloren).
 */
export function recordWear(perfumeId, ts = Date.now()) {
  if (perfumeId === null || perfumeId === undefined) return;
  const own = readOwnStore();
  const id = String(perfumeId);
  const entry = own[id] && typeof own[id] === "object" ? own[id] : { lastWornTs: 0, dayKeys: [] };
  const dayKeys = new Set(Array.isArray(entry.dayKeys) ? entry.dayKeys : []);
  if (typeof ts === "number") {
    entry.lastWornTs = Math.max(typeof entry.lastWornTs === "number" ? entry.lastWornTs : 0, ts);
    dayKeys.add(dayKeyOf(ts));
  }
  own[id] = {
    lastWornTs: entry.lastWornTs,
    // Slice von hinten: die jüngsten Tage bleiben erhalten
    dayKeys: [...dayKeys].slice(-MAX_DAY_KEYS),
  };
  backend.save(WEAR_STORE_KEY, own);
}

// ── Lernschleife: Feedback & persönlicher Bonus ──────────────────────────────
/**
 * Kontext-Schlüssel für Feedback: "anlass|stimmung" (z. B. "business|calm").
 * Beide Teile sind optional; fehlt einer → nur der andere.
 */
export function feedbackContextKey(occasion, mood) {
  const o = occasion || "", m = mood || "";
  return `${o}|${m}`;
}

function readFeedbackStore() {
  const raw = backend.load(FEEDBACK_STORE_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Vermerkt 1-Tap-Feedback für einen Duft in einem Kontext.
 * @param {"good"|"ok"|"bad"} rating – "Passte gut" / "Naja" / "Passte nicht"
 */
export function recordFeedback(perfumeId, contextKey, rating) {
  if (perfumeId === null || perfumeId === undefined || !contextKey) return;
  if (rating !== "good" && rating !== "ok" && rating !== "bad") return;
  const own = readFeedbackStore();
  const id = String(perfumeId);
  const entry = own[id] && typeof own[id] === "object" ? own[id] : {};
  const ctx = entry[contextKey] && typeof entry[contextKey] === "object"
    ? { good: 0, ok: 0, bad: 0, ...entry[contextKey] }
    : { good: 0, ok: 0, bad: 0 };
  ctx[rating] += 1;
  // Event-Historie für Zeit-Decay (rückwärtskompatibel: alte Einträge ohne hist
  // fallen automatisch auf die reinen Counts zurück)
  if (!Array.isArray(ctx.hist)) ctx.hist = [];
  ctx.hist.push({ r: rating, ts: Date.now() });
  // Obergrenze, damit der Store nicht unbegrenzt wächst
  if (ctx.hist.length > 200) ctx.hist = ctx.hist.slice(-200);
  entry[contextKey] = ctx;
  own[id] = entry;
  backend.save(FEEDBACK_STORE_KEY, own);
}

/**
 * Persönlicher Bonus/Malus (−0.15…+0.15) für einen Duft in einem Kontext.
 * Formel: (gut − schlecht) × FEEDBACK_STEP, geklemmt auf ±FEEDBACK_BONUS_MAX.
 * "Naja" ist neutral (zählt weder gut noch schlecht). Beeinflusst NUR den
 * kriterienScore, nie den Aging-Faktor.
 *
 * Feineres Tuning: Wenn Event-Historie (hist) vorhanden ist, wird jedes Event
 * mit Zeit-Decay gewichtet (Halbwertszeit FEEDBACK_HALF_LIFE_DAYS), und "Naja"
 * geht mit FEEDBACK_OK_WEIGHT ein. Ohne hist gilt die klassische Count-Formel.
 * @param {number} [nowTs] – current time (nur für Tests, Standard Date.now())
 */
export function getPersonalBonus(perfumeId, contextKey, feedbackMap = null, nowTs = Date.now()) {
  const map = feedbackMap || readFeedbackStore();
  const entry = map[String(perfumeId)];
  const ctx = entry && entry[contextKey];
  if (!ctx || typeof ctx !== "object") return 0;

  // Feinere Gewichtung über Event-Historie (mit Decay), falls vorhanden
  if (Array.isArray(ctx.hist) && ctx.hist.length > 0) {
    let good = 0, bad = 0, ok = 0;
    for (const ev of ctx.hist) {
      if (!ev || typeof ev !== "object") continue;
      let w = 1;
      if (FEEDBACK_HALF_LIFE_DAYS > 0 && typeof ev.ts === "number") {
        const days = Math.max(0, (nowTs - ev.ts) / DAY_MS);
        w = Math.pow(0.5, days / FEEDBACK_HALF_LIFE_DAYS);
      }
      if (ev.r === "good") good += w;
      else if (ev.r === "bad") bad += w;
      else if (ev.r === "ok") ok += w;
    }
    const raw = Math.round((good + ok * FEEDBACK_OK_WEIGHT - bad) * FEEDBACK_STEP * 1000) / 1000;
    return Math.max(-FEEDBACK_BONUS_MAX, Math.min(FEEDBACK_BONUS_MAX, raw));
  }

  // Klassischer Fallback: reine Counts (ältere Daten ohne hist)
  const good = typeof ctx.good === "number" ? ctx.good : 0;
  const bad = typeof ctx.bad === "number" ? ctx.bad : 0;
  const ok = typeof ctx.ok === "number" ? ctx.ok : 0;
  const raw = Math.round((good + ok * FEEDBACK_OK_WEIGHT - bad) * FEEDBACK_STEP * 1000) / 1000;
  return Math.max(-FEEDBACK_BONUS_MAX, Math.min(FEEDBACK_BONUS_MAX, raw));
}

/**
 * Rohes Feedback-Count-Map für einen Kontext: { [id]: { good, ok, bad, events } }.
 * Für Transparenz-Ansichten ("Warum dieser Vorschlag?") – kein Scoring.
 */
export function getFeedbackCountsMap(contextKey, feedbackMap = null) {
  const map = feedbackMap || readFeedbackStore();
  const out = {};
  for (const [id, entry] of Object.entries(map)) {
    const ctx = entry && entry[contextKey];
    if (!ctx || typeof ctx !== "object") continue;
    out[id] = {
      good: typeof ctx.good === "number" ? ctx.good : 0,
      ok: typeof ctx.ok === "number" ? ctx.ok : 0,
      bad: typeof ctx.bad === "number" ? ctx.bad : 0,
      events: Array.isArray(ctx.hist) ? ctx.hist.length : 0,
    };
  }
  return out;
}

/** Rohes Feedback-Map: { [id]: { [contextKey]: { good, ok, bad } } }. */
export function getFeedbackMap() {
  return readFeedbackStore();
}

/**
 * Persönliche Bonus-Map für ALLE Düfte in einem Kontext:
 * { [id]: bonus } – direkt als selection.personalBonusMap nutzbar.
 */
export function getPersonalBonusMap(contextKey, feedbackMap = null) {
  const map = feedbackMap || readFeedbackStore();
  const out = {};
  for (const [id, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== "object") continue;
    const bonus = getPersonalBonus(id, contextKey, map);
    if (bonus !== 0) out[id] = bonus;
  }
  return out;
}
