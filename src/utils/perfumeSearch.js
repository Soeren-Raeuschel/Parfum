/**
 * perfumeSearch.js – Suche/Matching über die Sammlung (aus App.jsx
 * ausgelagert): SYNONYMS, Query-Parsing und matchPerfume/getAllNotes.
 * Keine React-Abhängigkeit.
 */

import { splitNotes } from "./helpers";
import { normalizeText, tokenizeText } from "./perfumeMatch";

const SYNONYMS = {
  // Tabak
  tobacco: "tabak", tabac: "tabak", tabacco: "tabak", tabak: "tabak",
  // Vanille
  vanilla: "vanille", vanillin: "vanille", vanille: "vanille",
  // Moschus
  musk: "moschus", musc: "moschus", muschus: "moschus", moschus: "moschus",
  // Sandelholz
  sandalwood: "sandelholz", santal: "sandelholz", sandal: "sandelholz", sandelholz: "sandelholz",
  // Zedernholz
  cedarwood: "zedernholz", cedar: "zedernholz", cèdre: "zedernholz", zeder: "zedernholz", zedernholz: "zedernholz",
  // Ambra
  amber: "ambra", ambre: "ambra", ambergris: "ambra", ambra: "ambra", ambroxan: "ambra",
  // Oud
  oudh: "oud", aoud: "oud", oud: "oud",
  // Patschuli
  patchouli: "patschuli", patchuly: "patschuli", patschuli: "patschuli",
  // Bergamotte
  bergamot: "bergamotte", bergamotto: "bergamotte", bergamotte: "bergamotte",
  // Jasmin
  jasmine: "jasmin", jasminum: "jasmin", jasmin: "jasmin",
  // Rose
  rose: "rose", rosa: "rose", rosen: "rose",
  // Iris
  orris: "iris", iris: "iris",
  // Vetiver
  vetiver: "vetiver", vétiver: "vetiver",
  // Tonkabohne
  tonka: "tonkabohne", "fève tonka": "tonkabohne", tonkabohne: "tonkabohne",
  // Lavendel
  lavender: "lavendel", lavande: "lavendel", lavendel: "lavendel",
  // Zitrone
  lemon: "zitrone", citron: "zitrone", limone: "zitrone", citrus: "zitrus", zitrone: "zitrone",
  // Mandarine
  mandarin: "mandarine", tangerine: "mandarine", mandarine: "mandarine",
  // Kardamom
  cardamom: "kardamom", cardamome: "kardamom", kardamom: "kardamom",
  // Zimt
  cinnamon: "zimt", cannelle: "zimt", zimt: "zimt",
  // Ingwer
  ginger: "ingwer", gingembre: "ingwer", ingwer: "ingwer",
  // Neroli
  neroli: "neroli", néroli: "neroli",
  // Grapefruit
  pampelmuse: "grapefruit", grapefruit: "grapefruit",
  // Limette
  lime: "limette", limette: "limette",
  // Honig
  honey: "honig", miel: "honig", honig: "honig",
  // Leder
  leather: "leder", cuir: "leder", leder: "leder",
  // Eichenmoos
  oakmoss: "eichenmoos", mousse: "eichenmoos", eichenmoos: "eichenmoos",
  // Karamell
  caramel: "karamell", karamell: "karamell",
  // Pfeffer
  pepper: "pfeffer", poivre: "pfeffer", pfeffer: "pfeffer",
  // Zimt -> already done
  // Zypresse
  cypress: "zypresse", zypresse: "zypresse",
  // Pflaume
  plum: "pflaume", prune: "pflaume", pflaume: "pflaume",
  // Kirsche
  cherry: "kirsche", cerise: "kirsche", kirsche: "kirsche",
  // Feige
  fig: "feige", figue: "feige", feige: "feige",
  // Kaffee
  coffee: "kaffee", café: "kaffee", kaffee: "kaffee",
};

function normalizeTerm(raw) {
  const t = normalizeText(raw);
  return SYNONYMS[t] || t;
}

// Parse query string into normalized terms (split on whitespace or comma)
function parseQuery(q) {
  return q.split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(normalizeTerm);
}

// Get all normalized note tokens for a perfume
function perfumeNoteTokens(p) {
  const allNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)];
  return allNotes.map(n => normalizeTerm(n));
}

// Core match function: returns {matched: bool, hits: [{field, value}]}
// Every term must match at least one field (AND logic)
function matchPerfume(p, terms) {
  if (!terms.length) return { matched: true, hits: [] };
  const nameNorm = normalizeTerm(p.name || "");
  const houseNorm = normalizeTerm(p.house || "");
  const familyNorm = normalizeTerm(p.family || "");
  const nameTokens = tokenizeText(p.name || "").map(normalizeTerm);
  const houseTokens = tokenizeText(p.house || "").map(normalizeTerm);
  const noteCache = [["top", p.top], ["middle", p.middle], ["base", p.base]].map(([field, raw]) => {
    const notes = splitNotes(raw || "");
    return { field, notes, normNotes: notes.map(n => normalizeTerm(n)) };
  });
  const hits = [];
  for (const term of terms) {
    let termHit = false;
    // Name
    if (nameNorm.includes(term) || nameTokens.some(t => t.startsWith(term))) {
      hits.push({ field: "name", value: p.name, term });
      termHit = true;
    }
    // House
    if (!termHit && (houseNorm.includes(term) || houseTokens.some(t => t.startsWith(term)))) {
      hits.push({ field: "house", value: p.house, term });
      termHit = true;
    }
    // Notes (top / middle / base)
    if (!termHit) {
      for (const block of noteCache) {
        for (let i = 0; i < block.notes.length; i++) {
          const note = block.notes[i];
          const noteNorm = block.normNotes[i];
          if (noteNorm.includes(term)) {
            hits.push({ field: block.field, value: note, term });
            termHit = true;
            break;
          }
        }
        if (termHit) break;
      }
    }
    // Family
    if (!termHit && familyNorm.includes(term)) {
      hits.push({ field: "family", value: p.family, term });
      termHit = true;
    }
    if (!termHit) return { matched: false, hits: [] };
  }
  return { matched: true, hits };
}

// Collect all unique notes from collection, sorted by frequency
function getAllNotes(items) {
  const c = {};
  items.forEach(p => {
    [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
      .forEach(n => { const k = n.trim(); if (k) c[k] = (c[k] || 0) + 1; });
  });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: COST PER WEAR
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: MOOD HEADER (dynamischer Gradient pro Duftfamilie)
// ══════════════════════════════════════════════════════════════════════════════

export { SYNONYMS, normalizeTerm, parseQuery, perfumeNoteTokens, matchPerfume, getAllNotes };
