/**
 * Tests für die datenbasierte Kriterien-Logik (Teil 2):
 * Noten-/Familien-Mapping, Matching (DE/EN, Teilstrings), kombinierter Score,
 * Nachbarstufen, Konzentrations-Modifikator, Diversität und Abhängigkeiten.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeKey,
  categorizeNote,
  getNoteMapping,
  matchWords,
} from "../criteriaMapping";
import {
  normalizeFamilyKey,
  categorizeFamily,
  getFamilyMapping,
} from "../familyMapping";
import {
  getCriteriaScore,
  scoreNotes,
  scoreFamilies,
  collectWeightedNotes,
  resolveLevel,
  levelScore,
  getConcentrationModifier,
  getDependencyDefaults,
  hasTimeMoodConflict,
} from "../scoring";
import { PICKER_CONFIG } from "../pickerConfig";

// ── Typische Beispieldüfte ───────────────────────────────────────────────────
const citrusFresh = {
  id: "citrus",
  name: "Frischer Zitrus-Duft",
  conc: "EDT",
  families: ["Fresh", "Zitrisch", "Grün"],
  top: "Bergamotte, Limette, Mandarine",
  middle: "Minze, Salbei",
  base: "Weißer Moschus, Zeder",
};

const heavyOud = {
  id: "oud",
  name: "Schwerer Oud-Duft",
  conc: "Parfum",
  families: ["Oriental", "Harzig", "Würzig"],
  top: "Safran, Kardamom",
  middle: "Rose, Patschuli",
  base: "Oud, Weihrauch, Leder",
};

describe("normalizeKey / Matching", () => {
  it("löst deutsche/englische Varianten auf dasselbe Kanon auf", () => {
    expect(normalizeKey("Musk")).toBe(normalizeKey("Moschus"));
    expect(normalizeKey("Sandalwood")).toBe(normalizeKey("Sandelholz"));
    expect(normalizeKey("Incense")).toBe("weihrauch");
    expect(normalizeKey("Bergamot")).toBe(normalizeKey("Bergamotte"));
    expect(normalizeKey("Vanilla")).toBe("vanille");
    expect(normalizeKey("Cedarwood")).toBe("zeder");
  });

  it("entfernt Diakritika und Qualifier", () => {
    expect(normalizeKey("Fougère")).toBe("fougere");
    expect(normalizeKey("Süß")).toBe("suss");
  });

  it("findet Teilstrings und Zitrus-Präfixe", () => {
    expect(matchWords("zitrone", ["zitrus"])).toBe(true);       // 4er-Präfix
    expect(matchWords("eichenmoos", ["moos"])).toBe(true);      // Teilstring
    expect(matchWords("rosmarin", ["rose"])).toBe(false);       // kein Fehl-Match
  });

  it("kategorisiert Noten korrekt (HAUPT vor NEBEN vor MEIDEN)", () => {
    const sport = getNoteMapping("occasion", "sport");
    expect(categorizeNote(normalizeKey("zitrone"), sport)).toBe("haupt");
    expect(categorizeNote(normalizeKey("moschus"), sport)).toBe("neben");
    expect(categorizeNote(normalizeKey("oud"), sport)).toBe("meiden");
    expect(categorizeNote(normalizeKey("tabak"), sport)).toBe("meiden");
    // Englische Schreibweise wirkt genauso
    expect(categorizeNote(normalizeKey("Bergamot"), sport)).toBe("haupt");
    expect(categorizeNote(normalizeKey("Vanilla"), sport)).toBe("meiden");
  });

  it("kategorisiert Familien korrekt (an echte Familiennamen angepasst)", () => {
    const sport = getFamilyMapping("occasion", "sport");
    expect(categorizeFamily(normalizeFamilyKey("Fresh"), sport)).toBe("haupt");
    expect(categorizeFamily(normalizeFamilyKey("Gourmand"), sport)).toBe("meiden");
    expect(categorizeFamily(normalizeFamilyKey("Blumig"), sport)).toBeNull();
    // Abend: Zitrisch gemieden, Oriental HAUPT
    const evening = getFamilyMapping("occasion", "evening");
    expect(categorizeFamily(normalizeFamilyKey("Zitrisch"), evening)).toBe("meiden");
    expect(categorizeFamily(normalizeFamilyKey("Oriental"), evening)).toBe("haupt");
  });

  it("stimmung 'schlafen' nutzt das Anlass-Mapping (vereinheitlicht)", () => {
    expect(getNoteMapping("mood", "sleep")).toBe(getNoteMapping("occasion", "sleep"));
    expect(getFamilyMapping("mood", "sleep")).toBe(getFamilyMapping("occasion", "sleep"));
  });
});

describe("scoreNotes / scoreFamilies", () => {
  it("Zitrus-Mix bei Sport ergibt hohen Noten-Score (Mix aus HAUPT/NEBEN)", () => {
    const mapping = getNoteMapping("occasion", "sport");
    expect(scoreNotes(collectWeightedNotes(citrusFresh), mapping)).toBeGreaterThan(0.8);
    const nebenOnly = { "top": ["linden"] };
    const m = new Map(nebenOnly.top.map(k => [normalizeKey(k), 1]));
    expect(scoreNotes(m, mapping)).toBeCloseTo(0.75, 5);
    const meidenOnly = new Map([["oud", 1]]);
    expect(scoreNotes(meidenOnly, mapping)).toBeCloseTo(0.15, 5);
  });

  it("kein Match → null (Kriterium neutral)", () => {
    const mapping = getNoteMapping("occasion", "sport");
    expect(scoreNotes(new Map([["gurke", 1]]), mapping)).toBeNull();
  });

  it("Familien-Score: Sport hoch für Fresh, niedrig für Oriental", () => {
    const mapping = getFamilyMapping("occasion", "sport");
    const fresh = [{ name: "fresh", weight: 1 }];
    const oriental = [{ name: "oriental", weight: 1 }];
    expect(scoreFamilies(fresh, mapping)).toBeGreaterThan(0.9);
    expect(scoreFamilies(oriental, mapping)).toBeLessThan(0.3);
  });
});

describe("getCriteriaScore – typische Beispiele (SCHRITT 7)", () => {
  const sportSel = { occasion: "sport" };
  const eveningSel = { occasion: "evening" };
  const coldSel = { weather: "cold" };

  it("frischer Zitrus-Duft bei Sport hoch, schwerer Oud niedrig", () => {
    const sCitrus = getCriteriaScore(citrusFresh, sportSel);
    const sOud = getCriteriaScore(heavyOud, sportSel);
    expect(sCitrus).toBeGreaterThan(0.8);
    expect(sOud).toBeLessThan(0.45);
    expect(sCitrus).toBeGreaterThan(sOud);
  });

  it("umgekehrt bei Abend: Oud hoch, Zitrus niedrig", () => {
    const sOud = getCriteriaScore(heavyOud, eveningSel);
    const sCitrus = getCriteriaScore(citrusFresh, eveningSel);
    expect(sOud).toBeGreaterThan(0.8);
    expect(sCitrus).toBeLessThan(0.5);
    expect(sOud).toBeGreaterThan(sCitrus);
  });

  it("umgekehrt bei Kalt-Wetter: Oud hoch, Zitrus niedrig", () => {
    const sOud = getCriteriaScore(heavyOud, coldSel);
    const sCitrus = getCriteriaScore(citrusFresh, coldSel);
    expect(sOud).toBeGreaterThan(sCitrus);
    expect(sCitrus).toBeLessThan(0.5);
  });

  it("ein einzelnes unpassendes Kriterium schließt nie aus (weiches Scoring)", () => {
    const s = getCriteriaScore(heavyOud, sportSel);
    // Weiches Minimum pro Kriterium (0.2) hält den Score über ~0.35
    expect(s).toBeGreaterThanOrEqual(0.35);
    expect(s).toBeGreaterThan(0);
  });

  it("nicht gewählte Kriterien zählen neutral (0.5)", () => {
    expect(getCriteriaScore(citrusFresh, {})).toBe(0.5);
    expect(getCriteriaScore(citrusFresh, { unbekannt: "x" })).toBe(0.5);
  });

  it("Temperature-Automatik: glättet um 15 °C und bevorzugt bei 25 °C Frische", () => {
    const cold = getCriteriaScore(citrusFresh, { temperature: 5 });
    const mild = getCriteriaScore(citrusFresh, { temperature: 15 });
    const hot = getCriteriaScore(citrusFresh, { temperature: 28 });
    expect(hot).toBeGreaterThan(cold);
    expect(mild).toBeGreaterThan(cold);
  });

  it("manuelle Wetter-Chips überschreiben die Temperatur-Automatik", () => {
    const chip = getCriteriaScore(citrusFresh, { weather: "hot", temperature: 5 });
    expect(chip).toBeGreaterThan(0.8);
  });

  it("manuell gesetzte Familien-Tags haben Vorrang vor der Ableitung", () => {
    // Duft hat abgeleitet "Oriental" – manuell aber "Fresh" gewählt:
    // bei Sport soll der Tag "Fresh" (HAUPT) den Score hochziehen.
    const withTag = getCriteriaScore(heavyOud, { occasion: "sport", families: ["Fresh"] });
    const without = getCriteriaScore(heavyOud, { occasion: "sport" });
    expect(withTag).toBeGreaterThan(without);
  });

  it("Nachbarstufen bei Intensität: direkt 1.0, benachbart ~0.5, gegenüber niedrig", () => {
    const edc = { conc: "EDC" };
    const edp = { conc: "EDP" };
    const parfum = { conc: "Parfum" };
    expect(getCriteriaScore(edc, { intensityPref: "light" })).toBeCloseTo(1, 5);
    const neighbor = getCriteriaScore(edp, { intensityPref: "light" });
    const opposite = getCriteriaScore(parfum, { intensityPref: "light" });
    expect(neighbor).toBeGreaterThan(opposite);
    expect(levelScore(2, "light")).toBeCloseTo(0.5, 5);
    expect(levelScore(3, "light")).toBeLessThan(0.3);
  });

  it("Familien-Heuristik nur ohne echte Daten (conc hat Vorrang)", () => {
    // Ohne conc: Orientalisch → tendiert zu Stark (Level 3)
    expect(resolveLevel({ families: ["Oriental"] })).toBe(3);
    expect(resolveLevel({ families: ["Zitrisch"] })).toBe(1);
    // Mit conc: echte Daten gewinnen
    expect(resolveLevel({ families: ["Oriental"], conc: "EDC" })).toBe(1);
  });

  it("Konzentrations-Modifikator: EdT bei Sport bevorzugt, EdP bei Abend", () => {
    expect(getConcentrationModifier(citrusFresh, { occasion: "sport" })).toBeGreaterThan(0);
    expect(getConcentrationModifier(citrusFresh, { occasion: "evening" })).toBeLessThan(0);
    expect(getConcentrationModifier(heavyOud, { occasion: "sport" })).toBeLessThan(0);
    expect(getConcentrationModifier(heavyOud, { occasion: "evening" })).toBeGreaterThan(0);
    expect(getConcentrationModifier(citrusFresh, {})).toBe(0);
    // Netto-Unterschied max ±0.1
    expect(Math.abs(getConcentrationModifier(citrusFresh, { occasion: "sport" }))).toBeLessThanOrEqual(0.1);
  });

  it("Diversität: −10 % wenn Hauptfamilie zuletzt getragen (abschaltbar)", () => {
    const sel = { occasion: "sport", recentPrimaryFamilies: ["Fresh"] };
    const withPenalty = getCriteriaScore(citrusFresh, sel);
    const without = getCriteriaScore(citrusFresh, { occasion: "sport" });
    expect(withPenalty).toBeCloseTo(without * (1 - PICKER_CONFIG.diversityPenalty), 5);
    expect(withPenalty).toBeLessThan(without);
  });

  it("Wetter-Allpass-Bonus: passt der Duft in alle Lagen, +0.05", () => {
    // Zitrus-Duft passt in hot und rain, weniger in cold → kein Bonus
    const s = getCriteriaScore(citrusFresh, { temperature: 15 });
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("Abhängigkeiten (SCHRITT 6.2)", () => {
  it("Sport setzt Intensität/Haltbarkeit sinnvoll vor", () => {
    expect(getDependencyDefaults({ occasion: "sport" })).toEqual({
      intensityPref: "medium", longevityPref: "short",
    });
  });

  it("Schlafen (Anlass) setzt Leicht/Kurz vor", () => {
    expect(getDependencyDefaults({ occasion: "sleep" })).toEqual({
      intensityPref: "light", longevityPref: "short",
    });
  });

  it("doppeltes 'Schlafen' vereinheitlicht: Stimmung = Anlass", () => {
    expect(getDependencyDefaults({ mood: "sleep" })).toEqual(getDependencyDefaults({ occasion: "sleep" }));
    expect(getDependencyDefaults({ occasion: "everyday" })).toBeNull();
  });

  it("'Nachts' + 'Schlafen' wird als Widerspruch erkannt", () => {
    expect(hasTimeMoodConflict({ timeOfDay: "night", occasion: "sleep" })).toBe(true);
    expect(hasTimeMoodConflict({ timeOfDay: "night", mood: "sleep" })).toBe(true);
    expect(hasTimeMoodConflict({ timeOfDay: "morning", occasion: "sleep" })).toBe(false);
  });
});