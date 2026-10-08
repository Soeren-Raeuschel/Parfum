// Gemeinsame Konstanten & reine Helfer (aus App.jsx ausgelagert)
const KEYS = {
  items: "parfum_collection_v2",
  log: "parfum_log_v2",
  notes: "parfum_notes_v1",
  wishlist: "parfum_wishlist_v1",
  prefs: "parfum_prefs_v1",
  fillLevels: "parfum_fill_v1",
  onboarding: "parfum_onboard_v1",
  groqKey: "parfum_groq_key_v1",
  priceMl: "parfum_price_ml_v1",
  userNotePrefs: "parfum_user_note_prefs_v1",
  userFamilyPrefs: "parfum_user_family_prefs_v1",
  declutterStatus: "parfum_declutter_status_v1",
};

const SEASON_COLORS = {
  Frühling: { bg: "#E1F5EE", accent: "#0F6E56", text: "#085041" },
  Sommer: { bg: "#FAEEDA", accent: "#BA7517", text: "#633806" },
  Herbst: { bg: "#FAECE7", accent: "#993C1D", text: "#712B13" },
  Winter: { bg: "#E6F1FB", accent: "#185FA5", text: "#0C447C" },
  Ganzjährig: { bg: "#EEEDFE", accent: "#534AB7", text: "#3C3489" },
};
const FAM_COLORS = {
  Floral: "#D4537E", Woody: "#BA7517", Oriental: "#993C1D", Fresh: "#1D9E75",
  Chypre: "#185FA5", "Fougère": "#3B6D11", Gourmand: "#534AB7",
  Aquatisch: "#0F6E56", Sonstiges: "#5F5E5A",
  Süß: "#D4537E", Würzig: "#BA7517", Grün: "#5C6B4F", Animalisch: "#8B4513",
  Harzig: "#8B5E3C", Ledrig: "#7B4F3A", Rauchig: "#5F5E5A", Pudrig: "#C4A0B0", Zitrisch: "#C9A825",
  Erdig: "#6B5B3E", Cremig: "#E89B7A", Fruchtig: "#C2604A", Synthetisch: "#7F77DD",
};
const NOTE_TAGS = [
  { id: "eindruck", label: "Eindruck", color: "#534AB7" },
  { id: "anlass", label: "Anlass", color: "#0F6E56" },
  { id: "performance", label: "Performance", color: "#BA7517" },
  { id: "vergleich", label: "Vergleich", color: "#185FA5" },
  { id: "sonstiges", label: "Sonstiges", color: "#5F5E5A" },
];
const WISH_PRIOS = [
  { id: 1, label: "Muss haben", color: "#993C1D" },
  { id: 2, label: "Interessant", color: "#BA7517" },
  { id: 3, label: "Irgendwann", color: "#5F5E5A" },
];

function getSeasonColor(season) {
  if (!season) return SEASON_COLORS["Ganzjährig"];
  if (SEASON_COLORS[season]) return SEASON_COLORS[season];
  const key = Object.keys(SEASON_COLORS).find(k => season.includes(k));
  return SEASON_COLORS[key] || SEASON_COLORS["Ganzjährig"];
}
// NOTE: Season detection assumes northern hemisphere (März–Mai = Frühling etc.).

const FAMILIES = ["Floral", "Woody", "Oriental", "Fresh", "Chypre", "Fougère", "Gourmand", "Aquatisch", "Süß", "Würzig", "Grün", "Animalisch", "Harzig", "Ledrig", "Rauchig", "Pudrig", "Zitrisch", "Erdig", "Cremig", "Fruchtig", "Synthetisch", "Sonstiges"];
const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];
const NOTE_CATEGORIES = ["Süß", "Würzig", "Grün", "Animalisch", "Harzig", "Synthetisch", "Rauchig", "Fougère", "Aquatisch", "Pudrig", "Zitrisch", "Erdig", "Cremig", "Fruchtig"];
const NOTE_CAT_COLORS = {
  Süß: "#D4537E", Würzig: "#BA7517", Grün: "#5C6B4F", Animalisch: "#8B4513",
  Harzig: "#8B5E3C", Synthetisch: "#7F77DD", Rauchig: "#5F5E5A", Fougère: "#3B6D11",
  Aquatisch: "#2E86AB", Pudrig: "#C4A0B0", Zitrisch: "#C9A825", Erdig: "#6B5B3E",
  Cremig: "#E89B7A", Fruchtig: "#C2604A",
};

// Konzentration → Farbe (visuell differenziert)
const CONC_COLORS = {
  Parfum: "#1A1A18",  // dunkelschwarz/blau
  EDP: "#CED4DD",     // hellgrau
  EDT: "#F5C6BA",     // beige/creme
  EDC: "#E89B7A",     // cremig
  Extrait: "#8B4513", // braun
  Solid: "#5C6B4F",   // grün
};

const NOTE_TO_CAT = {
  // Süß
  vanille: "Süß", honig: "Süß", karamell: "Süß", zucker: "Süß", praline: "Süß", schokolade: "Süß",
  marshmallow: "Süß", bonbon: "Süß", "cotton candy": "Süß", tonka: "Süß",
  // heliotrop → Pudrig (powdery is its dominant character; removed duplicate Süß entry)
  // Würzig
  zimt: "Würzig", pfeffer: "Würzig", muskat: "Würzig", ingwer: "Würzig", nelke: "Würzig",
  safran: "Würzig", kardamom: "Würzig", kumin: "Würzig", sternanis: "Würzig", kurkuma: "Würzig",
  // Grün
  gras: "Grün", tee: "Grün", bambus: "Grün", moos: "Grün", blätter: "Grün",
  fleur: "Grün", "grüner tee": "Grün", galbanum: "Grün",
  // eichenmoos → Fougère (canonical home; removed duplicate Grün entry)
  // vetiver → Erdig (dominant character; removed duplicate Grün/Rauchig entries)
  // Animalisch
  moschus: "Animalisch", amber: "Animalisch", civette: "Animalisch", castoreum: "Animalisch",
  leder: "Animalisch", seide: "Animalisch",
  // oud → Rauchig (oud is better placed here as its smokiness is its most distinctive trait;
  //                  removed duplicate Animalisch entry)
  // Harzig
  weihrauch: "Harzig", myrrhe: "Harzig", benzoe: "Harzig", labdanum: "Harzig", opoponax: "Harzig",
  elemi: "Harzig", copaiba: "Harzig",
  // Synthetisch
  "iso e": "Synthetisch", ambroxan: "Synthetisch", hedione: "Synthetisch",
  etalon: "Synthetisch", geosmin: "Synthetisch",
  // cashmeran → Cremig (warm, creamy character; removed duplicate Synthetisch entry)
  // calone → Aquatisch (marine molecule; removed duplicate Synthetisch entry)
  // Rauchig
  tabak: "Rauchig", rauch: "Rauchig", oud: "Rauchig", birke: "Rauchig", guaiac: "Rauchig",
  incense: "Rauchig",
  // Fougère
  lavendel: "Fougère", coumarin: "Fougère", geranie: "Fougère", eichenmoos: "Fougère",
  salbei: "Fougère", thymian: "Fougère",
  // Aquatisch
  meer: "Aquatisch", ozean: "Aquatisch", wasser: "Aquatisch", alge: "Aquatisch", salz: "Aquatisch",
  regen: "Aquatisch", calone: "Aquatisch", lotus: "Aquatisch",
  // Pudrig
  iris: "Pudrig", puder: "Pudrig", veilchen: "Pudrig", heliotrop: "Pudrig", lippenstift: "Pudrig",
  kosmetisch: "Pudrig", mimose: "Pudrig",
  // Zitrisch
  zitrone: "Zitrisch", bergamotte: "Zitrisch", orange: "Zitrisch", limette: "Zitrisch",
  grapefruit: "Zitrisch", mandarine: "Zitrisch", neroli: "Zitrisch", petitgrain: "Zitrisch",
  yuzu: "Zitrisch", kumquat: "Zitrisch",
  // Erdig
  patchouli: "Erdig", erdig: "Erdig", trüffel: "Erdig", humus: "Erdig", khol: "Erdig",
  zypriol: "Erdig", vetiver: "Erdig",
  // Cremig
  milch: "Cremig", sandelholz: "Cremig", sahne: "Cremig", kokos: "Cremig", butter: "Cremig",
  mandelmilch: "Cremig", cashmeran: "Cremig",
  // Fruchtig
  birne: "Fruchtig", apfel: "Fruchtig", pfirsich: "Fruchtig", mango: "Fruchtig",
  himbeere: "Fruchtig", erdbeere: "Fruchtig", ananas: "Fruchtig", lychee: "Fruchtig",
  passe: "Fruchtig", cassis: "Fruchtig", stachelbeere: "Fruchtig", quitte: "Fruchtig",
};

function validateParfumoLookupUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 2048) throw new Error("Ungültige oder zu lange URL");
  let u;
  try { u = new URL(s.startsWith("http") ? s : "https://" + s); } catch { throw new Error("Ungültige URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Nur http(s)-URLs erlaubt");
  const host = u.hostname.toLowerCase();
  if (host !== "parfumo.de" && !host.endsWith(".parfumo.de")) throw new Error("Nur parfumo.de-Links werden unterstützt");
  return u.href;
}

// Parfumo-URL https://www.parfumo.de/Parfums/Brand/Name -> { brand, name }
// Die Pfad-Segmente sind URL-kodiert (Leerzeichen als _, Sonderzeichen percent-codiert)
function extrahiereBrandName(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const brand = parts[1] ? decodeURIComponent(parts[1].replace(/_/g, " ")) : "";
  const name = parts[2] ? decodeURIComponent(parts[2].replace(/_/g, " ")) : "";
  return { brand, name };
}

function primaryFamily(p) {
  return (p.families && p.families.length > 0 ? p.families[0] : null) || p.family || "Sonstiges";
}

export { KEYS, SEASON_COLORS, FAM_COLORS, NOTE_TAGS, WISH_PRIOS, getSeasonColor, FAMILIES, SEASONS, NOTE_CATEGORIES, NOTE_CAT_COLORS, CONC_COLORS, NOTE_TO_CAT, validateParfumoLookupUrl, extrahiereBrandName, primaryFamily };
