// Parsing der Parfumo-Duftseite (Port des Python-Skripts, cheerio statt BeautifulSoup)
import * as cheerio from "cheerio";

const SEASONS = new Set(["Frühling", "Sommer", "Herbst", "Winter"]);
const NOTE_LAYERS = { nb_t: "top", nb_m: "heart", nb_b: "base" };
const SIZE_RANK = { xl: 5, l: 4, m: 3, s: 2, xs: 1 }; // Skala ggf. anpassen

const sortDesc = (items, key) => [...items].sort((a, b) => b[key] - a[key]); // stabil

// aria-label "Herbst 33%, Winter 31%, ..." -> { Herbst: 33, ... }, absteigend sortiert
function parsePie(label) {
  const pairs = [];
  for (const part of (label ?? "").split(", ")) {
    const i = part.lastIndexOf(" ");
    if (i < 1) continue;
    pairs.push([part.slice(0, i), parseInt(part.slice(i + 1), 10)]);
  }
  pairs.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(pairs);
}

// Duftrichtungen; Gewicht aus der Größenklasse des Kreises
function parseAccords($) {
  const accords = [];
  $(".action_order_pd .s-circle-container").each((_, box) => {
    const name = $(box).find(".text-xs").first().text().trim();
    const cls = $(box).find(".s-circle").first().attr("class") ?? "";
    const size = /s-circle_(\w+)/.exec(cls)?.[1] ?? null;
    accords.push({ name, size, weight: SIZE_RANK[size] ?? 0 });
  });
  return sortDesc(accords, "weight");
}

// Kopf-/Herz-/Basisnoten. Ohne Pyramide: flache Liste -> alles als Kopfnote.
// Steht gar keine Note da, bleibt das Ergebnis leer ({}).
function parseNotes($) {
  const toItem = (el) => {
    const cls = $(el).attr("class") ?? "";
    const id = $(el).attr("data-n_id");
    return {
      id: id ? parseInt(id, 10) : null,
      name: $(el).text().trim(),
      emphasis: parseInt(/notefont(\d+)/.exec(cls)?.[1] ?? "0", 10),
    };
  };

  const notes = {};
  for (const [cls, layer] of Object.entries(NOTE_LAYERS)) {
    const block = $(`.pyramid_block.${cls}`).first();
    if (block.length) {
      notes[layer] = sortDesc(block.find(".clickable_note_img").toArray().map(toItem), "emphasis");
    }
  }
  if (Object.keys(notes).length === 0) {
    const flat = $(".notes_list .clickable_note_img").toArray().map(toItem);
    if (flat.length) notes.top = sortDesc(flat, "emphasis");
  }
  return notes;
}

// Marke, Jahr, Hersteller, Zielgruppe, Duftcharakter, Haltbarkeit/Sillage
function parseDescription($) {
  const desc = $('span[itemprop="description"]').first();
  if (!desc.length) return {};
  const out = {};

  const cmp = desc.find(".p_compare").first();
  if (cmp.length) {
    out.perfume_id = parseInt(cmp.attr("data-perfume-id"), 10);
    out.name = cmp.attr("data-perfume-name");
    out.brand = cmp.attr("data-brand-name");
    out.brand_slug = cmp.attr("data-brand-url");
    out.perfume_slug = cmp.attr("data-perfume-url");
  }
  const audio = desc.find(".action_play").first().attr("data-sound");
  if (audio) out.pronunciation_audio = audio;

  desc.find(".action_play, .p_compare").remove(); // interaktive Elemente vor dem Textlesen entfernen

  const year = desc.find('a[href*="/Erscheinungsjahre/"]').first().text().trim();
  if (/^\d{4}$/.test(year)) out.year = parseInt(year, 10);
  const maker = desc.find('a[href*="/makers/"]').first().text().trim();
  if (maker) out.maker = maker;

  const text = desc.text().replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();
  out.description_text = text; // Rohtext als Fallback
  out.target = /für (Damen und Herren|Damen|Herren)/.exec(text)?.[1];
  out.scent_character = /Der Duft ist ([^.]+)\./.exec(text)?.[1]?.trim();
  out.longevity_sillage = /Haltbarkeit und Sillage sind ([^.]+)\./.exec(text)?.[1]?.trim();
  return out;
}

export function parse(html, url) {
  const $ = cheerio.load(html);
  const data = { url, ...parseDescription($) };
  data.notes = parseNotes($);
  data.accords = parseAccords($);

  $("svg.pchart-pie").each((_, svg) => {
    const pie = parsePie($(svg).attr("aria-label"));
    const labels = Object.keys(pie);
    if (labels.length && labels.every((l) => SEASONS.has(l))) data.seasons = pie;
    else (data.other_charts ??= []).push(pie);
  });
  return data;
}
