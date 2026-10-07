/**
 * Kurz-Simulation: 365 Tage über die Teil-3-Integration (runPickerForToday,
 * inkl. Begründungs-/Ausschluss-Logik). Gibt Statistik für den Bericht aus.
 */
import { describe, it, expect } from "vitest";
import { setWearStoreBackend, recordWear, getWearMap } from "../wearStore";
import { buildPickerSelection, runPickerForToday } from "../todayIntegration";

const DAY_MS = 86400000;
const START = 1_700_000_000_000;
const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter"];
const FAMILIES = ["Floral", "Woody", "Oriental", "Fresh", "Chypre", "Gourmand", "Aquatisch", "Zitrisch", "Erdig", "Süß"];
const perfumes = Array.from({ length: 100 }, (_, i) => ({
  id: `t3-${i}`, name: `T3 ${i}`, gender: "Unisex", conc: ["EDP", "EDT", "EDC", "Parfum"][i % 4],
  season: SEASONS[i % 4], families: [FAMILIES[i % 10], FAMILIES[(i * 3) % 10]],
}));

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function backend() {
  const s = new Map();
  return { load: k => (s.has(k) ? s.get(k) : null), save: (k, v) => s.set(k, JSON.parse(JSON.stringify(v))) };
}

describe("Teil-3-Integration – 365 Tage", () => {
  it("rotiert auch über runPickerForToday", () => {
    const rand = mulberry32(2024);
    setWearStoreBackend(backend());
    const picks = new Map(); const days = new Map(); let relaxedDays = 0;
    for (let d = 0; d < 365; d++) {
      const nowTs = START + d * DAY_MS;
      const sel = buildPickerSelection({
        season: SEASONS[Math.floor(rand() * 4)], occasion: "casual",
        mood: "energetic", timeOfDay: "morning",
        intensityPref: ["light", "medium", "strong"][Math.floor(rand() * 3)],
        longevityPref: ["short", "medium", "long"][Math.floor(rand() * 3)],
      });
      const r = runPickerForToday(perfumes, getWearMap(), sel, { nowTs, random: rand });
      if (!r.perfume) continue;
      if (r.relaxed.length > 0) relaxedDays++;
      picks.set(r.perfume.id, (picks.get(r.perfume.id) || 0) + 1);
      if (!days.has(r.perfume.id)) days.set(r.perfume.id, []);
      days.get(r.perfume.id).push(d);
      recordWear(r.perfume.id, nowTs);
    }
    const gaps = [];
    for (const p of perfumes) {
      const ds = days.get(p.id);
      if (!ds) { gaps.push(365); continue; }
      let g = 364 - ds[ds.length - 1];
      for (let i = 1; i < ds.length; i++) g = Math.max(g, ds[i] - ds[i - 1] - 1);
      gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    const p90 = gaps[Math.floor(gaps.length * 0.9)];
    console.log(`[T3-SIM] Verschiedene Düfte: ${picks.size}/100`);
    console.log(`[T3-SIM] Wartezeiten: Median=${median}, p90=${p90}, Max=${gaps[gaps.length - 1]}`);
    console.log(`[T3-SIM] Tage mit Lockerung: ${relaxedDays}`);
    expect(picks.size).toBeGreaterThanOrEqual(60);
  });
});
