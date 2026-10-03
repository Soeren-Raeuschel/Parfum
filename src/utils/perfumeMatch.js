/**
 * Core perfume matching functions extracted from App.jsx
 * Diese Funktionen sind für die Filtration und den Abgleich von Parfüms
 * zuständig und werden von der Sammlungssuche verwendet.
 */

/**
 * Strip diacritics from a string
 * @param {string} s - Der zu bereinigende Text
 * @returns {string} Text ohne diakritische Zeichen
 */
function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalisiert einen Suchbegriff
 * @param {string} s - Der Roh-Suchbegriff
 * @returns {string} Der normalisierte Suchbegriff
 */
function normalizeText(s) {
  return stripDiacritics(String(s || "")).toLowerCase().trim();
}

/**
 * Synonym-Karte für Duftbegriffe - Maps every known variant to a canonical German key
 */
const SYNONYMS = {
  tobacco: "tabak", tabac: "tabak", tabacco: "tabak", tabak: "tabak",
  vanilla: "vanille", vanillin: "vanille", vanille: "vanille",
  musk: "moschus", musc: "moschus", muschus: "moschus", moschus: "moschus",
  sandalwood: "sandelholz", santal: "sandelholz", sandal: "sandelholz", sandelholz: "sandelholz",
  cedarwood: "zedernholz", cedar: "zedernholz", cèdre: "zedernholz", zeder: "zedernholz", zedernholz: "zedernholz",
  amber: "ambra", ambre: "ambra", ambergris: "ambra", ambra: "ambra", ambroxan: "ambra",
  oudh: "oud", aoud: "oud", oud: "oud",
  patchouli: "patschuli", patchuly: "patschuli", patschuli: "patschuli",
  bergamot: "bergamotte", bergamotto: "bergamotte", bergamotte: "bergamotte",
  jasmine: "jasmin", jasminum: "jasmin", jasmin: "jasmin",
  rose: "rose", rosa: "rose", rosen: "rose",
  orris: "iris", iris: "iris",
  vetiver: "vetiver", vétiver: "vetiver",
  tonka: "tonkabohne", "fève tonka": "tonkabohne", tonkabohne: "tonkabohne",
  lavender: "lavendel", lavande: "lavendel", lavendel: "lavendel",
  lemon: "zitrone", citron: "zitrone", limone: "zitrone", citrus: "zitrus", zitrone: "zitrone",
  mandarin: "mandarine", tangerine: "mandarine", mandarine: "mandarine",
  cardamom: "kardamom", cardamome: "kardamom", kardamom: "kardamom",
  cinnamon: "zimt", cannelle: "zimt", zimt: "zimt",
  ginger: "ingwer", gingembre: "ingwer", ingwer: "ingwer",
  neroli: "neroli", néroli: "neroli",
  pampelmuse: "grapefruit", grapefruit: "grapefruit",
  lime: "limette", limette: "limette",
  honey: "honig", miel: "honig", honig: "honig",
  leather: "leder", cuir: "leder", leder: "leder",
  oakmoss: "eichenmoos", mousse: "eichenmoos", eichenmoos: "eichenmoos",
  caramel: "karamell", karamell: "karamell",
  pepper: "pfeffer", poivre: "pfeffer", pfeffer: "pfeffer",
  cypress: "zypresse", zypresse: "zypresse",
  plum: "pflaume", prune: "pflaume", pflaume: "pflaume",
  cherry: "kirsche", cerise: "kirsche", kirsche: "kirsche",
  fig: "feige", figue: "feige", feige: "feige",
};
/**
 * Normalisiert einen Roh-Suchbegriff unter Verwendung von Synonymen
 * @param {string} raw - Der Roh-Suchbegriff
 * @returns {string} Der normalisierte Suchbegriff mit Synonymen aufgelöst
 */
function normalizeTerm(raw) {
  const t = normalizeText(raw);
  return SYNONYMS[t] || t;
}

/**
 * Teilt einen Noten-String in einzelne Noten auf
 * @param {string} val - Der Noten-String (kann "·" oder "," enthalten)
 * @returns {string[]} Array von Noten
 */
function splitNotes(val) {
  if (!val) return [];
  return val.replace(/\s*·\s*/g, ',').split(',').map(n => n.trim()).filter(Boolean);
}

/**
 * Parse query string into normalized terms (split on whitespace or comma)
 * @param {string} q - Der Suchbegriff
 * @returns {string[]} Array von normalisierten Suchbegriffen
 */
function parseQuery(q) {
  if (!q) return [];
  return q.split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(normalizeTerm);
}

/**
 * Get all normalized note tokens for a perfume
 * @param {Object} p - Das Parfum-Objekt mit top/middle/base Noten
 * @returns {string[]} Array von normalisierten Note-Tokens
 */
function perfumeNoteTokens(p) {
  const allNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)];
  return allNotes.map(n => normalizeText(n));
}

/**
 * Tokenisiert Text in einzelne Wörter für bessere Suche
 * @param {string} s - Der zu tokenisierende Text
 * @returns {string[]} Array von Tokens
 */
function tokenizeText(s) {
  return normalizeText(s).split(/[^a-z0-9äöüß]+/).filter(Boolean);
}
// Export all functions
export { 
  stripDiacritics,
  normalizeText,
  SYNONYMS,
  normalizeTerm,
  splitNotes,
  parseQuery,
  perfumeNoteTokens,
  tokenizeText
};
