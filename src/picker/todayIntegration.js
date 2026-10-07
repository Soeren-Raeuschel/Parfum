/**
 * todayIntegration.js – Klebstoff zwischen der "Heute"-UI (App.jsx) und der
 * Picker-Engine (pickPerfume.js / scoring.js). Reine Funktionen, kein React.
 */

import { PICKER_CONFIG } from "./pickerConfig";
import { pickPerfume } from "./pickPerfume";
import {
  getCriteriaScore,
  getCriterionValue,
  getAgingFactor,
  getFairnessFactor,
  getConcentrationModifier,
  resolveLevel,
  levelScore,
  collectWeightedNotes,
  scoreNotes,
  scoreFamilies,
} from "./scoring";
import {
  categorizeNote,
  getNoteMapping,
} from "./criteriaMapping";
import {
  perfumeFamilyList,
  categorizeFamily,
  getFamilyMapping,
  normalizeFamilyKey,
} from "./familyMapping";

const DAY_MS = 86400000;
const clamp01 = x => Math.min(1, Math.max(0, x));

// ── Konfigurierbare Konstanten (Teil 3) ──────────────────────────────────────
/** Standort für die Wetter-Vorbelegung (Open-Meteo, kein API-Key). */
export const KASSEL_COORDS = Object.freeze({ lat: 51.3127, lon: 9.4797 });

/** Ab welchem Kriterien-Score ein Chip als "hilfreich" gezählt wird. */
export const CHIP_GOOD_THRESHOLD = 0.55;

/** Chips mit weniger Treffern werden gedimmt. */
export const CHIP_DIM_COUNT = 1;

/** Schwellen für die schrittweise Lockerung (Stufe 1 → 2 → 3). */
export const RELAX_STEPS = Object.freeze([0.55, 0.45, 0.0]);

/** Mindestanzahl Kandidaten pro Stufe, bevor gelockert wird. */
export const RELAX_MIN_CANDIDATES = 1;

/** Anwendungshilfe: Sprühstöße pro Anlass (App-Occasion-IDs). */
export const SPRAY_GUIDE = Object.freeze({
  work: "1–2 Sprühstöße",
  business: "1–2 Sprühstöße",
  casual: "1–3 Sprühstöße, hautnah",
  everyday: "1–3 Sprühstöße, hautnah",
  sport: "1–3 Sprühstöße, hautnah",
  date: "1–2 Sprühstöße auf Pulsstellen",
  evening: "1–2 Sprühstöße auf Pulsstellen",
  special: "Großzügig, aber nicht erdrückend (3–4)",
  outdoor: "1–3 Sprühstöße, hautnah",
  travel: "1–3 Sprühstöße, hautnah",
  vacation: "1–3 Sprühstöße, hautnah",
  sleep: "1 Sprühstoß, hautnah",
});

/** Sprüh-Guide für einen Anlass (mit Fallback). */
export function getSprayGuide(occasion) {
  return SPRAY_GUIDE[occasion] || SPRAY_GUIDE.casual;
}

// ── Alias-Mapping: App-Chip-IDs → Picker-Keys ────────────────────────────────
const OCCASION_ALIAS = Object.freeze({ casual: "everyday", work: "business" });
const WEATHER_ALIAS = Object.freeze({ rainy: "rain" });

/**
 * Baut das Selection-Objekt für pickPerfume aus dem UI-Zustand.
 * occasion/weather werden über Aliase vereinheitlicht; "Schlafen" erzwingt
 * Leicht/Kurz (gleiche Regel wie in der bisherigen UI).
 */
export function buildPickerSelection({ season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, temperature, recentPrimaryFamilies, personalBonusMap }) {
  const isSleep = mood === "sleep" || occasion === "sleep";
  return {
    season,
    weather: weather ? (WEATHER_ALIAS[weather] || weather) : undefined,
    occasion: occasion ? (OCCASION_ALIAS[occasion] || occasion) : undefined,
    mood,
    timeOfDay,
    intensityPref: isSleep ? "light" : intensityPref,
    longevityPref: isSleep ? "short" : longevityPref,
    temperature: typeof temperature === "number" ? temperature : undefined,
    recentPrimaryFamilies: Array.isArray(recentPrimaryFamilies) ? recentPrimaryFamilies : undefined,
    personalBonusMap: personalBonusMap || undefined,
  };
}

// ── Begründungstext ──────────────────────────────────────────────────────────
const WEATHER_LABELS = Object.freeze({ sunny: "Sonnig", cloudy: "Bewölkt", rainy: "Regen", rain: "Regen", cold: "Kalt", hot: "Heiß" });
const TIME_LABELS = Object.freeze({ morning: "Morgens", afternoon: "Mittags", evening: "Abends", night: "Nachts" });

/**
 * Kurze Begründung für den vorgeschlagenen Duft, z. B.
 * "Passt zu Sonnig + Alltag, seit 47 Tagen nicht getragen".
 */
export function buildSuggestionReason(perfume, selection, daysSinceLastWorn, wearDays) {
  const parts = [];
  const matchBits = [];
  if (selection.weather) matchBits.push(WEATHER_LABELS[selection.weather] || selection.weather);
  if (selection.occasion) {
    const occLabel = selection.occasion === "everyday" ? "Alltag"
      : selection.occasion === "business" ? "Business"
      : selection.occasion.charAt(0).toUpperCase() + selection.occasion.slice(1);
    matchBits.push(occLabel);
  }
  if (selection.timeOfDay) matchBits.push(TIME_LABELS[selection.timeOfDay] || selection.timeOfDay);
  if (matchBits.length > 0) parts.push(`Passt zu ${matchBits.slice(0, 2).join(" + ")}`);

  const wearBit = daysSinceLastWorn === null || daysSinceLastWorn === undefined
    ? "noch nie getragen"
    : `seit ${Math.round(daysSinceLastWorn)} Tagen nicht getragen`;
  parts.push(wearBit);
  if (typeof wearDays === "number" && wearDays > 0) parts.push(`${wearDays}× getragen`);
  return parts.join(", ");
}

// ── Chip-Treffer-Zählung ─────────────────────────────────────────────────────
/**
 * Zählt, wie viele verfügbare Düfte (nicht im Cooldown) zu einem Chip-Wert
 * noch gut passen. kind ∈ { occasion, mood, weather, timeOfDay, intensity, longevity }.
 *
 * @returns {object} { [chipId]: anzahl }
 */
export function chipMatchCounts(perfumes, wearMap, nowTs, kind, values, baseSelection = {}) {
  const out = {};
  const pool = (perfumes || []).filter(p => {
    const e = wearMap && wearMap[String(p.id)];
    if (!e || typeof e.lastWornTs !== "number") return true;
    return (nowTs - e.lastWornTs) / DAY_MS >= PICKER_CONFIG.cooldownDays;
  });
  for (const value of values) {
    if (kind === "intensity" || kind === "longevity") {
      out[value] = pool.filter(p => levelScore(resolveLevel(p), value) >= 0.5).length;
      continue;
    }
    const sel = { ...baseSelection, [kind]: value };
    if (kind === "weather") sel.weather = WEATHER_ALIAS[value] || value;
    if (kind === "occasion") sel.occasion = OCCASION_ALIAS[value] || value;
    out[value] = pool.filter(p => getCriteriaScore(p, sel) >= CHIP_GOOD_THRESHOLD).length;
  }
  return out;
}

// ── Auswahl mit schrittweiser Lockerung ──────────────────────────────────────
/**
 * Führt die Tagesauswahl durch:
 *  1. Kandidaten-Pool = nicht ausgeschlossene Düfte
 *  2. Schrittweise Lockerung der Passungs-Schwelle, bis Kandidaten übrig sind
 *  3. Hauptvorschlag + 2 Alternativen (jeweils mit excludeIds gegen Wiederholung)
 *
 * @returns {{ perfume, alts, relaxed: string[], relaxedThreshold: number,
 *             candidates: number, info: object }}
 */
export function runPickerForToday(perfumes, wearMap, selection, { excludeIds = [], random = Math.random, nowTs = Date.now() } = {}) {
  const excluded = new Set(excludeIds.map(String));
  const pool = (perfumes || []).filter(p => p && !excluded.has(String(p.id)));

  const relaxed = [];
  let threshold = RELAX_STEPS[0];
  let usable = pool.filter(p => getCriteriaScore(p, selection) >= threshold);
  if (usable.length < RELAX_MIN_CANDIDATES) {
    threshold = RELAX_STEPS[1];
    usable = pool.filter(p => getCriteriaScore(p, selection) >= threshold);
    if (usable.length > 0) relaxed.push(`Passungs-Schwelle auf ${threshold} gelockert`);
  }
  if (usable.length < RELAX_MIN_CANDIDATES) {
    threshold = RELAX_STEPS[2];
    usable = pool;
    if (usable.length > 0) relaxed.push("Passungs-Schwelle komplett aufgehoben");
  }

  const main = pickPerfume(usable, wearMap, selection, { nowTs, random, excludeIds: [...excluded] });
  if (!main.perfume) {
    // Auch der Cooldown half nicht → letzter Versuch über den vollen Pool
    const rescue = pickPerfume(pool, wearMap, selection, { nowTs, random, excludeIds: [...excluded] });
    if (!rescue.perfume) return { perfume: null, alts: [], relaxed, relaxedThreshold: threshold, candidates: 0, info: null };
    if (rescue.usedFallback && !relaxed.includes("Cooldown gelockert")) relaxed.push("Cooldown gelockert");
    return { perfume: rescue.perfume, alts: [], relaxed, relaxedThreshold: threshold, candidates: rescue.candidates, info: rescue };
  }
  if (main.usedFallback && !relaxed.includes("Cooldown gelockert")) relaxed.push("Cooldown gelockert");
  const excludeSoFar = [...excluded, String(main.perfume.id)];

  // Alternativen: gleiche Logik, bereits Gezogenes bleibt draußen
  const alts = [];
  for (let i = 0; i < 2; i++) {
    const r = pickPerfume(usable, wearMap, selection, { nowTs, random, excludeIds: excludeSoFar });
    if (!r.perfume) break;
    alts.push(r.perfume);
    excludeSoFar.push(String(r.perfume.id));
  }

  return {
    perfume: main.perfume,
    alts,
    relaxed,
    relaxedThreshold: threshold,
    candidates: main.candidates,
    info: main,
  };
}

// ── Debug-Breakdown pro Duft ─────────────────────────────────────────────────
/** Tage seit letztem Tragen aus der Wear-Map (null = nie getragen). */
function daysSince(wearMap, perfumeId, nowTs) {
  const entry = wearMap && wearMap[String(perfumeId)];
  if (!entry || typeof entry.lastWornTs !== "number") return null;
  return Math.max(0, (nowTs - entry.lastWornTs) / DAY_MS);
}

/** Matched-Details: welche Noten/Familien treffen bei welchem Kriterium zu. */
function criterionDetails(perfume, fams, kind, key, evidenceFactor) {
  const notesMap = collectWeightedNotes(perfume);
  const noteMapping = getNoteMapping(kind, key);
  const famMapping = getFamilyMapping(kind, key);
  const matchedNotes = [];
  const matchedFamilies = [];
  for (const [note, zoneWeight] of notesMap) {
    const cat = noteMapping ? categorizeNote(note, noteMapping) : null;
    if (cat) matchedNotes.push({ note, cat, zoneWeight: Math.round(zoneWeight * 100) / 100 });
  }
  for (const { name, weight } of fams) {
    const cat = famMapping ? categorizeFamily(name, famMapping) : null;
    if (cat) matchedFamilies.push({ family: name, cat, weight });
  }
  const notesScore = scoreNotes(notesMap, noteMapping, evidenceFactor);
  const famScore = scoreFamilies(fams, famMapping, evidenceFactor);
  const value = getCriterionValue(perfume, fams, kind, key, evidenceFactor);
  return { value, notesScore, famScore, matchedNotes, matchedFamilies };
}

/**
 * Vollständiger Score-Breakdown für die Debug-Ansicht: Teilscores pro
 * Kriterium (Familien/Noten/Gewichte), Temperatur-Mischung, Aging, Fairness,
 * Zufallsbereich, Diversität, Konzentrations-Modifikator, persönlicher Bonus.
 */
export function debugBreakdown(perfume, selection, wearMap, nowTs = Date.now()) {
  if (!perfume) return null;
  const cfg = PICKER_CONFIG;
  const evO = cfg.EVIDENCE_FACTORS.occasionAndSeason;
  const evM = cfg.EVIDENCE_FACTORS.mood;
  const fams = perfumeFamilyList(perfume, cfg.FAMILY_POSITION_WEIGHTS);
  const criteria = [];

  if (selection.season) {
    const ps = (perfume.season || "").toLowerCase();
    const sel = String(selection.season).toLowerCase();
    const v = ps.includes(sel) ? 1 : ps.includes("ganzjährig") ? 0.75 : 0.2;
    criteria.push({ key: "season", label: "Saison", value: v, weight: Math.round(cfg.criterionWeights.season * evO * 100) / 100, details: null });
  }
  if (selection.occasion) criteria.push({
    key: "occasion", label: "Anlass", weight: cfg.criterionWeights.occasion,
    ...criterionDetails(perfume, fams, "occasion", selection.occasion, evO),
  });
  if (selection.mood) criteria.push({
    key: "mood", label: "Stimmung", weight: cfg.criterionWeights.mood,
    ...criterionDetails(perfume, fams, "mood", selection.mood, evM),
  });
  if (selection.weather) criteria.push({
    key: "weather", label: "Wetter", weight: cfg.criterionWeights.weather,
    ...criterionDetails(perfume, fams, "weather", selection.weather, evO),
  });
  let temperatureBlend = null;
  if (!selection.weather && typeof selection.temperature === "number") {
    const tb = cfg.TEMPERATURE_BLEND;
    const hot = getCriterionValue(perfume, fams, "weather", "hot", evO) ?? 0.5;
    const cold = getCriterionValue(perfume, fams, "weather", "cold", evO) ?? 0.5;
    const t = clamp01((selection.temperature - tb.low) / (tb.high - tb.low));
    temperatureBlend = {
      temperature: Math.round(selection.temperature * 10) / 10,
      t: Math.round(t * 100) / 100,
      hotScore: Math.round(hot * 100) / 100,
      coldScore: Math.round(cold * 100) / 100,
    };
    criteria.push({ key: "weather", label: `Wetter (Temperatur-Automatik)`, value: t * hot + (1 - t) * cold, weight: cfg.criterionWeights.weather, details: null });
  }
  if (selection.timeOfDay) criteria.push({
    key: "timeOfDay", label: "Tageszeit", weight: cfg.criterionWeights.timeOfDay,
    ...criterionDetails(perfume, fams, "time", selection.timeOfDay, evO),
  });
  const level = resolveLevel(perfume);
  if (selection.intensityPref) criteria.push({
    key: "intensity", label: "Intensität", value: levelScore(level, selection.intensityPref),
    weight: cfg.criterionWeights.intensity, level, details: null,
  });
  if (selection.longevityPref) criteria.push({
    key: "longevity", label: "Haltbarkeit", value: levelScore(level, selection.longevityPref),
    weight: cfg.criterionWeights.longevity, level, details: null,
  });

  const criteriaScore = getCriteriaScore(perfume, selection);
  const days = daysSince(wearMap, perfume.id, nowTs);
  const agingFactor = getAgingFactor(days);
  const fairnessFactor = getFairnessFactor(criteriaScore, days);
  const concModifier = getConcentrationModifier(perfume, selection);
  const personalBonus = selection.personalBonusMap ? (selection.personalBonusMap[String(perfume.id)] || 0) : 0;
  const primary = fams[0] ? fams[0].name : null;
  const diversityApplied = Array.isArray(selection.recentPrimaryFamilies) &&
    selection.recentPrimaryFamilies.map(normalizeFamilyKey).includes(primary);

  const r2 = x => Math.round(x * 1000) / 1000;
  return {
    id: perfume.id,
    name: perfume.name,
    level,
    criteria,
    criteriaScore: r2(criteriaScore),
    evidenceFactors: cfg.EVIDENCE_FACTORS,
    temperatureBlend,
    daysSinceLastWorn: days === null ? null : Math.round(days),
    agingFactor: r2(agingFactor),
    fairnessFactor,
    randomRange: [cfg.randomMin, cfg.randomMax],
    concModifier,
    diversityApplied,
    personalBonus,
    estimatedTotal: r2(criteriaScore * agingFactor * fairnessFactor),
  };
}
