/**
 * familyMapping.js – Familien-Mapping pro Kriterium für den "Parfum des Tages"-Picker.
 *
 * Familiennamen sind an das echte Datenmodell angepasst (FAMILIES-Array aus
 * App.jsx / localAdapter.js): Floral, Woody, Oriental, Fresh, Chypre, Fougère,
 * Gourmand, Aquatisch, Süß, Würzig, Grün, Animalisch, Harzig, Ledrig, Rauchig,
 * Pudrig, Zitrisch, Erdig, Cremig, Fruchtig, Synthetisch, Sonstiges.
 *
 * Ähnliche Begriffe aus der Vorgabe wurden zusammengeführt:
 *   Blumig→Floral, Holzig→Woody, Orientalisch→Oriental, Frisch→Fresh,
 *   Aromatisch→Fougère, Tierisch→Animalisch, Tropisch→Cremig, Erdig/Moosig→Erdig.
 *
 * HAUPT (+1.0), NEBEN (+0.5), MEIDEN (−0.7); Matching case-insensitive
 * inkl. Umlaut-Normalisierung und Teilstrings.
 */

import { normalizeKey, splitNoteString } from "./criteriaMapping";

/** Familien-Synonyme (rohe Nutzer-/Import-Begriffe → kanonischer Familienname). */
export const FAMILY_SYNONYMS = {
  blumig: "floral", holzig: "woody", orientalisch: "oriental", frisch: "fresh",
  aromatisch: "fougere", tierisch: "animalisch", moosig: "erdig",
  "erdig/moosig": "erdig", tropisch: "cremig", ambrriert: "harzig", ambriert: "harzig",
  zitrus: "zitrisch", wasser: "aquatisch",
};

/** Normalisiert einen Familiennamen (Umlaute raus, Synonym aufgelöst). */
export function normalizeFamilyKey(raw) {
  const t = normalizeKey(raw);
  return FAMILY_SYNONYMS[t] || t;
}

// ── Anlass-Familien (SCHRITT 5) ──────────────────────────────────────────────
export const OCCASION_FAMILIES = {
  everyday: {
    haupt: ["Fresh", "Zitrisch", "Fougère", "Woody"],
    neben: ["Fruchtig", "Floral", "Grün", "Süß"],
    meiden: ["Animalisch", "Rauchig", "Ledrig"],
  },
  business: {
    haupt: ["Fresh", "Zitrisch", "Fougère", "Aquatisch", "Pudrig"],
    neben: ["Grün", "Woody", "Floral"],
    meiden: ["Gourmand", "Süß", "Animalisch", "Rauchig", "Ledrig", "Oriental"],
  },
  date: {
    haupt: ["Süß", "Oriental", "Gourmand", "Würzig", "Woody", "Floral"],
    neben: ["Fruchtig", "Pudrig", "Harzig"],
    meiden: ["Aquatisch", "Grün"],
  },
  evening: {
    haupt: ["Oriental", "Würzig", "Harzig", "Ledrig", "Rauchig", "Gourmand", "Woody"],
    neben: ["Süß", "Floral", "Animalisch"],
    meiden: ["Zitrisch", "Aquatisch", "Grün"],
  },
  sport: {
    haupt: ["Fresh", "Zitrisch", "Aquatisch", "Grün", "Fougère"],
    neben: ["Fruchtig", "Woody"],
    meiden: ["Süß", "Gourmand", "Oriental", "Harzig", "Ledrig", "Animalisch", "Würzig"],
  },
  special: {
    haupt: ["Oriental", "Harzig", "Ledrig", "Floral", "Würzig", "Animalisch"],
    neben: ["Gourmand", "Süß", "Woody", "Pudrig"],
    meiden: ["Aquatisch", "Fresh"],
  },
  outdoor: {
    haupt: ["Woody", "Grün", "Fougère", "Erdig", "Rauchig", "Aquatisch"],
    neben: ["Fresh", "Zitrisch", "Würzig"],
    meiden: ["Gourmand", "Süß", "Pudrig"],
  },
  travel: {
    haupt: ["Fresh", "Zitrisch", "Woody", "Fougère"],
    neben: ["Grün", "Würzig", "Floral"],
    meiden: ["Gourmand", "Oriental", "Animalisch"],
  },
  vacation: {
    haupt: ["Aquatisch", "Zitrisch", "Fruchtig", "Fresh", "Floral", "Cremig"],
    neben: ["Grün", "Süß", "Fougère"],
    meiden: ["Oriental", "Harzig", "Ledrig", "Rauchig", "Würzig"],
  },
  sleep: {
    haupt: ["Pudrig", "Süß", "Woody", "Floral", "Fougère"],
    neben: ["Gourmand", "Harzig", "Animalisch"],
    meiden: ["Zitrisch", "Fresh", "Würzig", "Aquatisch"],
  },
};

// ── Wetter-Familien (SCHRITT 5) ──────────────────────────────────────────────
export const WEATHER_FAMILIES = {
  hot: {
    haupt: ["Zitrisch", "Fresh", "Aquatisch", "Fruchtig", "Grün"],
    neben: [],
    meiden: ["Oriental", "Harzig", "Gourmand", "Ledrig", "Rauchig"],
  },
  cold: {
    haupt: ["Oriental", "Gourmand", "Süß", "Würzig", "Harzig", "Ledrig", "Woody"],
    neben: [],
    meiden: ["Aquatisch", "Fresh", "Zitrisch"],
  },
  rain: {
    haupt: ["Grün", "Woody", "Aquatisch", "Erdig"],
    neben: ["Fougère", "Würzig"],
    meiden: ["Süß"],
  },
  cloudy: { haupt: [], neben: ["Woody", "Floral", "Fougère"], meiden: [] },
};

// ── Tageszeit-Familien (SCHRITT 5) ───────────────────────────────────────────
export const TIME_FAMILIES = {
  morning: {
    haupt: ["Fresh", "Zitrisch", "Fougère", "Grün"],
    neben: [],
    meiden: ["Oriental", "Harzig"],
  },
  afternoon: {
    haupt: ["Fresh", "Fruchtig", "Floral", "Aquatisch", "Woody"],
    neben: [],
    meiden: [],
  },
  evening: {
    haupt: ["Würzig", "Woody", "Süß", "Floral", "Oriental"],
    neben: ["Gourmand"],
    meiden: [],
  },
  night: {
    haupt: ["Oriental", "Gourmand", "Süß", "Harzig", "Ledrig", "Rauchig", "Pudrig"],
    neben: [],
    meiden: ["Zitrisch", "Aquatisch", "Grün"],
  },
};

// ── Stimmungs-Familien (SCHRITT 5) ───────────────────────────────────────────
export const MOOD_FAMILIES = {
  energetic: {
    haupt: ["Zitrisch", "Fresh", "Fougère", "Fruchtig"],
    neben: ["Würzig"],
    meiden: [],
  },
  calm: {
    haupt: ["Pudrig", "Woody", "Floral", "Fougère"],
    neben: ["Süß", "Gourmand", "Fruchtig"],
    meiden: [],
  },
  confident: {
    haupt: ["Woody", "Würzig", "Ledrig", "Fougère", "Oriental"],
    neben: [],
    meiden: [],
  },
  romantic: {
    haupt: ["Floral", "Süß", "Pudrig", "Gourmand", "Fruchtig"],
    neben: [],
    meiden: [],
  },
  mysterious: {
    haupt: ["Rauchig", "Harzig", "Oriental", "Ledrig", "Animalisch", "Würzig"],
    neben: [],
    meiden: [],
  },
  playful: {
    haupt: ["Fruchtig", "Süß", "Gourmand", "Zitrisch"],
    neben: [],
    meiden: [],
  },
};

// ── Kompilierung ─────────────────────────────────────────────────────────────
function compileAll(map) {
  const out = {};
  for (const [key, entry] of Object.entries(map)) {
    out[key] = {
      haupt: (entry.haupt || []).map(normalizeFamilyKey),
      neben: (entry.neben || []).map(normalizeFamilyKey),
      meiden: (entry.meiden || []).map(normalizeFamilyKey),
    };
  }
  return out;
}

const COMPILED = {
  occasion: compileAll(OCCASION_FAMILIES),
  mood: compileAll(MOOD_FAMILIES),
  weather: compileAll(WEATHER_FAMILIES),
  time: compileAll(TIME_FAMILIES),
};
// Stimmung "Schlafen" = Anlass "Schlafen" (vereinheitlicht, SCHRITT 6.2)
COMPILED.mood.sleep = COMPILED.occasion.sleep;

/** Liefert das kompilierte Familien-Mapping für eine Kriterien-Art und einen Schlüssel. */
export function getFamilyMapping(kind, key) {
  const group = COMPILED[kind];
  return group ? group[key] || null : null;
}

/**
 * Ordnet einen (normalisierten) Familiennamen einer Kategorie zu.
 * Priorität: HAUPT vor NEBEN vor MEIDEN; Teilstrings erlaubt (min. 3 Zeichen).
 */
export function categorizeFamily(familyKey, compiled) {
  if (!compiled || !familyKey) return null;
  const hit = list =>
    list.some(f =>
      familyKey === f ||
      (f.length >= 3 && familyKey.includes(f)) ||
      (familyKey.length >= 3 && f.includes(familyKey))
    );
  if (hit(compiled.haupt)) return "haupt";
  if (hit(compiled.neben)) return "neben";
  if (hit(compiled.meiden)) return "meiden";
  return null;
}

/**
 * Gewichtetet Familienliste eines Dufts: Position 0 = 1.0, 1 = 0.6, 2 = 0.35
 * (Gewichte kommen aus PICKER_CONFIG.FAMILY_POSITION_WEIGHTS via scoring.js).
 */
export function perfumeFamilyList(perfume, positionWeights) {
  const arr = Array.isArray(perfume.families) && perfume.families.length
    ? perfume.families
    : (perfume.family ? [perfume.family] : []);
  return arr.slice(0, 3).map((name, i) => ({
    name: normalizeFamilyKey(name),
    weight: positionWeights[i] ?? 0.35,
  }));
}

/** Hat der Duft überhaupt Noten? (für "zählt nur das Vorhandene") */
export function perfumeHasNotes(perfume) {
  return splitNoteString(perfume.top).length > 0 ||
    splitNoteString(perfume.middle).length > 0 ||
    splitNoteString(perfume.base).length > 0;
}