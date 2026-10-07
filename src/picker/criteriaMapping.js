/**
 * criteriaMapping.js – Noten-Mapping pro Kriterium für den "Parfum des Tages"-Picker.
 *
 * Pro Kriterium (Anlass, Stimmung, Wetter, Tageszeit) gibt es Listen mit
 * HAUPT (+1.0), NEBEN (+0.5) und MEIDEN (−0.7). Matching ist case-insensitive,
 * deutsch und englisch (über NOTE_SYNONYMS), inkl. Teilstring- und
 * Präfix-Matching (Bergamotte/Bergamot, Moschus/Musk, Sandelholz/Sandalwood,
 * Weihrauch/Incense, Zitrone/Zitrus …).
 *
 * Alle Listen sind bewusst als leicht editierbare Konstanten gehalten.
 * Qualifier wie "leicht", "weißer", "dominant" werden beim Parsen entfernt,
 * Alternativen werden über "/" (ODER) und "+" (UND) ausgedrückt.
 */

// ── Normalisierung ───────────────────────────────────────────────────────────
/** Entfernt Diakritika (ü→u, é→e …). */
export function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Synonym-Karte: Variante → kanonischer deutscher Noten-Schlüssel.
 * Reicht über die Such-Synonyme aus utils/perfumeMatch.js hinaus.
 */
export const NOTE_SYNONYMS = {
  musk: "moschus", musc: "moschus", muschus: "moschus",
  sandalwood: "sandelholz", santal: "sandelholz", sandal: "sandelholz",
  cedar: "zeder", cedarwood: "zeder", cedre: "zeder",
  incense: "weihrauch", frankincense: "weihrauch",
  bergamot: "bergamotte", bergamotto: "bergamotte",
  vanilla: "vanille", vanillin: "vanille",
  lemon: "zitrone", citron: "zitrone", citrus: "zitrone", zitrusfruechte: "zitrone",
  mandarin: "mandarine", tangerine: "mandarine",
  lime: "limette",
  jasmine: "jasmin",
  lavender: "lavendel",
  amber: "ambra", ambre: "ambra", amberwood: "ambra",
  oudh: "oud", aoud: "oud",
  patchouli: "patschuli",
  tonka: "tonkabohne", "tonka bean": "tonkabohne", "feve tonka": "tonkabohne",
  cardamom: "kardamom",
  cinnamon: "zimt",
  ginger: "ingwer", gingembre: "ingwer",
  pepper: "pfeffer", poivre: "pfeffer",
  nutmeg: "muskat", clove: "nelke", carnation: "nelke",
  saffron: "safran",
  honey: "honig", miel: "honig",
  leather: "leder", cuir: "leder",
  caramel: "karamell",
  coffee: "kaffee", cocoa: "kakao", cacao: "kakao", chocolate: "schokolade",
  tobacco: "tabak", tabac: "tabak",
  mint: "minze", sage: "salbei", "clary sage": "muskatellersalbei",
  rosemary: "rosmarin", basil: "basilikum",
  grapefruit: "grapefruit", pampelmuse: "grapefruit",
  "orange blossom": "orangenblute",
  fig: "feige", pear: "birne", apple: "apfel", peach: "pfirsich",
  pineapple: "ananas", mango: "mango", coconut: "kokos",
  cherry: "kirsche", plum: "pflaume", blackberry: "brombeere", berry: "beere",
  violet: "veilchen", heliotrope: "heliotrop",
  myrrh: "myrrhe", benzoin: "benzoe", labdanum: "labdanum", opoponax: "opoponax",
  oakmoss: "eichenmoos", moss: "moos", pine: "kiefer", fir: "tanne", spruce: "fichte",
  cypress: "zypresse", juniper: "wacholder",
  cashmeran: "kaschmirholz", cashmere: "kaschmirholz",
  chamomile: "kamille", linden: "linde", bamboo: "bambus", freesia: "freesie",
  mimosa: "mimose", peony: "pfingstrose",
  cotton: "baumwolle", linen: "leinen",
  smoke: "rauch", "birch tar": "birke", birch: "birke", tar: "teer",
  vetiver: "vetiver", orris: "iris",
  petitgrain: "petitgrain",
  ambroxan: "ambroxan", calone: "calone",
  "sea salt": "meersalz", seasalt: "meersalz", marine: "marin",
  aldehyd: "aldehyde", aldehydes: "aldehyde",
  ylang: "ylang-ylang", tiare: "tiare",
  cucumber: "gurke", watermelon: "wassermelone", melon: "melone",
  rum: "rum", whisky: "whisky", whiskey: "whisky", gin: "gin",
  licorice: "lakritz", liquorice: "lakritz", lakritze: "lakritz",
  praline: "praline", marshmallow: "marshmallow", "cotton candy": "zuckerwatte",
  civet: "civette", castoreum: "castoreum",
  galbanum: "galbanum", elemi: "elemi",
  oregano: "oregano", thyme: "thymian", geranium: "geranie",
};

/** Normalisiert einen Noten-/Termin-Schlüssel: Diakritika raus, ß→ss, Synonym. */
export function normalizeKey(raw) {
  const t = stripDiacritics(String(raw || "")).toLowerCase().trim().replace(/ß/g, "ss");
  return NOTE_SYNONYMS[t] || t;
}

/**
 * Qualifier-Wörter, die beim Termin-Parsen entfernt werden
 * ("leichte Vanille" → "vanille", "dominantes Sandelholz" → "sandelholz").
 */
const STOPWORDS = new Set([
  "leicht", "leichte", "leichter", "leichtes", "weich", "weiche", "weicher",
  "weisser", "weisse", "dominant", "dominante", "dominantes", "dominanter",
  "stark", "starke", "starkes", "schwer", "schwere", "schweres",
  "rein", "reine", "reines", "extrem", "fein", "feine", "feiner",
  "dunkel", "dunkle", "dunkles", "scharf", "scharfe", "scharfes",
  "kuehl", "kuhle", "frisch", "frische", "accord", "noten", "note", "duft",
]);

/**
 * Parst einen Mapping-Termin in Alternativen (ODER über "/", UND über "+" und
 * Leerzeichen). Jede Alternative ist ein Array normalisierter Schlüsselwörter.
 */
function parseTerm(raw) {
  return String(raw)
    .split("/")
    .map(alt =>
      alt
        .split(/[\s+]+/)
        .map(w => normalizeKey(w))
        .filter(Boolean)
        .filter(w => !STOPWORDS.has(w))
    )
    .filter(words => words.length > 0);
}

function compileList(list) {
  return (list || []).flatMap(parseTerm);
}

function compileAll(map) {
  const out = {};
  for (const [key, entry] of Object.entries(map)) {
    out[key] = {
      haupt: compileList(entry.haupt),
      neben: compileList(entry.neben),
      meiden: compileList(entry.meiden),
    };
  }
  return out;
}

// ── Evidenz: "Attraktivitäts-Noten" (Faktor 0.4, siehe pickerConfig) ─────────
export const ATTRACTIVENESS_NOTES = [
  "vetiver", "zitrone", "bergamotte", "grapefruit", "limette", "orange", "mandarine",
  "neroli", "aquatisch", "marin", "meer", "ozean", "wasser", "salz", "meersalz",
  "calone", "ozonisch", "regen", "tabak", "rauch", "oud", "zeder", "sandelholz",
  "ambra", "tonkabohne", "vanille", "minze", "moschus",
];

// ── Anlass-Noten (SCHRITT 3) ─────────────────────────────────────────────────
export const OCCASION_NOTES = {
  everyday: {
    haupt: ["bergamotte", "mandarine", "orange", "zitrone", "apfel", "kardamom",
      "rosa pfeffer", "ambrette", "moschus", "zeder", "sandelholz", "vetiver", "tee"],
    neben: ["lavendel", "salbei", "iris", "birne", "feige", "leichte vanille",
      "tonkabohne", "jasmin", "orangenblüte", "neroli"],
    meiden: ["oud", "zibet", "castoreum", "civette", "teer", "birke",
      "karamell", "schokolade", "zuckerwatte", "honig"],
  },
  business: {
    haupt: ["bergamotte", "neroli", "zitrone", "grapefruit", "lavendel", "moschus",
      "zeder", "sandelholz", "vetiver", "salbei", "minze", "aquatisch", "ozonisch",
      "meer", "ozean", "iris", "puder"],
    neben: ["tee", "grün", "gras", "orangenblüte", "zypresse", "wacholder",
      "vanille", "ambra"],
    meiden: ["oud", "leder", "zibet", "castoreum", "civette", "rum", "gin", "whisky",
      "karamell", "schokolade", "kaffee", "weihrauch", "rauch", "birke"],
  },
  date: {
    haupt: ["vanille", "ambra", "moschus", "sandelholz", "tonkabohne", "rose",
      "jasmin", "safran", "patschuli", "orangenblüte", "iris", "feige"],
    neben: ["lakritz", "zeder", "kardamom", "zimt", "pfeffer", "veilchen",
      "benzoe", "kaschmirholz", "bergamotte"],
    meiden: ["aquatisch", "ozonisch", "meer", "ozean", "calone", "minze",
      "seife", "waschmittel", "gurke"],
  },
  evening: {
    haupt: ["oud", "ambra", "weihrauch", "leder", "labdanum", "patschuli", "tabak",
      "zimt", "safran", "kardamom", "muskat", "vanille", "benzoe", "myrrhe", "rose"],
    neben: ["honig", "kaffee", "kakao", "karamell", "rum", "whisky", "sandelholz",
      "tonkabohne", "iris", "birke", "rauch", "zibet", "castoreum", "civette"],
    meiden: ["zitrone", "limette", "bergamotte", "grapefruit", "mandarine", "orange",
      "aquatisch", "meer", "ozean", "minze", "gurke", "wassermelone"],
  },
  sport: {
    haupt: ["zitrone", "limette", "grapefruit", "bergamotte", "minze", "basilikum",
      "salbei", "aquatisch", "marin", "meersalz", "grün", "gras", "birne", "apfel", "tee"],
    neben: ["moschus", "ingwer", "rosmarin", "lavendel", "linde", "orangenblüte",
      "freesie", "bambus", "zeder", "ambroxan"],
    meiden: ["vanille", "ambra", "oud", "weihrauch", "harz", "balsam", "tonkabohne",
      "karamell", "schokolade", "kaffee", "patschuli", "tuberose", "leder", "tabak"],
  },
  special: {
    haupt: ["oud", "ambra", "weihrauch", "safran", "iris", "rose", "leder",
      "labdanum", "honig", "vanille", "sandelholz", "tuberose", "jasmin"],
    neben: ["myrrhe", "benzoe", "patschuli", "tabak", "zimt", "pfeffer", "kardamom",
      "nelke", "brombeere", "kaschmirholz", "aldehyde", "veilchen"],
    meiden: ["seife", "waschmittel", "meer", "ozean", "calone"],
  },
  outdoor: {
    haupt: ["zeder", "kiefer", "tanne", "fichte", "wacholder", "vetiver", "zypresse",
      "moos", "eichenmoos", "lavendel", "rosmarin", "salbei", "minze", "grün", "ozonisch"],
    neben: ["bergamotte", "zitrone", "weihrauch", "rauch", "lagerfeuer", "sandelholz",
      "patschuli", "erde", "pfeffer", "tee"],
    meiden: ["zuckerwatte", "karamell", "marshmallow", "puder", "heliotrop"],
  },
  travel: {
    haupt: ["zitrone", "bergamotte", "orange", "grün", "gras", "tee", "zeder",
      "sandelholz", "vetiver", "moschus"],
    neben: ["pfeffer", "kardamom", "lavendel", "salbei", "iris", "vanille", "ambra"],
    meiden: ["oud", "zibet", "castoreum", "civette", "karamell", "schokolade", "zuckerwatte"],
  },
  vacation: {
    haupt: ["aquatisch", "meer", "ozean", "meersalz", "kokos", "ylang-ylang", "tiare",
      "bergamotte", "mandarine", "zitrone", "neroli", "orangenblüte", "jasmin",
      "feige", "mango", "ambra"],
    neben: ["heliotrop", "sandelholz+moschus", "ananas", "pfirsich", "tee", "salbei",
      "lavendel", "vetiver", "bambus", "vanille"],
    meiden: ["oud", "weihrauch", "myrrhe", "labdanum", "benzoe", "leder", "tabak",
      "zimt", "pfeffer", "nelke", "safran"],
  },
  sleep: {
    haupt: ["lavendel", "kamille", "vanille", "sandelholz", "kaschmirholz", "moschus",
      "tonkabohne", "bergamotte", "patschuli", "ylang-ylang"],
    neben: ["jasmin", "rose", "neroli", "wacholder", "muskatellersalbei", "weihrauch",
      "vetiver", "benzoe", "baumwolle", "leinen", "tee", "iris"],
    meiden: ["minze", "grapefruit", "rosmarin", "kaffee", "ingwer", "zimt", "pfeffer",
      "nelke", "aquatisch", "meer", "ozean", "calone"],
  },
};

// ── Stimmungs-Noten (SCHRITT 4) ──────────────────────────────────────────────
export const MOOD_NOTES = {
  energetic: {
    haupt: ["zitrone", "bergamotte", "minze", "rosmarin"],
    neben: ["ingwer", "grapefruit", "grün", "gras", "pfeffer"],
    meiden: ["vanille", "sandelholz", "weihrauch", "myrrhe", "labdanum", "benzoe"],
  },
  calm: {
    haupt: ["lavendel", "vanille", "sandelholz"],
    neben: ["bergamotte", "kamille", "tonkabohne", "moschus", "iris"],
    meiden: ["minze", "rosmarin", "zimt", "pfeffer", "ingwer", "nelke", "safran"],
  },
  confident: {
    haupt: ["zeder", "sandelholz", "vetiver", "leder"],
    neben: ["tabak", "pfeffer", "salbei", "ambra", "weihrauch"],
    meiden: ["zucker", "zuckerwatte", "marshmallow", "karamell", "bonbon"],
  },
  romantic: {
    haupt: ["moschus", "ambra", "tonkabohne", "rose"],
    neben: ["vanille", "jasmin", "iris", "sandelholz", "pfingstrose"],
    meiden: ["minze", "aquatisch", "meer", "ozean", "calone"],
  },
  playful: {
    haupt: ["bergamotte", "zitrone", "orange", "apfel", "birne", "pfirsich",
      "kirsche", "brombeere", "beere"],
    neben: ["vanille", "zucker", "orangenblüte", "neroli"],
    meiden: ["leder", "rauch", "oud", "birke"],
  },
  // "Geheimnisvoll" wirkt nur über Familien (→ familyMapping.js), daher hier leer.
  mysterious: { haupt: [], neben: [], meiden: [] },
};

// ── Wetter-Noten (SCHRITT 5) ─────────────────────────────────────────────────
export const WEATHER_NOTES = {
  hot: {
    haupt: ["zitrone", "bergamotte", "limette", "grapefruit", "mandarine", "orange",
      "minze", "aquatisch", "meer", "ozean", "meersalz", "calone", "kokos", "mango",
      "ananas", "apfel", "birne", "melone", "jasmin", "neroli", "orangenblüte"],
    neben: ["grün", "gras", "tee", "bambus", "vetiver"],
    meiden: ["weihrauch", "myrrhe", "labdanum", "benzoe", "oud", "leder", "tabak",
      "karamell", "schokolade", "honig", "zuckerwatte"],
  },
  cold: {
    haupt: ["vanille", "ambra", "oud", "tonkabohne", "myrrhe", "leder", "zimt",
      "pfeffer", "nelke", "tabak", "kardamom", "safran", "karamell", "schokolade",
      "weihrauch", "labdanum", "benzoe"],
    neben: ["sandelholz", "zeder", "patschuli", "rose", "moschus"],
    meiden: ["zitrone", "limette", "bergamotte", "grapefruit", "minze", "aquatisch",
      "meer", "ozean", "calone", "gurke", "wassermelone", "melone"],
  },
  rain: {
    haupt: ["grün", "gras", "moos", "eichenmoos", "vetiver", "zeder", "erde",
      "geosmin", "petrichor", "bambus", "tee", "grüner tee"],
    neben: ["lavendel", "salbei", "pfeffer", "kardamom"],
    meiden: ["zuckerwatte", "karamell", "marshmallow", "honig", "zucker"],
  },
  // Bewölkt: neutral, nur leichte Bevorzugung (NEBEN ohne HAUPT/MEIDEN).
  cloudy: { haupt: [], neben: ["zeder", "sandelholz", "iris", "lavendel", "salbei", "vetiver", "jasmin"], meiden: [] },
};

// ── Tageszeit-Noten (SCHRITT 5) ──────────────────────────────────────────────
export const TIME_NOTES = {
  morning: {
    haupt: ["zitrone", "bergamotte", "orange", "mandarine", "minze", "grapefruit",
      "tee", "grüner tee", "rosmarin"],
    neben: ["lavendel", "salbei", "grün", "gras"],
    meiden: ["oud", "weihrauch", "labdanum", "myrrhe", "leder", "tabak"],
  },
  afternoon: {
    haupt: ["zitrone", "bergamotte", "apfel", "birne", "pfirsich", "jasmin", "rose",
      "pfingstrose", "meer", "ozean", "zeder", "sandelholz"],
    neben: ["iris", "vetiver", "moschus"],
    meiden: [],
  },
  evening: {
    haupt: ["zimt", "pfeffer", "kardamom", "sandelholz", "zeder", "vanille", "rose",
      "jasmin", "ambra", "oud"],
    neben: ["karamell", "kaffee", "tonkabohne", "honig", "patschuli"],
    meiden: [],
  },
  night: {
    haupt: ["oud", "ambra", "vanille", "karamell", "schokolade", "leder", "tabak",
      "weihrauch", "labdanum", "iris", "puder", "moschus"],
    neben: ["rose", "jasmin", "sandelholz"],
    meiden: ["zitrone", "limette", "bergamotte", "minze", "meer", "ozean", "grün", "gras", "tee"],
  },
};

// ── Anlass-Feinheiten: Intensitäts-/Haltbarkeits-Hints (SCHRITT 3/6) ─────────
// Keys: heavy (Level 3), medium (Level 2), light (Level 1). Werte sind
// Multiplikatoren auf den Nachbarstufen-Score des jeweiligen Kriteriums.
export const OCCASION_PERFORMANCE_HINTS = {
  business: { intensity: { heavy: 0.85 } },
  sport: { intensity: { heavy: 0.6 }, longevity: { heavy: 0.6 } },
  travel: { intensity: { medium: 1.1 }, longevity: { medium: 1.1 } },
  sleep: { intensity: { light: 1.1, heavy: 0.6 }, longevity: { light: 1.1, heavy: 0.6 } },
};

// ── Kompilierung & Matching ──────────────────────────────────────────────────
const COMPILED = {
  occasion: compileAll(OCCASION_NOTES),
  mood: compileAll(MOOD_NOTES),
  weather: compileAll(WEATHER_NOTES),
  time: compileAll(TIME_NOTES),
};
// Stimmung "Schlafen" = Anlass "Schlafen" (vereinheitlicht, SCHRITT 6.2)
COMPILED.mood.sleep = COMPILED.occasion.sleep;

/** Liefert das kompilierte Noten-Mapping für eine Kriterien-Art und einen Schlüssel. */
export function getNoteMapping(kind, key) {
  const group = COMPILED[kind];
  return group ? group[key] || null : null;
}

/**
 * Prüft, ob ein normalisierter Noten-Schlüssel zu einer Alternative passt
 * (Teilstring in beide Richtungen oder gemeinsames 4-Zeichen-Präfix,
 * damit "Zitrone/Zitrus" und "Moschus/Musk" zusammenfinden).
 */
export function matchWords(note, words) {
  return words.every(w => {
    if (note.includes(w)) return true;
    if (w.includes(note) && note.length >= 3) return true;
    return w.length >= 4 && note.length >= 4 && note.slice(0, 4) === w.slice(0, 4);
  });
}

/**
 * Ordnet eine Note einer Kategorie zu ('haupt' | 'neben' | 'meiden' | null).
 * Priorität: HAUPT vor NEBEN vor MEIDEN.
 */
export function categorizeNote(note, compiled) {
  if (!compiled || !note) return null;
  if (compiled.haupt.some(alt => matchWords(note, alt))) return "haupt";
  if (compiled.neben.some(alt => matchWords(note, alt))) return "neben";
  if (compiled.meiden.some(alt => matchWords(note, alt))) return "meiden";
  return null;
}

/** Evidenz-Set für "Attraktivitäts-Noten" (normalisiert). */
export const ATTRACTIVENESS_SET = new Set(ATTRACTIVENESS_NOTES.map(normalizeKey));

/** Teilt einen Noten-String ("·" oder ",") in einzelne Noten. */
export function splitNoteString(val) {
  if (!val) return [];
  return String(val).replace(/\s*·\s*/g, ",").split(",").map(n => n.trim()).filter(Boolean);
}