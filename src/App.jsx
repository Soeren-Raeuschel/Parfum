// Chart.js wird lazy geladen (siehe loadChart unten) → kleinerer Initial-Bundle
import React, { useState, useEffect, useMemo, useCallback, useRef, useReducer, lazy, Suspense } from "react";
import { Combobox, Dialog, Disclosure, Tab } from "@headlessui/react";
import { storage } from "./data/storage";
import { newId, sanitizePerfume, ONBOARD_STYLES } from "./data/localAdapter"; // Fix: newId/sanitizePerfume/ONBOARD_STYLES wurden verwendet, aber nicht importiert (lokale Definitionen waren auskommentiert)
import { List as FixedSizeListVirtual, useDynamicRowHeight } from "react-window";
import { AppError, recordError, InvalidResponseError, ApiError, NetworkError, RateLimitError } from "./utils/errorHandler"; // Fix: ApiError/NetworkError/RateLimitError wurden in groqFetch verwendet, aber nicht importiert → "Can't find variable: ApiError"
import { FileUpload } from "./components/ui/file-upload";
import EvolveCard from "./components/EvolveCard";
import WhySuggestionDialog from "./components/WhySuggestionDialog";
import { AiSparkle } from "./components/AiSparkle";
import { splitNotes } from "./utils/helpers";
import { stripDiacritics, normalizeText, tokenizeText } from "./utils/perfumeMatch"; // Fix: normalizeText/stripDiacritics/tokenizeText wurden verwendet, aber nicht importiert → "Can't find variable: normalizeText"

import { getWearMap, recordWear, recordFeedback, feedbackContextKey, getPersonalBonusMap, getFeedbackCountsMap } from "./picker/wearStore";
import { PICKER_CONFIG } from "./picker/pickerConfig";
import {
  buildPickerSelection,
  buildSuggestionReason,
  runPickerForToday,
  chipMatchCounts,
  debugBreakdown,
  getSprayGuide,
  CHIP_GOOD_THRESHOLD,
  CHIP_DIM_COUNT,
  KASSEL_COORDS,
} from "./picker/todayIntegration";
// ── Gemeinsame Module (aus App.jsx ausgelagert) ─────────────────────────────
import { S, FamilyPill, MiniBar, Stars, useBodyLock, TabSkeleton } from "./shared/ui";
import { triggerSprayAnimation } from "./shared/spray";
import {
  KEYS, SEASON_COLORS, FAM_COLORS, NOTE_TAGS, WISH_PRIOS, getSeasonColor,
  FAMILIES, SEASONS, NOTE_CATEGORIES, NOTE_CAT_COLORS, CONC_COLORS, NOTE_TO_CAT,
  validateParfumoLookupUrl, extrahiereBrandName, primaryFamily,
} from "./shared/constants";
import { getDeclutterSuggestions } from "./shared/declutter";
// ── Ausgelagerte Module (Hooks, IO, Groq, Sammlung) ──────────────────────
import { debounce } from "./utils/hooks";
import { downloadTSV } from "./utils/collectionIO";
import { groqFetch, useGroqCountdown } from "./utils/groqClient";
// ── Ausgelagerte Module (API-Cache & Picker-Kontextdaten) ────────────────
import { cachedFetch } from "./utils/apiCache";
import {
  getSeason, MOODS, TIMES, WEATHERS, OCCASIONS, INTENSITIES, LONGEVITIES,
  FAMILY_CONTEXT,
} from "./picker/legacyScoring";

// ── Lazy geladene Ansichten (Code-Splitting: eine Ansicht = ein Chunk) ──────
const StatistikTab = lazy(() => import("./tabs/StatistikTab"));
const OrdnerTab = lazy(() => import("./tabs/OrdnerTab"));
const WunschlisteTab = lazy(() => import("./tabs/WunschlisteTab"));
const LayeringTab = lazy(() => import("./tabs/LayeringTab"));
const DeclutterTab = lazy(() => import("./tabs/DeclutterTab"));
const EinstellungenTab = lazy(() => import("./tabs/EinstellungenTab"));
const OnboardingModal = lazy(() => import("./tabs/OnboardingModal"));
const SammlungTab = lazy(() => import("./tabs/SammlungTab"));
// DetailView (gleicher Chunk wie SammlungTab) ebenfalls lazy – schrumpft den
// Main-Bundle-Graph: Overlay wird erst beim Öffnen geladen
const DetailView = lazy(() => import("./tabs/SammlungTab").then(m => ({ default: m.DetailView })));




// ── Storage keys ───────────────────────────────────────────────────────────────
// Parfumo-Lookup: Groq-API (kostenlos: console.groq.com) – Key in Settings oder window.__SILLAGE_GROQ_KEY__

// ── Design tokens ─────────────────────────────────────────────────────────────

// ── Season / color helpers ────────────────────────────────────────────────────
// For southern hemisphere users, seasons would be inverted – not currently supported.

// ── Enhanced debouncing with AbortController ──────────────────────────────────
// Fix: Der AbortController wird erst beim Commit des debounced Werts neu erzeugt
// (nicht pro Tastendruck). Damit ist das Signal zum Zeitpunkt des Sucheffekts
// garantiert gültig und nicht bereits vom Cleanup des vorherigen Laufs abgebrochen.
function safeParseJSON(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function hydrateArray(raw, fallback) {
  const v = safeParseJSON(raw, fallback);
  return Array.isArray(v) ? v : fallback;
}
function hydrateObject(raw, fallback) {
  const v = safeParseJSON(raw, fallback);
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
}
function hydrateItems(raw) {
  return hydrateArray(raw, [])
    .filter(x => x && typeof x === "object")
    .map(sanitizePerfume)
    .filter(x => x.name);
}
function hydrateLog(raw) {
  return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.ts === "number").slice(-1000);
}
function hydrateWishlist(raw) {
  return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.name === "string");
}
function hydrateNotes(raw) {
  const o = safeParseJSON(raw, null);
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const out = {};
  for (const k of Object.keys(o)) {
    if (k === "__proto__" || k === "constructor" || k.length > 200) continue;
    out[k] = o[k];
  }
  return out;
}
function hydrateFillLevels(raw) {
  const o = hydrateObject(raw, {});
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof k === "string" && k.length < 200 && typeof v === "number" && [100, 75, 50, 25, 0].includes(v)) out[k] = v;
  }
  return out;
}
function hydratePriceMl(raw) {
  const o = hydrateObject(raw, {});
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof k === "string" && k.length < 200 && v && typeof v === "object") {
      const price = Number(v.price);
      const ml = Number(v.ml);
      if (Number.isFinite(price) && price >= 0 && Number.isFinite(ml) && ml > 0) {
        out[k] = { price, ml };
      }
    }
  }
  return out;
}
function hydratePrefs(raw) {
  const o = hydrateObject(raw, { appName: "Sillage" });
  const name = typeof o.appName === "string" ? o.appName.slice(0, 80) : "Sillage";
  return { ...o, appName: name || "Sillage" };
}
/*function newId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { }
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
}*/
function buildPromptContext(params) {
  const {
    occasion, mood, timeOfDay, weather, season,
    intensityPref, longevityPref,
    // Erweiterte Parameter (optional):
    priceRange = null,        // "budget"|"mid"|"luxury"
    genderPref = null,        // "feminin"|"maskulin"|"unisex"
    userFamilyPrefs = [],     // bevorzugte Familien (aus Onboarding)
  } = params;

  const occasionLabels = { casual: "Alltag", work: "Büro", sport: "Sport", evening: "Abend",
    date: "Date/Romantik", sleep: "Schlafen", special: "Besonderer Anlass",
    outdoor: "Outdoor", travel: "Reise", vacation: "Urlaub" };
  const moodLabels = { energetic: "energetisch", calm: "entspannt", romantic: "romantisch",
    confident: "selbstsicher", mysterious: "geheimnisvoll", playful: "verspielt", sleep: "schläfrig/ruhig" };
  const timeLabels = { morning: "morgens", afternoon: "mittags", evening: "abends", night: "nachts" };
  const weatherLabels = { sunny: "sonnig", cloudy: "bewölkt", rainy: "regnerisch", cold: "kalt", hot: "heiß" };
  const intensityLabels = { light: "leicht/dezent", medium: "mittel", strong: "stark/projizierend" };
  const priceLabels = { budget: "unter 30€", mid: "30–100€", luxury: "über 100€" };

  let ctx = `Kontext für Parfum-Empfehlung:
- Anlass: ${occasionLabels[occasion] || occasion}
- Stimmung: ${moodLabels[mood] || mood}
- Tageszeit: ${timeLabels[timeOfDay] || timeOfDay}
- Wetter: ${weatherLabels[weather] || weather}
- Jahreszeit: ${season}
- Intensität: ${intensityLabels[intensityPref] || intensityPref}
- Haltbarkeit: ${longevityPref === "long" ? "lang" : longevityPref === "short" ? "kurz" : "mittel"}`;

  if (priceRange) ctx += `
- Preisbereich: ${priceLabels[priceRange] || priceRange}`;
  if (genderPref) ctx += `
- Präferenz: ${genderPref}`;
  if (userFamilyPrefs && userFamilyPrefs.length > 0) {
    ctx += `
- Lieblingsduftfamilien: ${userFamilyPrefs.slice(0, 4).join(", ")}`;
  }
  return ctx;
}
// Fix: buildTextFromJina wurde verwendet (fetchPageTextForLookup), aber nie definiert
// (beim Refactoring aus App_old.js verloren gegangen) → "Can't find variable: buildTextFromJina"
// Portiert aus App_old.js: bereitet den Jina-Seitentext für den KI-Lookup auf.
function PullToRefresh({ children, tabKey }) {
  const ref = useRef(null);
  // Reset scroll position to top when tab changes
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [tabKey]);
  return (
    <div ref={ref} id="main-scroll-container"
      style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        overscrollBehavior: "none", WebkitOverflowScrolling: "touch",
        animation: "fadeIn .3s ease-out"
      }}>
      {children}
    </div>
  );
}

// ── MiniBar helper ────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: ERROR HANDLING SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// Kategorien: 'user' | 'system' | 'network' | 'api'
function classifyError(err) {
  const msg = String(err?.message || err || "");
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed to fetch"))
    return { kind: "network", label: "Keine Verbindung", hint: "Prüfe deine Internetverbindung und versuche es erneut." };
  if (msg.includes("429") || msg.includes("rate"))
    return { kind: "api", label: "Zu viele Anfragen", hint: "Kurz warten und nochmal versuchen." };
  if (msg.includes("401") || msg.includes("403"))
    return { kind: "api", label: "Zugriff verweigert", hint: "Der externe Dienst ist momentan nicht erreichbar." };
  if (msg.includes("JSON") || msg.includes("parse"))
    return { kind: "user", label: "Ungültiges Dateiformat", hint: "Bitte prüfe deine Datei (TSV, CSV oder JSON)." };
  return { kind: "system", label: "Unbekannter Fehler", hint: "Bitte App neu laden und nochmal versuchen." };
}

// Retry mit exponential backoff
async function withRetry(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// Globaler Error-Banner
function ErrorBanner({ errors, onDismiss }) {
  if (!errors.length) return null;
  return (
    <div role="alert" aria-live="assertive"
      style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "min(480px,100vw)", zIndex: 9999, padding: "0 0 8px"
      }}>
      {errors.map(e => (
        <div key={e.id} style={{
          background: e.kind === "user" ? "#FFF4E5" : "#FEF2F2",
          border: `1px solid ${e.kind === "user" ? "#F59E0B" : "#F87171"}`,
          borderRadius: 8, padding: "10px 14px", margin: "8px 8px 0",
          display: "flex", gap: 10, alignItems: "flex-start",
          boxShadow: "0 4px 12px rgba(0,0,0,.1)"
        }}>
          <div style={{ fontSize: 16, flexShrink: 0 }} aria-hidden="true">{e.kind === "user" ? "⚠" : "◈"}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A18", marginBottom: 2 }}>{e.label}</div>
            <div style={{ fontSize: 11, color: "#888780" }}>{e.hint}</div>
            {e.action && <button onClick={e.action.fn} style={{
              fontSize: 11, color: "#185FA5",
              background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 4
            }}>
              {e.action.label}</button>}
          </div>
          <button onClick={() => onDismiss(e.id)} aria-label="Fehlermeldung schließen"
            style={{
              background: "none", border: "none", cursor: "pointer", fontSize: 14,
              color: "#B4B2A9", padding: 0, flexShrink: 0
            }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// Hook für globalen Error-State
function useErrorSystem() {
  const [errors, setErrors] = useState([]);
  const pushError = useCallback((err, opts = {}) => {
    const classified = classifyError(err);
    const entry = { id: Date.now() + "_" + Math.random(), ...classified, ...opts };
    setErrors(prev => [...prev.slice(-2), entry]);
    setTimeout(() => setErrors(prev => prev.filter(e => e.id !== entry.id)), 8000);
    return entry;
  }, []);
  const dismiss = useCallback(id => setErrors(prev => prev.filter(e => e.id !== id)), []);
  return { errors, pushError, dismiss };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: WEATHER API (Open-Meteo – kein API-Key nötig)
// ══════════════════════════════════════════════════════════════════════════════
const WMO_TO_WEATHER = {
  0: "sunny", 1: "sunny", 2: "cloudy", 3: "cloudy",
  45: "cloudy", 48: "cloudy",
  51: "rainy", 53: "rainy", 55: "rainy",
  61: "rainy", 63: "rainy", 65: "rainy",
  71: "cold", 73: "cold", 75: "cold",
  80: "rainy", 81: "rainy", 82: "rainy",
  95: "rainy", 96: "rainy", 99: "rainy",
};

    async function fetchWeather(lat, lon) {
  // Cache-Key basierend auf gerundeten Koordinaten (5km-Genauigkeit reicht für Wetter)
  const la = Number(lat), lo = Number(lon);
  const cacheKey = `weather_${Math.round(la * 100)}_${Math.round(lo * 100)}`;
  return cachedFetch(cacheKey, async () => {
  try {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error("Ungültige Koordinaten");
    const clampLat = Math.max(-90, Math.min(90, la));
    const clampLon = Math.max(-180, Math.min(180, lo));
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(clampLat))}&longitude=${encodeURIComponent(String(clampLon))}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    const data = await res.json();
    const c = data && data.current;
    if (!c || typeof c.temperature_2m !== "number") throw new Error("Wetterdaten unvollständig");
    const code = typeof c.weather_code === "number" ? c.weather_code : 0;
    const hum = typeof c.relative_humidity_2m === "number" ? c.relative_humidity_2m : 50;
    return {
      temp: c.temperature_2m,
      humidity: hum,
      wmoCode: code,
      weather: WMO_TO_WEATHER[code] ?? "cloudy",
      effectiveWeather: c.temperature_2m < 8 ? "cold"
        : c.temperature_2m > 26 ? "hot"
          : WMO_TO_WEATHER[code] ?? "cloudy",
    };
  } catch (error) {
    // Fehler NICHT abfangen: So kann withRetry() mit Backoff erneut versuchen und
    // cachedFetch() cached keine Fehlerfälle (503 etc.) für die ganze TTL.
    // Die eigentliche Fehlerbehandlung (Toast/Fallback) passiert in fetchAutoWeather().
    console.log('WARN', 'Wetter-Abruf fehlgeschlagen.', { error: error.message });
    throw error;
  }
  });
}

// Intensitäts-Korrektur durch Luftfeuchtigkeit:
// hohe Luftfeuchtigkeit → Projektion steigt, subtilere Düfte bevorzugen
function humidityIntensityMod(humidity) {
  if (humidity > 80) return "light";    // sehr feucht → dezent
  if (humidity > 60) return null;       // normal → keine Änderung
  if (humidity < 30) return "strong";   // trocken → stärkere Noten möglich
  return null;
}

function WeatherWidget({ weatherData, onUse }) {
  if (!weatherData) return null;
  const w = weatherData;
  const icon = w.effectiveWeather === "sunny" ? "☀" : w.effectiveWeather === "hot" ? "🌡" :
    w.effectiveWeather === "cold" ? "❄" : w.effectiveWeather === "rainy" ? "☁" : "◎";
  return (
    <div style={{
      background: "#F1EFE8", borderRadius: 8, padding: "8px 12px",
      display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 13, color: "#1A1A18" }}>{Math.round(w.temp)}°C · {w.humidity}% Luftfeuchte</div>
          <div style={{ fontSize: 10, color: "#888780" }}>Automatisch erkanntes Wetter wird berücksichtigt</div>
        </div>
      </div>
      <button onClick={onUse} className="btn btn-pri" style={{ fontSize: 10, padding: "5px 10px", borderRadius: 16 }}>
        Anwenden
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: FILL-LEVEL (NUR FLAKONS)
// ══════════════════════════════════════════════════════════════════════════════
function HeuteTab({ items, log, onLog, pushError, prefs, priceMl, onSelectPerfume, onNavigate, userNotePrefs, userFamilyPrefs }) {
  const season = getSeason(), sc = SEASON_COLORS[season];
  const [weather, setWeather] = useState("sunny");
  const [occasion, setOccasion] = useState("casual");
  const [mood, setMood] = useState("energetic");
  const [timeOfDay, setTime] = useState("morning");
  const [intensityPref, setIntensity] = useState("medium");
  const [longevityPref, setLongevity] = useState("medium");
  const [priceRange, setPriceRange] = useState(null);    // null|"budget"|"mid"|"luxury"
  const [genderPref, setGenderPref] = useState(null);    // null|"Feminin"|"Maskulin"|"Unisex"
  const [recs, setRecs] = useState(null);
  const [worn, setWorn] = useState({});
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
   const [toast, setToast] = useState("");
   const showToast = useCallback((msg) => {
     setToast(msg);
     setTimeout(() => setToast(""), 2200);
   }, []);

  // ── Teil 3: Neue Auswahl-Logik (pickPerfume) ──
  const [excludedIds, setExcludedIds] = useState([]);     // in dieser Sitzung abgelehnte Vorschläge
  const [lastPickInfo, setLastPickInfo] = useState(null); // { relaxed, candidates, relaxedThreshold }
  const [debugOpen, setDebugOpen] = useState(false);      // Debug-Ansicht (standardmäßig zu)
  const [feedbackFor, setFeedbackFor] = useState(null);   // Duft, der Feedback erwartet
  const [feedbackDone, setFeedbackDone] = useState(null); // { id, rating } – kurzzeitige Bestätigungs-Animation nach dem Tippen
  const [temperature, setTemperature] = useState(null);   // Temperatur aus Open-Meteo
  const [wearVersion, setWearVersion] = useState(0);      // löst Wear-Map-Neuladen aus

  // Gespeicherte Geolocation-Berechtigungsentscheidung (localStorage-Mirror).
// Der Browser merkt sich die Entscheidung selbst, aber dieser Mirror erlaubt
// es, bei "denied" den Dialog-Versuch beim nächsten App-Start zu überspringen
// und direkt den Kassel-Fallback zu nutzen.
const GEO_PERMISSION_KEY = "parfum_geo_permission_v1";

function readGeoPermission() {
  try {
    return JSON.parse(localStorage.getItem(GEO_PERMISSION_KEY) || "{}").state || null;
  } catch { return null; }
}

function writeGeoPermission(state) {
  try {
    localStorage.setItem(GEO_PERMISSION_KEY, JSON.stringify({ state, at: Date.now() }));
  } catch {}
}

async function fetchAutoWeather(forcePrompt = false) {
    // Wetter wird standortbasiert geladen: Zuerst Browser-Geolocation
    // (Browser zeigt den Berechtigungs-Dialog – erst nach Bestätigung wird der
    // echte Standort verwendet), bei Verweigerung/Fehler Fallback auf Kassel.
    // Die Entscheidung wird in localStorage gespiegelt (GEO_PERMISSION_KEY);
    // bei gespeicherter Ablehnung wird der Dialog beim App-Start übersprungen.
    // forcePrompt=true (Button "Standort nutzen") ignoriert die Ablehnung.
    setWeatherLoading(true);
    try {
      let lat = KASSEL_COORDS.lat;
      let lon = KASSEL_COORDS.lon;
      let usedFallback = false;
      const stored = readGeoPermission();
      const hasGeo = typeof navigator !== "undefined" && !!navigator.geolocation;
      if (forcePrompt && stored === "denied") {
        // Manueller Button-Klick: gespeicherte Ablehnung aufheben und neu fragen
        writeGeoPermission(null);
      }
      if (!hasGeo || readGeoPermission() === "denied") {
        // Keine Geolocation-API oder vorher abgelehnt → direkt Kassel-Fallback
        usedFallback = true;
      } else {
        // Echten Browser-Berechtigungsstatus prüfen: Nur bei "prompt" bzw.
        // "granted" kann ein Standort-Abruf Sinn machen. Bei "denied" hat der
        // Browser die Berechtigung dauerhaft blockiert – getCurrentPosition
        // würde dann sofort fehlschlagen OHNE Frage-Fenster anzuzeigen.
        let browserState = "prompt";
        try {
          if (navigator.permissions && navigator.permissions.query) {
            browserState = (await navigator.permissions.query({ name: "geolocation" })).state || "prompt";
          }
        } catch {}
        if (browserState === "denied") {
          // Kein Frage-Fenster möglich → Kassel-Fallback + Anleitung per Toast
          usedFallback = true;
          writeGeoPermission("denied");
          showToast("Standort ist im Browser blockiert – in den Seiten-Berechtigungen erlauben und erneut klicken");
        } else {
          try {
            const pos = await new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
            lat = pos.coords.latitude;
            lon = pos.coords.longitude;
            writeGeoPermission("granted");
          } catch {
            // Geolocation verweigert/nicht verfügbar → Fallback Kassel + ablehnen merken
            usedFallback = true;
            writeGeoPermission("denied");
          }
        }
      }
      const data = await withRetry(() => fetchWeather(lat, lon));
      // fetchWeather wirft bei Fehlern jetzt (nach 3 Retry-Versuchen) – der catch-Block unten behandelt sie
      setWeatherData(data);
        setTemperature(typeof data.temp === "number" ? data.temp : null);
        // Automatisch übernehmen (gleiches Verhalten wie vorher über "Anwenden")
        setWeather(data.effectiveWeather);
        const humid = humidityIntensityMod(data.humidity);
        if (humid) setIntensity(humid);
        if (usedFallback) showToast("Standort nicht verfügbar – Wetter für Kassel geladen");
    } catch (e) {
      if (pushError) pushError(e, { hint: "Wetterdaten konnten nicht geladen werden. Bitte manuell auswählen." });
      showToast("Wetter konnte nicht geladen werden");
      setWeatherData(null);
    } finally {
      setWeatherLoading(false);
    }
  }

  function applyWeather() {
    if (!weatherData) return;
    const wxLabel = (WEATHERS.find(w => w.id === weatherData.effectiveWeather) || {}).label || weatherData.effectiveWeather;
    const temp = typeof weatherData.temp === "number" ? Math.round(weatherData.temp) : null;
    // Fix: "Anwenden" übernimmt das ermittelte Wetter UND setzt die Tageszeit
    // auf die aktuelle Uhrzeit (gleiche Ableitung wie beim App-Start), damit
    // beide Regler dem "Jetzt"-Zustand entsprechen. Danach Empfehlung neu
    // berechnen und Feedback per Toast geben.
    setWeather(weatherData.effectiveWeather);
    const h = new Date().getHours();
    const currentTimeOfDay = h < 10 ? "morning" : h < 14 ? "afternoon" : h < 20 ? "evening" : "night";
    setTime(currentTimeOfDay);
    const timeLabels = { morning: "Morgens", afternoon: "Mittags", evening: "Abends", night: "Nachts" };
    const humid = humidityIntensityMod(weatherData.humidity);
    if (humid) setIntensity(humid);
    // Fix: Werte explizit als Override übergeben (State-Updates sind async,
    // generate() würde sonst die alten Chip-Werte lesen)
    generate([], { weather: weatherData.effectiveWeather, timeOfDay: currentTimeOfDay });
    showToast(temp !== null
      ? `✓ Wetter übernommen: ${wxLabel}, ${temp}°C · ${timeLabels[currentTimeOfDay]} – Empfehlung aktualisiert`
      : `✓ Wetter übernommen: ${wxLabel} · ${timeLabels[currentTimeOfDay]} – Empfehlung aktualisiert`);
  }
  const [open, setOpen] = useState({ crit: true, res: true, alts: true, wild: true, debug: false });
  const [loadingRecs, setLoadingRecs] = useState(false);
  // ── KI-Tagesbeschreibung ──
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const interpretationCache = useRef(new Map()); // Cache for AI interpretation results to avoid duplicate Groq calls
  const tog = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  const groqCountdownVal = useGroqCountdown(); // Sekunden bis Rate-Limit abläuft
   const [reasoningChars, setReasoningChars] = useState(0); // Zeichenzähler für KI-Reasoning-Validierung

  useEffect(() => {
    const h = new Date().getHours();
    setTime(h < 10 ? "morning" : h < 14 ? "afternoon" : h < 20 ? "evening" : "night");
  }, []);

  // Wetter automatisch beim App-Start laden: Der Browser zeigt den
  // Geolocation-Berechtigungs-Dialog. Erst nach Bestätigung ("Zulassen") wird
  // der echte Standort genutzt; bei Ablehnung/Fehler greift der Kassel-Fallback.
  // Der Button bleibt als manuelle Nachlade-Möglichkeit erhalten.
  useEffect(() => {
    fetchAutoWeather();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  async function interpretDayDescription(text) {
    // Cache layer for interpreted results to avoid duplicate Groq calls
    const cacheKey = `interpret_${text}_${season}_${weather}_${occasion}_${mood}_${timeOfDay}_${intensityPref}_${longevityPref}_${priceRange || 'null'}_${genderPref || 'null'}`;
    const cachedInterpretation = interpretationCache.current.get(cacheKey);
    if (cachedInterpretation && Date.now() - cachedInterpretation.timestamp < CACHE_TTL) {
      console.log('INFO', 'Using cached interpretation result');
      return cachedInterpretation.data;
    }

    // Aktuellen Kontext als Zusatz-Info für die KI aufbauen (buildPromptContext)
    const currentCtxHint = buildPromptContext({
      occasion, mood, timeOfDay, weather, season,
      intensityPref, longevityPref, priceRange, genderPref, userFamilyPrefs,
    });
    const systemPrompt = `Du bist ein Parfum-Berater. Analysiere eine kurze Tagesbeschreibung und gib optimierte Duftparameter zurück.
Beachte den aktuellen Kontext (Saison, Wetter usw.) – du kannst davon abweichen wenn die Beschreibung es nahelegt.
Antworte NUR mit einem validen JSON-Objekt, kein Markdown, keine Erklärung.`;
    const userPrompt = `Tagesbeschreibung: "${text}"

Aktueller Kontext (zur Orientierung):
${currentCtxHint}

Analysiere und bestimme optimierte Werte für:
- occasion: eines von [casual, work, sport, evening, date, sleep, special, outdoor, travel, vacation]
- mood: eines von [energetic, calm, romantic, confident, mysterious, playful, sleep]
- timeOfDay: eines von [morning, afternoon, evening, night]
- intensityPref: eines von [light, medium, strong]
- longevityPref: eines von [short, medium, long]
- reasoning: ein deutscher Satz warum (max 80 Zeichen)

Antworte NUR mit JSON: {"occasion":"...","mood":"...","timeOfDay":"...","intensityPref":"...","longevityPref":"...","reasoning":"..."}`;

    const { text: raw, fromCache } = await groqFetch({
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.3, max_tokens: 150,
      cacheKey: "day:" + text.slice(0, 40) + season + weather,
    });
    const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
    if (!m) throw new Error("KI-Antwort konnte nicht gelesen werden.");
    try {
      const parsed = JSON.parse(m[0]);
      const result = { ...parsed, _fromCache: fromCache };
      // Cache the interpretation result
      interpretationCache.current.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch {
      throw new Error("KI-Antwort konnte nicht verarbeitet werden.");
    }
  }

  async function handleAiGenerate() {
    if (!aiText.trim()) return;
    setAiLoading(true); setAiErr("");
    console.log('[KI] Start der Auswertung für:', aiText.trim());
    // Valid value sets – used to sanitize AI output before applying to app state
    const VALID_OCCASIONS = new Set(OCCASIONS.map(o => o.id));
    const VALID_MOODS     = new Set(MOODS.map(m => m.id));
    const VALID_TIMES     = new Set(TIMES.map(t => t.id));
    const VALID_INT       = new Set(INTENSITIES.map(i => i.id));
    const VALID_LON       = new Set(LONGEVITIES.map(l => l.id));
    try {
      const result = await interpretDayDescription(aiText.trim());
      console.log('[KI] Antwort erhalten:', result);
      // Sanitize: only apply values that exist in the app's enum lists.
      // Unknown AI values (e.g. "formal", "happy", "focused") are silently dropped
      // so they don't corrupt the score context.
      const safeOcc = VALID_OCCASIONS.has(result.occasion) ? result.occasion : null;
      const safeMood = VALID_MOODS.has(result.mood) ? result.mood : null;
      const safeTime = VALID_TIMES.has(result.timeOfDay) ? result.timeOfDay : null;
      const safeInt  = VALID_INT.has(result.intensityPref) ? result.intensityPref : null;
      const safeLon  = VALID_LON.has(result.longevityPref) ? result.longevityPref : null;
      console.log('[KI] Bereinigte Werte:', { safeOcc, safeMood, safeTime, safeInt, safeLon });
      if (safeOcc)  setOccasion(safeOcc);
      if (safeMood) setMood(safeMood);
      if (safeTime) setTime(safeTime);
      if (safeInt)  setIntensity(safeInt);
      if (safeLon)  setLongevity(safeLon);
      setShowAiInput(false);
      setAiText("");
      // Fix: dieselbe Picker-Logik wie die manuelle Auswahl nutzen (generate()).
      // Werte werden als overrides übergeben, da State-Updates async sind.
      generate([], {
        occasion: safeOcc || occasion,
        mood: safeMood || mood,
        timeOfDay: safeTime || timeOfDay,
        intensityPref: safeInt || intensityPref,
        longevityPref: safeLon || longevityPref,
        aiReasoning: result.reasoning,
        fromCache: result._fromCache,
      });
    } catch(e) {
      // Fix: verständliche Fehlermeldung statt endlosem Laden
      console.log('[KI] Fehler:', e);
      const msg = e?.message || "Unbekannter Fehler bei der KI-Auswertung";
      setAiErr(msg);
      showToast(msg);
    } finally {
      // Fix: Loading-State endet immer
      setAiLoading(false);
    }
  }

  const generateTimerRef = useRef(null);

// ── Memoized recommendation context: only recomputes when core inputs change ────
const recCtx = useMemo(() => {
  const effectiveIntensity = (mood === "sleep" || occasion === "sleep") ? "light" : intensityPref;
  const effectiveLongevity = (mood === "sleep" || occasion === "sleep") ? "short" : longevityPref;
  return { season, weather, occasion, mood, timeOfDay, intensityPref: effectiveIntensity, longevityPref: effectiveLongevity, log, userNotePrefs, userFamilyPrefs, priceRange, genderPref, priceMl };
}, [season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, log, userNotePrefs, userFamilyPrefs, priceRange, genderPref, priceMl]);

  // ── Teil 3: Empfehlung über die neue Picker-Engine (pickPerfume) ──
  // excludeExtra: zusätzliche IDs für "Anderer Vorschlag" (state-Update + Draw
  // in einem Schritt, ohne auf das React-SetState zu warten).
  function generate(excludeExtra = [], overrides = {}) {
    // Cancel any pending generate call so rapid double-taps don't race
    if (generateTimerRef.current) clearTimeout(generateTimerRef.current);
    setLoadingRecs(true);
    // Fix: overrides erlauben der KI-Auswertung, dieselbe Picker-Logik wie die
    // manuelle Auswahl zu nutzen (State-Updates sind async → Werte direkt übergeben)
    const effOccasion = overrides.occasion ?? occasion;
    const effMood = overrides.mood ?? mood;
    const effTime = overrides.timeOfDay ?? timeOfDay;
    const effIntensity = overrides.intensityPref ?? intensityPref;
    const effLongevity = overrides.longevityPref ?? longevityPref;
    const effWeather = overrides.weather ?? weather;
    generateTimerRef.current = setTimeout(() => {
      generateTimerRef.current = null;
      // Fix: try/finally – loadingRecs wird in jedem Fall zurückgesetzt
      try {
        if (!items.length) { showToast("Keine Parfums in der Sammlung"); return; }
        const wearMap = getWearMap();
        // Kontext-Schlüssel für die Lernschleife (Anlass + Stimmung)
        const ctxKey = feedbackContextKey(effOccasion, effMood);
        const selection = buildPickerSelection({
          season, weather: effWeather, occasion: effOccasion, mood: effMood, timeOfDay: effTime,
          intensityPref: effIntensity, longevityPref: effLongevity, temperature,
          recentPrimaryFamilies: recentPrimaryFamilies(wearMap),
          personalBonusMap: getPersonalBonusMap(ctxKey),
          feedbackCountsMap: getFeedbackCountsMap(ctxKey),
        });
        const result = runPickerForToday(items, wearMap, selection, {
          excludeIds: [...excludedIds, ...excludeExtra],
        });
        if (!result.perfume) {
          setRecs(null);
          showToast("Kein passender Duft gefunden");
          return;
        }
        setLastPickInfo({ relaxed: result.relaxed, candidates: result.candidates });
        setRecs({
          top3: [result.perfume],
          alts: result.alts,
          wildcard: null,
          _selection: selection,
          _daysSince: daysSinceMap(wearMap, [result.perfume, ...result.alts]),
          ...(overrides.aiReasoning ? { _aiReasoning: overrides.aiReasoning, _fromCache: overrides.fromCache } : {}),
        });
        setWorn({});
      } catch (err) {
        // Fix: Fehler sichtbar machen statt endlosem Ladezustand
        console.log('[Picker] Fehler in generate():', err);
        setRecs(null);
        showToast("Fehler bei der Empfehlung – bitte erneut versuchen.");
        if (pushError) pushError(err, { hint: "Empfehlung konnte nicht berechnet werden." });
      } finally {
        setLoadingRecs(false);
      }
    }, 300);
  }

  // App-Occasion-IDs unverändert (Aliase passieren in buildPickerSelection)

  // Hauptfamilien der zuletzt getragenen Düfte (Diversität im Score)
  function recentPrimaryFamilies(wearMap) {
    return Object.entries(wearMap || {})
      .filter(([, e]) => typeof e.lastWornTs === "number")
      .sort((a, b) => b[1].lastWornTs - a[1].lastWornTs)
      .slice(0, PICKER_CONFIG.diversityWindow)
      .map(([id]) => {
        const p = items.find(it => String(it.id) === id);
        const fams = p && p.families && p.families.length > 0 ? p.families : (p && p.family ? [p.family] : []);
        return fams[0];
      })
      .filter(Boolean);
  }

  // Tage-seit-Tragen pro Duft (für die Begründung)
  function daysSinceMap(wearMap, perfumes) {
    const DAY = 86400000;
    const nowTs = Date.now();
    const out = {};
    for (const p of perfumes) {
      const e = wearMap && wearMap[String(p.id)];
      out[p.id] = e && typeof e.lastWornTs === "number"
        ? Math.max(0, (nowTs - e.lastWornTs) / DAY)
        : null;
    }
    return out;
  }

  // Wear-Map als Memo (aktualisiert sich über wearVersion nach jedem Tragen)
  const wearMapMemo = useMemo(() => {
    try { return getWearMap(); } catch { return {}; }
  }, [wearVersion]);

  // Treffer-Zähler für die Kriterien-Chips (Teil 3.5)
  const chipCounts = useMemo(() => {
    if (!items || items.length === 0) return null;
    const nowTs = Date.now();
    const base = buildPickerSelection({ season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, temperature });
    return {
      mood: chipMatchCounts(items, wearMapMemo, nowTs, "mood", MOODS.map(m => m.id), base),
      time: chipMatchCounts(items, wearMapMemo, nowTs, "timeOfDay", TIMES.map(t => t.id), base),
      weather: chipMatchCounts(items, wearMapMemo, nowTs, "weather", WEATHERS.map(w => w.id), base),
      occasion: chipMatchCounts(items, wearMapMemo, nowTs, "occasion", OCCASIONS.map(o => o.id), base),
      intensity: chipMatchCounts(items, wearMapMemo, nowTs, "intensity", INTENSITIES.map(i => i.id), base),
      longevity: chipMatchCounts(items, wearMapMemo, nowTs, "longevity", LONGEVITIES.map(l => l.id), base),
    };
  }, [items, wearMapMemo, season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, temperature]);

  // Kleiner Helfer: Chip-Stil inkl. Zähler-Badge & Dimmen
  function chipStyle(active, count, color) {
    const dimmed = typeof count === "number" && count <= CHIP_DIM_COUNT;
    return {
      ...S.chip(active, color),
      opacity: dimmed && !active ? 0.4 : 1,
      minHeight: 44,
    };
  }

  // Parfum-Anzahl wird nicht mehr angezeigt (User-Wunsch) – Komponente bleibt
  // als No-op bestehen, damit die Aufrufe an den Schaltflächen ohne Umbau funktionieren.
  function ChipCount() {
    return null;
  }

  // ── Teil 3: Tragen über wearStore.recordWear ("zuletzt getragen" +
  // "Anzahl Trage-Tage" werden dort aktualisiert) + 1-Tap-Feedback anstoßen ──
  function wear(p, btnEl) {
    recordWear(p.id, Date.now());
    onLog(p); // bestehendes Legacy-Log weiterführen (Statistik)
    setWearVersion(v => v + 1);
    setWorn(prev => ({ ...prev, [p.id]: true }));
    setFeedbackFor(p.id);
    triggerSprayAnimation(btnEl);
    showToast("Getragen! Wie passte es?");
  }

  // 1-Tap-Feedback: speichert persönlichen Bonus/Malus (±0.15) pro Anlass+Stimmung
  function sendFeedback(p, rating) {
    try {
      recordFeedback(p.id, feedbackContextKey(occasion, mood), rating);
      setWearVersion(v => v + 1);
      showToast(rating === "good" ? "Danke! Wird gemerkt." : rating === "bad" ? "Ok – merke ich mir." : "Notiert.");
    } catch {
      showToast("Feedback konnte nicht gespeichert werden");
    }
    setFeedbackFor(null);
    // Kurze Bestätigungs-Animation am selben Ort anzeigen (Feedback-Panel ersetzt sich selbst)
    setFeedbackDone({ id: p.id, rating });
    setTimeout(() => setFeedbackDone(cur => (cur && cur.id === p.id ? null : cur)), 1400);
  }

  // "Anderer Vorschlag": aktuellen Vorschlag ablehnen und neu ziehen
  function suggestOther(p) {
    setExcludedIds(prev => [...prev, String(p.id)]);
    generate([String(p.id)]);
  }

  // Abgelehnte Vorschläge der Sitzung zurücksetzen
  function resetExcluded() {
    setExcludedIds([]);
    showToast("Abgelehnte Vorschläge zurückgesetzt");
  }

  const Sec = ({ id, lbl, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div onClick={() => tog(id)} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer", marginBottom: 8 }}>
        <div className="lbl">{lbl}</div>
        <div style={{ fontSize: 10, color: "#888780" }}>{open[id] ? "▲" : "▼"}</div>
      </div>
      {open[id] && children}
    </div>
  );

  // Karte für eine Empfehlung
  function RecCard({ p, role, rank }) {
    const [whyOpen, setWhyOpen] = useState(false);
    const isTop1 = role === "top1";
    const isWild = role === "wildcard";
    const fc = FAM_COLORS[p.family] || "#888";
    const families = p.families && p.families.length > 0 ? p.families : (p.family ? [p.family] : []);
    const familyDisplay = families.length > 0 ? families.join(", ") : "Sonstiges";
    const familyColor = families.length > 0 ? FAM_COLORS[families[0]] || "#888" : "#888";
    const reason = buildSuggestionReason(
      p,
      recs && recs._selection ? recs._selection : buildPickerSelection({ season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, temperature }),
      recs && recs._daysSince ? recs._daysSince[p.id] : null,
      wearMapMemo[p.id] && wearMapMemo[p.id].wearDays ? wearMapMemo[p.id].wearDays : 0,
    );
    const wornNow = worn[p.id];
    const todayStr = new Date().toDateString();
    const wornToday = log.some(l => l.id === p.id && new Date(l.ts).toDateString() === todayStr);

    const borderStyle = isTop1
      ? "1.5px solid #1A1A18"
      : isWild
        ? `1px dashed ${fc}`
        : "1px solid #E8E6E0";

    return (
      <div className="card" style={{border: borderStyle, marginBottom: 10, padding: "12px 14px" }}>
        {/* Rang-Badge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isTop1 && <span style={{ fontSize: 9, letterSpacing: "1px", background: "#1A1A18", color: "#fff", padding: "2px 7px", borderRadius: 10 }}>BESTE WAHL</span>}
            {isWild && <span style={{ fontSize: 9, letterSpacing: "1px", background: fc + "22", color: fc, padding: "2px 7px", borderRadius: 10 }}>WILDCARD</span>}
            {["alt1", "alt2"].includes(role) && <span style={{ fontSize: 9, letterSpacing: "1px", color: "#888780" }}>ALTERNATIVE</span>}
            {["top2", "top3"].includes(role) && <span style={{ fontSize: 9, letterSpacing: "1px", color: "#888780" }}>#{rank}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setWhyOpen(true)}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 8, border: "1px solid #E8E6E0", background: "#fff", color: "#888780", cursor: "pointer" }}>
              Warum?
            </button>
            <WhySuggestionDialog
              perfume={p}
              selection={recs && recs._selection ? recs._selection : null}
              wearMap={wearMapMemo}
              open={whyOpen}
              onClose={() => setWhyOpen(false)}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, marginBottom: 1, fontWeight: isTop1 ? 500 : 400 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#888780", marginBottom: 6 }}>{p.house} · {p.conc}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
              {families.map((f, idx) => (
                <FamilyPill key={f} family={f} idx={idx} />
              ))}
              <span className="pill" style={{ '--pill-bg': "#88878022", '--pill-c': "#888780" }}>{p.season}</span>
              <span className="pill" style={{ '--pill-bg': "#88878022", '--pill-c': "#888780" }}>{p.format}</span>
            </div>
            {(p.rating || 0) > 0 && <Stars rating={p.rating} size={12} />}
            {/* Begründung (Teil 3.1) */}
            <div style={{ fontSize: 10, color: "#888780", marginTop: 6, lineHeight: 1.5, fontStyle: "italic" }}>
              {reason}
            </div>
            {/* Anwendungshilfe: Sprühstöße je Anlass (Teil 3.1) */}
            <div style={{ fontSize: 10, color: "#1A1A18", marginTop: 4, lineHeight: 1.5 }}>
              💧 Anwendung: {getSprayGuide(occasion)}
            </div>
            {/* Aktionen: Tragen / Anderer Vorschlag (Teil 3.2) */}
            {!wornNow && !wornToday && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => suggestOther(p)}
                  aria-label="Anderen Vorschlag ziehen"
                  style={{ ...S.btn("out"), fontSize: 11, padding: "8px 12px", minHeight: 44, flex: 1 }}>
                  ↻ Anderer Vorschlag
                </button>
              </div>
            )}
            {/* 1-Tap-Feedback nach dem Tragen (Teil 3.7) */}
            {feedbackFor === p.id && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #E8E6E0" }}>
                <div style={{ fontSize: 10, color: "#888780", marginBottom: 6 }}>Passte es heute (zu {occasion === "work" ? "Business" : occasion === "casual" ? "Alltag" : occasion === "sleep" ? "Schlafen" : occasion})?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["good", "Passte gut", "#1D9E75"], ["ok", "Naja", "#BA7517"], ["bad", "Passte nicht", "#E24B4A"]].map(([rating, label, color]) => (
                    <button key={rating} onClick={() => sendFeedback(p, rating)}
                      aria-label={`Feedback: ${label}`}
                      className="animate-in fade-in zoom-in-95 duration-150"
                      style={{
                        ...S.btn("out"), flex: 1, fontSize: 10, minHeight: 44,
                        padding: "8px 4px", color, borderColor: color,
                        background: color + "11", borderRadius: 8,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Bestätigungs-Animation nach dem Feedback-Tap (ersetzt das Panel kurz) */}
            {feedbackDone && feedbackDone.id === p.id && (
              <div className="feedback-confirm animate-in fade-in zoom-in-95 duration-200" style={{
                marginTop: 10, paddingTop: 8, borderTop: "1px solid #E8E6E0",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontSize: 11, color: "#1D9E75"
              }} role="status">
                <span style={{ fontSize: 14 }}>✓</span> Notiert – danke!
              </div>
            )}
          </div>
          <div style={{ marginLeft: 12, textAlign: "center", flexShrink: 0 }}>
            {wornNow || wornToday
              ? <div style={{ fontSize: 11, color: "#1D9E75" }}>✓ getragen</div>
              : <button onClick={e => wear(p, e.currentTarget)} aria-label="Parfüm tragen" className="btn" style={{ ...S.btn("out"), fontSize: 11, padding: "6px 10px" }}>Tragen</button>
            }
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Datum/Saison-Karte */}
      <div className="card" style={{background: sc.bg, border: `1px solid ${sc.accent}33`, marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: "1.5px", color: sc.text, marginBottom: 3 }}>
          {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
        </div>
        <div style={{ fontSize: 18, color: sc.text }}>{season}</div>
      </div>

      {/* Wetter-Widget */}
      <div className="card" style={{marginBottom: 12, padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: weatherData ? 8 : 0 }}>
          <div className="lbl">WETTER AUTOMATISCH ERKENNEN</div>
          <button onClick={() => fetchAutoWeather(true)} disabled={weatherLoading}
            style={{
              ...S.btn("out"), fontSize: 10, padding: "5px 10px", borderRadius: 16,
              opacity: weatherLoading ? .6 : 1
            }}>
            {weatherLoading ? "…" : "Standort nutzen"}
          </button>
        </div>
        {weatherData && <WeatherWidget weatherData={weatherData} onUse={applyWeather} />}
        {!weatherData && !weatherLoading && <div style={{ fontSize: 10, color: "#B4B2A9" }}>Wetter wird automatisch beim Start geladen (Standort-Fallback: Kassel). Oder manuell unten auswählen.</div>}
      </div>

      <Sec id="crit" lbl="KRITERIEN">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><div className="lbl">STIMMUNG</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {MOODS.map(m => (
                <button key={m.id} onClick={() => setMood(m.id)} aria-label={`Stimmung: ${m.label}`} className={`chip ${mood === m.id ? "active" : ""}`}
                  style={{ ...chipStyle(mood === m.id, chipCounts && chipCounts.mood && chipCounts.mood[m.id]), padding: "10px 6px", textAlign: "center", borderRadius: 10 }}>
                  <div style={{ fontSize: 16, marginBottom: 2 }}>{m.icon}</div>
                  <div style={{ fontSize: 10 }}>{m.label}</div>
                  <ChipCount count={chipCounts && chipCounts.mood && chipCounts.mood[m.id]} />
                </button>
              ))}
            </div>
          </div>
          {/* auto-fill: einheitliche Zellen – auf schmalen Screens (iPhone) rutscht der zweite Block automatisch in eine neue Zeile */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
            <div><div className="lbl">TAGESZEIT</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TIMES.map(t => (
                  <button key={t.id} onClick={() => setTime(t.id)} aria-label={`Zeit: ${t.label}`} className="chip"
                  style={{ ...chipStyle(timeOfDay === t.id, chipCounts && chipCounts.time && chipCounts.time[t.id]), padding: "8px 12px", fontSize: 11, minHeight: 44 }}>{t.label}<ChipCount count={chipCounts && chipCounts.time && chipCounts.time[t.id]} /></button>
                ))}
              </div>
            </div>
            <div><div className="lbl">WETTER</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WEATHERS.map(w => (
                  <button key={w.id} onClick={() => setWeather(w.id)} aria-label={`Wetter: ${w.label}`} className="chip"
                  style={{ ...chipStyle(weather === w.id, chipCounts && chipCounts.weather && chipCounts.weather[w.id]), padding: "8px 12px", fontSize: 11, minHeight: 44 }}>{w.label}<ChipCount count={chipCounts && chipCounts.weather && chipCounts.weather[w.id]} /></button>
                ))}
              </div>
            </div>
          </div>
          <div><div className="lbl">ANLASS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6 }}>
              {OCCASIONS.map(o => (
                <button key={o.id} onClick={() => setOccasion(o.id)} aria-label={`Anlass: ${o.label}`}
                  style={{ ...chipStyle(occasion === o.id, chipCounts && chipCounts.occasion && chipCounts.occasion[o.id]), padding: "8px 2px", textAlign: "center", borderRadius: 10, minHeight: 48 }}>
                  <div style={{ fontSize: 14, marginBottom: 1 }}>{o.icon}</div>
                  <div style={{ fontSize: 8, lineHeight: 1.2 }}>{o.label}</div>
                  <ChipCount count={chipCounts && chipCounts.occasion && chipCounts.occasion[o.id]} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            <div><div className="lbl">INTENSITÄT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {INTENSITIES.map(i => (
                  <button key={i.id} onClick={() => setIntensity(i.id)} aria-label={`Intensität: ${i.label}`}
                    className="chip"
                    style={{ ...chipStyle(intensityPref === i.id, chipCounts && chipCounts.intensity && chipCounts.intensity[i.id]), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "8px 12px", minHeight: 44 }}>
                    <span>{i.label}<ChipCount count={chipCounts && chipCounts.intensity && chipCounts.intensity[i.id]} /></span><span style={{ fontSize: 9, opacity: .7 }}>{i.note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div><div className="lbl">HALTBARKEIT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {LONGEVITIES.map(l => (
                  <button key={l.id} onClick={() => setLongevity(l.id)} aria-label={`Haltbarkeit: ${l.label}`}
                    className="chip"
                    style={{ ...chipStyle(longevityPref === l.id, chipCounts && chipCounts.longevity && chipCounts.longevity[l.id]), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "8px 12px", minHeight: 44 }}>
                    <span>{l.label}<ChipCount count={chipCounts && chipCounts.longevity && chipCounts.longevity[l.id]} /></span><span style={{ fontSize: 9, opacity: .7 }}>{l.note}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Optionale erweiterte Filter */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            <div>
              <div className="lbl">PREISBEREICH (optional)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[["budget","Budget","< 30€"],["mid","Mittel","30–100€"],["luxury","Luxus","> 100€"]].map(([id,label,note]) => (
                  <button key={id} onClick={() => setPriceRange(priceRange === id ? null : id)}
                    className="chip"
                    style={{ ...S.chip(priceRange === id, "#BA7517"), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
                    <span>{label}</span><span style={{ fontSize: 9, opacity: .7 }}>{note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="lbl">GENDER (optional)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[["Feminin","♀"],["Maskulin","♂"],["Unisex","⚥"]].map(([id,icon]) => (
                  <button key={id} onClick={() => setGenderPref(genderPref === id ? null : id)}
                    className="chip"
                    style={{ ...S.chip(genderPref === id), display: "flex", gap: 6, borderRadius: 8, padding: "6px 10px", fontSize: 11, alignItems: "center" }}>
                    <span style={{ fontSize: 12 }}>{icon}</span><span>{id}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Sec>

      {/* ── KI-Tagesbeschreibung ─────────────────────────────────── */}
      <div className="card" style={{marginBottom: 12, padding: "14px 16px", borderRadius: 14,
        background: "#fff",
        border: showAiInput ? "1.5px solid #1A1A18" : "1px solid #E8E6E0",
        transition: "all .2s" }}>
        {!showAiInput ? (
          <button onClick={() => setShowAiInput(true)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "none", border: "none", cursor: "pointer", padding: 0,
              fontFamily: "'Georgia',serif", textAlign: "left" }}>
            <AiSparkle size={32} />
            <div>
              <div style={{ fontSize: 12, color: "#1A1A18", fontWeight: 500 }}>Beschreib deinen Tag</div>
              <div style={{ fontSize: 11, color: "#888780" }}>KI wählt passende Regler aus</div>
            </div>
            <div style={{ marginLeft: "auto", fontSize: 10, color: "#B4B2A9" }}>▸</div>
          </button>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: "1.5px", color: "#1A1A18" }}>BESCHREIB DEINEN TAG</div>
              <button onClick={() => { setShowAiInput(false); setAiText(""); setAiErr(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: 0 }}>✕</button>
            </div>

            {/* Quick examples */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {["Romantisches Dinner", "Gym & Sport", "Büro-Meeting", "Strandurlaub", "Gemütlicher Abend"].map(ex => (
                <button key={ex} onClick={() => setAiText(ex)}
                  style={{ fontSize: 10, padding: "5px 10px", borderRadius: 20,
                    border: "1px solid #D3D1C7", background: aiText === ex ? "#1A1A18" : "#fff",
                    color: aiText === ex ? "#fff" : "#888780", cursor: "pointer", transition: "all .1s" }}>
                  {ex}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <input
                value={aiText}
                onChange={e => setAiText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAiGenerate(); } }}
                placeholder='z.B. "Abendessen mit Freunden" oder "langer Arbeitstag"'
                autoFocus
                className="inp" style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10,
                  border: "1.5px solid #1A1A18", background: "#fff" }}
                maxLength={500}
              />
              <div style={{ fontSize: 10, color: aiText.length > 450 ? "#E24B4A" : "#B4B2A9", marginBottom: 10, minWidth: "36px", textAlign: "right" }}>
                {aiText.length}/500
              </div>
              <button onClick={handleAiGenerate} disabled={aiLoading || !aiText.trim()}
                style={{ ...S.btn("pri"), padding: "12px 16px", borderRadius: 10, fontSize: 12,
                  opacity: aiLoading || !aiText.trim() ? 0.5 : 1,
                  background: "#1A1A18",
                  boxShadow: "0 2px 8px rgba(26,26,24,0.25)", whiteSpace: "nowrap" }}>
                {aiLoading ? "…" : "✦ Los"}
              </button>
            </div>
            {groqCountdownVal > 0 && (
              <div style={{ fontSize: 11, color: "#BA7517", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span>⏱</span>
                <span>API-Limit – verfügbar in <strong>{groqCountdownVal}s</strong>. Zwischengespeicherte Antworten werden genutzt.</span>
              </div>
            )}
            {aiErr && !aiErr.includes("RATE_LIMIT") && <div style={{ fontSize: 11, color: "#E24B4A", marginTop: 8 }}>{aiErr}</div>}
          </div>
        )}
      </div>

      <button onClick={() => generate()} disabled={loadingRecs}
        style={{
          ...S.btn("pri"), width: "100%", padding: "14px", borderRadius: 10, marginBottom: 10, fontSize: 14,
          opacity: loadingRecs ? 0.6 : 1, cursor: loadingRecs ? "wait" : "pointer"
        }}>
        {loadingRecs ? "Berechne..." : (recs ? "Neu empfehlen" : "Empfehlung generieren")}
      </button>

      {/* Abgelehnte Vorschläge dieser Sitzung (Teil 3.2) */}
      {excludedIds.length > 0 && (
        <button onClick={resetExcluded}
          style={{ ...S.btn("out"), width: "100%", fontSize: 11, padding: "10px", borderRadius: 10, minHeight: 44, marginBottom: 20 }}>
          {excludedIds.length} abgelehnte{excludedIds.length > 1 ? "" : "r"} Vorschlag{excludedIds.length > 1 ? "e" : ""} – zurücksetzen
        </button>
      )}

      {/* Hinweis: was wurde gelockert (Teil 3.5) */}
      {lastPickInfo && lastPickInfo.relaxed && lastPickInfo.relaxed.length > 0 && (
        <div className="card" style={{ background: "#FDF6EC", border: "1px solid #BA751733", marginBottom: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#BA7517", lineHeight: 1.5 }}>
            ⚠ Weniger Treffer als sonst – gelockert: {lastPickInfo.relaxed.join(" · ")}
          </div>
        </div>
      )}

      {recs && (
        <div>
          {/* KI-Reasoning Banner */}
          {recs._aiReasoning && (
            <div className="card" style={{background: "#F4F3FD", border: "1px solid #534AB722",
              marginBottom: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>✦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#534AB7", fontStyle: "italic" }}>{recs._aiReasoning}</div>
                {recs._fromCache && (
                  <div style={{ fontSize: 10, color: "#B4B2A9", marginTop: 3 }}>◎ Aus Cache – KI-Limit aktiv</div>
                )}
              </div>
            </div>
          )}
          {/* Vorschlag */}
          <Sec id="res" lbl="VORSCHLAG HEUTE">
            {(recs.top3 || []).map((p, i) => (
              <RecCard key={p.id} p={p} role={["top1", "top2", "top3"][i]} rank={i + 1} />
            ))}
          </Sec>

          {/* Alternativen */}
          {recs.alts && recs.alts.length > 0 && (
            <Sec id="alts" lbl="WEITERE VORSCHLÄGE">
              {recs.alts.map((p, i) => (
                <RecCard key={p.id} p={p} role={["alt1", "alt2"][i]} rank={2 + i} />
              ))}
            </Sec>
          )}

          {/* Wildcard */}
          {recs.wildcard && (
            <Sec id="wild" lbl="WILDCARD">
              <RecCard p={recs.wildcard} role="wildcard" rank={0} />
            </Sec>
          )}

          {/* Debug-Ansicht (Teil 3.6): aufklappbar, standardmäßig zu */}
          <Sec id="debug" lbl="DEBUG (SCORING-DETAILS)">
            <button onClick={() => setDebugOpen(o => !o)}
              aria-expanded={debugOpen}
              style={{ ...S.btn("out"), width: "100%", fontSize: 11, minHeight: 44, marginBottom: 10 }}>
              {debugOpen ? "▲ Details verbergen" : "▼ Score-Details anzeigen"}
            </button>
            {debugOpen && recs._selection && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...(recs.top3 || []), ...(recs.alts || [])].map(p => {
                  const d = debugBreakdown(p, recs._selection, getWearMap(), Date.now());
                  if (!d) return null;
                  return (
                    <div key={p.id} className="card" style={{ padding: "10px 12px", fontSize: 10, lineHeight: 1.6 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{d.name} <span style={{ color: "#888780", fontWeight: 400 }}>· Gesamt ≈ {d.estimatedTotal}</span></div>
                      <div style={{ color: "#888780" }}>
                        kriterienScore: {d.criteriaScore} · Aging: ×{d.agingFactor} ({d.daysSinceLastWorn === null ? "nie getragen" : `${d.daysSinceLastWorn} Tage`}) · Fairness: ×{d.fairnessFactor} · Zufall: {d.randomRange[0]}–{d.randomRange[1]} · Konz.-Mod.: {d.concModifier > 0 ? "+" : ""}{d.concModifier} · Diversität: {d.diversityApplied ? "−10 %" : "nein"} · Persönl. Bonus: {d.personalBonus > 0 ? "+" : ""}{d.personalBonus}
                      </div>
                      {d.criteria.map(c => (
                        <div key={c.key + (c.label || "")} style={{ marginTop: 6, paddingTop: 4, borderTop: "1px dashed #E8E6E0" }}>
                          <div><strong>{c.label}</strong> · Wert: {c.value === null || c.value === undefined ? "–" : Math.round(c.value * 100) / 100} · Gewicht: {c.weight}{c.notesScore !== undefined ? ` · Familien: ${c.famScore === null ? "–" : Math.round(c.famScore * 100) / 100} / Noten: ${c.notesScore === null ? "–" : Math.round(c.notesScore * 100) / 100}` : ""}</div>
                          {c.details && c.details.matchedFamilies && c.details.matchedFamilies.length > 0 && (
                            <div style={{ color: "#5C6B4F" }}>Familien: {c.details.matchedFamilies.map(m => `${m.family} (${m.cat === "haupt" ? "HAUPT" : m.cat === "neben" ? "NEBEN" : "MEIDEN"})`).join(", ")}</div>
                          )}
                          {c.details && c.details.matchedNotes && c.details.matchedNotes.length > 0 && (
                            <div style={{ color: "#5C6B4F" }}>Noten: {c.details.matchedNotes.map(m => `${m.note} (${m.cat === "haupt" ? "H" : m.cat === "neben" ? "N" : "M"})`).join(", ")}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </Sec>
        </div>
      )}

      {items.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6, animation: "float 4s ease-in-out infinite" }}>🌸</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1A18", marginBottom: 8, animation: "fadeIn .6s ease-out both", animationDelay: "0.1s" }}>Deine Sammlung ist leer</div>
          <div style={{ fontSize: 13, color: "#888780", lineHeight: 1.6, marginBottom: 20, animation: "fadeIn .6s ease-out both", animationDelay: "0.2s" }}>
            Importiere deine Parfüms als TSV-Datei<br />oder füge sie einzeln hinzu.
          </div>
          <button onClick={() => onNavigate && onNavigate("settings")}
            style={{ ...S.btn("pri"), padding: "12px 24px", fontSize: 13, animation: "fadeIn .6s ease-out both", animationDelay: "0.3s" }}>
            → Zu Einstellungen
          </button>
        </div>
      )}

      {/* Fix: Toast-Anzeige für HeuteTab – showToast() setzte den State, aber der
          Toast wurde nie gerendert (das {toast && …} gehört zur DeclutterTab,
          die ein eigenes State hat). Dadurch waren Feedbacks (z. B. "Anwenden",
          KI-Fehler, "Kein passender Duft") im Heute-Tab unsichtbar. */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{toast}</div>
      )}
    </div>
  );
}

// ── Note synonym map + search engine ─────────────────────────────────────────
// Maps every known variant to a canonical German key.
// Both the query AND the note values are normalized through this map,
// so "Tobacco", "Tabac", "Tabacco" all match a search for "Tabak".
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
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, message: String(err?.message || err || "Unbekannter Fehler") };
  }
  componentDidCatch(err, info) {
    try {
      console.error("AppErrorBoundary", err, info);
    } catch { }
  }
  render() {
    if (this.state.hasError) {
      return React.createElement("div", { style: { maxWidth: 480, margin: "30px auto", padding: 16, fontFamily: "Georgia,serif" } },
        React.createElement("div", { style: { background: "#fff", border: "1px solid #F7C1C1", borderRadius: 10, padding: 14 } },
          React.createElement("div", { style: { fontSize: 14, color: "#A32D2D", marginBottom: 6 } }, "Etwas ist schiefgelaufen."),
          React.createElement("div", { style: { fontSize: 12, color: "#666", marginBottom: 10 } }, this.state.message),
          React.createElement("button", { onClick: () => location.reload(), style: { padding: "8px 12px", borderRadius: 8, border: "1px solid #D3D1C7", background: "#fff", cursor: "pointer" } }, "App neu laden")
        )
      );
    }
    return this.props.children;
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  // ═══════════════════════════════════════════════════════════════════
  // Zentraler App-State via useReducer – alle Daten in einem Objekt
  // ══════════════════════════════════════════════════════════════════
  const [state, dispatch] = useReducer((s, a) => {
switch (a.type) {
  case 'HYDRATE_ALL': return { ...s, ...a.payload };
  case 'SET_ITEMS': return { ...s, items: a.payload };
  case 'SET_LOG': return { ...s, log: a.payload };
  case 'SET_NOTES': return { ...s, notes: a.payload };
  case 'SET_WISHLIST': return { ...s, wishlist: a.payload };
  case 'SET_WISH_DETAILS_CACHE': return { ...s, wishDetailsCache: a.payload };
  case 'SET_PREFS': return { ...s, prefs: a.payload };
  case 'SET_USER_NOTE_PREFS': return { ...s, userNotePrefs: a.payload };
  case 'SET_USER_FAMILY_PREFS': return { ...s, userFamilyPrefs: a.payload };
  case 'SET_FILL_LEVELS': return { ...s, fillLevels: a.payload };
  case 'SET_PRICE_ML': return { ...s, priceMl: a.payload };
  case 'SET_DECLUTTER_STATUS': return { ...s, declutterStatus: a.payload };
  case 'SET_TAB': return { ...s, tab: a.payload };
  case 'SET_TOAST': return { ...s, toast: a.payload };
  case 'SET_LOADED': return { ...s, loaded: a.payload };
  case 'SET_BACK_STACK': return { ...s, backStack: typeof a.payload === 'function' ? a.payload(s.backStack) : a.payload };
  case 'SET_DETAIL': return { ...s, detail: a.payload };
  case 'SET_SHOW_ONBOARD': return { ...s, showOnboard: a.payload };
  default: return s;
}
  }, {
items: [], log: [], notes: {},
wishlist: [], wishDetailsCache: {},
prefs: { appName: "Sillage" }, userNotePrefs: [], userFamilyPrefs: [],
fillLevels: {}, priceMl: {}, declutterStatus: {},
tab: "heute", toast: { msg: "", show: false }, loaded: false,
backStack: [], detail: null, showOnboard: false,
  });
  const { errors, pushError, dismiss } = useErrorSystem();
  // ── Hydration (einmalig beim Mount) ──────────────────────────
  useEffect(() => {
(async () => {
  try {
    const data = await storage.loadAll();
    dispatch({ type: 'HYDRATE_ALL', payload: data });
  } catch (e) { pushError(e); }
  dispatch({ type: 'SET_LOADED', payload: true });
})();
  }, []);

  // ── Save functions (alle über storage.Adapter) ────────────────
  const saveItems = useCallback(async n => { dispatch({ type: 'SET_ITEMS', payload: n }); try { await storage.saveItems(n); } catch (e) { pushError(e); } }, [pushError]);
  const saveLog = useCallback(async n => { dispatch({ type: 'SET_LOG', payload: n }); try { await storage.saveLog(n); } catch (e) { pushError(e); } }, [pushError]);
  const saveNotes = useCallback(async n => { dispatch({ type: 'SET_NOTES', payload: n }); try { await storage.saveNotes(n); } catch (e) { pushError(e); } }, [pushError]);
  const saveWishlist = useCallback(async n => { dispatch({ type: 'SET_WISHLIST', payload: n }); try { await storage.saveWishlist(n); } catch (e) { pushError(e); } }, [pushError]);
  const savePrefs = useCallback(async n => { dispatch({ type: 'SET_PREFS', payload: n }); try { await storage.saveSettings({ prefs: n }); } catch (e) { pushError(e); } }, [pushError]);
  const saveUserNotePrefs = useCallback(async n => { dispatch({ type: 'SET_USER_NOTE_PREFS', payload: n }); try { await storage.saveSettings({ userNotePrefs: n }); } catch (e) { pushError(e); } }, [pushError]);
  const saveUserFamilyPrefs = useCallback(async n => { dispatch({ type: 'SET_USER_FAMILY_PREFS', payload: n }); try { await storage.saveSettings({ userFamilyPrefs: n }); } catch (e) { pushError(e); } }, [pushError]);
  const saveFillLevels = useCallback(async n => { dispatch({ type: 'SET_FILL_LEVELS', payload: n }); try { await storage.saveFillLevels(n); } catch (e) { pushError(e); } }, [pushError]);
  const savePriceMl = useCallback(async n => { dispatch({ type: 'SET_PRICE_ML', payload: n }); try { await storage.savePriceMl(n); } catch (e) { pushError(e); } }, [pushError]);

  // Debounced versions for frequent updates (500ms delay)
  const saveItemsDebounced = useMemo(() => debounce(async n => {
try { await storage.saveItems(n); } catch (e) { pushError(e); }
  }, 500), [pushError]);
  const saveLogDebounced = useMemo(() => debounce(async n => {
try { await storage.saveLog(n); } catch (e) { pushError(e); }
  }, 500), [pushError]);
  const saveNotesDebounced = useMemo(() => debounce(async n => {
try { await storage.saveNotes(n); } catch (e) { pushError(e); }
  }, 500), [pushError]);
  const saveFillLevelsDebounced = useMemo(() => debounce(async n => {
try { await storage.saveFillLevels(n); } catch (e) { pushError(e); }
  }, 500), [pushError]);
  const savePriceMlDebounced = useMemo(() => debounce(async n => {
try { await storage.savePriceMl(n); } catch (e) { pushError(e); }
  }, 500), [pushError]);

    const handleImport = useCallback(p => {
const validated = (Array.isArray(p) ? p : []).map(item => sanitizePerfume(item)).map(item => ({
  ...item,
  fillLevel: item.format === "Flakon" ? item.fillLevel : undefined,
})).filter(x => x.name);
saveItems(validated);
  }, [saveItems]);
  const handleAdd = useCallback(p => {
const safe = sanitizePerfume(p);
if (!safe.name) return;
saveItems([...state.items, safe]);
  }, [state.items, saveItems]);
  const handleDelete = useCallback(id => saveItems(state.items.filter(p => p.id !== id)), [state.items, saveItems]);
  const handleUpdate = useCallback((id, ch) => saveItems(state.items.map(p => p.id === id ? sanitizePerfume({ ...p, ...(ch || {}) }) : p)), [state.items, saveItems]);
  const handleLog = useCallback(p => {
const next = [...state.log, { id: p.id, ts: Date.now() }].slice(-1000);
dispatch({ type: 'SET_LOG', payload: next });
// Use immediate save (not debounced) so a log entry is never lost if the
// user closes the app within the 500 ms debounce window.
try { localStorage.setItem(KEYS.log, JSON.stringify(next)); } catch { }
dispatch({ type: 'SET_TOAST', payload: { msg: "✓ Getragen", show: true } });
setTimeout(() => dispatch({ type: 'SET_TOAST', payload: { msg: "", show: false } }), 2000);
  }, [state.log]);
  // Undo: removes the last log entry (for user mistakes)
  const handleUndoLog = useCallback(() => {
if (state.log.length === 0) return;
const next = state.log.slice(0, -1);
dispatch({ type: 'SET_LOG', payload: next });
try { localStorage.setItem(KEYS.log, JSON.stringify(next)); } catch { }
dispatch({ type: 'SET_TOAST', payload: { msg: "✕ Letzter Eintrag entfernt", show: true } });
setTimeout(() => dispatch({ type: 'SET_TOAST', payload: { msg: "", show: false } }), 2000);
  }, [state.log]);
  // Replay: re-logs the last entry (for accidental undo)
  const handleReplayLog = useCallback(() => {
if (state.log.length === 0) return;
const last = state.log[state.log.length - 1];
const next = [...state.log, { id: last.id, ts: Date.now() }].slice(-1000);
dispatch({ type: 'SET_LOG', payload: next });
try { localStorage.setItem(KEYS.log, JSON.stringify(next)); } catch { }
dispatch({ type: 'SET_TOAST', payload: { msg: "✓ Eintrag wiederholt", show: true } });
setTimeout(() => dispatch({ type: 'SET_TOAST', payload: { msg: "", show: false } }), 2000);
  }, [state.log]);
  const handleExport = useCallback(() => downloadTSV(state.items), [state.items]);
  // Full data reset: clears items, log, notes, fill levels, price data.
  // Preserves prefs (app name), API key, and user preference selections.
  const handleClearAllData = useCallback(() => {
saveItems([]);
saveLog([]);
saveNotes({});
saveFillLevels({});
savePriceMl({});
  }, [saveItems, saveLog, saveNotes, saveFillLevels, savePriceMl]);
  const handleSaveNote = useCallback((pid, pnotes) => {
const next = { ...state.notes, [pid]: pnotes };
dispatch({ type: 'SET_NOTES', payload: next });
saveNotesDebounced(next);
  }, [state.notes, saveNotesDebounced]);
  const handleSetAppName = useCallback(name => savePrefs({ ...state.prefs, appName: name }), [state.prefs, savePrefs]);
  const handleSetFill = useCallback((id, level) => {
// STRICT: only allow fill level for Flakons
const item = state.items.find(p => p.id === id);
if (!item || item.format !== "Flakon") return;
const next = level === null ? { ...state.fillLevels } : { ...state.fillLevels, [id]: level };
if (level === null) delete next[id];
dispatch({ type: 'SET_FILL_LEVELS', payload: next });
saveFillLevelsDebounced(next);
  }, [state.items, state.fillLevels, saveFillLevelsDebounced]);
  const handleSavePriceMl = useCallback((id, data) => {
const next = { ...state.priceMl, [id]: data };
dispatch({ type: 'SET_PRICE_ML', payload: next });
savePriceMlDebounced(next);
  }, [state.priceMl, savePriceMlDebounced]);
  const onSaveDeclutterStatus = useCallback(async next => {
dispatch({ type: 'SET_DECLUTTER_STATUS', payload: next });
try { await storage.saveDeclutterStatus(next); } catch (e) { pushError(e); }
  }, [pushError]);

  // Onboarding completion
  const handleOnboardComplete = useCallback(async (data) => {
dispatch({ type: 'SET_SHOW_ONBOARD', payload: false });
try {
  localStorage.setItem(KEYS.onboarding, JSON.stringify({ done: true, data, ts: Date.now() }));
} catch (e) { pushError(e); }
if (data) {
  // Merge: families from explicit family selection + style-mapped families
  const styleFamilies = ONBOARD_STYLES.filter(s => (data.styles || []).includes(s.id)).map(s => s.family);
  const directFamilies = data.favFamilies || [];
  const merged = [...new Set([...directFamilies, ...styleFamilies])];
  savePrefs({ ...state.prefs, favFamilies: merged, favOccs: data.occasions || [] });
  if (merged.length) saveUserFamilyPrefs(merged);
}
  }, [state.prefs, savePrefs, saveUserFamilyPrefs, pushError]);

  // Fill-level warnings for low Flakons
  const lowFillWarnings = useMemo(() =>
state.items.filter(p => p.format === "Flakon" && state.fillLevels[p.id] !== undefined && state.fillLevels[p.id] <= 25)
, [state.items, state.fillLevels]);

  const wishCount = state.wishlist.length;
  const declutterCount = useMemo(() => getDeclutterSuggestions(state.items, state.log).length, [state.items, state.log]);

  const TABS = [
{ id: "heute", l: "HEUTE", i: "☀" },
{ id: "sammlung", l: "SAMMLUNG", i: "✦" },
{ id: "statistik", l: "STATISTIK", i: "◉" },
{ id: "ordner", l: "ORDNER", i: "▤" },
{ id: "layering", l: "LAYERING", i: "✧" },
{ id: "declutter", l: `VERGESSEN`, i: "↺", badge: declutterCount > 0 ? declutterCount : null },
{ id: "wunschliste", l: "WÜNSCHE", i: "♡", badge: wishCount > 0 ? wishCount : null },
{ id: "settings", l: "SETTINGS", i: "⚙" },
  ];

  // App-level detail overlay state
  const appDetailPerfume = state.detail ? state.items.find(x => x.id === state.detail) || null : null;
  const appDetailRef = useRef(null);
  useBodyLock(!!appDetailPerfume || state.showOnboard);

  if (!state.loaded) return (
<div className="app" style={{ alignItems: "center", justifyContent: "center", background: "#FAFAF8" }} role="status" aria-live="polite">
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 32, marginBottom: 16, animation: "breathe 2s ease-in-out infinite" }}>◇</div>
    <div style={{ color: "#888780", fontSize: 13, letterSpacing: "1px", animation: "pulse 2s ease-in-out infinite" }}>Lädt…</div>
  </div>
</div>
  );

  return (
<div className="app">
  {/* Error Banner */}
  <ErrorBanner errors={errors} onDismiss={dismiss} />

  {/* Toast Notification */}
  {state.toast.show && (
    <div style={{
      position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
      background: "#1A1A18", color: "#fff", padding: "12px 24px", borderRadius: 24,
      fontSize: 13, boxShadow: "0 8px 30px rgba(26,26,24,0.3)", zIndex: 9999,
      animation: "fadeIn .3s ease-out"
    }}>
      {state.toast.msg}
    </div>
  )}

  {/* Onboarding Modal */}
  {state.showOnboard && state.items.length === 0 && (
    <Suspense fallback={null}>
      <OnboardingModal onComplete={handleOnboardComplete} />
    </Suspense>
  )}

  <header className="hdr">
    <div>
    <h1 style={{
      fontSize: 20, fontWeight: 400, letterSpacing: "-0.5px", color: "#1A1A18",
      margin: "0 0 14px", display: "flex", alignItems: "baseline", gap: 8
    }}>
      {state.prefs.appName}
      <span style={{ fontSize: 11, color: "#B4B2A9", fontWeight: 400, letterSpacing: "0.5px" }}>
        {state.items.length > 0 ? `${state.items.length} parfüms` : ""}
      </span>
    </h1>
    <Tab.Group
      selectedIndex={Math.max(0, TABS.findIndex(t => t.id === state.tab))}
      onChange={index => {
        const t = TABS[index];
        if (!t) return;
        dispatch({ type: 'SET_DETAIL', payload: null });
        dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) });
        dispatch({ type: 'SET_TAB', payload: t.id });
      }}
    >
      <Tab.List as="nav" className="tabs" aria-label="Hauptnavigation">
        {TABS.map(t => (
          <Tab key={t.id} id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} className={({ selected }) => `${S.tab(selected).className} ui-focus-visible:outline-none`} style={{ whiteSpace: "nowrap", position: "relative" }}>
            <span style={{ marginRight: 1, fontSize: 9 }}>{t.i}</span>{t.l}
            {t.badge && <span style={{
              position: "absolute", top: 1, right: 1, fontSize: 6, background: "#E24B4A", color: "#fff",
              borderRadius: 5, minWidth: 10, height: 10, lineHeight: "10px", textAlign: "center", padding: "0 2px"
            }}>{t.badge}</span>}
          </Tab>
        ))}
      </Tab.List>
    </Tab.Group>
    </div>
  </header>
  <PullToRefresh tabKey={state.tab}>
    <main key={state.tab} className="body animate-in fade-in slide-in-from-bottom-2 duration-200 fill-mode-both" role="tabpanel" id={`panel-${state.tab}`} aria-labelledby={`tab-${state.tab}`}>
      <Suspense fallback={<TabSkeleton />}>
      {state.tab === "heute" && (
        <HeuteTab items={state.items} log={state.log} onLog={handleLog}
          pushError={pushError} prefs={state.prefs} priceMl={state.priceMl}
          userNotePrefs={state.userNotePrefs} userFamilyPrefs={state.userFamilyPrefs}
          onNavigate={id => dispatch({ type: 'SET_TAB', payload: id })}
          onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
      )}
      {state.tab === "sammlung" && (
        <SammlungTab items={state.items} log={state.log} notes={state.notes}
          onDelete={handleDelete} onUpdate={handleUpdate}
          onExport={handleExport} onSaveNote={handleSaveNote} onLog={handleLog}
          fillLevels={state.fillLevels} onSetFill={handleSetFill}
          priceMl={state.priceMl} onSavePriceMl={handleSavePriceMl}
          wishlist={state.wishlist} />
      )}
      {state.tab === "statistik" && (
        <StatistikTab items={state.items} log={state.log} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
      )}
      {state.tab === "ordner" && (
        <OrdnerTab items={state.items} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
      )}
      {state.tab === "layering" && (
        <LayeringTab items={state.items} />
      )}
      {state.tab === "declutter" && (
        <DeclutterTab items={state.items} log={state.log} onDelete={handleDelete} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} declutterStatus={state.declutterStatus} onSaveDeclutterStatus={onSaveDeclutterStatus} />
      )}
      {state.tab === "wunschliste" && (
        <WunschlisteTab wishlist={state.wishlist} onSave={saveWishlist}
          items={state.items} onAddToCollection={handleAdd}
          onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }}
          wishDetailsCache={state.wishDetailsCache} setWishDetailsCache={cache => dispatch({ type: 'SET_WISH_DETAILS_CACHE', payload: cache })}/>
      )}
      {state.tab === "settings" && (
        <EinstellungenTab items={state.items} onImport={handleImport} onExport={handleExport}
          onAdd={handleAdd} onClearAll={() => saveItems([])} onClearAllData={handleClearAllData}
          appName={state.prefs.appName} onSetAppName={handleSetAppName}
          userNotePrefs={state.userNotePrefs} setUserNotePrefs={saveUserNotePrefs}
          userFamilyPrefs={state.userFamilyPrefs} setUserFamilyPrefs={saveUserFamilyPrefs} />
      )}
      </Suspense>
    </main>
  </PullToRefresh>

  {/* App-level detail overlay: für Statistik, Heute, Ordner, Declutter, Wunschliste */}
  {appDetailPerfume && (
    <Suspense fallback={null}>
    <div ref={appDetailRef} style={{ position: "fixed", inset: 0, background: "#FAFAF8", zIndex: 9000, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", animation: "slideInRight .28s cubic-bezier(0.25,0.46,0.45,0.94) both", padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(56px + env(safe-area-inset-bottom))" }}>
      <DetailView perfume={appDetailPerfume} items={state.items} log={state.log} notes={state.notes}
        onClose={() => dispatch({ type: 'SET_DETAIL', payload: null })} onDelete={handleDelete}
        onUpdate={handleUpdate} onSaveNote={handleSaveNote} onLog={handleLog}
        onSearchNote={() => dispatch({ type: 'SET_DETAIL', payload: null })}
        fillLevels={state.fillLevels || {}} onSetFill={handleSetFill}
                        priceMl={state.priceMl || {}} onSavePriceMl={handleSavePriceMl}
        containerRef={appDetailRef} declutterStatus={state.declutterStatus} onSaveDeclutterStatus={onSaveDeclutterStatus} />
    </div>
    </Suspense>
  )}
</div>
);
}
export default App;
export { AppErrorBoundary };