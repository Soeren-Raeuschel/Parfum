/**
 * Tests für pickPerfume: Cooldown-Ausschluss, Fallback (Cooldown-Lockerung),
 * excludeIds, harte Filter (Gender/Preis) und Roulette-Verteilung.
 */
import { describe, it, expect } from "vitest";
import { pickPerfume } from "../pickPerfume";
import { PICKER_CONFIG } from "../pickerConfig";

const DAY_MS = 86400000;
const NOW = 1_700_000_000_000;

function mkPerfume(id, overrides = {}) {
  return { id, name: `P-${id}`, gender: "Unisex", season: "Ganzjährig", conc: "EDP", ...overrides };
}

describe("pickPerfume – Cooldown", () => {
  it("schließt Düfte innerhalb der cooldownDays aus", () => {
    const perfumes = [mkPerfume("a"), mkPerfume("b"), mkPerfume("c")];
    const wearMap = { a: { lastWornTs: NOW - 3 * DAY_MS } };
    const result = pickPerfume(perfumes, wearMap, {}, { nowTs: NOW, random: () => 0.5 });
    expect(result.perfume.id).not.toBe("a");
    expect(result.candidates).toBe(2);
    expect(result.usedFallback).toBe(false);
  });

  it("lässt Düfte nach Ablauf der cooldownDays wieder zu", () => {
    const perfumes = [mkPerfume("a"), mkPerfume("b"), mkPerfume("c")];
    const wearMap = { a: { lastWornTs: NOW - (PICKER_CONFIG.cooldownDays + 1) * DAY_MS } };
    const result = pickPerfume(perfumes, wearMap, {}, { nowTs: NOW });
    expect(result.candidates).toBe(3);
  });
});

describe("pickPerfume – Fallback (Cooldown-Lockerung)", () => {
  it("lockert den Cooldown schrittweise, wenn alle im Cooldown sind", () => {
    const perfumes = [mkPerfume("a"), mkPerfume("b"), mkPerfume("c")];
    const wearMap = {
      a: { lastWornTs: NOW - 2 * DAY_MS },
      b: { lastWornTs: NOW - 5 * DAY_MS },
      c: { lastWornTs: NOW - 8 * DAY_MS },
    };
    const result = pickPerfume(perfumes, wearMap, {}, { nowTs: NOW });
    expect(result.usedFallback).toBe(true);
    expect(result.perfume).not.toBeNull();
    expect(result.relaxedCooldownDays).toBeLessThan(PICKER_CONFIG.cooldownDays);
    expect(result.relaxedCooldownDays).toBeLessThanOrEqual(PICKER_CONFIG.cooldownDays / 2);
  });

  it("liefert trotzdem immer einen Duft (nie null) bei leerem Cooldown-Pool", () => {
    const perfumes = [mkPerfume("a")];
    const wearMap = { a: { lastWornTs: NOW - 1 * DAY_MS } };
    const result = pickPerfume(perfumes, wearMap, {}, { nowTs: NOW });
    expect(result.perfume.id).toBe("a");
    expect(result.usedFallback).toBe(true);
  });

  it("gibt null zurück, wenn es gar keine Düfte gibt", () => {
    const result = pickPerfume([], {}, {}, { nowTs: NOW });
    expect(result.perfume).toBeNull();
    expect(result.candidates).toBe(0);
  });
});

describe("pickPerfume – excludeIds", () => {
  it("schließt excludeIds dauerhaft aus (auch jenseits des Cooldowns)", () => {
    const perfumes = [mkPerfume("a"), mkPerfume("b")];
    const wearMap = { a: { lastWornTs: NOW - 300 * DAY_MS } };
    const result = pickPerfume(perfumes, wearMap, {}, {
      nowTs: NOW, excludeIds: ["a"], random: () => 0.5,
    });
    expect(result.perfume.id).toBe("b");
    expect(result.candidates).toBe(1);
  });
describe("pickPerfume – harte Filter", () => {
  it("Gender filtert hart, wenn genug Kandidaten bleiben", () => {
    const perfumes = [
      mkPerfume("a", { gender: "Maskulin" }),
      mkPerfume("b", { gender: "Maskulin" }),
      mkPerfume("c", { gender: "Feminin" }),
      mkPerfume("d", { gender: "Feminin" }),
      mkPerfume("e", { gender: "Unisex" }),
    ];
    const result = pickPerfume(perfumes, {}, { genderPref: "Feminin" }, { nowTs: NOW, random: () => 0.5 });
    expect(["c", "d", "e"]).toContain(result.perfume.id);
    expect(result.skippedHardFilters).toEqual([]);
    expect(result.candidates).toBe(3);
  });

  it("lockert den Gender-Filter, wenn zu wenige Kandidaten bleiben (Schutzschild)", () => {
    const perfumes = [
      mkPerfume("a", { gender: "Maskulin" }),
      mkPerfume("b", { gender: "Maskulin" }),
      mkPerfume("c", { gender: "Feminin" }),
    ];
    const result = pickPerfume(perfumes, {}, { genderPref: "Feminin" }, { nowTs: NOW });
    expect(result.skippedHardFilters).toContain("genderPref");
    expect(result.perfume).not.toBeNull();
  });

  it("Preisbereich filtert hart bei ausreichend Kandidaten", () => {
    const priceMl = {
      cheap1: { price: 20, ml: 100 },   // 0.2 → budget
      cheap2: { price: 30, ml: 100 },   // 0.3 → budget
      cheap3: { price: 35, ml: 100 },   // 0.35 → budget
      luxe1: { price: 200, ml: 100 },   // 2.0 → luxury
      luxe2: { price: 300, ml: 100 },
      luxe3: { price: 250, ml: 100 },
    };
    const perfumes = [mkPerfume("cheap1"), mkPerfume("cheap2"), mkPerfume("cheap3"),
      mkPerfume("luxe1"), mkPerfume("luxe2"), mkPerfume("luxe3")];
    const result = pickPerfume(perfumes, {}, { priceRange: "budget", priceMl }, { nowTs: NOW, random: () => 0.5 });
    expect(result.perfume.id).toMatch(/^cheap/);
    expect(result.candidates).toBe(3);
  });

  it("stürzt nicht ab, wenn Düfte keine Preisdaten haben", () => {
    const priceMl = { rich: { price: 300, ml: 100 } };
    const perfumes = [mkPerfume("rich"), mkPerfume("nix1"), mkPerfume("nix2"), mkPerfume("nix3")];
    const result = pickPerfume(perfumes, {}, { priceRange: "luxury", priceMl }, { nowTs: NOW });
    expect(result.perfume).not.toBeNull();
    expect(["rich", "nix1", "nix2", "nix3"]).toContain(result.perfume.id);
  });
});

describe("pickPerfume – Roulette-Verteilung", () => {
  it("gibt nicht immer dem höchsten Score den Vorzug (Zufall wirkt)", () => {
    const perfumes = Array.from({ length: 20 }, (_, i) => mkPerfume(`p${i}`));
    const picks = new Set();
    for (let i = 0; i < 200; i++) {
      const r = pickPerfume(perfumes, {}, {}, { nowTs: NOW });
      picks.add(r.perfume.id);
    }
    expect(picks.size).toBeGreaterThan(5);
  });
});
});