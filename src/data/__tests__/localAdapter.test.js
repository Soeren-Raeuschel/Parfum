/**
 * Tests für den localAdapter: sanitizePerfume (Clamping, Defaults,
 * Prototype-Schlüssel-Filter), Hydration kaputter localStorage-Daten,
 * Roundtrips über loadAll/save* und Fehler-Rückfallebene.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localAdapter, sanitizePerfume, newId } from "../localAdapter";

const KEYS = {
  items: "parfum_collection_v2",
  log: "parfum_log_v2",
  notes: "parfum_notes_v1",
  wishlist: "parfum_wishlist_v1",
  prefs: "parfum_prefs_v1",
  fillLevels: "parfum_fill_v1",
  onboarding: "parfum_onboard_v1",
  priceMl: "parfum_price_ml_v1",
  declutterStatus: "parfum_declutter_status_v1",
};

const basePerfume = {
  id: "a1", name: "Aventus", house: "Creed", conc: "EDP",
  family: "Fruchtig", season: "Winter", gender: "Maskulin",
  format: "Flakon", url: "https://www.parfumo.de/x", rating: 4,
};

describe("sanitizePerfume", () => {
  it("übernimmt gültige Felder unverändert", () => {
    const p = sanitizePerfume(basePerfume);
    expect(p).toMatchObject({
      id: "a1", name: "Aventus", house: "Creed", conc: "EDP",
      family: "Fruchtig", season: "Winter", gender: "Maskulin",
      format: "Flakon", rating: 4,
    });
    expect(p.families).toEqual(["Fruchtig"]);
  });

  it("setzt unbekannte Familien auf 'Sonstiges'", () => {
    const p = sanitizePerfume({ ...basePerfume, family: "Fantasie-Familie" });
    expect(p.family).toBe("Sonstiges");
  });

  it("clampt Ratings auf 0–5", () => {
    expect(sanitizePerfume({ ...basePerfume, rating: 9 }).rating).toBe(5);
    expect(sanitizePerfume({ ...basePerfume, rating: -3 }).rating).toBe(0);
    expect(sanitizePerfume({ ...basePerfume, rating: "4" }).rating).toBe(4);
    expect(sanitizePerfume({ ...basePerfume, rating: "kein Zahlwert" }).rating).toBe(0);
  });

  it("erkennt Season über 'includes' und fällt auf 'Ganzjährig' zurück", () => {
    expect(sanitizePerfume({ ...basePerfume, season: "besonders im Winter" }).season).toBe("besonders im Winter");
    expect(sanitizePerfume({ ...basePerfume, season: "Quatsch" }).season).toBe("Ganzjährig");
  });

  it("filtert families auf gültige Werte und nutzt den ersten", () => {
    const p = sanitizePerfume({ ...basePerfume, families: ["Woody", "Quatsch", "Fresh"] });
    expect(p.families).toEqual(["Woody", "Fresh"]);
    expect(p.family).toBe("Woody");
  });

  it("beschneidet lange Strings auf die Feldgrenzen", () => {
    const p = sanitizePerfume({ ...basePerfume, name: "x".repeat(300), house: "y".repeat(200) });
    expect(p.name).toHaveLength(220);
    expect(p.house).toHaveLength(180);
  });

  it("setzt Defaults: gender 'Unisex', leere Strings, neue ID", () => {
    const p = sanitizePerfume(null);
    expect(p.gender).toBe("Unisex");
    expect(p.family).toBe("Sonstiges");
    expect(p.season).toBe("Ganzjährig");
    expect(p.name).toBe("");
    expect(p.id).toBeTruthy();
  });

  it("konvertiert addedAt-Strings in Timestamps", () => {
    const ts = sanitizePerfume({ ...basePerfume, addedAt: "2024-01-15T12:00:00Z" }).addedAt;
    expect(typeof ts).toBe("number");
    expect(ts).toBe(new Date("2024-01-15T12:00:00Z").getTime());
  });

  it("filtert note_categories auf bekannte Kategorien (max. 3)", () => {
    const p = sanitizePerfume({ ...basePerfume, note_categories: ["Süß", "Quatsch", "Grün", "Würzig", "Erdig"] });
    expect(p.note_categories).toEqual(["Süß", "Grün", "Würzig"]);
  });

  it("erlaubt nur http(s)-URLs bei url/spotify_url (XSS-Schutz)", () => {
    expect(sanitizePerfume({ ...basePerfume, url: "https://www.parfumo.de/x" }).url).toBe("https://www.parfumo.de/x");
    expect(sanitizePerfume({ ...basePerfume, url: "http://parfumo.de/y" }).url).toBe("http://parfumo.de/y");
    expect(sanitizePerfume({ ...basePerfume, url: "javascript:alert(1)" }).url).toBe("");
    expect(sanitizePerfume({ ...basePerfume, url: "data:text/html,hi" }).url).toBe("");
    expect(sanitizePerfume({ ...basePerfume, url: "vbscript:x" }).url).toBe("");
    expect(sanitizePerfume({ ...basePerfume, url: "keine url" }).url).toBe("");
    expect(sanitizePerfume({ ...basePerfume, spotify_url: "javascript:alert(1)" }).spotify_url).toBe("");
    expect(sanitizePerfume({ ...basePerfume, spotify_url: "https://open.spotify.com/track/1" }).spotify_url).toBe("https://open.spotify.com/track/1");
  });
});

describe("newId", () => {
  it("erzeugt eindeutige Strings", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
  });
});
describe("localAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
    localAdapter.setPushError(console.error);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadAll liefert Standardwerte bei leerem Speicher", async () => {
    const all = await localAdapter.loadAll();
    expect(all.items).toEqual([]);
    expect(all.log).toEqual([]);
    expect(all.wishlist).toEqual([]);
    expect(all.prefs.appName).toBe("Sillage");
    expect(all.onboarded).toBe(false);
  });

  it("saveItems + loadAll: Roundtrip funktioniert", async () => {
    await localAdapter.saveItems([basePerfume]);
    const all = await localAdapter.loadAll();
    expect(all.items).toHaveLength(1);
    expect(all.items[0].name).toBe("Aventus");
  });

  it("kaputtes JSON wird abgefangen (Fallback statt Crash)", async () => {
    localStorage.setItem(KEYS.items, "{kaputt");
    localStorage.setItem(KEYS.log, "{kaputt");
    localStorage.setItem(KEYS.wishlist, "{kaputt");
    const all = await localAdapter.loadAll();
    expect(all.items).toEqual([]);
    expect(all.log).toEqual([]);
    expect(all.wishlist).toEqual([]);
  });

  it("hydrateItems filtert keine Objekt-Einträge heraus", async () => {
    localStorage.setItem(KEYS.items, JSON.stringify([{ id: "1", name: "A" }, "kein objekt", null]));
    const all = await localAdapter.loadAll();
    expect(all.items).toHaveLength(1);
  });

  it("hydrateLog behält nur Einträge mit numerischem ts", async () => {
    localStorage.setItem(KEYS.log, JSON.stringify([{ ts: 123 }, { ts: "x" }, { foo: 1 }]));
    const all = await localAdapter.loadAll();
    expect(all.log).toEqual([{ ts: 123 }]);
  });

  it("hydrateNotes filtert __proto__-Schlüssel und überlange Schlüssel", async () => {
    localStorage.setItem(KEYS.notes,
      '{"__proto__":{"boese":true},"Rosace":"toll","' + "x".repeat(201) + '":"zu lang"}');
    const all = await localAdapter.loadAll();
    expect(Object.keys(all.notes)).toEqual(["Rosace"]);
    expect(Object.hasOwn(all.notes, "__proto__")).toBe(false);
  });

  it("hydrateWishlist behält nur Einträge mit Namens-String", async () => {
    localStorage.setItem(KEYS.wishlist, JSON.stringify([{ name: "W" }, { x: 1 }]));
    const all = await localAdapter.loadAll();
    expect(all.wishlist).toEqual([{ name: "W" }]);
  });

  it("hydrateFillLevels akzeptiert nur die Werte 100/75/50/25/0", async () => {
    localStorage.setItem(KEYS.fillLevels, JSON.stringify({ p1: 75, p2: 80, p3: "100" }));
    const all = await localAdapter.loadAll();
    expect(all.fillLevels).toEqual({ p1: 75 });
  });

  it("hydratePriceMl validiert price/ml-Paare", async () => {
    localStorage.setItem(KEYS.priceMl, JSON.stringify({
      p1: { price: 99, ml: 50 },
      p2: { price: -1, ml: 50 },
      p3: { price: 10, ml: 0 },
    }));
    const all = await localAdapter.loadAll();
    expect(all.priceMl).toEqual({ p1: { price: 99, ml: 50 } });
  });

  it("prefs: appName wird auf 80 Zeichen gekürzt, Nicht-Strings werden ersetzt", async () => {
    localStorage.setItem(KEYS.prefs, JSON.stringify({ appName: "x".repeat(120) }));
    expect((await localAdapter.loadAll()).prefs.appName).toHaveLength(80);

    localStorage.setItem(KEYS.prefs, JSON.stringify({ appName: 42 }));
    expect((await localAdapter.loadAll()).prefs.appName).toBe("Sillage");
  });

  it("setOnboarded(true/false) steuert den Onboarding-Status", async () => {
    await localAdapter.setOnboarded(true);
    expect((await localAdapter.loadAll()).onboarded).toBe(true);
    await localAdapter.setOnboarded(false);
    expect((await localAdapter.loadAll()).onboarded).toBe(false);
  });

  it("saveNotes/saveFillLevels/savePriceMl/saveDeclutterStatus: Roundtrips", async () => {
    await localAdapter.saveNotes({ Rose: "schön" });
    await localAdapter.saveFillLevels({ p1: 50 });
    await localAdapter.savePriceMl({ p1: { price: 10, ml: 30 } });
    await localAdapter.saveDeclutterStatus({ p1: "behalten" });
    const all = await localAdapter.loadAll();
    expect(all.notes).toEqual({ Rose: "schön" });
    expect(all.fillLevels).toEqual({ p1: 50 });
    expect(all.priceMl).toEqual({ p1: { price: 10, ml: 30 } });
    expect(all.declutterStatus).toEqual({ p1: "behalten" });
  });

  it("saveSettings schreibt nur übergebene Schlüssel", async () => {
    await localAdapter.saveSettings({ prefs: { appName: "Mein Sillage" } });
    const all = await localAdapter.loadAll();
    expect(all.prefs.appName).toBe("Mein Sillage");
    expect(all.userNotePrefs).toEqual([]);
  });

  it("bei Storage-Fehlern wird der Fallback geliefert und der Fehler gemeldet", async () => {
    const pushError = vi.fn();
    localAdapter.setPushError(pushError);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("boom"); });

    const all = await localAdapter.loadAll();
    expect(all.items).toEqual([]);
    expect(all.prefs.appName).toBe("Sillage");
    expect(all.onboarded).toBe(false);
    expect(pushError).toHaveBeenCalled();
  });

  it("saveItems fängt Storage-Fehler ab, ohne zu werfen", async () => {
    const pushError = vi.fn();
    localAdapter.setPushError(pushError);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });

    await expect(localAdapter.saveItems([basePerfume])).resolves.toBeUndefined();
    expect(pushError).toHaveBeenCalled();
  });
});