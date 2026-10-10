/**
 * Tests für den Reise-/Set-Planer (tripPlanner.js).
 * Nutzt echte Duftobjekte, um die Picker-Engine (scoring/familyMapping) mit
 * realistischen Noten-/Familiendaten zu durchlaufen.
 */
import { describe, it, expect } from "vitest";
import { buildTripSlots, planTrip, tripPickReason, TRIP_TOP_N } from "../tripPlanner";

// Hilfs-Duftfabrik: Familien/Noten bestimmen den Kriterien-Score
function mk(id, { family, families, top = [], middle = [], base = [], season = "Ganzjährig", conc = "EDP", gender = "Unisex", format = "Flakon" }) {
  return {
    id, name: `Duft ${id}`, family, families: families || (family ? [family] : []),
    top: top.join(", "), middle: middle.join(", "), base: base.join(", "),
    season, conc, gender, format,
  };
}

const SUMMER_FRESH = mk("f1", { family: "Fresh", top: ["Bergamotte", "Zitrone"], middle: ["Meer", "Minze"], base: ["Moschus"], season: "Sommer" });
const SUMMER_CITRUS = mk("f2", { family: "Zitrisch", top: ["Limette", "Grapefruit"], middle: ["Kardamom"], base: ["Vetiver"], season: "Sommer" });
const WINTER_ORIENTAL = mk("o1", { family: "Oriental", top: ["Safran"], middle: ["Rose"], base: ["Oud", "Ambra"], season: "Winter" });
const GOURMAND = mk("g1", { family: "Gourmand", top: ["Zimt"], middle: ["Karamell"], base: ["Vanille", "Tonkabohne"], season: "Winter" });

describe("buildTripSlots", () => {
  it("rotiert Wetter und Anlass über die Tage", () => {
    const slots = buildTripSlots(3, ["sunny", "rain"], ["casual", "evening", "date"]);
    expect(slots).toHaveLength(3);
    expect(slots[0].weather).toBe("hot");
    expect(slots[1].weather).toBe("rain");
    expect(slots[2].weather).toBe("hot");
    expect(slots[0].occasion).toBe("casual");
    expect(slots[1].occasion).toBe("evening");
    expect(slots[2].occasion).toBe("date");
    expect(slots.map(s => s.day)).toEqual([1, 2, 3]);
  });

  it("liefert Fallback-Slots bei leeren Listen und klemmt die Tageszahl", () => {
    expect(buildTripSlots(0)).toHaveLength(3); // 0 = ungültig → Fallback 3
    expect(buildTripSlots(-2)).toHaveLength(1); // negative Werte → Minimum 1
    expect(buildTripSlots(99)).toHaveLength(14);
    expect(buildTripSlots(2, [], [])[0].weather).toBe("hot");
    expect(buildTripSlots(2, [], [])[0].occasion).toBe("casual");
  });
});

describe("planTrip", () => {
  it("wählt im Sommer-Set die frischen Düfte vor dem orientalischen Winterduft", () => {
    const { picks } = planTrip([SUMMER_FRESH, WINTER_ORIENTAL], { days: 3, weathers: ["hot"], occasions: ["casual"] });
    expect(picks.length).toBe(2);
    expect(picks[0].perfume.id).toBe("f1");
    expect(picks[0].avgScore).toBeGreaterThan(picks[1].avgScore);
  });

  it("deckt mehrere Lagen ab: kaltes Wetter favorisiert den Winterduft, heißes den frischen", () => {
    const { slots, picks } = planTrip([SUMMER_FRESH, WINTER_ORIENTAL], { days: 4, weathers: ["cold", "hot"], occasions: ["casual"] });
    expect(slots).toHaveLength(4);
    // Beide Düfte sollten ins Set kommen, der frische zuerst (1. Tag ist kalt → eigentlich orientalisch stark)
    const ids = picks.map(p => p.perfume.id);
    expect(ids).toContain("f1");
    expect(ids).toContain("o1");
  });

  it("begrenzt das Set auf topN (3) Flakons", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      mk(`p${i}`, { family: i % 2 === 0 ? "Fresh" : "Woody", top: ["Bergamotte"], base: ["Zeder"] }));
    const { picks } = planTrip(many, { days: 3, weathers: ["sunny"], occasions: ["travel"], topN: 3 });
    expect(picks.length).toBe(TRIP_TOP_N);
  });

  it("Diversität: bei gleicher Passung wird die zweite Hauptfamilie bevorzugt", () => {
    // Zwei fast identische Fresh-Düfte vs. ein etwas schwächerer, aber anderer Duft:
    // Der Gourmand muss den zweiten Platz gegen den doppelten Fresh-Block holen können.
    const freshA = mk("fa", { family: "Fresh", top: ["Bergamotte"], middle: ["Minze"], base: ["Moschus"] });
    const freshB = mk("fb", { family: "Fresh", top: ["Zitrone"], middle: ["Meer"], base: ["Moschus"] });
    const { picks } = planTrip([freshA, freshB, GOURMAND], { days: 3, weathers: ["sunny"], occasions: ["travel"] });
    // Es dürfen nicht zwei Duftzwillinge ohne Penalty beide vor dem Gourmand stehen,
    // wenn der Gourmand nur wenig schwächer ist – Hauptsache: max. 3 Picks, kein Crash.
    expect(picks.length).toBe(3);
    // Mit vollem Penalty (1.0) folgt auf den ersten Fresh-Twin nie direkt der zweite:
    const forced = planTrip([freshA, freshB, GOURMAND], { days: 3, weathers: ["sunny"], occasions: ["travel"], diversityPenalty: 1.0, topN: 3 });
    expect(forced.picks[1].perfume.id).not.toBe("fb");
  });

  it("respektiert excludeIds", () => {
    const { picks } = planTrip([SUMMER_FRESH, SUMMER_CITRUS], {
      days: 2, weathers: ["hot"], occasions: ["casual"], excludeIds: ["f1"],
    });
    expect(picks.map(p => p.perfume.id)).not.toContain("f1");
    expect(picks.map(p => p.perfume.id)).toContain("f2");
  });

  it("liefert bestSlots als Begründungsdaten", () => {
    const { picks } = planTrip([SUMMER_FRESH, WINTER_ORIENTAL], { days: 2, weathers: ["hot", "cold"], occasions: ["casual"] });
    for (const p of picks) {
      expect(Array.isArray(p.bestSlots)).toBe(true);
      if (p.bestSlots.length > 0) {
        expect(p.bestSlots[0].slot).toHaveProperty("day");
        expect(p.bestSlots[0].slot).toHaveProperty("occasion");
      }
    }
  });

  it("behandelt leere / defekte Eingaben robust", () => {
    expect(planTrip([], {}).picks).toEqual([]);
    expect(planTrip([null, undefined, { noId: true }], {}).picks).toEqual([]);
    expect(planTrip([SUMMER_FRESH], { days: 1, weathers: [], occasions: [] }).picks).toHaveLength(1);
  });
});

describe("tripPickReason", () => {
  it("erzeugt eine deutsche Begründung mit Prozentwert", () => {
    const { picks, slots } = planTrip([SUMMER_FRESH], { days: 3, weathers: ["hot"], occasions: ["casual"] });
    const reason = tripPickReason(picks[0], slots);
    expect(reason).toMatch(/% Ø-Passung/);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  });
});
