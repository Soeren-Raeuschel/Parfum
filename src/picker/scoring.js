/**
 * scoring.js – Reine Scoring-Funktionen für die "Parfum des Tages"-Auswahl.
 *
 * gesamtScore = kriterienScore × alterungsFaktor × fairnessFaktor × zufallsFaktor
 *
 * Keine UI-Abhängigkeit: keine React-Imports, kein localStorage-Zugriff.
 * Alle Kriterien (Saison, Wetter, Anlass, Stimmung, Tageszeit …) wirken WEICH
 * über den Score; nur Preisbereich und Gender sind harte Filter (→ pickPerfume.js).
 *
 * Teil 2: getCriteriaScore ist jetzt datenbasiert – Noten-Mapping
 * (criteriaMapping.js) und Familien-Mapping (familyMapping.js) mit
 * HAUPT/NEBEN/MEIDEN, Zonen- und Positionsgewichtung sowie
 * kriterienScore = 0.55 × familienScore + 0.45 × notenScore (je 0–1).
 */

import { PICKER_CONFIG } from "./pickerConfig";
import {
  getNoteMapping,
  categorizeNote,
  normalizeKey,
  splitNoteString,
  ATTRACTIVENESS_SET,
  OCCASION_PERFORMANCE_HINTS,
} from "./criteriaMapping";
import {
  getFamilyMapping,
  categorizeFamily,
  normalizeFamilyKey,
  perfumeFamilyList,
} from "./familyMapping";

const clamp01 = x => Math.min(1, Math.max(0, x));

// ── Duft-Noten sammeln ───────────────────────────────────────────────────────
/**
 * Liefert alle Noten eines Dufts normalisiert, mit der höchsten Zonen-Gewichtung
 * pro Note (Basis 1.3×, Herz 1.0×, Kopf 0.7×; Duplikate zählen einmal, in der
 * stärksten Zone). Rückgabe: Map normalisierteNote → Zonen-Gewicht.
 */
export function collectWeightedNotes(perfume) {
  const zw = PICKER_CONFIG.NOTE_ZONE_WEIGHTS;
  const zones = [
    ["top", zw.top, splitNoteString(perfume.top)],
    ["heart", zw.heart, splitNoteString(perfume.middle)],
    ["base", zw.base, splitNoteString(perfume.base)],
  ];
  const map = new Map();
  for (const [, weight, notes] of zones) {
    for (const raw of notes) {
      const note = normalizeKey(raw);
      if (!note) continue;
      const prev = map.get(note);
      if (prev === undefined || weight > prev) map.set(note, weight);
    }
  }
  return map;
}

// ── Noten-Score (0–1, null = keine Information) ──────────────────────────────
/**
 * Bewertet die Noten eines Dufts gegen ein kompiliertes Mapping:
 * HAUPT +1.0, NEBEN +0.5, MEIDEN −0.7 (je × Zonen-Gewicht × Evidenz-Faktor,
 * Attraktivitäts-Noten zusätzlich × 0.4). Normalisiert zentriert auf 0.5:
 * nur HAUPT → 1.0, nur NEBEN → 0.75, nur MEIDEN → 0.15, Mischung dazwischen.
 */
export function scoreNotes(notesMap, compiled, evidenceFactor = 1) {
  if (!compiled || !(notesMap instanceof Map) || notesMap.size === 0) return null;
  const ev = PICKER_CONFIG.EVIDENCE_FACTORS;
  let raw = 0;
  let maxRaw = 0;
  let matched = false;
  for (const [note, zoneWeight] of notesMap) {
    const cat = categorizeNote(note, compiled);
    if (!cat) continue;
    matched = true;
    const base = cat === "haupt" ? 1.0 : cat === "neben" ? 0.5 : -0.7;
    const attract = ATTRACTIVENESS_SET.has(note) ? ev.attractiveness : 1;
    const w = zoneWeight * evidenceFactor * attract;
    raw += base * w;
    maxRaw += 1.0 * w;
  }
  if (!matched || maxRaw <= 0) return null;
  return clamp01(0.5 + 0.5 * (raw / maxRaw));
}

// ── Familien-Score (0–1, null = keine Information) ───────────────────────────
/**
 * Bewertet die (positionsgewichteten) Familien eines Dufts gegen ein Mapping:
 * HAUPT +1.0, NEBEN +0.5, MEIDEN −0.7 (je × Positionsgewicht × Evidenz-Faktor),
 * gleiche zentrierte Normalisierung wie scoreNotes.
 */
export function scoreFamilies(families, compiled, evidenceFactor = 1) {
  if (!compiled || !Array.isArray(families) || families.length === 0) return null;
  let raw = 0;
  let maxRaw = 0;
  let matched = false;
  for (const { name, weight } of families) {
    const cat = categorizeFamily(name, compiled);
    if (!cat) continue;
    matched = true;
    const base = cat === "haupt" ? 1.0 : cat === "neben" ? 0.5 : -0.7;
    const w = weight * evidenceFactor;
    raw += base * w;
    maxRaw += 1.0 * w;
  }
  if (!matched || maxRaw <= 0) return null;
  return clamp01(0.5 + 0.5 * (raw / maxRaw));
}

// __SCORING2__
// ── Intensität/Haltbarkeit: Nachbarstufen-Logik (SCHRITT 6.1) ────────────────
const CONC_LEVELS = { Parfum: 3, Extrait: 3, EDP: 2, EDT: 1.5, EDC: 1, Solid: 0.5 };
const PREF_LEVELS = { light: 1, short: 1, medium: 2, strong: 3, long: 3 };
// Schwacher Hinweis NUR wenn echte Daten (conc) fehlen
const HEAVY_FAMILIES = ["oriental", "harzig", "gourmand", "ledrig", "wuerzig"];
const LIGHT_FAMILIES = ["zitrisch", "fresh", "aquatisch", "grun"];

/**
 * Löst das Intensitäts-/Haltbarkeits-Level eines Dufts auf (1–3).
 * Echte Daten (Konzentration) haben immer Vorrang; fehlen sie, wird schwach
 * aus den Familien abgeleitet (schwer → 3, leicht → 1, sonst 2).
 */
export function resolveLevel(perfume) {
  if (perfume.conc && CONC_LEVELS[perfume.conc] !== undefined) {
    return CONC_LEVELS[perfume.conc];
  }
  const fams = perfumeFamilyList(perfume, PICKER_CONFIG.FAMILY_POSITION_WEIGHTS).map(f => f.name);
  if (fams.some(n => HEAVY_FAMILIES.includes(n))) return 3;
  if (fams.some(n => LIGHT_FAMILIES.includes(n))) return 1;
  return 2;
}

/**
 * Nachbarstufen: Direkter Treffer 1.0, benachbarte Stufe ca. 0.5,
 * gegenüberliegende Stufe niedrig (0.15).
 */
export function levelScore(level, pref) {
  const p = PREF_LEVELS[pref] ?? 2;
  const dist = Math.abs(level - p);
  if (dist <= 0.25) return 1;
  if (dist <= 1) return 0.5;
  return 0.15;
}

/**
 * Wendet die Anlass-Hints (z. B. "Sport: Stark abwerten", "Schlafen: Leicht
 * bevorzugen") auf einen Intensitäts-/Haltbarkeits-Teilscore an.
 */
function applyPerformanceHints(value, level, occasion, kind) {
  const hints = OCCASION_PERFORMANCE_HINTS[occasion] && OCCASION_PERFORMANCE_HINTS[occasion][kind];
  if (!hints || typeof value !== "number") return value;
  let v = value;
  if (hints.heavy !== undefined && level >= 2.6) v *= hints.heavy;
  if (hints.medium !== undefined && level >= 1.75 && level < 2.25) v *= hints.medium;
  if (hints.light !== undefined && level < 1.25) v *= hints.light;
  return Math.min(1, v);
}

// ── Kombinierter Kriterienwert (Familien + Noten) ────────────────────────────
/**
 * kriterienScore-Baustein pro Kriterium:
 * 0.55 × familienScore + 0.45 × notenScore. Fehlen Noten oder Familien, zählt
 * nur das Vorhandene; fehlt beides → null (Kriterium wird übersprungen).
 */
export function getCriterionValue(perfume, fams, kind, key, evidenceFactor) {
  const notesScore = scoreNotes(collectWeightedNotes(perfume), getNoteMapping(kind, key), evidenceFactor);
  const famScore = scoreFamilies(fams, getFamilyMapping(kind, key), evidenceFactor);
  if (notesScore === null && famScore === null) return null;
  const mix = PICKER_CONFIG.SCORE_MIX;
  let v;
  if (notesScore === null) v = famScore;
  else if (famScore === null) v = notesScore;
  else v = mix.family * famScore + mix.notes * notesScore;
  // Weiches Minimum: ein Kriterium schließt nie komplett aus
  // (hält den Score über der Fairness-Schwelle, siehe getFairnessFactor)
  return clamp01(Math.max(0.2, v));
}

// ── Konzentrations-Modifikator (SCHRITT 6.5, nur ±0.1 Netto) ─────────────────
const LIGHT_CONCS = ["EDC", "EDT", "Solid"];
const HEAVY_CONCS = ["EDP", "Parfum", "Extrait"];

/**
 * Büro/Business, Sport, Heiß, Alltag: EdT/EdC leicht bevorzugen;
 * Date, Abend, Special, Kalt: EdP/Parfum/Extrait leicht bevorzugen.
 * Modifikator ±concentrationModifier je Richtung (Netto-Unterschied ±0.1).
 */
export function getConcentrationModifier(perfume, selection) {
  if (!perfume.conc) return 0;
  const lightPref = selection.occasion === "business" || selection.occasion === "sport" ||
    selection.occasion === "everyday" || selection.weather === "hot";
  const heavyPref = selection.occasion === "date" || selection.occasion === "evening" ||
    selection.occasion === "special" || selection.weather === "cold";
  if (!lightPref && !heavyPref) return 0;
  const isLight = LIGHT_CONCS.includes(perfume.conc);
  const isHeavy = HEAVY_CONCS.includes(perfume.conc);
  if (!isLight && !isHeavy) return 0;
  const preferred = (lightPref && isLight) || (heavyPref && isHeavy);
  return preferred ? PICKER_CONFIG.concentrationModifier : -PICKER_CONFIG.concentrationModifier;
}

// __SCORING3__
// ── Diversität (SCHRITT 6.6) ─────────────────────────────────────────────────
/** −10 % Score, wenn die Hauptfamilie in den letzten 3 getragenen Düften vorkam. */
function applyDiversity(score, perfume, selection) {
  if (!PICKER_CONFIG.diversityEnabled) return score;
  const recent = selection.recentPrimaryFamilies;
  if (!Array.isArray(recent) || recent.length === 0) return score;
  const primary = perfumeFamilyList(perfume, PICKER_CONFIG.FAMILY_POSITION_WEIGHTS)[0];
  if (!primary) return score;
  const recentNorm = recent.map(normalizeFamilyKey);
  return recentNorm.includes(primary.name)
    ? score * (1 - PICKER_CONFIG.diversityPenalty)
    : score;
}

// ── Wetter-Allpass-Bonus (SCHRITT 6.3) ───────────────────────────────────────
/** true, wenn der Duft in hot, cold UND rain jeweils >= ALL_WEATHER_MIN_SCORE liegt. */
function fitsAllWeather(perfume, fams) {
  const min = PICKER_CONFIG.ALL_WEATHER_MIN_SCORE;
  for (const key of ["hot", "cold", "rain"]) {
    const v = getCriterionValue(perfume, fams, "weather", key, PICKER_CONFIG.EVIDENCE_FACTORS.occasionAndSeason);
    if (v === null || v < min) return false;
  }
  return true;
}

// ── Abhängigkeiten (SCHRITT 6.2) ─────────────────────────────────────────────
/**
 * Sinnvolle Voreinstellungen für Intensität/Haltbarkeit (überschreibbar):
 * "Sport" und "Schlafen" setzen Intensität/Haltbarkeit als Vorschlag vor.
 * Die UI kann diese Werte als Vorbelegung nutzen.
 */
export const OCCASION_DEPENDENCIES = Object.freeze({
  sport: Object.freeze({ intensityPref: "medium", longevityPref: "short" }),
  sleep: Object.freeze({ intensityPref: "light", longevityPref: "short" }),
});

/**
 * Liefert die Abhängigkeits-Voreinstellungen für die gewählte Kombination.
 * Das doppelte "Schlafen" (Stimmung + Anlass) ist vereinheitlicht (key "sleep").
 */
export function getDependencyDefaults(selection = {}) {
  const isSleep = selection.occasion === "sleep" || selection.mood === "sleep";
  const key = isSleep ? "sleep" : selection.occasion;
  return (key && OCCASION_DEPENDENCIES[key]) || null;
}

/** true, wenn "Nachts" und "Schlafen" widersprüchlich kombiniert würden. */
export function hasTimeMoodConflict(selection = {}) {
  return selection.timeOfDay === "night" &&
    (selection.occasion === "sleep" || selection.mood === "sleep");
}

// ── Kriterien-Score ──────────────────────────────────────────────────────────
/**
 * Datenbasierter Kriterien-Score (0–1) für die "Heute"-Seite.
 *
 * Weiches Scoring: Jedes Kriterium liefert pro Duft einen Passungswert 0–1;
 * ein einzelnes unpassendes Kriterium schließt nie aus. Nicht gewählte
 * Kriterien zählen neutral (werden übersprungen). Manuell gesetzte
 * Familien-Tags (selection.families) haben Vorrang vor der Ableitung.
 *
 * @param {object} perfume – Duftobjekt (conc, families[], top/middle/base, season …)
 * @param {object} [selection] – { season, occasion, mood, weather, temperature,
 *        timeOfDay, intensityPref, longevityPref, families, recentPrimaryFamilies }
 * @returns {number} Score zwischen 0 und 1
 */
export function getCriteriaScore(perfume, selection = {}) {
  if (!perfume) return 0;
  const cfg = PICKER_CONFIG;
  const evO = cfg.EVIDENCE_FACTORS.occasionAndSeason;
  const evM = cfg.EVIDENCE_FACTORS.mood;
  const weights = cfg.criterionWeights;
  const parts = []; // { value: 0..1, weight }

  // Manuell gesetzte Tags haben Vorrang vor der Ableitung
  const manualFams = Array.isArray(selection.families) && selection.families.length > 0
    ? selection.families.map(f => ({ name: normalizeFamilyKey(f), weight: 1 }))
    : null;
  const fams = manualFams || perfumeFamilyList(perfume, cfg.FAMILY_POSITION_WEIGHTS);

  // Saison (weich: Ganzjährig ist fast so gut wie ein Treffer)
  if (selection.season) {
    const ps = (perfume.season || "").toLowerCase();
    const sel = String(selection.season).toLowerCase();
    let v;
    if (ps.includes(sel)) v = 1;
    else if (ps.includes("ganzjährig")) v = 0.75;
    else v = 0.2;
    parts.push({ value: v, weight: weights.season * evO });
  }

  // Anlass
  if (selection.occasion) {
    const v = getCriterionValue(perfume, fams, "occasion", selection.occasion, evO);
    if (v !== null) parts.push({ value: v, weight: weights.occasion });
  }

  // Stimmung
  if (selection.mood) {
    const v = getCriterionValue(perfume, fams, "mood", selection.mood, evM);
    if (v !== null) parts.push({ value: v, weight: weights.mood });
  }

  // Wetter: manuelle Chips überschreiben die Temperatur-Automatik
  let usedAutoWeather = false;
  if (selection.weather) {
    const v = getCriterionValue(perfume, fams, "weather", selection.weather, evO);
    if (v !== null) parts.push({ value: v, weight: weights.weather });
  } else if (typeof selection.temperature === "number") {
    const tb = cfg.TEMPERATURE_BLEND;
    const hot = getCriterionValue(perfume, fams, "weather", "hot", evO) ?? 0.5;
    const cold = getCriterionValue(perfume, fams, "weather", "cold", evO) ?? 0.5;
    const t = clamp01((selection.temperature - tb.low) / (tb.high - tb.low));
    let v = t * hot + (1 - t) * cold;
    // Ab ca. 25 °C zusätzlich leichte, frische Düfte bevorzugen
    if (selection.temperature >= tb.hotFrom) {
      v = 0.8 * v + 0.2 * levelScore(resolveLevel(perfume), "light");
    }
    parts.push({ value: v, weight: weights.weather });
    usedAutoWeather = true;
  }

  // Tageszeit
  if (selection.timeOfDay) {
    const v = getCriterionValue(perfume, fams, "time", selection.timeOfDay, evO);
    if (v !== null) parts.push({ value: v, weight: weights.timeOfDay });
  }

  // Intensität & Haltbarkeit: Nachbarstufen + Anlass-Hints
  const level = resolveLevel(perfume);
  if (selection.intensityPref) {
    let v = levelScore(level, selection.intensityPref);
    v = applyPerformanceHints(v, level, selection.occasion, "intensity");
    parts.push({ value: v, weight: weights.intensity });
  }
  if (selection.longevityPref) {
    let v = levelScore(level, selection.longevityPref);
    v = applyPerformanceHints(v, level, selection.occasion, "longevity");
    parts.push({ value: v, weight: weights.longevity });
  }

  // Manuelle Familien zusätzlich als eigenes Kriterium (Direkt-Übereinstimmung)
  if (manualFams) {
    const perfumeNames = new Set(perfumeFamilyList(perfume, cfg.FAMILY_POSITION_WEIGHTS).map(f => f.name));
    const hits = manualFams.filter(f => perfumeNames.has(f.name)).length;
    parts.push({ value: manualFams.length ? hits / manualFams.length : 0, weight: weights.manualFamilies });
  }

  // Kein vergleichbares Kriterium → neutral
  if (parts.length === 0) return 0.5;

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.value * p.weight, 0);
  const avg = Math.min(1, Math.max(0, weighted / totalWeight));

  // Basis-Streuung: 0.3 + 0.7 × Durchschnitt. Damit sinkt auch ein "Total-Mismatch"
  // nie unter ~0.3–0.5 – sonst würde der Fairness-Bonus (Schwelle
  // fairnessMinCriteriaScore) bei schlecht passenden Düften dauerhaft nicht greifen
  // und diese würden über Monate nicht mehr gezogen.
  let score = 0.3 + 0.7 * avg;

  // Konzentrations-Modifikator
  score += getConcentrationModifier(perfume, selection);

  // Wetter-Allpass-Bonus (nur bei Temperatur-Automatik)
  if (usedAutoWeather && fitsAllWeather(perfume, fams)) {
    score += cfg.ALL_WEATHER_BONUS;
  }

  score = clamp01(score);

  // Lernschleife: persönlicher Bonus/Malus (±0.15, aus 1-Tap-Feedback).
  // Wirkt NUR auf den kriterienScore – nie auf den Alterungsfaktor.
  const pbMap = selection.personalBonusMap;
  if (pbMap && typeof pbMap === "object") {
    const pb = pbMap[String(perfume.id)];
    if (typeof pb === "number") score = clamp01(score + pb);
  }

  // Diversität (−10 % bei wiederkehrender Hauptfamilie)
  return applyDiversity(score, perfume, selection);
}

// ── Alterungsfaktor (Rotation) ───────────────────────────────────────────────
/**
 * alterungsFaktor = 1 + agingStrength × sqrt(tageSeitTragen / 30)
 * Nie getragene Düfte nutzen neverWornDays als fiktiven Wert.
 *
 * @param {number|null} daysSinceLastWorn – null = noch nie getragen
 */
export function getAgingFactor(daysSinceLastWorn, config = PICKER_CONFIG) {
  const days = daysSinceLastWorn === null || daysSinceLastWorn === undefined ? config.neverWornDays : daysSinceLastWorn;
  return 1 + config.agingStrength * Math.sqrt(Math.max(0, days) / 30);
}

// ── Fairness-Bonus ───────────────────────────────────────────────────────────
/**
 * Düfte, die länger als fairnessDays nicht dran waren UND einen ausreichend
 * guten Kriterien-Score haben, erhalten den fairnessBonus als Multiplikator.
 * Nie getragene Düfte zählen wie neverWornDays Tage Pause (gleiche Logik
 * wie im Alterungsfaktor).
 */
export function getFairnessFactor(criteriaScore, daysSinceLastWorn, config = PICKER_CONFIG) {
  const days = daysSinceLastWorn === null || daysSinceLastWorn === undefined ? config.neverWornDays : daysSinceLastWorn;
  const dormantLongEnough = days > config.fairnessDays;
  const goodEnough = criteriaScore >= config.fairnessMinCriteriaScore;
  return dormantLongEnough && goodEnough ? config.fairnessBonus : 1;
}

// ── Cooldown ─────────────────────────────────────────────────────────────────
/**
 * true, wenn der Duft innerhalb der letzten cooldownDays getragen wurde
 * (→ ausgeschlossen). Nie getragene Düfte sind nie im Cooldown.
 */
export function isOnCooldown(daysSinceLastWorn, cooldownDays = PICKER_CONFIG.cooldownDays) {
  if (daysSinceLastWorn === null || daysSinceLastWorn === undefined) return false;
  return daysSinceLastWorn < cooldownDays;
}

// ── Gesamt-Score ─────────────────────────────────────────────────────────────
/**
 * gesamtScore = kriterienScore × alterungsFaktor × fairnessFaktor × zufallsFaktor
 *
 * @param {object} args
 * @param {number} args.criteriaScore – 0..1 (aus getCriteriaScore)
 * @param {number|null} args.daysSinceLastWorn – null = noch nie getragen
 * @param {number} [args.randomFactor=1] – Zufallsmultiplikator (0.85–1.15)
 */
export function computeTotalScore({ criteriaScore, daysSinceLastWorn, randomFactor = 1 }, config = PICKER_CONFIG) {
  const aging = getAgingFactor(daysSinceLastWorn, config);
  const fairness = getFairnessFactor(criteriaScore, daysSinceLastWorn, config);
  return criteriaScore * aging * fairness * randomFactor;
}

/** Zufallsfaktor im Bereich [randomMin, randomMax]. */
export function getRandomFactor(rand = Math.random, config = PICKER_CONFIG) {
  return config.randomMin + rand() * (config.randomMax - config.randomMin);
}