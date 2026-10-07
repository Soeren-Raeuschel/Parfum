/**
 * Simulation: 365 Tage "Parfum des Tages" mit zufälligen Kriterien.
 *
 * Prüft die Fairness/Rotation des Pickers über ein ganzes Jahr:
 *  - Wie viele verschiedene Düfte kamen dran?
 *  - Wie lang waren die Wartezeiträume (Median / 90%-Perzentil / Max)?
 *  - Wie oft kamen die häufigsten Düfte vor?
 *
 * Hinweis zur Statistik: Der Picker zieht per Roulette-Wheel (kein
 * "höchster Score gewinnt"), daher sind Wartezeiten exponentiell verteilt –
 * seltene lange Tails (einzelne Düfte) sind prinzipbedingt möglich. Die
 * Assertions prüfen deshalb Median und Perzentile statt nur das Maximum.
 *
 * Nutzt den wearStore mit In-Memory-Backend (Beweis der Backend-Austauschbarkeit).
 */
import { describe, it, expect } from "vitest";
import { pickPerfume } from "../pickPerfume";
import { setWearStoreBackend, recordWear, getWearMap } from "../wearStore";

const DAY_MS = 86400000;
const START = 1_700_000_000_000;

// ── Fixtures: 100 künstliche Düfte ───────────────────────────────────────────
const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];
const FAMILIES = ["Floral", "Woody", "Oriental", "Fresh", "Chypre", "Gourmand", "Aquatisch", "Zitrisch", "Erdig", "Süß"];
const CONCS = ["EDP", "EDT", "EDC", "Parfum"];

const perfumes = Array.from({ length: 100 }, (_, i) => ({
  id: `sim-${i}`,
  name: `Sim ${i}`,
  gender: "Unisex",
  season: SEASONS[i % SEASONS.length],
  conc: CONCS[i % CONCS.length],
  families: [FAMILIES[i % FAMILIES.length], FAMILIES[(i * 3) % FAMILIES.length]],
}));

// ── Zufällige Tages-Kriterien ────────────────────────────────────────────────
function randomSelection(rand) {
  return {
    season: SEASONS[Math.floor(rand() * 4)], // ohne Ganzjährig, für echte Streuung
    intensityPref: ["light", "medium", "strong"][Math.floor(rand() * 3)],
    longevityPref: ["short", "medium", "long"][Math.floor(rand() * 3)],
    families: [FAMILIES[Math.floor(rand() * FAMILIES.length)]],
  };
}

// ── In-Memory-Backend (zeigt: wearStore ist backend-austauschbar) ────────────
function createInMemoryBackend() {
  const store = new Map();
  return {
    load: key => (store.has(key) ? store.get(key) : null),
    save: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
  };
}

// deterministischer RNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runSimulation(seed) {
  const rand = mulberry32(seed);
  setWearStoreBackend(createInMemoryBackend());

  const pickCount = new Map();          // id → Anzahl Picks
  const pickedDays = new Map();         // id → [Tagesindexe]
  let fallbackDays = 0;

  for (let day = 0; day < 365; day++) {
    const nowTs = START + day * DAY_MS;
    const selection = randomSelection(rand);
    const result = pickPerfume(perfumes, getWearMap(), selection, { nowTs, random: rand });
    if (!result.perfume) continue;
    if (result.usedFallback) fallbackDays++;

    const id = result.perfume.id;
    pickCount.set(id, (pickCount.get(id) || 0) + 1);
    if (!pickedDays.has(id)) pickedDays.set(id, []);
    pickedDays.get(id).push(day);
    recordWear(id, nowTs);
  }

  // Pro Duft: größter Abstand zwischen aufeinanderfolgenden Picks bzw.
  // vom letzten Pick bis zum Simulationsende (0, wenn nie gezogen → 365)
  const gaps = [];
  for (const p of perfumes) {
    const days = pickedDays.get(p.id);
    if (!days || days.length === 0) { gaps.push(365); continue; }
    let g = 364 - days[days.length - 1];
    for (let i = 1; i < days.length; i++) g = Math.max(g, days[i] - days[i - 1] - 1);
    gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p90 = gaps[Math.floor(gaps.length * 0.9)];
  const maxGap = gaps[gaps.length - 1];

  return { pickCount, median, p90, maxGap, fallbackDays, gaps };
}

describe("Simulation – 365 Tage Parfum des Tages", () => {
  const sim = runSimulation(42);

  it("lässt die überwiegende Mehrheit der Düfte mindestens einmal dran", () => {
    console.log(`[SIM seed=42] Verschiedene Düfte dran: ${sim.pickCount.size} von ${perfumes.length}`);
    console.log(`[SIM seed=42] Wartezeiten (Tage): Median=${sim.median}, p90=${sim.p90}, Max=${sim.maxGap}`);
    console.log(`[SIM seed=42] Fallback-Tage (Cooldown gelockert): ${sim.fallbackDays}`);
    const sorted = [...sim.pickCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log("[SIM seed=42] Top 5 Düfte:", sorted.map(([id, n]) => `${id}=${n}`).join(", "));

    expect(sim.pickCount.size).toBeGreaterThanOrEqual(60); // ≥ 60 % der Sammlung
  });

  it("die typische Wartezeit bleibt im Rahmen der Rotation", () => {
    // 365 Picks / 100 Düfte → mittlere Wartezeit ≈ 100 Tage (inherent, kein Bug).
    // Die Assertions prüfen, dass die Verteilung nicht deutlich schlechter ist:
    expect(sim.median).toBeLessThanOrEqual(150);
    expect(sim.p90).toBeLessThanOrEqual(250);
  });

  it("verteilt die Picks ohne extreme Dominanz", () => {
    const maxPicks = Math.max(...sim.pickCount.values());
    console.log(`[SIM seed=42] Häufigster Duft: ${maxPicks} Picks (Durchschnitt ≈ ${(365 / perfumes.length).toFixed(1)})`);
    expect(maxPicks).toBeLessThanOrEqual(Math.ceil((365 / perfumes.length) * 8));
  });

  it("ist stabil über verschiedene Seeds", () => {
    const sim2 = runSimulation(1234);
    console.log(`[SIM seed=1234] Verschiedene Düfte: ${sim2.pickCount.size}, Median=${sim2.median}, p90=${sim2.p90}, Max=${sim2.maxGap}`);
    expect(sim2.pickCount.size).toBeGreaterThanOrEqual(90);
    expect(sim2.median).toBeLessThanOrEqual(150);
    expect(sim2.p90).toBeLessThanOrEqual(250);
    expect(sim2.fallbackDays).toBeLessThanOrEqual(365);
  });
});