/**
 * collectionIO.js – Import/Export der Sammlung:
 * TSV/CSV/JSON-Parsing, TSV-Download, Export-Payload/CSV,
 * Datei teilen/herunterladen (shareOrDownloadFile).
 * Aus App.jsx ausgelagert; keine React-/UI-Abhängigkeit.
 * parseImportFile und MAX_IMPORT_BYTES sind inline exportiert.
 */

function sanitizeField(v) {
  return (v === null || v === undefined ? "" : String(v)).replace(/[\t\r\n]/g, " ").trim();
}
const MAX_TSV_CHARS = 2_000_000;
const MAX_TSV_LINES = 50_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function parseTSV(text) {
  if (typeof text !== "string" || text.length > MAX_TSV_CHARS) return [];
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > MAX_TSV_LINES || lines.length < 2) return [];
  const h = lines[0].split("\t").map(x => x.trim().toLowerCase());
  const idx = k => h.findIndex(x => x.includes(k));
  const m = {
    name: idx("name"), house: idx("haus"), conc: idx("konz"), family: idx("famil"),
    top: idx("kopf"), middle: idx("herz"), base: idx("basis"), season: idx("saison"),
    gender: idx("geschl"), format: idx("format"), url: idx("link"),
    rating: idx("bewertung") >= 0 ? idx("bewertung") : idx("rating")
  };
  return lines.slice(1).map(line => {
    const c = line.split("\t"); const g = k => k >= 0 ? (c[k] || "").trim() : "";
    const rawRating = parseInt(g(m.rating), 10);
    return sanitizePerfume({
      id: newId(), name: g(m.name), house: g(m.house), conc: g(m.conc),
      family: g(m.family) || "Sonstiges", top: g(m.top), middle: g(m.middle), base: g(m.base),
      season: g(m.season) || "Ganzjährig", gender: g(m.gender) || "Unisex",
      format: g(m.format) || "Probe", url: g(m.url),
      rating: isNaN(rawRating) ? 0 : Math.min(5, Math.max(0, rawRating))
    });
  }).filter(p => p.name);
}

// Gemeinsame Zuordnung: Spaltenkopf -> Feld (wird von TSV und CSV genutzt)
function mapHeaderToFields(headerCells) {
  const h = headerCells.map(x => x.trim().toLowerCase());
  const idx = k => h.findIndex(x => x.includes(k));
  return {
    name: idx("name"), house: idx("haus"), conc: idx("konz"), family: idx("famil"),
    top: idx("kopf"), middle: idx("herz"), base: idx("basis"), season: idx("saison"),
    gender: idx("geschl"), format: idx("format"), url: idx("link"),
    rating: idx("bewertung") >= 0 ? idx("bewertung") : idx("rating")
  };
}
// Wandelt eine Datenzeile (Zellen-Array) in ein sanitisiertes Parfum-Objekt um
function mapRowToPerfume(cells, m) {
  const g = k => k >= 0 ? (cells[k] || "").trim() : "";
  const rawRating = parseInt(g(m.rating), 10);
  return sanitizePerfume({
    id: newId(), name: g(m.name), house: g(m.house), conc: g(m.conc),
    family: g(m.family) || "Sonstiges", top: g(m.top), middle: g(m.middle), base: g(m.base),
    season: g(m.season) || "Ganzjährig", gender: g(m.gender) || "Unisex",
    format: g(m.format) || "Probe", url: g(m.url),
    rating: isNaN(rawRating) ? 0 : Math.min(5, Math.max(0, rawRating))
  });
}
// Trennt eine CSV-Zeile in Zellen auf, respektiert Anführungszeichen ("" = escaped Quote)
function splitCsvLine(line) {
  const cells = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
function parseCSV(text) {
  if (typeof text !== "string" || text.length > MAX_TSV_CHARS) return [];
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > MAX_TSV_LINES || lines.length < 2) return [];
  const m = mapHeaderToFields(lines[0].split(","));
  return lines.slice(1).map(line => mapRowToPerfume(splitCsvLine(line), m))
    .filter(p => p.name);
}
// JSON-Import: akzeptiert den Export-Payload ({meta, items, wishlist}), ein
// Array von Parfums oder ein einzelnes Parfum-Objekt.
function parseJSON(text) {
  if (typeof text !== "string" || text.length > MAX_TSV_CHARS) return [];
  let obj;
  try { obj = JSON.parse(text.replace(/^\uFEFF/, "").trim()); } catch { return []; }
  let list;
  if (Array.isArray(obj)) list = obj;
  else if (obj && Array.isArray(obj.items)) list = obj.items;
  else if (obj && typeof obj === "object") list = [obj];
  else return [];
  // Objekte ohne "name" sind keine Parfums – herausfiltern (sanitize macht das selbst)
  return list.filter(p => p && typeof p === "object")
    .map(p => sanitizePerfume({
      ...p,
      id: newId(),
      rating: Math.min(5, Math.max(0, parseInt(p.rating, 10) || 0))
    }))
    .filter(p => p.name);
}
// Dispatcher: erkennt am Dateinamen (Fallback: Inhalt), welches Format vorliegt
export function parseImportFile(text, filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".json") || (!name && text && text.trim().startsWith("{"))) {
    const parsed = parseJSON(text);
    if (parsed.length) return parsed;
  }
  if (name.endsWith(".csv")) {
    return parseCSV(text);
  }
  return parseTSV(text);
}
function downloadTSV(items) {
  const h = ["Name", "Haus", "Konzentration", "Familie", "Kopfnoten", "Herznoten",
    "Basisnoten", "Saison", "Geschlecht", "Format", "Bewertung", "Parfumo Link"];
  const rows = items.map(p => [p.name, p.house, p.conc, p.family, p.top, p.middle,
  p.base, p.season, p.gender, p.format, p.rating ?? 0, p.url].map(sanitizeField).join("\t"));
  const uri = "data:text/tab-separated-values;charset=utf-8," + encodeURIComponent([h.join("\t"), ...rows].join("\n"));
  const a = document.createElement("a"); a.href = uri; a.download = "parfum_sammlung.tsv"; a.click();
}
// ── Sicherer Datenexport (JSON/CSV, iOS-Standalone-kompatibel via Web Share API) ──
const EXPORT_SCHEMA_VERSION = 1;
// Entfernt Funktionen/undefined aus dem Export; JSON.stringify bricht bei zirkulären
// Referenzen ab – das wird im Aufrufer per try/catch abgefangen.
function exportReplacer(key, value) {
  if (typeof value === "function" || value === undefined) return undefined;
  return value;
}
function buildExportPayload(items, wishlist) {
  return {
    meta: {
      app: "Sillage Parfum-Sammlung",
      exportedAt: new Date().toISOString(),
      schemaVersion: EXPORT_SCHEMA_VERSION,
      counts: { items: items.length, wishlist: (wishlist || []).length },
    },
    items: items.map(p => exportReplacer("", p) || {}),
    wishlist: (wishlist || []).map(w => exportReplacer("", w) || {}),
  };
}
function buildExportCsv(items) {
  const h = ["Name", "Haus", "Konzentration", "Familie", "Kopfnoten", "Herznoten",
    "Basisnoten", "Saison", "Geschlecht", "Format", "Bewertung", "Parfumo Link"];
  const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const rows = items.map(p => [p.name, p.house, p.conc, p.family, p.top, p.middle,
    p.base, p.season, p.gender, p.format, p.rating ?? 0, p.url].map(esc).join(","));
  return "\uFEFF" + [h.map(esc).join(","), ...rows].join("\r\n");
}
// Primär Web Share API (funktioniert im iOS-Standalone-Modus, zeigt das Share-Sheet),
// Fallback: Blob + temporärer <a download>-Link.
function shareOrDownloadFile(content, filename, mime, onDone, onError) {
  let file;
  try { file = new File([content], filename, { type: mime }); } catch { file = null; }
  if (file && typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: filename })
      .then(() => onDone())
      .catch(err => { if (err && err.name !== "AbortError") onError(); });
    return;
  }
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onDone();
  } catch { onError(); }
}

export {
  sanitizeField, MAX_TSV_CHARS, MAX_TSV_LINES,
  parseTSV, mapHeaderToFields, mapRowToPerfume, splitCsvLine, parseCSV, parseJSON,
  downloadTSV, EXPORT_SCHEMA_VERSION, exportReplacer, buildExportPayload, buildExportCsv,
  shareOrDownloadFile,
};
