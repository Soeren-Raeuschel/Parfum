/**
 * parfumoLookup.js – Parfumo-Lookup-Kette (aus App.jsx ausgelagert):
 * Seitentext-Extraktion (Jina), KI-Payload-Normalisierung und die
 * öffentlichen Einstiegspunkte lookupByUrl / ladeParfumdaten
 * (beide inline exportiert).
 */

import { groqFetch, LOOKUP_PAGE_MAX_CHARS } from "./groqClient";
import { InvalidResponseError } from "./errorHandler";
import { FAMILY_CONTEXT } from "../picker/legacyScoring";
import { normalizeFamilyKey } from "../picker/familyMapping";
import { stripDiacritics } from "../picker/criteriaMapping";
import { validateParfumoLookupUrl } from "../shared/constants";

function buildTextFromJina(text) {
  // Jina rendert Parfumo-Noten als: ![Image N: NoteName](url)NoteName
  // Die Pyramiden-Blöcke sind: "Kopfnote\n\n![...]NoteName![...]NoteName"
  // Basisnoten werden von Jina oft NICHT als eigener Block gerendert – direkt aus dem Bild-Muster extrahieren

  function extractNotesFromBlock(block) {
    // Muster: ![Image N: NoteName](url)NoteName  – NoteName erscheint zweimal
    const notes = [];
    const re = /!\[Image \d+:\s*([^\]]+)\]\([^)]+\)/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      const name = m[1].trim();
      if (name && !["Kopfnote","Herznote","Basisnote","Kopfnoten","Herznoten","Basisnoten","Inspiration"].includes(name)) {
        notes.push(name);
      }
    }
    return notes.join(" · ");
  }

  // Pyramiden-Abschnitt finden: zwischen "## Duftpyramide" und nächstem "##"
  const pyramideStart = text.indexOf("## Duftpyramide");
  const pyramideEnd   = pyramideStart >= 0 ? text.indexOf("##", pyramideStart + 10) : -1;
  const pyramideBlock = pyramideStart >= 0
    ? (pyramideEnd > pyramideStart ? text.slice(pyramideStart, pyramideEnd) : text.slice(pyramideStart, pyramideStart + 3000))
    : "";

  // Innerhalb des Blocks: Kopf/Herz/Basis-Sektionen trennen
  function extractSection(block, startMarker, endMarker) {
    const lower = block.toLowerCase();
    const s = lower.indexOf(startMarker.toLowerCase());
    if (s === -1) return "";
    const e = endMarker ? lower.indexOf(endMarker.toLowerCase(), s + startMarker.length) : -1;
    const section = e > -1 ? block.slice(s, e) : block.slice(s);
    return extractNotesFromBlock(section);
  }

  const topNotes    = extractSection(pyramideBlock, "Kopfnote", "Herznote");
  const middleNotes = extractSection(pyramideBlock, "Herznote", "Basisnote");
  // Basisnoten: erst im Pyramide-Block suchen, dann im gesamten Text (Jina lässt nb_b manchmal weg)
  let baseNotes = extractSection(pyramideBlock, "Basisnote", "");
  if (!baseNotes) {
    // Suche im vollen Text nach dem Basisnoten-Bild-Muster direkt nach "Basisnote"
    const fullLower = text.toLowerCase();
    const bIdx = fullLower.lastIndexOf("basisnote");
    if (bIdx >= 0) {
      const bBlock = text.slice(bIdx, bIdx + 2000);
      baseNotes = extractNotesFromBlock(bBlock);
    }
  }

  const notesHint = topNotes || middleNotes || baseNotes
    ? "\n\nExtrahierte Duftpyramide (bereits korrekt getrennt, bitte genau so übernehmen):\nKopfnoten: " + (topNotes || "–") + "\nHerznoten: " + (middleNotes || "–") + "\nBasisnoten: " + (baseNotes || "–")
    : "";

  // Detect ingredient-only pages: no pyramid but INCI/ingredients section present
  const lowerText = text.toLowerCase();
  const hasIngredients = !topNotes && !middleNotes && !baseNotes &&
    (lowerText.includes("inhaltsstoff") || lowerText.includes("ingredient") ||
     lowerText.includes("inci") || lowerText.includes("zutaten"));
  const ingredientsHint = hasIngredients
    ? "\n\nHINWEIS: Diese Seite enthält keine Duftpyramide (keine Kopf-/Herz-/Basisnoten), nur Inhaltsstoffe/INCI. Extrahiere erkennbare Duftstoffe aus dem Inhaltsstoffabschnitt und trage sie ausschließlich in 'base' ein. 'top' und 'middle' leer lassen."
    : "";
  // Seitentext bereinigen: Bild-URLs und Rezensionen kürzen um Token zu sparen
  const cleaned = text
    .replace(/!\[([^\]]*)\]\([^)]{20,}\)/g, (_, alt) => alt ? "[" + alt + "]" : "")  // lange Bild-URLs kürzen
    .replace(/https?:\/\/\S+/g, "")           // restliche URLs entfernen
    .replace(/\n{3,}/g, "\n\n")               // mehrfache Leerzeilen kürzen
    .trim();
  return cleaned.slice(0, LOOKUP_PAGE_MAX_CHARS) + notesHint + ingredientsHint;
}

async function fetchPageTextForLookup(safeUrl) {
  const jinaUrl = "https://r.jina.ai/" + safeUrl;
  try {
    const r = await fetch(jinaUrl, {
      headers: {
        "X-Return-Format": "markdown",
        "X-No-Cache": "true",
      }
    });
    if (r.ok) {
      const t = await r.text();
      if (t && t.length > 80) {
        return buildTextFromJina(t);
      }
    }
  } catch (e) {
  }
  throw new Error("Seiteninhalt konnte nicht geladen werden. Bitte Parfumo-URL prüfen oder später erneut versuchen.");
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Leitet aus Parfumo-Accorden (Rohbegriffe wie "Frisch", "Holzig", "Zitrus")
// eine Saison her: Synonym-Mapping auf App-Familien, dann FAMILY_CONTEXT der
// ersten Familie mit bekanntem Kontext. Liefert null, wenn nichts herleitbar ist.
function seasonFromAccords(accords) {
  for (const a of Array.isArray(accords) ? accords : []) {
    const key = normalizeFamilyKey(a?.name || "");
    if (!key) continue;
    const ctxKey = Object.keys(FAMILY_CONTEXT)
      .find(k => stripDiacritics(k.toLowerCase()) === key);
    const seasons = ctxKey ? FAMILY_CONTEXT[ctxKey].seasons : null;
    if (seasons && seasons.length) return seasons[0];
  }
  return null;
}

function normalizeLookupPayload(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Ungültige API-Antwort");
  const pick = (k, max) => {
    const v = obj[k];
    return v === null || v === undefined ? "" : String(v).slice(0, max);
  };
  // Extract fields from KI response
  const name = pick("name", 400);
  const house = pick("house", 200);
  const conc = pick("conc", 40);
  const families = Array.isArray(obj.families) ? obj.families : (obj.family ? [obj.family] : []);
  const top = pick("top", 2000);
  const middle = pick("middle", 2000);
  const base = pick("base", 2000);
  const gender = pick("gender", 40);
  
  // --- Season Validation ---
  let season = pick("season", 40);
  
  // If KI didn't provide a valid season or it's empty, infer from primary family
  if (!season || season.trim() === "") {
    const primaryFamily = families.length > 0 ? families[0] : "Sonstiges";
    // Look up the season from FAMILY_CONTEXT
    const familyContext = FAMILY_CONTEXT[primaryFamily];
    if (familyContext && familyContext.seasons && familyContext.seasons.length > 0) {
      season = familyContext.seasons[0]; // Use the first season from the context
    }
  }
  
  // If still no season, default to "Ganzjährig"
  if (!season || season.trim() === "") {
    season = "Ganzjährig";
  }
  
  return {
    name, house, conc,
    families,
    top, middle, base,
    season, gender,
  };
}

// ── Normalisierung: bringt beide Datenquellen in das interne App-Format ────────
function normalisiere(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Ungültige API-Antwort");

  // ── Neue Netlify-Function (cheerio-Parser) ──
  if (obj.url && obj.brand && (obj.notes || obj.accords || obj.seasons)) {
    const notes = obj.notes || {};
    const joinNames = (list) => (list || []).map(n => n.name).filter(Boolean).join(", ");

    // Accords nach Gewicht sortiert als Namen-Liste
    const accords = (obj.accords || []);

    // Seasons: die Saison mit dem höchsten Wert (Gewichtung aus der Parfumo-Statistik),
    // sonst aus der Hauptfamilie abgeleitet (Parfumo-Accorde wie "Frisch"/"Holzig"
    // sind Rohbegriffe -> über Synonyme auf App-Familien mappen), sonst Ganzjährig.
    // Keys werden getrimmt, falls der Parser Whitespaces liefert.
    let season = "Ganzjährig";
    const seasonEntries = Object.entries(obj.seasons || {})
      .map(([k, v]) => [String(k).trim(), Number(v) || 0])
      .filter(([k, v]) => k && v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (seasonEntries.length > 0) season = seasonEntries[0][0];
    else season = seasonFromAccords(accords) || season;

    return {
      name: obj.name || "",
      house: obj.brand || "",
      conc: "",
      family: accords[0]?.name || "",
      families: accords.map(a => a.name).filter(Boolean).slice(0, 3),
      top: joinNames(notes.top),
      middle: joinNames(notes.heart),
      base: joinNames(notes.base),
      season, gender: "",
      url: obj.url || "",
      // Zusätzliche Felder aus der Function
      year: obj.year ?? "",
      maker: obj.maker || "",
      target: obj.target || "",
      scent_character: obj.scent_character || "",
      longevity_sillage: obj.longevity_sillage || "",
      accords,
      seasons: obj.seasons || {},
    };
  }

  // ── Alter Scraper (Groq-Antwort) – bestehende Normalisierung ──
  return normalizeLookupPayload(obj);
}

async function lookupByUrl(url) {
  const safeUrl = validateParfumoLookupUrl(url);
  const pageText = await fetchPageTextForLookup(safeUrl);
  const system = "Extrahiere Parfüm-Daten aus Seitentext. Nur JSON, kein Markdown.";
  const user = `Parfumo-Seitentext. Extrahiere: Name, Haus, Konz, Familien (bis zu 3), Noten (Kopf/Herz/Basis), Saison, Geschlecht.
Duftpyramide: Noten zwischen Kopfnote/Herznote/Basisnote-Markierungen extrahieren.
Mapping: Blumig→Floral, Holzig→Woody, Orientalisch→Oriental, Frisch→Fresh, Gourmand/Süß→Gourmand, Marin→Aquatisch.
Nur JSON:
{"name":"","house":"","conc":"EDP|EDT|Parfum|EDC|Extrait","families":["Floral","Woody","Gourmand"],"top":"","middle":"","base":"","season":"Frühling|Sommer|Herbst|Winter|Ganzjährig","gender":"Unisex|Feminin|Maskulin"}

` + pageText;
  // Lookup needs the big model - small fallback can't handle 16k chars of page text.
  // If big model fails due to rate-limit, truncate the page text and retry with fallback.
  let lookupRaw;
  try {
    const r = await groqFetch({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2, max_tokens: 600,
      cacheKey: "lookup:" + safeUrl.slice(-60),
      forceFallback: false,
    });
    lookupRaw = r.text;
  } catch(firstErr) {
    // If rate-limited, retry with aggressively truncated text on fallback model
    const truncatedUser = user.slice(0, 2000) + "\n[Text gekürzt – bitte kurze Antwort]";
    const r2 = await groqFetch({
      messages: [{ role: "system", content: system }, { role: "user", content: truncatedUser }],
      temperature: 0.2, max_tokens: 400,
      cacheKey: "lookup-short:" + safeUrl.slice(-60),
      forceFallback: true,
    });
    lookupRaw = r2.text;
  }
  const { text: raw } = { text: lookupRaw };
  // Robust JSON extraction: try multiple strategies
  function extractJSON(str) {
    // 1. Strip markdown fences and try direct parse
    const stripped = str.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    try { return JSON.parse(stripped); } catch {}
    // 2. Find last complete {...} block (greedy, picks outermost)
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    // 3. Find first {...} block (non-greedy)
    const m2 = stripped.match(/\{[^{}]*\}/);
    if (m2) { try { return JSON.parse(m2[0]); } catch {} }
    return null;
  }
  const parsed = extractJSON(raw);
  if (!parsed) throw new InvalidResponseError("KI-Antwort enthielt kein lesbares JSON. Bitte nochmal versuchen.");
  return normalizeLookupPayload(parsed);
}

// ── Neuer Abruf über Netlify Function + Fallback auf den alten KI-Scraper ─────
class ParfumNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParfumNotFoundError";
  }
}

/**
 * Ruft Duftdaten über die Netlify Function /api/parfum/:brand/:name ab
 * und fällt auf den alten jina+Groq-Scraper (lookupByUrl) zurück, wenn die
 * Function mit einem anderen Fehler als 404 fehlschlägt.
 * Liefert das normalisierte App-Format ({name, house, conc, family, families,
 * top, middle, base, season, gender, url, year, maker, target,
 * scent_character, longevity_sillage, accords, seasons}).
 */
export async function ladeParfumdaten(brand, name) {
  try {
    const res = await fetch(
      "/api/parfum/" + encodeURIComponent(brand) + "/" + encodeURIComponent(name)
    );
    if (res.status === 404) {
      throw new ParfumNotFoundError("Duft nicht gefunden");
    }
    if (!res.ok) {
      throw new Error(`Netlify Function antwortete mit ${res.status}`);
    }
    const data = await res.json();
    // Datenstruktur der Funktion bereits im App-Format (via normalisiere)
    return normalisiere(data);
  } catch (err) {
    if (err instanceof ParfumNotFoundError) {
      throw err; // kein Fallback - der Duft existiert so nicht
    }
    console.warn("Netlify Function fehlgeschlagen, nutze alten Scraper:", err);
    // Alter Scraper erwartet eine Parfumo-URL -> Rekonstruktion aus Marke/Name
    // Slugs wie die Netlify Function bilden: Leerzeichen -> "_" (Parfumo-Konvention)
    const slugify = (t) => encodeURIComponent(String(t).trim().replace(/\s+/g, "_"));
    const reconstructed = `https://www.parfumo.de/Parfums/${slugify(brand)}/${slugify(name)}`;
    return await lookupByUrl(reconstructed);
  }
}

// ── Styles (zentralisiert in styles.css, S-Objekt gibt nur Klassen zurück) ─────

// ── Pull-to-refresh component ─────────────────────────────────────────────────

export { lookupByUrl, normalisiere, ParfumNotFoundError, NotFoundError };
