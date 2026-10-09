/**
 * Tests für collectionIO: Import-Dispatcher (TSV/CSV/JSON), Feld-Zuordnung,
 * Rating-Clamping, CSV-Quoting und Export-Payload.
 * Reine Logik-Tests ohne DOM-Interaktion.
 */
import { describe, it, expect } from "vitest";
import {
  parseImportFile, parseTSV, parseCSV, parseJSON, splitCsvLine,
  mapHeaderToFields, mapRowToPerfume, sanitizeField,
  buildExportPayload, buildExportCsv, exportReplacer,
  MAX_IMPORT_BYTES,
} from "../collectionIO";

const TSV = [
  "Name\tHaus\tKonzentration\tFamilie\tKopfnoten\tHerznoten\tBasisnoten\tSaison\tGeschlecht\tFormat\tBewertung\tParfumo Link",
  "Aventus\tCreed\tEDP\tFruchtig\tBergamotte\tBirke\tMoschus\tWinter\tMaskulin\tFlakon\t4\thttps://www.parfumo.de/x",
].join("\n");

describe("collectionIO – TSV-Import", () => {
  it("parst eine TSV-Zeile mit allen Spalten", () => {
    const items = parseImportFile(TSV, "sammlung.tsv");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Aventus", house: "Creed", conc: "EDP", family: "Fruchtig",
      top: "Bergamotte", middle: "Birke", base: "Moschus",
      season: "Winter", gender: "Maskulin", format: "Flakon",
      rating: 4, url: "https://www.parfumo.de/x",
    });
    expect(items[0].id).toBeTruthy();
  });

  it("clampt Ratings auf 0–5 und setzt 0 bei ungültigen Werten", () => {
    const text = [
      "Name\tBewertung",
      "ZuHoch\t9",
      "ZuTief\t-3",
      "KeineZahl\tabc",
    ].join("\n");
    const items = parseImportFile(text, "s.tsv");
    expect(items.map(p => p.rating)).toEqual([5, 0, 0]);
  });

  it("filtert Zeilen ohne Namen heraus", () => {
    const text = ["Name\tHaus", "\tCreed", "Aventus\tCreed"].join("\n");
    const items = parseImportFile(text, "s.tsv");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Aventus");
  });

  it("gibt ein leeres Array bei unbrauchbaren Daten zurück", () => {
    expect(parseImportFile("", "s.tsv")).toEqual([]);
    expect(parseImportFile("NurEineZeile", "s.tsv")).toEqual([]);
    expect(parseImportFile(null, "s.tsv")).toEqual([]);
  });
});

describe("collectionIO – CSV-Import", () => {
  it("respektiert Anführungszeichen und escaped Quotes", () => {
    const csv = [
      'Name,Haus,Kopfnoten,Familie,Bewertung',
      '"Duft, mit Komma","Haus ""X""","Zitrone, Bergamotte",Fresh,3',
    ].join("\r\n");
    const items = parseImportFile(csv, "s.csv");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Duft, mit Komma", house: 'Haus "X"',
      top: "Zitrone, Bergamotte", family: "Fresh", rating: 3,
    });
  });

  it("splitCsvLine trennt korrekt inkl. Escaping", () => {
    expect(splitCsvLine('a,"b,c","d""e"')).toEqual(["a", "b,c", 'd"e']);
    expect(splitCsvLine("x,y")).toEqual(["x", "y"]);
  });
});
describe("collectionIO – JSON-Import", () => {
  it("liest den Export-Payload (meta + items)", () => {
    const payload = JSON.stringify({
      meta: { app: "Sillage" },
      items: [{ name: "A", house: "B", rating: 10 }, { name: "" }, "kein objekt"],
      wishlist: [{ name: "W" }],
    });
    const items = parseImportFile(payload, "export.json");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "A", house: "B", rating: 5 });
  });

  it("akzeptiert ein Array und ein einzelnes Objekt", () => {
    expect(parseImportFile(JSON.stringify([{ name: "X" }]), "x.json")).toHaveLength(1);
    expect(parseImportFile('{"name":"Solo"}', "")).toHaveLength(1);
  });

  it("gibt bei kaputtem JSON ein leeres Array zurück", () => {
    expect(parseImportFile("{kaputt", "x.json")).toEqual([]);
    expect(parseImportFile("[]", "x.json")).toEqual([]);
  });

describe("collectionIO – Header-Zuordnung und Sanitizing", () => {
  it("mapHeaderToFields findet die richtigen Spalten", () => {
    const m = mapHeaderToFields(["Name", "Haus", "Kopfnoten", "Bewertung"]);
    expect(m.name).toBe(0);
    expect(m.house).toBe(1);
    expect(m.top).toBe(2);
    expect(m.rating).toBe(3);
  });

  it("'bewertung' schlägt 'rating' als Bewertungsspalte", () => {
    expect(mapHeaderToFields(["bewertung", "rating"]).rating).toBe(0);
    expect(mapHeaderToFields(["rating"]).rating).toBe(0);
    expect(mapHeaderToFields(["name"]).rating).toBe(-1);
  });

  it("mapRowToPerfume nutzt Standardwerte für leere Felder", () => {
    const m = mapHeaderToFields(["Name"]);
    const p = mapRowToPerfume(["NurName"], m);
    expect(p).toMatchObject({
      name: "NurName", family: "Sonstiges", season: "Ganzjährig",
      gender: "Unisex", format: "Probe", rating: 0,
    });
  });

  it("sanitizeField entfernt Tabs/Zeilenumbrüche und trimmt", () => {
    expect(sanitizeField("a\tb\nc\rd ")).toBe("a b c d");
    expect(sanitizeField(null)).toBe("");
    expect(sanitizeField(undefined)).toBe("");
  });
});
  it("erkennt JSON am Inhalt, wenn kein Dateiname vorliegt", () => {
describe("collectionIO – Export", () => {
  it("buildExportPayload liefert Meta-Zähler und saubere Listen", () => {
    const payload = buildExportPayload([{ name: "A", rating: 3 }], [{ name: "W" }]);
    expect(payload.meta.schemaVersion).toBe(1);
    expect(payload.meta.counts).toEqual({ items: 1, wishlist: 1 });
    expect(payload.items[0]).toMatchObject({ name: "A", rating: 3 });
    expect(payload.wishlist[0].name).toBe("W");
  });

  it("buildExportPayload funktioniert ohne Wishlist", () => {
    const payload = buildExportPayload([{ name: "A" }]);
    expect(payload.meta.counts.wishlist).toBe(0);
    expect(payload.wishlist).toEqual([]);
  });

  it("exportReplacer entfernt Funktionen/undefined", () => {
    expect(exportReplacer("a", () => {})).toBeUndefined();
    expect(exportReplacer("a", undefined)).toBeUndefined();
    expect(exportReplacer("a", 5)).toBe(5);
  });

  it("buildExportCsv nutzt BOM, Zeilenumbrüche und Quote-Escaping", () => {
    const csv = buildExportCsv([{ name: 'Duft "X"', house: "Haus", rating: 2 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toContain('"Name"');
    expect(lines[1]).toBe('"Duft ""X""","Haus",,,,,,,,,2,');
  });

  it("MAX_IMPORT_BYTES liegt bei 2 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 * 1024);
  });
});
    expect(parseImportFile('{"name":"Solo"}', "")).toHaveLength(1);
    // TSV ohne Dateiname wird als TSV geparst
    expect(parseImportFile(TSV, "")).toHaveLength(1);
  });
});