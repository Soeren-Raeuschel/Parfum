/**
 * Tests für die Normalisierung der Parfumo-Lookup-Kette: Season-Herleitung
 * (Saison-Chart -> Accorde-Fallback -> Ganzjährig) im Netlify-Function-Zweig.
 */
import { describe, it, expect } from "vitest";
import { normalisiere } from "../parfumoLookup";

describe("normalisiere – Season-Herleitung (Netlify-Function-Format)", () => {
  const base = {
    url: "https://www.parfumo.de/Parfums/Creed/Aventus",
    brand: "Creed",
    name: "Aventus",
    notes: { top: [{ id: 1, name: "Bergamotte" }] },
  };

  it("nutzt die Saison mit dem höchsten Chart-Wert", () => {
    const r = normalisiere({ ...base, seasons: { Frühling: 32, Sommer: 31, Herbst: 24, Winter: 14 } });
    expect(r.season).toBe("Frühling");
    expect(r.seasons).toEqual({ Frühling: 32, Sommer: 31, Herbst: 24, Winter: 14 });
  });

  it("leitet die Saison aus Parfumo-Accorden her, wenn kein Chart existiert", () => {
    // "Frisch" -> Fresh -> [Frühling, Sommer]
    const r = normalisiere({ ...base, accords: [{ name: "Frisch", weight: 4 }, { name: "Holzig", weight: 4 }] });
    expect(r.season).toBe("Frühling");
  });

  it("leitet aus Holzig/Würzig auf Herbst/Winter ab", () => {
    const r = normalisiere({ ...base, accords: [{ name: "Würzig", weight: 5 }] });
    expect(r.season).toBe("Herbst");
  });

  it("akzeptiert auch englische Familien im seasons-Fallback", () => {
    const r = normalisiere({ ...base, accords: [{ name: "Zitrus", weight: 3 }] });
    // Zitrus -> Zitrisch -> [Frühling, Sommer]
    expect(r.season).toBe("Frühling");
  });

  it("fällt auf Ganzjährig zurück, wenn Accorde unbekannt sind", () => {
    const r = normalisiere({ ...base, accords: [{ name: "Mystery Accord", weight: 5 }] });
    expect(r.season).toBe("Ganzjährig");
  });

  it("funktioniert auch ohne seasons- und accords-Feld", () => {
    const r = normalisiere({ ...base });
    expect(r.season).toBe("Ganzjährig");
  });
});