/**
 * Tests für den Parfumo-Parser (Netlify Function): Description-Felder,
 * Notenpyramide (mit Fallback auf flache Liste), Accorde-Sortierung und
 * Saison-/Weitere-Diagramme. Nutzt ein kleines synthetisches HTML-Fixture,
 * das die von Parfumo erwarteten Klassen/Attribute nachbildet.
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parfumo-parser.mjs";

const URL = "https://www.parfumo.de/Parfums/Creed/Aventus";

const FIXTURE = `
<html><body>
<span itemprop="description">
  <span class="p_compare"
    data-perfume-id="1234"
    data-perfume-name="Aventus"
    data-brand-name="Creed"
    data-brand-url="creed"
    data-perfume-url="Aventus"></span>
  <span class="action_play" data-sound="/audio/aventus.mp3"></span>
  Ein klassischer Duft für Damen und Herren. Der Duft ist fruchtig und rauchig.
  Haltbarkeit und Sillage sind sehr gut . Komponiert von
  <a href="/makers/jean-claude">Jean Claude</a> , erschienen
  <a href="/Parfums/Erscheinungsjahre/2010">2010</a> .
</span>
<div class="pyramid_block nb_t">
  <span class="clickable_note_img notefont2" data-n_id="11">Bergamotte</span>
  <span class="clickable_note_img notefont3" data-n_id="12">Ananas</span>
</div>
<div class="pyramid_block nb_m">
  <span class="clickable_note_img notefont1" data-n_id="13">Birke</span>
</div>
<div class="pyramid_block nb_b">
  <span class="clickable_note_img notefont1" data-n_id="14">Moschus</span>
</div>
<div class="action_order_pd">
  <div class="s-circle-container">
    <div class="s-circle s-circle_l"></div>
    <div class="text-xs">Fruchtig</div>
  </div>
  <div class="s-circle-container">
    <div class="s-circle s-circle_xl"></div>
    <div class="text-xs">Woody</div>
  </div>
  <div class="s-circle-container">
    <div class="s-circle s-circle_unbekannt"></div>
    <div class="text-xs">Rauchig</div>
  </div>
</div>
<svg class="pchart-pie" aria-label="Herbst 40%, Winter 30%, Frühling 20%, Sommer 10%"></svg>
<svg class="pchart-pie" aria-label="Damen 60%, Unisex 40%"></svg>
</body></html>`;

describe("parfumo-parser – Description", () => {
  const data = parse(FIXTURE, URL);

  it("übernimmt die URL und die p_compare-Metadaten", () => {
    expect(data.url).toBe(URL);
    expect(data.perfume_id).toBe(1234);
    expect(data.name).toBe("Aventus");
    expect(data.brand).toBe("Creed");
    expect(data.brand_slug).toBe("creed");
    expect(data.perfume_slug).toBe("Aventus");
  });

  it("liest die Aussprache-Audiodatei", () => {
    expect(data.pronunciation_audio).toBe("/audio/aventus.mp3");
  });

  it("extrahiert Jahr, Hersteller, Zielgruppe, Charakter und Haltbarkeit", () => {
    expect(data.year).toBe(2010);
    expect(data.maker).toBe("Jean Claude");
    expect(data.target).toBe("Damen und Herren");
    expect(data.scent_character).toBe("fruchtig und rauchig");
    expect(data.longevity_sillage).toBe("sehr gut");
  });

  it("normalisiert den Rohtext (Whitespace, Leerzeichen vor Satzzeichen)", () => {
    expect(data.description_text).not.toMatch(/\s{2,}/);
    expect(data.description_text).not.toMatch(/ \./);
  });
});

describe("parfumo-parser – Notenpyramide", () => {
  const data = parse(FIXTURE, URL);

  it("liest Kopf-, Herz- und Basisnoten mit ID und Gewichtung", () => {
    expect(data.notes.top).toEqual([
      { id: 12, name: "Ananas", emphasis: 3 },
      { id: 11, name: "Bergamotte", emphasis: 2 },
    ]);
    expect(data.notes.heart).toEqual([{ id: 13, name: "Birke", emphasis: 1 }]);
    expect(data.notes.base).toEqual([{ id: 14, name: "Moschus", emphasis: 1 }]);
  });

  it("fällt auf die flache Notenliste zurück, wenn keine Pyramide existiert", () => {
    const html = `
      <html><body>
        <div class="notes_list">
          <span class="clickable_note_img notefont2" data-n_id="21">Zitrone</span>
          <span class="clickable_note_img notefont3" data-n_id="22">Limette</span>
        </div>
      </body></html>`;
    const d = parse(html, URL);
    expect(d.notes.top).toEqual([
      { id: 22, name: "Limette", emphasis: 3 },
      { id: 21, name: "Zitrone", emphasis: 2 },
    ]);
    expect(d.notes.heart).toBeUndefined();
    expect(d.notes.base).toBeUndefined();
  });

  it("liefert ein leeres Noten-Objekt ohne Noten", () => {
    const d = parse("<html><body><p>nichts</p></body></html>", URL);
    expect(d.notes).toEqual({});
  });
describe("parfumo-parser – Accorde", () => {
  it("gewichtet nach Größenklasse und sortiert absteigend", () => {
    const data = parse(FIXTURE, URL);
    expect(data.accords).toEqual([
      { name: "Woody", size: "xl", weight: 5 },
      { name: "Fruchtig", size: "l", weight: 4 },
      { name: "Rauchig", size: "unbekannt", weight: 0 },
    ]);
  });
});

describe("parfumo-parser – Diagramme", () => {
  it("erkennt Saison-Diagramme und sortiert die Anteile absteigend", () => {
    const data = parse(FIXTURE, URL);
    expect(data.seasons).toEqual({ Herbst: 40, Winter: 30, Frühling: 20, Sommer: 10 });
  });

  it("sammelt Nicht-Saison-Diagramme unter other_charts", () => {
    const data = parse(FIXTURE, URL);
    expect(data.other_charts).toEqual([{ Damen: 60, Unisex: 40 }]);
  });
});

describe("parfumo-parser – Robustheit", () => {
  it("übersteht leeres und kaputtes HTML ohne Exceptions", () => {
    expect(() => parse("", URL)).not.toThrow();
    expect(() => parse("<html><body><p>kaputt</p", URL)).not.toThrow();

    const d = parse("", URL);
    expect(d.url).toBe(URL);
    expect(d.notes).toEqual({});
    expect(d.accords).toEqual([]);
    expect(d.seasons).toBeUndefined();
    expect(d.other_charts).toBeUndefined();
  });

  it("liefert ohne Description-Block keine Description-Felder", () => {
    const d = parse("<html><body><p>ohne Beschreibung</p></body></html>", URL);
    expect(d.name).toBeUndefined();
    expect(d.year).toBeUndefined();
    expect(d.description_text).toBeUndefined();
  });

  it("behandelt Diagramme mit unbekannten Labels nicht als Saison", () => {
    const d = parse('<svg class="pchart-pie" aria-label="Damen 50%, Herren 50%"></svg>', URL);
    expect(d.seasons).toBeUndefined();
    expect(d.other_charts).toEqual([{ Damen: 50, Herren: 50 }]);
  });
});
});