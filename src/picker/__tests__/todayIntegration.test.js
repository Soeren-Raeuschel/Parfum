/**
 * Tests für die Teil-3-Integration: Lernschleife (persönlicher Bonus ±0.15,
 * nur kriterienScore), "Anderer Vorschlag" (excludeIds über runPickerForToday),
 * Chip-Treffer-Zählung, Begründungstext und Sprüh-Guide.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setWearStoreBackend, recordWear, getDaysSinceLastWorn, getWearDayCount,
  recordFeedback, getPersonalBonus, getPersonalBonusMap, feedbackContextKey,
} from "../wearStore";
import {
  buildPickerSelection, buildSuggestionReason, runPickerForToday,
  chipMatchCounts, debugBreakdown, getSprayGuide,
} from "../todayIntegration";
import { getCriteriaScore } from "../scoring";

const DAY_MS = 86400000;
const NOW = 1_700_000_000_000;

function createInMemoryBackend() {
  const store = new Map();
  return {
    load: key => (store.has(key) ? store.get(key) : null),
    save: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
  };
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkPerfume(id, overrides = {}) {
  return {
    id, name: `P-${id}`, gender: "Unisex", season: "Ganzjährig", conc: "EDP",
    families: ["Woody"], top: "Bergamotte", middle: "Lavendel", base: "Moschus",
    ...overrides,
  };
}

beforeEach(() => setWearStoreBackend(createInMemoryBackend()));

describe("Lernschleife – Feedback & persönlicher Bonus", () => {
  it("wächst mit Feedback und ist auf ±0.15 begrenzt", () => {
    const ctx = feedbackContextKey("work", "calm");
    expect(getPersonalBonus("p1", ctx)).toBe(0);
    recordFeedback("p1", ctx, "good");
    recordFeedback("p1", ctx, "good");
    expect(getPersonalBonus("p1", ctx)).toBe(0.10);
    for (let i = 0; i < 5; i++) recordFeedback("p1", ctx, "good");
    expect(getPersonalBonus("p1", ctx)).toBe(0.15); // geklemmt
    recordFeedback("p2", ctx, "bad");
    recordFeedback("p2", ctx, "bad");
    recordFeedback("p2", ctx, "bad");
    expect(getPersonalBonus("p2", ctx)).toBe(-0.15);
  });

  it("ist kontextspezifisch (Anlass|Stimmung)", () => {
    recordFeedback("p1", feedbackContextKey("work", "calm"), "good");
    expect(getPersonalBonus("p1", feedbackContextKey("date", "romantic"))).toBe(0);
    expect(getPersonalBonus("p1", feedbackContextKey("work", "calm"))).toBe(0.05);
  });

  it("'Naja' ist neutral und verändert den Bonus nicht", () => {
    const ctx = feedbackContextKey("casual", "energetic");
    recordFeedback("p1", ctx, "ok");
    expect(getPersonalBonus("p1", ctx)).toBe(0);
  });

  it("wirkt nur auf den kriterienScore, nie auf den Aging-Faktor", () => {
    const perfumes = [mkPerfume("a"), mkPerfume("b")];
    const ctx = feedbackContextKey("work", "calm");
    const sel = buildPickerSelection({ occasion: "work", mood: "calm", timeOfDay: "morning", season: "Ganzjährig" });
    const scoreWithout = getCriteriaScore(perfumes[0], sel);
    recordFeedback("a", ctx, "good");
    recordFeedback("a", ctx, "good");
    const selWith = { ...sel, personalBonusMap: getPersonalBonusMap(ctx) };
    const scoreWith = getCriteriaScore(perfumes[0], selWith);
    expect(scoreWith).toBeCloseTo(scoreWithout + 0.10, 5);
  });
});

describe("Tragen über wearStore", () => {
  it("recordWear aktualisiert zuletzt getragen + Trage-Tage", () => {
    recordWear("x", NOW);
    expect(getDaysSinceLastWorn("x", NOW + 5 * DAY_MS)).toBeCloseTo(5, 5);
    expect(getWearDayCount("x")).toBe(1);
    recordWear("x", NOW + 2 * DAY_MS); // anderer Tag
    expect(getWearDayCount("x")).toBe(2);
    recordWear("x", NOW + 3 * DAY_MS); // wieder neuer Tag
    expect(getWearDayCount("x")).toBe(3);
    expect(getDaysSinceLastWorn("x", NOW + 3 * DAY_MS + 3600_000)).toBeCloseTo(1 / 24, 3);
  });
});

describe("Anderer Vorschlag – excludeIds", () => {
  const perfumes = [mkPerfume("a"), mkPerfume("b"), mkPerfume("c"), mkPerfume("d")];

  it("zieht nach Ablehnung einen anderen Duft (nie denselben erneut)", () => {
    const sel = buildPickerSelection({ occasion: "casual", mood: "energetic", timeOfDay: "morning", season: "Ganzjährig" });
    const r1 = runPickerForToday(perfumes, {}, sel, { nowTs: NOW, random: mulberry32(7) });
    const seen = [r1.perfume.id, ...r1.alts.map(p => p.id)];
    const r2 = runPickerForToday(perfumes, {}, sel, {
      nowTs: NOW, random: mulberry32(7), excludeIds: seen,
    });
    expect(r2.perfume.id).not.toBe(r1.perfume.id);
    expect(seen).not.toContain(r2.perfume.id);
  });
});

describe("Chip-Hilfe & Lockerung", () => {
  it("zählt Treffer pro Chip (Fremdes zählt nicht)", () => {
    const counts = chipMatchCounts(
      [
        mkPerfume("f1", { families: ["Fresh"], top: "Zitrone", middle: "Minze", base: "Meersalz" }),
        mkPerfume("f2", { families: ["Oriental", "Harzig"], top: "Oud", middle: "Weihrauch", base: "Tabak" }),
      ],
      {}, NOW, "weather", ["hot", "cold"], {},
    );
    expect(counts.hot).toBe(1);   // f2 passt laut Mapping nicht zu Heiß
    expect(counts.cold).toBe(1);  // nur f2
  });

  it("lockert schrittweise und berichtet, was gelockert wurde", () => {
    // Alles im Cooldown → Cooldown-Lockerung muss gemeldet werden
    const pool = [mkPerfume("a"), mkPerfume("b"), mkPerfume("c"), mkPerfume("d")];
    const wearMap = Object.fromEntries(pool.map(p => [p.id, { lastWornTs: NOW - 1 * DAY_MS }]));
    const sel = buildPickerSelection({ occasion: "casual", timeOfDay: "morning", season: "Ganzjährig" });
    const r = runPickerForToday(pool, wearMap, sel, { nowTs: NOW, random: mulberry32(3) });
    expect(r.perfume).not.toBeNull();
    expect(r.relaxed.join(" ")).toMatch(/Cooldown/);
  });
});

describe("Begründung & Anwendungshilfe", () => {
  it("nennt Kriterien und Wartezeit", () => {
    const sel = buildPickerSelection({ weather: "sunny", occasion: "casual", timeOfDay: "morning" });
    const reason = buildSuggestionReason(mkPerfume("a"), sel, 47.3, 12);
    expect(reason).toContain("Passt zu Sonnig + Alltag");
    expect(reason).toContain("seit 47 Tagen");
    expect(reason).toContain("12× getragen");
  });

  it("Sprüh-Guide je Anlass", () => {
    expect(getSprayGuide("work")).toMatch(/1–2 Sprühstöße/);
    expect(getSprayGuide("sport")).toMatch(/1–3 Sprühstöße, hautnah/);
    expect(getSprayGuide("date")).toMatch(/Pulsstellen/);
    expect(getSprayGuide("special")).toMatch(/nicht erdrückend/);
    expect(getSprayGuide("unbekannt")).toBe(getSprayGuide("casual"));
  });
});

describe("Debug-Breakdown", () => {
  it("enthält Teilscores, Aging, Zufallsbereich und gematchte Noten/Familien", () => {
    const sel = buildPickerSelection({ occasion: "work", mood: "calm", timeOfDay: "morning", season: "Ganzjährig", weather: "cloudy", temperature: null });
    const d = debugBreakdown(mkPerfume("a"), sel, {}, NOW);
    expect(d.criteriaScore).toBeGreaterThan(0);
    expect(d.agingFactor).toBeGreaterThan(1);
    expect(d.randomRange).toEqual([0.85, 1.15]);
    const occ = d.criteria.find(c => c.key === "occasion");
    expect(occ).toBeDefined();
    expect(occ.matchedNotes.length + occ.matchedFamilies.length).toBeGreaterThan(0);
    // Temperatur-Mischung nur ohne Wetter-Chip
    const d2 = debugBreakdown(mkPerfume("a"), { ...sel, weather: undefined, temperature: 15 }, {}, NOW);
    expect(d2.temperatureBlend).not.toBeNull();
    expect(d2.temperatureBlend.t).toBeGreaterThan(0);
  });
});
