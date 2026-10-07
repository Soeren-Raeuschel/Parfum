/**
 * pickPerfume.js – Gewichtete Zufallsziehung (Roulette-Wheel) für den
 * "Parfum des Tages"-Vorschlag.
 *
 * - Harte Filter: NUR Gender und Preisbereich (mit Schutzschild: wird der Pool
 *   dadurch leer/kleiner als 3, wird der jeweilige Filter gelockert und das
 *   Ergebnis vermerkt es in skippedHardFilters).
 * - Weiche Kriterien: alles andere wirkt über den Score (→ scoring.js).
 * - Cooldown: kürzlich getragene Düfte sind ausgeschlossen; bleibt danach nichts
 *   übrig, wird der Cooldown schrittweise halbiert (relaxedCooldownDays im
 *   Ergebnis mitgeliefert).
 * - excludeIds: optionale IDs, die komplett ausgeschlossen bleiben
 *   (später für "Anderer Vorschlag").
 */

import { PICKER_CONFIG } from "./pickerConfig";
import { getCriteriaScore, computeTotalScore, getRandomFactor, isOnCooldown } from "./scoring";

const DAY_MS = 86400000;

/** Tage seit letztem Tragen aus der Wear-Map (null = nie getragen). */
function daysSince(wearMap, perfumeId, nowTs) {
  const entry = wearMap && wearMap[String(perfumeId)];
  if (!entry || typeof entry.lastWornTs !== "number") return null;
  return Math.max(0, (nowTs - entry.lastWornTs) / DAY_MS);
}

/**
 * Wendet einen harten Filter an, aber nur solange genug Kandidaten übrig bleiben
 * (Schutzschild wie in der bestehenden Engine: < 3 Ergebnisse → Filter lockern).
 */
function applyHardFilter(pool, predicate) {
  const filtered = pool.filter(predicate);
  if (filtered.length >= 3) return { pool: filtered, skipped: false };
  return { pool, skipped: filtered.length > 0 && filtered.length < 3 };
}

/**
 * Wählt per Roulette-Wheel einen Duft aus.
 *
 * @param {Array} perfumes – Duftliste
 * @param {object} wearMap – { [id]: { lastWornTs, wearDays } } (aus wearStore.getWearMap())
 * @param {object} [selection] – Kriterien des Users (season, genderPref, priceRange,
 *                               priceMl, intensityPref, longevityPref, families …)
 * @param {object} [options]
 * @param {string[]} [options.excludeIds] – IDs, die nie gewählt werden dürfen
 * @param {Function} [options.random] – Zufallsquelle (injectierbar für Tests)
 * @param {number} [options.nowTs] – "Jetzt"-Timestamp (injectierbar für Tests)
 * @param {object} [options.config] – PICKER_CONFIG-Override
 * @returns {{ perfume: object|null, relaxedCooldownDays: number, usedFallback: boolean,
 *             candidates: number, skippedHardFilters: string[] }}
 */
export function pickPerfume(perfumes, wearMap = {}, selection = {}, options = {}) {
  const config = options.config || PICKER_CONFIG;
  const excludeIds = new Set((options.excludeIds || []).map(String));
  const random = options.random || Math.random;
  const nowTs = options.nowTs ?? Date.now();
  const skippedHardFilters = [];

  let pool = (perfumes || []).filter(p => p && !excludeIds.has(String(p.id)));

  // ── Harte Filter: Gender ──────────────────────────────────────────────────
  if (selection.genderPref) {
    const gf = selection.genderPref.toLowerCase();
    const res = applyHardFilter(
      pool,
      p => {
        const g = (p.gender || "").toLowerCase();
        return g.includes(gf) || g === "unisex";
      }
    );
    pool = res.pool;
    if (res.skipped) skippedHardFilters.push("genderPref");
  }

  // ── Harte Filter: Preisbereich ────────────────────────────────────────────
  if (selection.priceRange && selection.priceMl) {
    const res = applyHardFilter(pool, p => {
      const pm = selection.priceMl[p.id];
      if (!pm) return false; // ohne Preisdaten nicht bewertbar → raus
      const pricePerMl = pm.price / pm.ml;
      if (selection.priceRange === "luxury") return pricePerMl > 1.5;
      if (selection.priceRange === "budget") return pricePerMl < 0.4;
      return pricePerMl >= 0.4 && pricePerMl <= 1.5; // mid
    });
    pool = res.pool;
    if (res.skipped) skippedHardFilters.push("priceRange");
  }

  // ── Cooldown mit schrittweiser Lockerung ──────────────────────────────────
  let cooldown = config.cooldownDays;
  let usedFallback = false;
  let finalPool = [];
  for (;;) {
    finalPool = pool.filter(p => !isOnCooldown(daysSince(wearMap, p.id, nowTs), cooldown));
    if (finalPool.length > 0) break;
    if (cooldown <= 1) {
      // Cooldown komplett aufgehoben – nur harte Filter bleiben
      finalPool = pool;
      break;
    }
    cooldown = Math.floor(cooldown / 2);
    usedFallback = true;
  }

  if (finalPool.length === 0) {
    return { perfume: null, relaxedCooldownDays: cooldown, usedFallback: true, candidates: 0, skippedHardFilters };
  }

  // ── Roulette-Wheel über die Gesamt-Scores ─────────────────────────────────
  const scored = finalPool.map(p => {
    const days = daysSince(wearMap, p.id, nowTs);
    const criteriaScore = getCriteriaScore(p, selection);
    return {
      perfume: p,
      criteriaScore,
      daysSinceLastWorn: days,
      totalScore: computeTotalScore({
        criteriaScore,
        daysSinceLastWorn: days,
        randomFactor: getRandomFactor(random, config),
      }, config),
    };
  });

  const total = scored.reduce((sum, s) => sum + Math.max(s.totalScore, 1e-9), 0);
  let pick = random() * total;
  let chosen = scored[scored.length - 1];
  for (const s of scored) {
    pick -= Math.max(s.totalScore, 1e-9);
    if (pick <= 0) { chosen = s; break; }
  }

  return {
    perfume: chosen.perfume,
    relaxedCooldownDays: cooldown,
    usedFallback,
    candidates: finalPool.length,
    skippedHardFilters,
    _scored: scored, // Transparenz für UI/Debug (kann ignoriert werden)
  };
}