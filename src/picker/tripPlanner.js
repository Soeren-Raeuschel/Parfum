/**
 * tripPlanner.js – Reise-/Set-Planer ("Ich fahre 3 Tage nach X").
 *
 * Wiederverwendet die komplette Picker-Logik: Pro Reisetag (Wetter × Anlass)
 * wird ein Tagesslot gebildet und jeder Duft mit getCriteriaScore()
 * (→ scoring.js) bewertet. Der Duft-Score ist der Mittelwert über alle Slots.
 *
 * Auswahl: Greedy über die Kandidaten mit Diversitäts-Penalty – ein Flakon,
 * dessen Hauptfamilie schon im Set ist, wird abgewertet (diversityPenalty),
 * damit die 2–3 Vorschläge möglichst viele Wetter-/Anlass-Lagen abdecken.
 *
 * Bewusst KEIN Cooldown/Roulette: Beim Packen dürfen auch kürzlich getragene
 * Favoriten mitkommen. Reine Funktion, kein React, kein localStorage.
 */

import { getCriteriaScore, resolveLevel } from "./scoring";
import { perfumeFamilyList, normalizeFamilyKey } from "./familyMapping";
import { PICKER_CONFIG } from "./pickerConfig";

// UI-Wetter-Chips (sunny/rainy) auf kompilierte Wetter-Keys (hot/rain) mappen,
// gleiche Alias-Idee wie buildPickerSelection in todayIntegration.js.
const TRIP_WEATHER_ALIAS = Object.freeze({ sunny: "hot", rainy: "rain" });

/** Maximalanzahl Flakons im Set. */
export const TRIP_TOP_N = 3;

/** Diversitäts-Penalty je bereits vertretener Hauptfamilie (multipliziert auf avg). */
export const TRIP_DIVERSITY_PENALTY = 0.15;

/**
 * Baut die Tagesslots: Slot i bekommt Wetter i und Anlass i (rotierend,
 * damit bei 3 Tagen × 2 Wettern beide berücksichtigt werden).
 *
 * @param {number} days – Reisedauer in Tagen (1–14, wird geklemmt)
 * @param {string[]} weathers – UI-Wetter-IDs (leer → "sunny")
 * @param {string[]} occasions – Anlass-IDs (leer → "casual")
 */
export function buildTripSlots(days = 3, weathers = [], occasions = []) {
  const n = Math.min(14, Math.max(1, Math.round(days) || 3));
  const w = weathers.length ? weathers : ["sunny"];
  const o = occasions.length ? occasions : ["casual"];
  const slots = [];
  for (let i = 0; i < n; i++) {
    const rawW = w[i % w.length];
    const occ = o[i % o.length];
    slots.push({
      day: i + 1,
      weather: TRIP_WEATHER_ALIAS[rawW] || rawW,
      weatherLabel: rawW,
      occasion: occ,
    });
  }
  return slots;
}

/**
 * Baut das Selection-Objekt für getCriteriaScore aus einem Slot
 * (gleiche Felder wie buildPickerSelection, ohne UI-Aliase).
 */
export function buildTripSelection({ season, weather, occasion, intensityPref, longevityPref }) {
  return {
    season,
    weather,
    occasion,
    intensityPref: intensityPref || undefined,
    longevityPref: longevityPref || undefined,
  };
}

/**
 * Plant das Reise-Set.
 *
 * @param {Array} perfumes – Duftliste aus der Sammlung
 * @param {object} opts
 * @param {number} [opts.days=3]
 * @param {string[]} [opts.weathers]
 * @param {string[]} [opts.occasions]
 * @param {string} [opts.season] – aktuelle Saison (z. B. aus legacyScoring.getSeason())
 * @param {string} [opts.intensityPref] – "light"|"medium"|"strong"
 * @param {string} [opts.longevityPref] – "short"|"medium"|"long"
 * @param {number} [opts.topN=3] – max. Flakons im Set
 * @param {string[]} [opts.excludeIds] – ausgeschlossene IDs ("Andere Vorschläge")
 * @param {number} [opts.diversityPenalty]
 * @returns {{ slots: object[], picks: object[], candidates: number }}
 *   picks[i]: { perfume, avgScore, adjustedScore, slotScores, bestSlots,
 *               level, primary, duplicateOfPrimary }
 */
export function planTrip(perfumes, opts = {}) {
  const {
    days = 3,
    weathers = [],
    occasions = [],
    season,
    intensityPref,
    longevityPref,
    topN = TRIP_TOP_N,
    excludeIds = [],
    diversityPenalty = TRIP_DIVERSITY_PENALTY,
  } = opts;

  const slots = buildTripSlots(days, weathers, occasions);
  const excl = new Set((excludeIds || []).map(String));
  const pool = (perfumes || []).filter(p => p && p.id && !excl.has(String(p.id)));
  if (pool.length === 0) return { slots, picks: [], candidates: 0 };

  // Je Duft: Score pro Slot (Kriterien-Score der Picker-Engine) + Mittelwert
  const scored = pool.map(p => {
    const slotScores = slots.map(s => {
      const v = getCriteriaScore(p, buildTripSelection({
        season, weather: s.weather, occasion: s.occasion, intensityPref, longevityPref,
      }));
      return typeof v === "number" ? v : 0.5; // fehlende Daten = neutral
    });
    const avg = slotScores.reduce((a, b) => a + b, 0) / slotScores.length;
    const fams = perfumeFamilyList(p, PICKER_CONFIG.FAMILY_POSITION_WEIGHTS);
    const primary = fams[0] ? normalizeFamilyKey(fams[0].name) : null;
    return {
      perfume: p,
      avgScore: avg,
      slotScores,
      level: resolveLevel(p),
      primary,
      // bester Slot pro Duft (für die Begründung in der UI)
      bestSlotIdx: slotScores.reduce((bi, v, i) => (v > slotScores[bi] ? i : bi), 0),
    };
  });

  // ── Greedy-Auswahl mit Familien-Diversität ─────────────────────────────────
  const remaining = [...scored];
  const famCount = {};
  const picks = [];
  const target = Math.min(topN, remaining.length);
  for (let k = 0; k < target; k++) {
    if (remaining.length === 0) break;
    let best = null;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dup = c.primary && famCount[c.primary] ? famCount[c.primary] * diversityPenalty : 0;
      const adj = c.avgScore * (1 - dup);
      if (!best || adj > best.adjustedScore) { best = { ...c, adjustedScore: adj, duplicateOfPrimary: dup > 0 }; bestIdx = i; }
    }
    if (!best) break;
    remaining.splice(bestIdx, 1);
    if (best.primary) famCount[best.primary] = (famCount[best.primary] || 0) + 1;
    picks.push(best);
  }

  // Begründungs-Daten pro Pick: Slots, in denen der Duft am besten passt
  const withBest = picks.map(p => {
    const bestScore = Math.max(...p.slotScores);
    const bestSlots = p.slotScores
      .map((v, i) => ({ slot: slots[i], score: v }))
      .filter(s => s.score >= bestScore - 1e-9 && bestScore > 0.55);
    return { ...p, bestSlots };
  });

  return { slots, picks: withBest, candidates: scored.length };
}

/** Kurze deutsche Begründung für einen Pick (UI). */
export function tripPickReason(pick, slots) {
  const pct = Math.round(pick.avgScore * 100);
  if (pick.bestSlots && pick.bestSlots.length > 0) {
    const s = pick.bestSlots[0].slot;
    const wx = { sunny: "Sonnig", hot: "Heiß", cold: "Kalt", rain: "Regen", rainy: "Regen", cloudy: "Bewölkt" };
    const occLabels = {
      casual: "Alltag", work: "Business", business: "Business", date: "Date",
      evening: "Abend", sport: "Sport", special: "Special", outdoor: "Outdoor",
      travel: "Reise", vacation: "Urlaub", sleep: "Schlafen",
    };
    return `Passt am besten an Tag ${s.day}: ${wx[s.weatherLabel] || s.weatherLabel} + ${occLabels[s.occasion] || s.occasion} (${pct}% Ø-Passung)`;
  }
  return `Solide Allround-Passung für ${slots.length} Tag(e) (${pct}% Ø-Passung)`;
}
