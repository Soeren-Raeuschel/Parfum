/**
 * Lokale Speicher-Implementierung mit localStorage.
 * Entspricht der bisherigen Logik aus App.js (gleiche KEYS, JSON-Format).
 * Alle Methoden geben Promises zurück (kompatibel zu Supabase-Adapter später).
 *
 * Exportiert sanitizePerfume und ONBOARD_STYLES für die Nutzung in App.js.
 */

import { normalizeFamilyKey } from "../picker/familyMapping";

const KEYS = {
  items: "parfum_collection_v2",
  log: "parfum_log_v2",
  notes: "parfum_notes_v1",
  wishlist: "parfum_wishlist_v1",
  prefs: "parfum_prefs_v1",
  fillLevels: "parfum_fill_v1",
  onboarding: "parfum_onboard_v1",
  groqKey: "parfum_groq_key_v1",
  priceMl: "parfum_price_ml_v1",
  userNotePrefs: "parfum_user_note_prefs_v1",
  userFamilyPrefs: "parfum_user_family_prefs_v1",
  declutterStatus: "parfum_declutter_status_v1",
};

// --- Constants (copied from App.js) ---
const FAMILIES = [
  "Floral", "Woody", "Oriental", "Fresh", "Chypre", "Fougère",
  "Gourmand", "Aquatisch", "Süß", "Würzig", "Grün",
  "Animalisch", "Harzig", "Ledrig", "Rauchig", "Pudrig",
  "Zitrisch", "Erdig", "Cremig", "Fruchtig", "Synthetisch",
  "Sonstiges"
];

const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];

const NOTE_CATEGORIES = ["Süß", "Würzig", "Grün", "Animalisch", "Harzig", "Synthetisch",
  "Rauchig", "Fougère", "Aquatisch", "Pudrig", "Zitrisch", "Erdig",
  "Cremig", "Fruchtig"];

const ONBOARD_STYLES = [
  { id: "eindruck", label: "Eindruck", color: "#534AB7" },
  { id: "anlass", label: "Anlass", color: "#0F6E56" },
  { id: "performance", label: "Performance", color: "#BA7517" },
  { id: "vergleich", label: "Vergleich", color: "#185FA5" },
  { id: "sonstiges", label: "Sonstiges", color: "#5F5E5A" },
];

let pushErrorFn = console.error;

function safeParseJSON(raw, fallback) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function hydrateArray(raw, fallback) {
  const v = safeParseJSON(raw, fallback);
  return Array.isArray(v) ? v : fallback;
}

function hydrateObject(raw, fallback) {
  const v = safeParseJSON(raw, fallback);
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
}

function hydrateItems(raw) {
  return hydrateArray(raw, []).filter(x => x && typeof x === "object");
}

function hydrateLog(raw) {
  return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.ts === "number").slice(-1000);
}

function hydrateWishlist(raw) {
  return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.name === "string");
}

function hydrateNotes(raw) {
  const o = safeParseJSON(raw, null);
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const out = {};
  for (const k of Object.keys(o)) {
    if (k === "__proto__" || k === "constructor" || k.length > 200) continue;
    out[k] = o[k];
  }
  return out;
}

function hydrateFillLevels(raw) {
  const o = hydrateObject(raw, {});
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof k === "string" && k.length < 200 && typeof v === "number" && [100, 75, 50, 25, 0].includes(v)) out[k] = v;
  }
  return out;
}

function hydratePriceMl(raw) {
  const o = hydrateObject(raw, {});
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof k === "string" && k.length < 200 && v && typeof v === "object") {
      const price = Number(v.price);
      const ml = Number(v.ml);
      if (Number.isFinite(price) && price >= 0 && Number.isFinite(ml) && ml > 0) out[k] = { price, ml };
    }
  }
  return out;
}

function hydratePrefs(raw) {
  const o = hydrateObject(raw, { appName: "Sillage" });
  const name = typeof o.appName === "string" ? o.appName.slice(0, 80) : "Sillage";
  return { ...o, appName: name || "Sillage" };
}

// --- sanitizePerfume (from App.js) ---
// eslint-disable-next-line no-unused-vars -- exported for App.js
// Nur absolute http(s)-URLs durchlassen – importierte/gespeicherte Werte könnten
// sonst javascript:-URIs enthalten, die als <a href> gerendert werden (XSS).
function safeUrl(v, max = 2048) {
  const s = String(v === null || v === undefined ? "" : v).trim().slice(0, max);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch { return ""; }
}

// Kanonische App-Familie für einen Rohbegriff ("Frisch", "Holzig", "Zitrus" …):
// über Synonym-Mapping normalisieren und case-insensitiv auf FAMILIES mappen.
const FAMILY_BY_KEY = Object.fromEntries(FAMILIES.map(f => [normalizeFamilyKey(f), f]));

function sanitizePerfume(item) {
  const src = item && typeof item === "object" ? item : {};
  const cleanStr = (v, max = 300) => String(v === null || v === undefined ? "" : v).trim().slice(0, max);
  const canonFamily = raw => FAMILY_BY_KEY[normalizeFamilyKey(raw)] || null;
  const famRaw = cleanStr(src.family, 80);
  const seasonRaw = cleanStr(src.season, 80);
  // Familien-Fallback: auch Parfumo-Rohbegriffe auf kanonische Familien mappen,
  // bevor "Sonstiges" greift (gescrapte Accorde sonst immer "Sonstiges").
  const fam = canonFamily(famRaw) || (FAMILIES.includes(famRaw) ? famRaw : "Sonstiges");
  const season = SEASONS.some(s => seasonRaw.includes(s)) ? seasonRaw : "Ganzjährig";
  const ratingNum = Number.parseInt(src.rating, 10);

  // Handle families array - keep first family as family for compatibility, store all in families
  let families = [];
  if (Array.isArray(src.families)) {
    families = src.families.map(canonFamily).filter(Boolean);
  }
  if (families.length === 0 && fam && fam !== "Sonstiges") {
    families = [fam];
  }

  return {
    id: cleanStr(src.id, 80) || newId(),
    name: cleanStr(src.name, 220),
    house: cleanStr(src.house, 180),
    conc: cleanStr(src.conc, 40),
    family: families.length > 0 ? families[0] : "Sonstiges",
    families: families,
    top: cleanStr(src.top, 2000),
    middle: cleanStr(src.middle, 2000),
    base: cleanStr(src.base, 2000),
    season,
    gender: cleanStr(src.gender, 40) || "Unisex",
    format: cleanStr(src.format, 20),
    url: safeUrl(src.url),
    spotify_url: safeUrl(src.spotify_url),
    rating: Number.isFinite(ratingNum) ? Math.min(5, Math.max(0, ratingNum)) : 0,
    note_categories: Array.isArray(src.note_categories) ? src.note_categories.filter(c => NOTE_CATEGORIES.includes(c)).slice(0, 3) : [],
    addedAt: typeof src.addedAt === "number" ? src.addedAt : (src.addedAt ? new Date(src.addedAt).getTime() : Date.now()),
  };
}

// --- newId helper ---
function newId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { }
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
}

const localAdapter = {
  async loadAll() {
    try {
      return {
        items: hydrateItems(localStorage.getItem(KEYS.items)),
        log: hydrateLog(localStorage.getItem(KEYS.log)),
        notes: hydrateNotes(localStorage.getItem(KEYS.notes)),
        wishlist: hydrateWishlist(localStorage.getItem(KEYS.wishlist)),
        prefs: hydratePrefs(localStorage.getItem(KEYS.prefs)),
        userNotePrefs: safeParseJSON(localStorage.getItem(KEYS.userNotePrefs), []),
        userFamilyPrefs: safeParseJSON(localStorage.getItem(KEYS.userFamilyPrefs), []),
        fillLevels: hydrateFillLevels(localStorage.getItem(KEYS.fillLevels)),
        priceMl: hydratePriceMl(localStorage.getItem(KEYS.priceMl)),
        declutterStatus: safeParseJSON(localStorage.getItem(KEYS.declutterStatus), {}),
        onboarded: !!localStorage.getItem(KEYS.onboarding),
      };
    } catch (e) {
      pushErrorFn(e);
      return {
        items: [], log: [], notes: {}, wishlist: [],
        prefs: { appName: "Sillage" }, userNotePrefs: [], userFamilyPrefs: [],
        fillLevels: {}, priceMl: {}, declutterStatus: {}, onboarded: false,
      };
    }
  },

  async saveItems(items) {
    try { localStorage.setItem(KEYS.items, JSON.stringify(items)); }
    catch (e) { pushErrorFn(e); }
  },

  async saveLog(log) {
    try { localStorage.setItem(KEYS.log, JSON.stringify(log)); }
    catch (e) { pushErrorFn(e); }
  },

  async saveNotes(notes) {
    try { localStorage.setItem(KEYS.notes, JSON.stringify(notes)); }
    catch (e) { pushErrorFn(e); }
  },

  async saveWishlist(list) {
    try { localStorage.setItem(KEYS.wishlist, JSON.stringify(list)); }
    catch (e) { pushErrorFn(e); }
  },

  async saveSettings({ prefs, userNotePrefs, userFamilyPrefs }) {
    try {
      if (prefs !== undefined) localStorage.setItem(KEYS.prefs, JSON.stringify(prefs));
      if (userNotePrefs !== undefined) localStorage.setItem(KEYS.userNotePrefs, JSON.stringify(userNotePrefs));
      if (userFamilyPrefs !== undefined) localStorage.setItem(KEYS.userFamilyPrefs, JSON.stringify(userFamilyPrefs));
    } catch (e) { pushErrorFn(e); }
  },

  async saveFillLevels(map) {
    try { localStorage.setItem(KEYS.fillLevels, JSON.stringify(map)); }
    catch (e) { pushErrorFn(e); }
  },

  async savePriceMl(map) {
    try { localStorage.setItem(KEYS.priceMl, JSON.stringify(map)); }
    catch (e) { pushErrorFn(e); }
  },

  async saveDeclutterStatus(map) {
    try { localStorage.setItem(KEYS.declutterStatus, JSON.stringify(map)); }
    catch (e) { pushErrorFn(e); }
  },

  async setOnboarded(bool) {
    try {
      if (bool) {
        localStorage.setItem(KEYS.onboarding, JSON.stringify({ done: true, ts: Date.now() }));
      } else {
        localStorage.removeItem(KEYS.onboarding);
      }
    } catch (e) { pushErrorFn(e); }
  },

  setPushError(fn) { pushErrorFn = fn; },
};

export { localAdapter, sanitizePerfume, ONBOARD_STYLES, newId };