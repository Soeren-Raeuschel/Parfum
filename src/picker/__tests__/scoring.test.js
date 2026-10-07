/**
 * Tests für die Scoring-Funktionen: Aging, Fairness-Bonus, Cooldown,
 * Kriterien-Score-Normierung und Gesamt-Score.
 */
import { describe, it, expect } from "vitest";
import {
  getAgingFactor,
  getFairnessFactor,
  isOnCooldown,
  getCriteriaScore,
  computeTotalScore,
  getRandomFactor,
} from "../scoring";
import { PICKER_CONFIG } from "../pickerConfig";

describe("getAgingFactor", () => {
  it("ist 1 bei 0 Tagen", () => {
    expect(getAgingFactor(0)).toBe(1);
  });

  it("nutzt die Formel 1 + agingStrength * sqrt(days/30)", () => {
    // 30 Tage → 1 + 1.5 * 1 = 2.5
    expect(getAgingFactor(30)).toBeCloseTo(2.5, 10);
    // 7.5 Tage → sqrt(0.25) = 0.5 → 1 + 0.75 = 1.75
    expect(getAgingFactor(7.5)).toBeCloseTo(1.75, 10);
  });

  it("nutzt neverWornDays (120) für nie getragene Düfte", () => {
    // sqrt(120/30) = 2 → 1 + 1.5*2 = 4
    expect(getAgingFactor(null)).toBeCloseTo(4, 10);
  });
});

describe("getFairnessFactor", () => {
  it("gibt 1 zurück, wenn der Duft kürzlich dran war", () => {
    expect(getFairnessFactor(0.8, 30)).toBe(1);
  });

  it("gibt 1 zurück, wenn der Kriterien-Score zu niedrig ist", () => {
    expect(getFairnessFactor(0.3, 200)).toBe(1);
  });

  it("gibt fairnessBonus zurück bei langer Pause UND gutem Score", () => {
    expect(getFairnessFactor(0.5, PICKER_CONFIG.fairnessDays + 1)).toBe(PICKER_CONFIG.fairnessBonus);
  });

  it("gilt genau an der Grenze fairnessDays (strikt >)", () => {
    expect(getFairnessFactor(0.5, PICKER_CONFIG.fairnessDays)).toBe(1);
  });

  it("behandelt nie getragene Düfte wie neverWornDays Pause (> fairnessDays)", () => {
    expect(getFairnessFactor(PICKER_CONFIG.fairnessMinCriteriaScore, null)).toBe(PICKER_CONFIG.fairnessBonus);
  });

  it("gilt genau an der Grenze fairnessMinCriteriaScore (>=)", () => {
    expect(getFairnessFactor(PICKER_CONFIG.fairnessMinCriteriaScore, 200)).toBe(PICKER_CONFIG.fairnessBonus);
  });
});

describe("isOnCooldown", () => {
  it("nie getragene Düfte sind nie im Cooldown", () => {
    expect(isOnCooldown(null)).toBe(false);
  });

  it("Düfte innerhalb der cooldownDays sind im Cooldown", () => {
    expect(isOnCooldown(0)).toBe(true);
    expect(isOnCooldown(13.9)).toBe(true);
    expect(isOnCooldown(14)).toBe(false); // genau an der Grenze → kein Cooldown
  });
});

describe("getCriteriaScore", () => {
  it("liefert 0.5 als neutralen Wert ohne Kriterien", () => {
    expect(getCriteriaScore({ season: "Sommer" }, {})).toBe(0.5);
  });

  it("belohnt Saison-Treffer weich (Ganzjährig < Treffer < 1)", () => {
    const sel = { season: "Sommer" };
    const full = getCriteriaScore({ season: "Sommer" }, sel);
    const any = getCriteriaScore({ season: "Ganzjährig" }, sel);
    const none = getCriteriaScore({ season: "Winter" }, sel);
    expect(full).toBeCloseTo(1, 10);
    expect(any).toBeGreaterThan(none);
    expect(any).toBeLessThan(full);
    // Total-Mismatch bleibt über der Fairness-Schwelle, damit der
    // Fairness-Bonus lang nicht gezogene Düfte erreichen kann
    expect(none).toBeGreaterThanOrEqual(PICKER_CONFIG.fairnessMinCriteriaScore);
  });

  it("misst Intensitäts-Distanz weich", () => {
    const sel = { intensityPref: "light" };
    const close = getCriteriaScore({ conc: "EDC" }, sel);      // Level 1 = perfekt
    const far = getCriteriaScore({ conc: "Parfum" }, sel);     // Level 3 = weit weg
    expect(close).toBeGreaterThan(far);
    expect(close).toBeCloseTo(1, 10);
  });

  it("bewertet Familien-Übereinstimmung anteilig", () => {
    const sel = { families: ["Woody", "Oriental"] };
    const both = getCriteriaScore({ families: ["Woody", "Oriental"] }, sel);
    const one = getCriteriaScore({ families: ["Woody", "Floral"] }, sel);
    const none = getCriteriaScore({ families: ["Fresh"] }, sel);
    expect(both).toBeCloseTo(1, 10);
    expect(one).toBeGreaterThan(none);
    expect(one).toBeLessThan(both);
  });

  it("ist immer im Bereich 0–1", () => {
    const s = getCriteriaScore({ season: "Winter", conc: "Parfum" }, {
      season: "Sommer", intensityPref: "light", longevityPref: "short",
      families: ["Fresh", "Aquatisch"],
    });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("computeTotalScore", () => {
  it("multipliziert kriterienScore × aging × fairness × random", () => {
    const score = computeTotalScore({
      criteriaScore: 0.8,
      daysSinceLastWorn: 10,           // aging = 1 + 1.5*sqrt(10/30) ≈ 1.866, kein Fairness (< 90 Tage)
      randomFactor: 1,
    });
    const aging = 1 + PICKER_CONFIG.agingStrength * Math.sqrt(10 / 30);
    expect(score).toBeCloseTo(0.8 * aging, 6);
  });

  it("kombiniert alle Faktoren korrekt", () => {
    const score = computeTotalScore({
      criteriaScore: 0.5,
      daysSinceLastWorn: 100,          // aging = 1 + 1.5*sqrt(100/30) ≈ 3.7386
      randomFactor: 1.1,
    });
    const aging = 1 + PICKER_CONFIG.agingStrength * Math.sqrt(100 / 30);
    expect(score).toBeCloseTo(0.5 * aging * PICKER_CONFIG.fairnessBonus * 1.1, 6);
  });
});

describe("getRandomFactor", () => {
  it("liegt im Bereich randomMin–randomMax", () => {
    for (let i = 0; i < 100; i++) {
      const f = getRandomFactor(Math.random);
      expect(f).toBeGreaterThanOrEqual(PICKER_CONFIG.randomMin);
      expect(f).toBeLessThanOrEqual(PICKER_CONFIG.randomMax);
    }
  });
});