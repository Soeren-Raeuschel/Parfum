import ReactDOM from "react-dom"; // Fix: ReactDOM.createPortal wurde verwendet, aber nicht importiert
// Chart.js wird lazy geladen (siehe loadChart unten) → kleinerer Initial-Bundle
import React, { useState, useEffect, useMemo, useCallback, useRef, useReducer, lazy, Suspense } from "react";
import { Combobox, Dialog, Disclosure, Tab } from "@headlessui/react";
import { storage } from "./data/storage";
import { newId, sanitizePerfume, ONBOARD_STYLES } from "./data/localAdapter"; // Fix: newId/sanitizePerfume/ONBOARD_STYLES wurden verwendet, aber nicht importiert (lokale Definitionen waren auskommentiert)
import { List as FixedSizeListVirtual, useDynamicRowHeight } from "react-window";
import { AppError, recordError, InvalidResponseError, ApiError, NetworkError, RateLimitError } from "./utils/errorHandler"; // Fix: ApiError/NetworkError/RateLimitError wurden in groqFetch verwendet, aber nicht importiert → "Can't find variable: ApiError"
import { FileUpload } from "./components/ui/file-upload";
import EvolveCard from "./components/EvolveCard";
import { AiSparkle } from "./components/AiSparkle";
import { splitNotes } from "./utils/helpers";
import { stripDiacritics, normalizeText, tokenizeText } from "./utils/perfumeMatch"; // Fix: normalizeText/stripDiacritics/tokenizeText wurden verwendet, aber nicht importiert → "Can't find variable: normalizeText"

import { getWearMap, recordWear, recordFeedback, feedbackContextKey, getPersonalBonusMap } from "./picker/wearStore";
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
import { S, FamilyPill, MiniBar, Stars, useBodyLock } from "./shared/ui";
import {
  KEYS, SEASON_COLORS, FAM_COLORS, NOTE_TAGS, WISH_PRIOS, getSeasonColor,
  FAMILIES, SEASONS, NOTE_CATEGORIES, NOTE_CAT_COLORS, CONC_COLORS, NOTE_TO_CAT,
  validateParfumoLookupUrl, extrahiereBrandName, primaryFamily,
} from "./shared/constants";
import { getDeclutterSuggestions } from "./shared/declutter";

// ── Lazy geladene Ansichten (Code-Splitting: eine Ansicht = ein Chunk) ──────
const StatistikTab = lazy(() => import("./tabs/StatistikTab"));
const OrdnerTab = lazy(() => import("./tabs/OrdnerTab"));
const WunschlisteTab = lazy(() => import("./tabs/WunschlisteTab"));
const LayeringTab = lazy(() => import("./tabs/LayeringTab"));
const DeclutterTab = lazy(() => import("./tabs/DeclutterTab"));
const EinstellungenTab = lazy(() => import("./tabs/EinstellungenTab"));
const OnboardingModal = lazy(() => import("./tabs/OnboardingModal"));




// ── Debounce helper ─────────────────────────────────────────────────────────────
function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

// ── Enhanced API Response Cache (TTL-basiert mit LRU-Eviction und Prefetching) ─────
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 Minuten
const MAX_CACHE_SIZE = 200; // Maximale Anzahl an Einträgen im Speicher
const CACHE_STORAGE_KEY = 'parfum_api_cache_v2';
// Lazy-load cache persistence - wird erst verwendet, wenn nötig
let _cacheStorage = null;
function _getCacheStorage() {
  if (_cacheStorage !== null) return _cacheStorage;
  try {
    const stored = localStorage.getItem(CACHE_STORAGE_KEY);
    if (stored) {
      _cacheStorage = new Map(JSON.parse(stored));
      const now = Date.now();
      let toDelete = 0;
      _cacheStorage.forEach((entry) => {
        if (now - entry.timestamp > CACHE_TTL) toDelete++;
      });
      if (toDelete > 0) {
        const arr = Array.from(_cacheStorage.entries());
        const kept = arr.filter(([, entry]) => now - entry.timestamp <= CACHE_TTL);
        _cacheStorage = new Map(kept);
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
      }
    } else {
      _cacheStorage = new Map();
    }
  } catch {
    _cacheStorage = new Map();
  }
  return _cacheStorage;
}

// Persistenz entprellen: viele schnelle Cache-Updates führen zu genau einem
// localStorage-Write (synchrones localStorage ist auf iOS/Safari teuer)
let _persistTimer = null;
function persistCache() {
  if (_persistTimer) return; // Es ist bereits ein Write geplant
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
    } catch {
      // Speicherversuche ignorieren
    }
  }, 1000);
}

// Bei Verlassen der Seite oder Tab-Wechsel den noch anstehenden Write sofort ausführen
if (typeof window !== "undefined") {
  const flushPendingCache = () => {
    if (!_persistTimer) return;
    clearTimeout(_persistTimer);
    _persistTimer = null;
    if (_cacheStorage && _cacheStorage.size > 0) {
      try {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
      } catch {
        // Speicherversuche ignorieren
      }
    }
  };
  window.addEventListener("pagehide", flushPendingCache);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPendingCache();
  });
}

// Sichert den Cache-Eintrag und fügt ihn hinzu, wenn er noch nicht vorhanden ist
function ensureCache(key, data) {
  const now = Date.now();
  const stored = apiCache.get(key);
  if (stored && now - stored.timestamp <= CACHE_TTL) {
    return;
  }
  const entry = { data, timestamp: now };
  apiCache.set(key, entry);
  const storage = _getCacheStorage();
  storage.set(key, entry);
  persistCache();
  // Wenn der Cache zu groß wird, verwende LRU-Eviction
  if (apiCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(apiCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // Älteste zuerst
    const toRemove = entries.slice(0, apiCache.size - Math.floor(MAX_CACHE_SIZE * 0.8)); // Entferne 20%
    toRemove.forEach(([k]) => {
      apiCache.delete(k);
      _getCacheStorage().delete(k);
    });
    persistCache();
  }
}

// Verbesserter cachedFetch mit Speicher und localStorage-Backup
function cachedFetch(key, fetchFn) {
  const now = Date.now();
  const memory = apiCache.get(key);
  if (memory && now - memory.timestamp <= CACHE_TTL && !(memory.data && memory.data.error)) {
    console.log('INFO', 'Using cached API data for key', key);
    return Promise.resolve(memory.data);
  }
  const storage = _getCacheStorage();
  const stored = storage.get(key);
  if (stored && now - stored.timestamp <= CACHE_TTL && !(stored.data && stored.data.error)) {
    // Cache aus localStorage in den Memory-Cache laden
    apiCache.set(key, stored);
    console.log('INFO', 'Using cached API data from storage for key', key);
    return Promise.resolve(stored.data);
  }
  return fetchFn().then(result => {
    ensureCache(key, result);
    return result;
  });
}


function clearApiCache() {
  apiCache.clear();
  const storage = _getCacheStorage();
  storage.clear();
  persistCache();
  console.log('INFO', 'API cache cleared');
}

// ── Storage keys ───────────────────────────────────────────────────────────────
// Parfumo-Lookup: Groq-API (kostenlos: console.groq.com) – Key in Settings oder window.__SILLAGE_GROQ_KEY__

// ── Design tokens ─────────────────────────────────────────────────────────────

// ── Season / color helpers ────────────────────────────────────────────────────
// For southern hemisphere users, seasons would be inverted – not currently supported.
function getSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return "Frühling";
  if (m >= 6 && m <= 8) return "Sommer";
  if (m >= 9 && m <= 11) return "Herbst";
  return "Winter";
}

// ── Scoring constants ─────────────────────────────────────────────────────────
// ── FAMILY CONTEXT MAPPING ─────────────────────────────────────────────────
// Maps families to their best contexts (season, weather, occasion, time, mood)
const FAMILY_CONTEXT = {
  Floral: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "cloudy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Woody: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["work", "evening", "date"], times: ["evening", "night"], moods: ["confident", "mysterious", "calm"] },
  Oriental: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["romantic", "confident", "mysterious"] },
  Fresh: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "outdoor"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Chypre: { seasons: ["Herbst", "Winter", "Ganzjährig"], weather: ["cold", "rainy", "cloudy"], occasions: ["work", "evening", "outdoor"], times: ["afternoon", "evening"], moods: ["confident", "mysterious", "calm"] },
  "Fougère": { seasons: ["Ganzjährig"], weather: ["cloudy", "rainy"], occasions: ["work", "casual"], times: ["morning", "afternoon"], moods: ["confident", "calm"] },
  Gourmand: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["playful", "romantic", "calm"] },
  Aquatisch: { seasons: ["Sommer", "Frühling"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "vacation"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Süß: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["playful", "romantic"] },
  Würzig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["confident", "mysterious"] },
  Grün: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "cloudy"], occasions: ["casual", "sport", "outdoor"], times: ["morning", "afternoon"], moods: ["calm", "energetic", "playful"] },
  Animalisch: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "night"], times: ["evening", "night"], moods: ["confident", "mysterious", "romantic"] },
  Harzig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "work"], times: ["afternoon", "evening"], moods: ["confident", "calm"] },
  Rauchig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["mysterious", "confident"] },
  Pudrig: { seasons: ["Ganzjährig"], weather: ["cloudy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Zitrisch: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "outdoor"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Erdig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["work", "evening", "outdoor"], times: ["afternoon", "evening"], moods: ["confident", "calm", "mysterious"] },
  Cremig: { seasons: ["Herbst", "Winter"], weather: ["cold"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Fruchtig: { seasons: ["Sommer", "Frühling"], weather: ["sunny", "hot"], occasions: ["casual", "date", "vacation"], times: ["afternoon", "evening"], moods: ["playful", "energetic", "romantic"] },
  Synthetisch: { seasons: ["Ganzjährig"], weather: ["cloudy", "sunny"], occasions: ["casual", "work", "sport"], times: ["morning", "afternoon"], moods: ["confident", "energetic"] },
  Sonstiges: { seasons: ["Ganzjährig"], weather: ["cloudy"], occasions: ["casual"], times: ["afternoon"], moods: ["calm"] },
};

const FAMILY_HARMONY = {
  Floral: ["Süß", "Pudrig", "Cremig", "Grün"],
  Woody: ["Harzig", "Animalisch", "Rauchig", "Erdig"],
  Oriental: ["Süß", "Würzig", "Harzig", "Animalisch"],
  Fresh: ["Zitrisch", "Aquatisch", "Grün", "Cremig"],
  Chypre: ["Woody", "Fougère", "Animalisch", "Grün"],
  "Fougère": ["Chypre", "Grün", "Harzig", "Cremig"],
  Gourmand: ["Süß", "Cremig", "Fruchtig", "Pudrig"],
  Aquatisch: ["Fresh", "Zitrisch", "Grün", "Cremig"],
  Süß: ["Gourmand", "Floral", "Cremig", "Pudrig"],
  Würzig: ["Oriental", "Harzig", "Rauchig", "Animalisch"],
  Grün: ["Fresh", "Aquatisch", "Zitrisch", "Chypre"],
  Animalisch: ["Oriental", "Woody", "Würzig", "Chypre"],
  Harzig: ["Woody", "Oriental", "Fougère", "Würzig"],
  Rauchig: ["Woody", "Oriental", "Würzig", "Animalisch"],
  Pudrig: ["Floral", "Süß", "Gourmand", "Cremig"],
  Zitrisch: ["Fresh", "Aquatisch", "Grün", "Fruchtig"],
  Erdig: ["Woody", "Chypre", "Harzig", "Rauchig"],
  Cremig: ["Gourmand", "Floral", "Süß", "Aquatisch"],
  Fruchtig: ["Gourmand", "Fresh", "Süß", "Zitrisch"],
  Synthetisch: ["Fresh", "Aquatisch", "Woody", "Oriental"],
};

const FAMILY_CONFLICT = {
  Aquatisch: ["Rauchig", "Animalisch", "Würzig"],
  Zitrisch: ["Animalisch", "Rauchig", "Harzig"],
  Süß: ["Animalisch", "Rauchig", "Zitrisch"],
  Fresh: ["Würzig", "Rauchig", "Animalisch"],
};

function getFamilyContextScore(family, ctx) {
  const fc = FAMILY_CONTEXT[family];
  if (!fc) return 0;
  let score = 0;
  if (fc.seasons?.includes(ctx.season)) score += 3;
  if (fc.weather?.includes(ctx.weather)) score += 3;
  if (fc.occasions?.includes(ctx.occasion)) score += 4;
  if (fc.times?.includes(ctx.timeOfDay)) score += 2;
  if (fc.moods?.includes(ctx.mood)) score += 3;
  return score;
}

function getFamilyHarmonyScore(perfumeFamilies, userFamilyPrefs) {
  if (!perfumeFamilies || perfumeFamilies.length === 0) return 0;
  if (!userFamilyPrefs || userFamilyPrefs.length === 0) return 0;
  let harmony = 0, conflict = 0;
  for (const pf of perfumeFamilies) {
    const good = FAMILY_HARMONY[pf] || [];
    const bad = FAMILY_CONFLICT[pf] || [];
    for (const uf of userFamilyPrefs) {
      if (good.includes(uf)) harmony += 3;
      if (bad.includes(uf)) conflict += 2;
    }
  }
  return Math.max(0, harmony - conflict);
}

function getMultiFamilyMatchScore(perfumeFamilies, userFamilyPrefs) {
  if (!perfumeFamilies || perfumeFamilies.length === 0) return 0;
  if (!userFamilyPrefs || userFamilyPrefs.length === 0) return 0;
  const matches = perfumeFamilies.filter(f => userFamilyPrefs.includes(f)).length;
  if (matches >= 3) return 20;
  if (matches === 2) return 12;
  if (matches === 1) return 5;
  return 0;
}

const MOODS = [
  { id: "energetic", label: "Energetisch", icon: "⚡", families: ["Fresh", "Aquatisch", "Gourmand"] },
  { id: "romantic", label: "Romantisch", icon: "♥", families: ["Floral", "Oriental", "Gourmand"] },
  { id: "confident", label: "Selbstsicher", icon: "★", families: ["Woody", "Chypre", "Oriental"] },
  { id: "calm", label: "Entspannt", icon: "◎", families: ["Aquatisch", "Fresh", "Floral"] },
  { id: "mysterious", label: "Geheimnisvoll", icon: "◆", families: ["Oriental", "Chypre", "Woody"] },
  { id: "playful", label: "Verspielt", icon: "◇", families: ["Gourmand", "Fresh", "Floral"] },
  { id: "sleep", label: "Schlafen", icon: "◑", families: ["Floral", "Fresh", "Gourmand"], isSleep: true },
];
const TIMES = [
  { id: "morning", label: "Morgens", families: ["Fresh", "Aquatisch", "Floral"] },
  { id: "afternoon", label: "Mittags", families: ["Fresh", "Chypre", "Woody"] },
  { id: "evening", label: "Abends", families: ["Oriental", "Woody", "Gourmand"] },
  { id: "night", label: "Nachts", families: ["Oriental", "Chypre", "Woody"] },
];
const WEATHERS = [
  { id: "sunny", label: "Sonnig", families: ["Fresh", "Aquatisch", "Floral"] },
  { id: "cloudy", label: "Bewölkt", families: ["Chypre", "Woody", "Fougère"] },
  { id: "rainy", label: "Regen", families: ["Oriental", "Woody", "Gourmand"] },
  { id: "cold", label: "Kalt", families: ["Oriental", "Gourmand", "Woody"] },
  { id: "hot", label: "Heiß", families: ["Fresh", "Aquatisch", "Floral"] },
];
const OCCASIONS = [
  { id: "casual", label: "Alltag", icon: "☀" },
  { id: "work", label: "Business", icon: "◈" },
  { id: "date", label: "Date", icon: "♥" },
  { id: "evening", label: "Abend", icon: "★" },
  { id: "sport", label: "Sport", icon: "◎" },
  { id: "special", label: "Special", icon: "◆" },
  { id: "outdoor", label: "Outdoor", icon: "◉" },
  { id: "travel", label: "Reise", icon: "→" },
  { id: "vacation", label: "Urlaub", icon: "✦" },
  { id: "sleep", label: "Schlafen", icon: "◑", isSleep: true },
];
const INTENSITIES = [
  { id: "light", label: "Leicht", note: "Subtil & nah" },
  { id: "medium", label: "Mittel", note: "Ausgewogen" },
  { id: "strong", label: "Stark", note: "Projizierend" },
];
const LONGEVITIES = [
  { id: "short", label: "2–4h", note: "Kurz" },
  { id: "medium", label: "4–8h", note: "Normal" },
  { id: "long", label: "8h+", note: "Langanhaltend" },
];
// ── Occasion → ideal families ────────────────────────────────────────────────
const OCC_FAM = {
  casual: { pri: ["Fresh", "Aquatisch", "Floral"], sec: ["Woody", "Chypre"] },
  work: { pri: ["Woody", "Chypre", "Fougère"], sec: ["Fresh", "Floral"] },
  date: { pri: ["Oriental", "Floral", "Gourmand"], sec: ["Woody", "Chypre"] },
  evening: { pri: ["Oriental", "Woody", "Gourmand"], sec: ["Chypre", "Floral"] },
  sport: { pri: ["Fresh", "Aquatisch"], sec: ["Floral", "Fougère"] },
  special: { pri: ["Oriental", "Chypre", "Floral"], sec: ["Woody", "Gourmand"] },
  outdoor: { pri: ["Fresh", "Aquatisch", "Chypre"], sec: ["Woody", "Floral"] },
  travel: { pri: ["Fresh", "Woody", "Oriental"], sec: ["Aquatisch", "Floral"] },
  vacation: { pri: ["Fresh", "Aquatisch", "Floral"], sec: ["Gourmand", "Oriental"] },
  sleep: { pri: ["Floral", "Fresh", "Aquatisch"], sec: ["Gourmand", "Woody"] },
};

// Concentration → perceived intensity (1–3) and longevity (1–3)
const CONC_INT = { Parfum: 3, Extrait: 3, EDP: 2.5, EDT: 1.5, EDC: 1, Solid: 1 };
const CONC_LON = { Parfum: 3, Extrait: 3, EDP: 2.5, EDT: 2, EDC: 1.5, Solid: 1 };

// ── Duftpsychologie: Note → Wirkung (0–1 Stärke) ─────────────────────────────
// Quellen: Aromatherapie-Forschung, Fragrance Psychology (Herz, 2009)
const NOTE_PSYCHOLOGY = {
  // ENTSPANNEND / Beruhigend
  calm: {
    "lavendel": 1.0, "vanille": 0.95, "tonkabohne": 0.9, "sandelholz": 0.9,
    "vetiver": 0.85, "zedernholz": 0.8, "patschuli": 0.75, "weihrauch": 0.85,
    "myrrhe": 0.8, "benzoe": 0.8, "ylang-ylang": 0.75, "kamille": 1.0,
    "bergamotte": 0.7, "ambra": 0.7, "moschus": 0.65, "rose": 0.7,
    "iris": 0.65, "jasmin": 0.6, "labdanum": 0.75, "rum": 0.5,
    "holz": 0.6, "bourbon-vanille absolue": 0.95,
  },
  // ENERGETISIEREND / Belebend
  energetic: {
    "bergamotte": 0.9, "zitrone": 1.0, "grapefruit": 0.95, "limette": 0.9,
    "orange": 0.85, "mandarine": 0.8, "neroli": 0.75, "ingwer": 0.9,
    "pfeffer": 0.85, "rosa pfeffer": 0.8, "minze": 0.95, "eukalyptus": 0.9,
    "kardamom": 0.75, "petitgrain": 0.7, "kümmel": 0.7, "zitrusfrüchte": 0.9,
    "pomelo": 0.85, "yuzu": 0.85, "blutorange": 0.8,
  },
  // SINNLICH / Romantisch
  romantic: {
    "rose": 1.0, "jasmin": 0.95, "ylang-ylang": 0.9, "sandelholz": 0.85,
    "oud": 0.8, "ambra": 0.85, "vanille": 0.8, "moschus": 0.75,
    "patschuli": 0.7, "iris": 0.7, "safran": 0.8, "tonkabohne": 0.75,
    "labdanum": 0.8, "zimt": 0.7, "nelke": 0.65,
  },
  // SERIÖS / Selbstsicher
  confident: {
    "zedernholz": 1.0, "vetiver": 0.95, "sandelholz": 0.9, "eichenmoos": 0.85,
    "holz": 0.85, "leder": 0.9, "tabak": 0.8, "iris": 0.8, "patschuli": 0.75,
    "weihrauch": 0.75, "myrrhe": 0.7, "bergamotte": 0.65, "ambra": 0.6,
  },
  // VERSPIELT / Leicht
  playful: {
    "frucht": 0.85, "karamell": 0.9, "vanille": 0.8, "kokos": 0.85,
    "mandarine": 0.8, "orange": 0.75, "kirsche": 0.9, "beere": 0.85,
    "mango": 0.85, "ananas": 0.8, "himbeere": 0.85, "jasmin": 0.6,
    "maiglöckchen": 0.7, "veilchen": 0.75, "tonkabohne": 0.65,
  },
  // GEHEIMNISVOLL / Tiefgründig
  mysterious: {
    "oud": 1.0, "weihrauch": 0.95, "myrrhe": 0.9, "ambra": 0.85,
    "leder": 0.85, "tabak": 0.8, "patschuli": 0.8, "labdanum": 0.9,
    "safran": 0.85, "benzoe": 0.8, "zimt": 0.7, "nelke": 0.75,
    "rum": 0.7, "holz": 0.6, "vetiver": 0.75,
  },
  // SCHLAFEN / Nachtruhe
  // Quellen: Aromatherapie-Schlafforschung (Goel et al. 2005, Field et al. 2008)
  sleep: {
    // Stark schlaffördernd (klinisch belegt)
    "lavendel": 1.0, "kamille": 1.0, "baldrian": 0.95,
    // Beruhigend, entspannend
    "vanille": 0.9, "sandelholz": 0.88, "tonkabohne": 0.85, "benzoe": 0.85,
    "vetiver": 0.82, "moschus": 0.8, "ambra": 0.75, "ylang-ylang": 0.78,
    "weihrauch": 0.80, "patschuli": 0.70, "zedernholz": 0.72,
    // Mild blumig / frisch (nicht aufdringlich)
    "rose": 0.65, "neroli": 0.70, "jasmin": 0.60, "bergamotte": 0.65,
    "iris": 0.60, "veilchen": 0.65, "maiglöckchen": 0.55,
    // Leicht süß / warm
    "honig": 0.70, "litschi": 0.55, "bourbon-vanille absolue": 0.90,
    // Schlechte Schlafnoten (aufdringlich, aufweckend)
    "pfeffer": -0.3, "ingwer": -0.3, "minze": -0.4, "eukalyptus": -0.3,
    "zitrone": -0.2, "grapefruit": -0.2, "kardamom": -0.1,
    "oud": -0.1, "leder": -0.2, "tabak": -0.2, "rum": -0.2,
  },
};

// Score a perfume's notes against a psychology profile
// Returns a value that can be negative (e.g. sleep-disrupting notes reduce the score).
// Positive values: note supports the profile. Negative values: note works against it.
// The raw sum is divided by allNotes.length so the scale stays comparable across
// perfumes with different numbers of notes.
function notePsychologyScore(perfume, profile) {
  const dict = NOTE_PSYCHOLOGY[profile] || {};
  const allNotes = [
    ...splitNotes(perfume.top),
    ...splitNotes(perfume.middle),
    ...splitNotes(perfume.base),
  ];
  if (!allNotes.length) return 0;
  let total = 0, anyHit = false;
  for (const note of allNotes) {
    const key = note.toLowerCase().trim();
    // Direct match or partial match – includes negative values (e.g. sleep: pfeffer: -0.3)
    const val = dict[key] ?? Object.entries(dict).find(([k]) => key.includes(k) || k.includes(key))?.[1] ?? 0;
    if (val !== 0) { total += val; anyHit = true; }
  }
  return anyHit ? total / allNotes.length : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPFEHLUNGS-ENGINE v4
// Score-Architektur:
//   BASIS-SCORE        (0–50): Saison · Anlass · Wetter · Tageszeit
//   KONTEXT-MULT       (×1.0–1.4): Kohärente Kombis verstärken
//   PSYCHO-SCORE       (0–20): Note-Wirkung zur Stimmung
//   HARMONY-BONUS      (0–10): Alle Parameter passen zusammen
//   ROTATION-BONUS     (0–10): Lange nicht getragen → bevorzugen
//   BEWERTUNGS-BONUS   (0–6):  Persönliche Qualität
//   KONFLIKT-MALUS     (−10–0): Unlogische Kombis bestrafen
//   RANDOMNESS         (0–3):  Tiebreaker / Wildcard-Variation
// ══════════════════════════════════════════════════════════════════════════════

// ── Konflikt-Definitionen ────────────────────────────────────────────────────
// [occasion, intensityPref/family, Grund] → Malus
const CONFLICTS = [
  // Sport + starke Projektion
  { check: (p, ctx) => ctx.occasion === "sport" && (CONC_INT[p.conc] || 2) > 2, malus: 10, reason: "Zu intensiv für Sport" },
  // Büro + Oud/Oriental
  { check: (p, ctx) => ctx.occasion === "work" && p.family === "Oriental" && (CONC_INT[p.conc] || 2) >= 2.5, malus: 8, reason: "Zu schwer für Büro" },
  // Morgens + schwere Orientalische
  { check: (p, ctx) => ctx.timeOfDay === "morning" && p.family === "Oriental" && (CONC_INT[p.conc] || 2) === 3, malus: 6, reason: "Zu intensiv für morgens" },
  // Heiß + Gourmand/Oriental EDP/Parfum
  { check: (p, ctx) => ctx.weather === "hot" && ["Oriental", "Gourmand"].includes(p.family) && (CONC_INT[p.conc] || 2) >= 2.5, malus: 7, reason: "Zu warm für heißes Wetter" },
  // Sport + Gourmand
  { check: (p, ctx) => ctx.occasion === "sport" && p.family === "Gourmand", malus: 6, reason: "Gourmand ungeeignet für Sport" },
  // Schlafen + starke Projektion (EDP/Parfum)
  { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) >= 2.5, malus: 12, reason: "Zu intensiv zum Schlafen" },
  // Schlafen + Oriental stark (Oud etc.)
  { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && p.family === "Oriental" && (CONC_INT[p.conc] || 2) >= 2, malus: 8, reason: "Zu schwer für Schlafzimmer" },
];

// ── Harmony-Kombis (Bonus wenn mehrere passen) ───────────────────────────────
const HARMONY_COMBOS = [
  // Frisch + Sonnig + Sommer/Frühling
  { check: (p, ctx) => ["Fresh", "Aquatisch"].includes(p.family) && ["sunny", "hot"].includes(ctx.weather) && ["Sommer", "Frühling"].includes(ctx.season), bonus: 10 },
  // Oriental + Kalt + Abend
  { check: (p, ctx) => ["Oriental", "Woody"].includes(p.family) && ["cold", "rainy"].includes(ctx.weather) && ["evening", "night"].includes(ctx.timeOfDay), bonus: 10 },
  // Business + Chypre/Fougère + Mittel-Intensität
  { check: (p, ctx) => ctx.occasion === "work" && ["Chypre", "Fougère", "Woody"].includes(p.family) && ctx.intensityPref === "medium", bonus: 8 },
  // Date + Romantisch + Abend
  { check: (p, ctx) => ctx.occasion === "date" && ctx.mood === "romantic" && ["evening", "night"].includes(ctx.timeOfDay), bonus: 8 },
  // Sport + Fresh + Morgens
  { check: (p, ctx) => ctx.occasion === "sport" && ["Fresh", "Aquatisch"].includes(p.family) && ctx.timeOfDay === "morning", bonus: 9 },
  // Entspannt + Woody/Floral + Bewölkt
  { check: (p, ctx) => ctx.mood === "calm" && ["Woody", "Floral"].includes(p.family) && ctx.weather === "cloudy", bonus: 6 },
  // Outdoor + Chypre + Bewölkt/Kalt
  { check: (p, ctx) => ctx.occasion === "outdoor" && p.family === "Chypre" && ["cloudy", "cold"].includes(ctx.weather), bonus: 7 },
  // Gourmand + Winter + Abend
  { check: (p, ctx) => p.family === "Gourmand" && ctx.season === "Winter" && ["evening", "night"].includes(ctx.timeOfDay), bonus: 8 },
  // Schlafen + Lavendel/Vanille + leichte Konzentration
  { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) <= 1.5, bonus: 12 },
  // Schlafen + Floral/Fresh + Nacht
  { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && ["Floral", "Fresh", "Aquatisch"].includes(p.family) && ctx.timeOfDay === "night", bonus: 8 },
  // Urlaub + Sommer + Fresh/Aquatisch/Gourmand
  { check: (p, ctx) => ctx.occasion === "vacation" && ctx.season === "Sommer" && ["Fresh", "Aquatisch", "Floral"].includes(p.family), bonus: 9 },
  // Urlaub + Oriental/Woody (abendlicher Urlaubs-Look)
  { check: (p, ctx) => ctx.occasion === "vacation" && ["evening", "night"].includes(ctx.timeOfDay) && ["Oriental", "Woody", "Gourmand"].includes(p.family), bonus: 7 },
];

// ── Kontext-Multiplikatoren ──────────────────────────────────────────────────
const CONTEXT_MULTIPLIERS = [
  { check: (p, ctx) => ctx.occasion === "work" && (CONC_INT[p.conc] || 2) <= 1.5, mult: 1.35, label: "Subtil – ideal im Büro" },
  { check: (p, ctx) => ctx.occasion === "date" && ctx.mood === "romantic" && ["Oriental", "Floral"].includes(p.family), mult: 1.35, label: "Romantisch · sinnlich" },
  { check: (p, ctx) => ctx.occasion === "sport" && (CONC_INT[p.conc] || 2) <= 1.5 && ["Fresh", "Aquatisch"].includes(p.family), mult: 1.4, label: "Frisch & leicht – perfekt für Sport" },
  { check: (p, ctx) => ctx.occasion === "special" && (p.rating || 0) >= 4, mult: 1.3, label: "Bewährt für besondere Anlässe" },
  { check: (p, ctx) => ctx.occasion === "evening" && (CONC_INT[p.conc] || 2) >= 2.5, mult: 1.25, label: "Starke Projektion für den Abend" },
  { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) <= 1.5 && ["Floral", "Fresh"].includes(p.family), mult: 1.4, label: "Sanft & beruhigend – ideal zum Einschlafen" },
  { check: (p, ctx) => ctx.occasion === "vacation" && (p.rating || 0) >= 4, mult: 1.2, label: "Bewährter Urlaubs-Duft" },
];

// ── Rotation-Logik ───────────────────────────────────────────────────────────
function rotationBonus(p, log) {
  const wears = log.filter(l => l.id === p.id);
  if (wears.length === 0) return 8; // noch nie getragen → stark bevorzugen
  // reduce statt Math.max(...spread): Stack Overflow bei sehr vielen Einträgen (vgl. StatistikTab)
  const lastWorn = wears.reduce((m, l) => Math.max(m, l.ts), 0);
  const daysSince = (Date.now() - lastWorn) / 86400000;
  if (daysSince > 30) return 10;   // >30 Tage → max Bonus
  if (daysSince > 14) return 7;
  if (daysSince > 7) return 4;
  if (daysSince > 3) return 1;
  return 0;                         // < 3 Tage → kein Bonus
}

// ── Wiederholungs-Malus (letzte 3 Tage getragen → stark bestrafen) ───────────
function recencyMalus(p, log) {
  const recent = log.filter(l => l.id === p.id && (Date.now() - l.ts) < 3 * 86400000);
  return recent.length * 8; // -8 pro Trag in den letzten 3 Tagen
}

// ── Begründungs-Generator ────────────────────────────────────────────────────
function buildReason(p, ctx, role, log) {
  const parts = [];
  const fam = p.family || "Sonstiges";

  // Rolle
  if (role === "top1") parts.push("Bestes Match heute");
  else if (role === "top2") parts.push("Starke Alternative");
  else if (role === "top3") parts.push("Sehr gut geeignet");
  else if (role === "alt1") parts.push("Gute Option");
  else if (role === "alt2") parts.push("Solide Wahl");
  else if (role === "wildcard") parts.push("Überraschungsvorschlag");

  // Kontext-Match
  const occ = OCC_FAM[ctx.occasion];
  if (occ?.pri.includes(fam)) parts.push(`${fam} passt ideal zum Anlass`);
  else if (occ?.sec.includes(fam)) parts.push(`${fam} funktioniert gut hier`);

  // Wetter
  const wx = WEATHERS.find(w => w.id === ctx.weather);
  if (wx?.families.includes(fam)) {
    // Build grammatically correct German: "sonnigem", "bewölktem", "regnerischem", etc.
    const weatherAdj = { sunny: "sonnigem", cloudy: "bewölktem", rainy: "regnerischem", cold: "kaltem", hot: "heißem" };
    const adj = weatherAdj[ctx.weather] || wx.label.toLowerCase() + "em";
    parts.push(`Harmoniert mit ${adj} Wetter`);
  }

  // Stimmung / Psychologie
  const moodToProfile = { calm: "calm", energetic: "energetic", romantic: "romantic", confident: "confident", playful: "playful", mysterious: "mysterious", sleep: "sleep" };
  const profile = moodToProfile[ctx.mood];
  const psychVal = notePsychologyScore(p, profile);
  if (psychVal > 0.5) {
    const moodLabel = MOODS.find(m => m.id === ctx.mood)?.label || ctx.mood;
    parts.push(`Duftnoten wirken ${moodLabel.toLowerCase()}`);
  }

  // Rotation
  const wears = log.filter(l => l.id === p.id);
  if (wears.length === 0) parts.push("Noch nie getragen – ideale Gelegenheit");
  else {
    const daysSince = (Date.now() - wears.reduce((m, l) => Math.max(m, l.ts), 0)) / 86400000;
    if (daysSince > 14) parts.push(`Zuletzt vor ${Math.round(daysSince)} Tagen`);
  }

  // Bewertung
  if ((p.rating || 0) >= 4) parts.push(`Du hast es mit ${p.rating}★ bewertet`);

  // Wildcard-Hinweis
  if (role === "wildcard") parts.push("Probier mal etwas anderes!");

  return parts.slice(0, 3).join(" · ");
}

// ── HAUPT-SCORING-FUNKTION ───────────────────────────────────────────────────
function score(p, ctx) {
  const { season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, log, userNotePrefs, userFamilyPrefs } = ctx;
  const fam = p.family || "Sonstiges";
  const ps = (p.season || "").toLowerCase();
  let s = 0;

  // ── BASIS-SCORE (0–50) ───────────────────────────────────────────────────
  // Saison (0–15)
  if (ps.includes(season.toLowerCase())) s += 15;
  else if (ps.includes("ganzjährig")) s += 11;
  else s += 2;

  // Anlass (0–14)
  const occ = OCC_FAM[occasion] || { pri: [], sec: [] };
  if (occ.pri.includes(fam)) s += 14;
  else if (occ.sec.includes(fam)) s += 7;

  // Wetter (0–10)
  const wx = WEATHERS.find(w => w.id === weather);
  if (wx?.families.includes(fam)) s += 10;

  // Tageszeit (0–6)
  const tx = TIMES.find(t => t.id === timeOfDay);
  if (tx?.families.includes(fam)) s += 6;

  // Intensität (0–5)
  const ci = CONC_INT[p.conc] || 2;
  const ip = intensityPref === "light" ? 1 : intensityPref === "strong" ? 3 : 2;
  s += Math.max(0, 5 - Math.abs(ci - ip) * 2);

  // ── BENUTZER-PRÄFERENZEN (Duftnoten & Familien) ───────────────────────────
  // Get perfume families (from array or fallback to single family)
  const perfumeFamilies = (p.families && p.families.length > 0) ? p.families : [fam];
  const mainFamily = perfumeFamilies[0] || "Sonstiges";

  // #8: Prioritäts-Gewichtung der Duftfamilien
  // Position 0 (Hauptfamilie) = volle Gewichtung
  // Position 1 (2. Familie)   = halbe Gewichtung
  // Position 2 (3. Familie)   = Viertel-Gewichtung
  const FAMILY_PRIORITY_WEIGHTS = [1.0, 0.5, 0.25];

  // Main family match (primary family gets extra weight) (0-15)
  if (userFamilyPrefs && userFamilyPrefs.length > 0) {
    perfumeFamilies.forEach((f, idx) => {
      if (userFamilyPrefs.includes(f)) {
        const w = FAMILY_PRIORITY_WEIGHTS[idx] ?? 0.1;
        s += Math.round(15 * w);
      }
    });
  }

  // Multi-family match score (0-20) - additional families beyond main
  const multiFamilyScore = getMultiFamilyMatchScore(perfumeFamilies, userFamilyPrefs);
  s += multiFamilyScore;

  // Family context score for each family – weighted by position (#8)
  let weightedContextScore = 0;
  for (let idx = 0; idx < perfumeFamilies.length; idx++) {
    const f = perfumeFamilies[idx];
    const w = FAMILY_PRIORITY_WEIGHTS[idx] ?? 0.1;
    const cs = getFamilyContextScore(f, { season, weather, occasion, timeOfDay, mood });
    weightedContextScore += cs * w;
  }
  s += Math.min(15, Math.round(weightedContextScore));

  // Family harmony score (can be negative)
  const harmonyScore = getFamilyHarmonyScore(perfumeFamilies, userFamilyPrefs);
  s += harmonyScore;

  // Noten-Präferenz (0–25)
  // userNotePrefs ist jetzt ein Array von NOTE_CATEGORIES
  if (userNotePrefs && userNotePrefs.length > 0) {
    const perfumeNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
      .map(n => n.toLowerCase().trim());

    let noteMatchScore = 0;

    // Check each perfume note against user's selected categories
    for (const note of perfumeNotes) {
      const cat = NOTE_TO_CAT[note];
      if (cat && userNotePrefs.includes(cat)) {
        noteMatchScore += 2;
      }
    }

    s += Math.min(25, noteMatchScore);
  }

  // ── KONTEXT-MULTIPLIKATOR (×1.0–1.4) ────────────────────────────────────
  let mult = 1.0;
  for (const cm of CONTEXT_MULTIPLIERS) {
    if (cm.check(p, ctx)) { mult = Math.max(mult, cm.mult); break; }
  }
  s = Math.round(s * mult);

  // ── DUFTPSYCHOLOGIE (−20–+20) ────────────────────────────────────────────
  // Positive: note supports the mood. Negative: note works against it (e.g. stimulating
  // notes for sleep mode). notePsychologyScore() now returns values in that signed range.
  const moodToProfile = { calm: "calm", energetic: "energetic", romantic: "romantic", confident: "confident", playful: "playful", mysterious: "mysterious", sleep: "sleep" };
  const profile = moodToProfile[mood] || mood;
  const psychVal = notePsychologyScore(p, profile);
  s += Math.round(psychVal * 20);
  // Fallback: no note data at all (psychVal === 0 AND no notes exist) → use family as proxy
  if (psychVal === 0) {
    const mx = MOODS.find(m => m.id === mood);
    if (mx?.families.includes(fam)) s += 8;
  }

  // ── HARMONY-BONUS (0–10) ────────────────────────────────────────────────
  for (const hc of HARMONY_COMBOS) {
    if (hc.check(p, ctx)) { s += hc.bonus; break; }
  }

  // ── ROTATION-BONUS (0–10) ───────────────────────────────────────────────
  s += rotationBonus(p, log);

  // ── BEWERTUNGS-BONUS (0–6) ──────────────────────────────────────────────
  s += (p.rating || 0) * 1.2;

  // ── HALTBARKEIT-MATCH (0–4) ─────────────────────────────────────────────
  const cl = CONC_LON[p.conc] || 2;
  const lp = longevityPref === "short" ? 1 : longevityPref === "long" ? 3 : 2;
  s += Math.max(0, 4 - Math.abs(cl - lp) * 1.5);

  // ── KONFLIKT-MALUS (−10–0) ──────────────────────────────────────────────
  for (const cf of CONFLICTS) {
    if (cf.check(p, ctx)) { s -= cf.malus; break; }
  }

  // ── WIEDERHOLUNGS-MALUS ──────────────────────────────────────────────────
  s -= recencyMalus(p, log);

  // ── CONTROLLED RANDOMNESS (0–3) ─────────────────────────────────────────
  // Seed basiert auf Tageszeit + Parfum-ID → gleiche Regler, verschiedene Tages-Sessions = andere Reihenfolge
  const daySlot = Math.floor(Date.now() / (4 * 3600000)); // wechselt alle 4h
  const idHash = p.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const seededRandom = ((daySlot * 2654435761 + idHash * 40503) >>> 0) / 4294967296;
  s += seededRandom * 3;

  return Math.round(Math.max(0, s));
}

// ── Empfehlungs-Engine: erzeugt Top3 + 2 Alt + 1 Wildcard ───────────────────
function generateRecommendations(items, ctx) {
  if (!items.length) return null;

  // ── Optionale Vorfilter (Frage 2: skalierbare KI-Parameter) ─────────────────
  let pool = items;
  // Gender-Filter
  if (ctx.genderPref) {
    const gf = ctx.genderPref.toLowerCase();
    const filtered = pool.filter(p => (p.gender || "").toLowerCase().includes(gf) || (p.gender || "").toLowerCase() === "unisex");
    if (filtered.length >= 3) pool = filtered; // nur anwenden wenn genug Ergebnisse
  }
  // Preisbereich-Filter: nutzt priceMl wenn vorhanden (wird via ctx übergeben wenn verfügbar)
  // Für Empfehlungsmotor: kein harter Filter, sondern Bonus-Punkte via Score
  // (Harter Filter würde bei kleinen Sammlungen zu keinem Ergebnis führen)

  const scored = pool
    .map(p => {
      let s = score(p, ctx);
      // Preis-Bonus wenn priceMl-Daten vorhanden (ctx.priceMl optional)
      if (ctx.priceRange && ctx.priceMl) {
        const pm = ctx.priceMl[p.id];
        if (pm) {
          const pricePerMl = pm.price / pm.ml;
          const isLuxury = pricePerMl > 1.5;
          const isBudget = pricePerMl < 0.4;
          if (ctx.priceRange === "luxury" && isLuxury) s += 8;
          if (ctx.priceRange === "budget" && isBudget) s += 8;
          if (ctx.priceRange === "mid" && !isLuxury && !isBudget) s += 6;
        }
      }
      return { ...p, _s: s };
    })
    .sort((a, b) => b._s - a._s);

  const top3 = scored.slice(0, 3);
  const rest = scored.slice(3);

  // Alternativen: aus einer anderen Duftfamilie als Top1
  const top1Fam = top3[0]?.family;
  const alts = rest.filter(p => p.family !== top1Fam).slice(0, 2);

  // Wildcard: zufällig aus Bottom-40% – andere Familie als Top1
  const bottomSlice = scored.slice(Math.floor(scored.length * 0.6));
  const wildcandidates = bottomSlice.filter(p => p.family !== top1Fam);
  const wildcard = wildcandidates.length
    ? wildcandidates[Math.floor(Math.random() * Math.min(wildcandidates.length, 20))]
    : bottomSlice[Math.floor(Math.random() * Math.min(bottomSlice.length, 10))];

  return {
    top3,
    alts: alts.length >= 2 ? alts : rest.slice(0, 2), // Fallback
    wildcard,
    roles: {
      [top3[0]?.id]: "top1", [top3[1]?.id]: "top2", [top3[2]?.id]: "top3",
      [alts[0]?.id]: "alt1", [alts[1]?.id]: "alt2", [wildcard?.id]: "wildcard"
    },
  };
}

function sanitizeField(v) {
  return (v == null ? "" : String(v)).replace(/[\t\r\n]/g, " ").trim();
}
const MAX_TSV_CHARS = 2_000_000;
const MAX_TSV_LINES = 50_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_RENDERED_RESULTS = 180;

function suggestNoteCategories(top, middle, base) {
  const allNotes = [...splitNotes(top), ...splitNotes(middle), ...splitNotes(base)];
  const scores = {};
  allNotes.forEach(note => {
    const key = normalizeText(note);
    const cat = NOTE_TO_CAT[key];
    if (cat) scores[cat] = (scores[cat] || 0) + 1;
  });
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
}
// ── Enhanced debouncing with AbortController ──────────────────────────────────
// Fix: Der AbortController wird erst beim Commit des debounced Werts neu erzeugt
// (nicht pro Tastendruck). Damit ist das Signal zum Zeitpunkt des Sucheffekts
// garantiert gültig und nicht bereits vom Cleanup des vorherigen Laufs abgebrochen.
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    // Vorherigen Timeout löschen
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Laufende Operation des vorherigen Werts abbrechen (neue Eingabe)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Neuen Timeout setzen; der Controller wird erst beim Commit erzeugt,
    // damit das Signal während des nächsten Renders frisch und nicht abgebrochen ist
    timeoutRef.current = setTimeout(() => {
      abortControllerRef.current = new AbortController();
      setDebounced(value);
    }, delay);

    // Cleanup beim Unmount
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, delay]);

  // Signal wird zur Laufzeit aus der Ref gelesen (immer der aktuelle Controller)
  return {
    debounced,
    signal: abortControllerRef.current?.signal,
    abort: () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    },
  };
}
// ──────────────────────────────────────────────────────────────────────────────
/*function sanitizePerfume(item) {
  const src = item && typeof item === "object" ? item : {};
  const cleanStr = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const famRaw = cleanStr(src.family, 80);
  const seasonRaw = cleanStr(src.season, 80);
  const fam = FAMILIES.includes(famRaw) ? famRaw : "Sonstiges";
  const season = SEASONS.some(s => seasonRaw.includes(s)) ? seasonRaw : "Ganzjährig";
  const ratingNum = Number.parseInt(src.rating, 10);

  // Handle families array - keep first family as family for compatibility, store all in families
  let families = [];
  if (Array.isArray(src.families)) {
    families = src.families.filter(f => FAMILIES.includes(f));
  }
  if (families.length === 0 && fam && fam !== "Sonstiges") {
    families = [fam];
  }

  return {
    id: cleanStr(src.id, 80) || newId(),
    name: cleanStr(src.name, 220),
    house: cleanStr(src.house, 180),
    conc: cleanStr(src.conc, 40),
    family: families.length > 0 ? families[0] : "Sonstiges",
    families: families,
    top: cleanStr(src.top, 2000),
    middle: cleanStr(src.middle, 2000),
    base: cleanStr(src.base, 2000),
    season,
    gender: cleanStr(src.gender, 40) || "Unisex",
    format: cleanStr(src.format, 20) || "Probe",
    url: cleanStr(src.url, 2048),
    spotify_url: cleanStr(src.spotify_url, 2048),
    rating: Number.isFinite(ratingNum) ? Math.min(5, Math.max(0, ratingNum)) : 0,
    note_categories: Array.isArray(src.note_categories) ? src.note_categories.filter(c => NOTE_CATEGORIES.includes(c)).slice(0, 3) : [],
    addedAt: typeof src.addedAt === "number" ? src.addedAt : (src.addedAt ? new Date(src.addedAt).getTime() : Date.now()),
  };
}*/
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
function getGroqKey() {
  try {
    const stored = typeof localStorage !== "undefined" && localStorage.getItem(KEYS.groqKey);
    if (typeof stored === "string" && stored.trim().length >= 10) return stored.trim();
  } catch { }
  const w = typeof window !== "undefined" ? window : {};
  const k = w.__SILLAGE_GROQ_KEY__ || w.__SILLAGE_AI_KEY__;
  return typeof k === "string" && k.length >= 10 ? k.trim() : null;
}
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const LOOKUP_PAGE_MAX_CHARS = 6000; // Reduziert von 10000 → weniger Input-Tokens


// ══════════════════════════════════════════════════════════════════════════════
// JSON SCHEMA VALIDATION & RETRY LOGIC
// Validates Groq API responses against expected schemas
// Automatic retry with stricter prompt on schema violation
// ══════════════════════════════════════════════════════════════════════════════

// Schema definitions for expected JSON responses
const JSON_SCHEMAS = {
  lookup: {
    requiredKeys: ['name', 'house', 'conc', 'family', 'top', 'middle', 'base', 'season', 'gender'],
    keyTypes: { name: 'string', house: 'string', conc: 'string', family: 'string', top: 'string', middle: 'string', base: 'string', season: 'string', gender: 'string' },
    enumConstraints: { conc: ['EDP', 'EDT', 'Parfum', 'EDC', 'Extrait'], family: ['Floral', 'Woody', 'Oriental', 'Fresh', 'Chypre', 'Fougère', 'Gourmand', 'Aquatisch', 'Sonstiges'], season: ['Frühling', 'Sommer', 'Herbst', 'Winter', 'Ganzjährig'], gender: ['Unisex', 'Feminin', 'Maskulin'] }
  },
  dayParams: {
    requiredKeys: ['occasion', 'mood', 'timeOfDay', 'intensityPref', 'longevityPref', 'reasoning'],
    keyTypes: { occasion: 'string', mood: 'string', timeOfDay: 'string', intensityPref: 'string', longevityPref: 'string', reasoning: 'string' },
    enumConstraints: { occasion: ['casual', 'work', 'sport', 'evening', 'date', 'sleep', 'special', 'outdoor', 'travel', 'vacation'], mood: ['energetic', 'calm', 'romantic', 'confident', 'mysterious', 'playful', 'sleep'], timeOfDay: ['morning', 'afternoon', 'evening', 'night'], intensityPref: ['light', 'medium', 'strong'], longevityPref: ['short', 'medium', 'long'] },
    maxLengths: { reasoning: 80 }
  }
};

// Validates a parsed JSON object against a schema definition
function validateJsonSchema(obj, schemaName) {
  const schema = JSON_SCHEMAS[schemaName];
  if (!schema) return { valid: false, errors: [`Unknown schema: ${schemaName}`] };
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['Response is not an object'] };
  const errors = [];
  for (const key of schema.requiredKeys) {
    if (!(key in obj)) { errors.push(`Missing required key: ${key}`); continue; }
    const val = obj[key];
    const expectedType = schema.keyTypes[key];
    if (expectedType && typeof val !== expectedType) errors.push(`Key "${key}" has wrong type: expected ${expectedType}, got ${typeof val}`);
  }
  if (schema.enumConstraints) {
    for (const [key, allowedValues] of Object.entries(schema.enumConstraints)) {
      if (key in obj && obj[key] && !allowedValues.includes(obj[key])) errors.push(`Key "${key}" has invalid value "${obj[key]}". Allowed: ${allowedValues.join(', ')}`);
    }
  }
  if (schema.maxLengths) {
    for (const [key, maxLen] of Object.entries(schema.maxLengths)) {
      if (key in obj && obj[key] && typeof obj[key] === 'string' && obj[key].length > maxLen) errors.push(`Key "${key}" exceeds max length of ${maxLen} (got ${obj[key].length})`);
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// Schema example for retry instructions
function getSchemaExample(schemaName) {
  if (schemaName === 'lookup') {
    return { name: '', house: '', conc: 'EDP', family: 'Floral', top: '', middle: '', base: '', season: 'Ganzjährig', gender: 'Unisex' };
  }
  if (schemaName === 'dayParams') {
    return { occasion: 'casual', mood: 'calm', timeOfDay: 'evening', intensityPref: 'medium', longevityPref: 'medium', reasoning: 'Erklärung warum diese Werte passen.' };
  }
  return {};
}


// ══════════════════════════════════════════════════════════════════════════════
// GROQ TOKEN MANAGER v2 – Model Rotation, Rate-Limit-Tracking, Offline-Cache
// Primäres Modell: openai/gpt-oss-120b
// Fallback-Modelle: qwen/qwen3.8-27b, openai/gpt-oss-20b
// Strategie: Requests-Budget schonen, schnell rotieren bei 429
// ══════════════════════════════════════════════════════════════════════════════
export const GTM_MODEL_POOL = [
  { id: "openai/gpt-oss-120b",  reqPerMin: 30, quality: "high" },
  { id: "qwen/qwen3.8-27b",     reqPerMin: 30, quality: "medium" },
  { id: "openai/gpt-oss-20b",   reqPerMin: 30, quality: "medium" },
];
const GTM_COOLDOWN_MS = 62000; // 62s nach 429

export const _gtmState = {};
GTM_MODEL_POOL.forEach(m => {
  _gtmState[m.id] = {
    blockedUntil: 0, lastUsed: 0,
    reqRemainingDay: 30, reqResetDayAt: 0,   // RPD-Header (Requests per Day)
    tokRemaining: 8000, tokResetAt: 0,        // TPM-Header (Tokens per Minute)
  };
});

const _groqOfflineCache = {};
let _groqRetryAfterUntil = 0;

function groqSetOfflineCache(cacheKey, text) {
  if (!cacheKey || !text) return;
  _groqOfflineCache[cacheKey] = text;
  try {
    const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
    all[cacheKey] = text;
    const keys = Object.keys(all);
    if (keys.length > 30) delete all[keys[0]];
    localStorage.setItem("parfum_groq_cache_v1", JSON.stringify(all));
  } catch {}
}
function groqGetOfflineCache(cacheKey) {
  if (_groqOfflineCache[cacheKey]) return _groqOfflineCache[cacheKey];
  try {
    const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
    return all[cacheKey] || null;
  } catch { return null; }
}

function _gtmParseHeaders(headers, modelId) {
  const s = _gtmState[modelId];
  if (!s || typeof s !== 'object' || s === null) return;
  const remReq = headers.get("x-ratelimit-remaining-requests");
  const resetReq = headers.get("x-ratelimit-reset-requests");
  if (remReq !== null && typeof parseInt(remReq) === 'number') s.reqRemainingDay = parseInt(remReq);
  if (resetReq) {
    const secs = parseFloat(resetReq.replace("s",""));
    if (typeof secs === 'number') s.reqResetDayAt = Date.now() + secs * 1000;
  }
  const remTok = headers.get("x-ratelimit-remaining-tokens");
  const resetTok = headers.get("x-ratelimit-reset-tokens");
  if (remTok !== null && typeof parseInt(remTok) === 'number') s.tokRemaining = parseInt(remTok);
  if (resetTok) {
    const secs = parseFloat(resetTok.replace("s", ""));
    if (typeof secs === 'number') s.tokResetAt = Date.now() + secs * 1000;
  }
  s.lastUsed = Date.now();
}

function _gtmSelectModel() {
  const now = Date.now();
  for (const m of GTM_MODEL_POOL) {
    const s = _gtmState[m.id];
    if (!s || typeof s !== 'object' || s === null) continue;
    // Tages-Reset prüfen
    if (s.blockedUntil > now) continue;
    // Token-Reset prüfen
    if (s.reqResetDayAt > 0 && now >= s.reqResetDayAt) { s.reqRemainingDay = m.reqPerMin; s.reqResetDayAt = 0; }
    // Token-Reset prüfen
    if (s.tokResetAt > 0 && now >= s.tokResetAt) { s.tokRemaining = 8000; s.tokResetAt = 0; }
    // Modell überspringen, wenn Request- oder Token-Budget erschöpft
    if (s.reqRemainingDay <= 1 || s.tokRemaining <= 0) continue;
    return m;
  }
  // alle erschöpft → frühestes Reset (beide Metriken)
  return GTM_MODEL_POOL.reduce((best, m) => {
    const ms = _gtmState[m.id];
    const bs = _gtmState[best.id];
    const bt = ms && typeof ms === 'object' ? Math.max(ms.blockedUntil, ms.reqResetDayAt, ms.tokResetAt) : Infinity;
    const bb = bs && typeof bs === 'object' ? Math.max(bs.blockedUntil, bs.reqResetDayAt, bs.tokResetAt) : -Infinity;
    return bt < bb ? m : best;
  });
}

async function groqFetch({ messages, temperature = 0.4, max_tokens = 200, cacheKey = null, forceFallback = false }) {
  const apiKey = getGroqKey();
  if (!apiKey) { console.log('ERROR', 'Groq API key missing'); throw new ApiError('Kein Groq API-Key – bitte unter Settings → API eintragen.'); }

  const now = Date.now();
  const retryWaitSec = Math.ceil((_groqRetryAfterUntil - now) / 1000);

  const pool = forceFallback ? GTM_MODEL_POOL.slice(1) : GTM_MODEL_POOL;
  let lastErr = null;

  for (const modelDef of pool) {
    const s = _gtmState[modelDef.id];
    if (!s || typeof s !== 'object' || s === null || s.blockedUntil > Date.now()) continue;

    try {
      // Fix: Timeout für den Request (30s), damit der Loading-State nie endlos hängt
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 30000);
      let res;
      try {
        res = await fetch(GROQ_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
          body: JSON.stringify({ model: modelDef.id, temperature, max_completion_tokens: max_tokens, messages }),
          signal: abortCtrl.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      _gtmParseHeaders(res.headers, modelDef.id);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers?.get?.("retry-after") || "62", 10);
        const waitMs = isNaN(retryAfter) ? GTM_COOLDOWN_MS : Math.min(retryAfter * 1000, 300000);
        s.blockedUntil = Date.now() + waitMs;
        lastErr = new RateLimitError(`Rate-Limit für ${modelDef.id}, wechsle zum nächsten Modell`, { retryAfter: Math.ceil(waitMs / 1000) });
        console.log('WARN', `Rate limit hit on ${modelDef.id}`, { retryAfter: Math.ceil(waitMs/1000) });
        continue;
      }

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const errMsg = e?.error?.message || `HTTP ${res.status}`;
        if (res.status >= 500) {
          lastErr = new NetworkError(`Server nicht erreichbar (${res.status}). Bitte später erneut versuchen.`);
        } else if (res.status >= 400 && res.status < 500) {
          lastErr = new ApiError(`API-Fehler (${res.status}): ${errMsg}`);
        } else {
          lastErr = new ApiError(`Unerwartete Antwort (${res.status})`);
        }
        console.log('WARN', `HTTP ${res.status} on ${modelDef.id}`, { error: errMsg });
        continue;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) { lastErr = new InvalidResponseError('Keine Textantwort von KI erhalten.'); continue; }

      _groqRetryAfterUntil = 0;
      if (cacheKey) groqSetOfflineCache(cacheKey, text);
      return { text, fromCache: false, model: modelDef.id };
    } catch (e) {
      if (e && e.name === "AbortError") {
        lastErr = new NetworkError("Zeitüberschreitung bei der KI-Anfrage – bitte erneut versuchen.");
        console.log('WARN', `Timeout on ${modelDef.id}`);
      } else {
        // Fix: handleApiError existiert nicht (war nie definiert/importiert) →
        // Fehler in ApiError kapseln und in den Performance-Metriken zählen
        lastErr = e instanceof AppError ? e : new ApiError(e?.message || "Unbekannter API-Fehler");
        try { recordError('groqFetch'); } catch { /* Metrik ist optional */ }
        console.log('WARN', `Fetch error on ${modelDef.id}`, { error: e.message });
      }
    }
  }

  const allBlocked = pool.every(m => { const s = _gtmState[m.id]; return s && typeof s === 'object' && s != null && s.blockedUntil > Date.now(); });
  if (allBlocked) {
    const earliest = pool.reduce((min, m) => {
      const s = _gtmState[m.id];
      return s && typeof s === 'object' && s != null ? Math.min(min, s.blockedUntil) : min;
    }, Infinity);
    _groqRetryAfterUntil = earliest;
  }

  if (cacheKey) {
    const cached = groqGetOfflineCache(cacheKey);
    if (cached) return { text: cached, fromCache: true, model: "cache", retryAfterSec: retryWaitSec > 0 ? retryWaitSec : 0 };
  }

  // Graceful degradation: if no cache is available, return a fallback response
  // instead of crashing. The app will continue to work with cached data if available.
  return {
    text: "Aktiviert gedämpfte Funktion – nur gecachte Antworten sind verfügbar.",
    fromCache: false,
    model: "degraded"
  };
}

// ── Countdown Hook für Rate-Limit-Anzeige ────────────────────────────────────
export function useGroqCountdown() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const tick = () => {
      const remaining = Math.ceil((_groqRetryAfterUntil - Date.now()) / 1000);
      setSec(remaining > 0 ? remaining : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return sec;
}

// ── buildPromptContext: skalierbare KI-Parameter ─────────────────────────────
// Erweiterbar: neue Felder einfach im params-Objekt ergänzen.
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

function normalizeLookupPayload(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Ungültige API-Antwort");
  const pick = (k, max) => {
    const v = obj[k];
    return v == null ? "" : String(v).slice(0, max);
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

    // Seasons: die Saison mit dem höchsten Wert (Gewichtung aus der Parfumo-Statistik),
    // sonst Ganzjährig. Keys werden getrimmt, falls der Parser Whitespaces liefert.
    let season = "Ganzjährig";
    const seasonEntries = Object.entries(obj.seasons || {})
      .map(([k, v]) => [String(k).trim(), Number(v) || 0])
      .filter(([k, v]) => k && v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (seasonEntries.length > 0) season = seasonEntries[0][0];

    // Accords nach Gewicht sortiert als Namen-Liste
    const accords = (obj.accords || []);

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
const FILL_LEVELS = [100, 75, 50, 25, 0];
const FILL_LABELS = { 100: "Voll", 75: "¾", 50: "½", 25: "¼", 0: "Leer" };
const FILL_COLORS = { 100: "#1D9E75", 75: "#0F6E56", 50: "#BA7517", 25: "#E24B4A", 0: "#5F5E5A" };

function FillLevelEditor({ item, fillLevels, onSetFill }) {
  if (item.format !== "Flakon") return null; // CRITICAL: only for Flakons
  const current = fillLevels[item.id] ?? null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="lbl">FÜLLSTAND</div>
      <div style={{ display: "flex", gap: 6 }}>
        {FILL_LEVELS.map(level => {
          const active = current === level;
          const color = FILL_COLORS[level];
          return (
            <button key={level} onClick={() => onSetFill(item.id, active ? null : level)}
              title={FILL_LABELS[level]}
              style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${active ? color : "#E8E6E0"}`,
                background: active ? color + "22" : "transparent", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2
              }}>
              <div style={{
                width: "100%", height: 28, background: "#F1EFE8", borderRadius: 4,
                overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end"
              }}>
                <div style={{
                  width: "100%", height: `${level}%`, background: active ? color : color + "55",
                  transition: "height .3s"
                }} />
              </div>
              <div style={{ fontSize: 9, color: active ? color : "#888780" }}>{FILL_LABELS[level]}</div>
            </button>
          );
        })}
      </div>
      {current !== null && current <= 25 && (
        <div style={{ fontSize: 11, color: "#E24B4A", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span>◎</span>
          <span>{current === 0 ? "Leer – evtl. nachfüllen oder ersetzen" : "Fast leer – bald aufbrauchen oder ersetzen"}</span>
        </div>
      )}
    </div>
  );
}

function FillLevelBadge({ fillLevel }) {
  if (fillLevel === null || fillLevel === undefined) return null;
  const color = FILL_COLORS[fillLevel] || "#888";
  return (
    <div title={`Füllstand: ${FILL_LABELS[fillLevel]}`}
      style={{
        width: 16, height: 20, borderRadius: 3, border: `1px solid ${color}`,
        overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end"
      }}>
      <div style={{ width: "100%", height: `${fillLevel}%`, background: color }} />
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════

// iOS Body-Scroll-Lock: verhindert dass der Hintergrund scrollt wenn Modal offen


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
  const [temperature, setTemperature] = useState(null);   // Temperatur aus Open-Meteo
  const [wearVersion, setWearVersion] = useState(0);      // löst Wear-Map-Neuladen aus

  async function fetchAutoWeather() {
    // Wetter wird standortbasiert geladen: Zuerst Browser-Geolocation,
    // bei Fehler/Verweigerung/Nicht-Verfügbarkeit Fallback auf Kassel.
    // Der Abruf passiert ausschließlich über den Button (nicht beim App-Start).
    setWeatherLoading(true);
    try {
      let lat = KASSEL_COORDS.lat;
      let lon = KASSEL_COORDS.lon;
      let usedFallback = false;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        } catch {
          // Geolocation verweigert/nicht verfügbar → Fallback Kassel
          usedFallback = true;
        }
      } else {
        usedFallback = true;
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

  // Fix: Wetter wird NICHT mehr beim App-Start geladen (früherer useEffect feuerte beim Mount).
  // Der Abruf passiert ausschließlich über den Button (fetchAutoWeather).


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
          <button onClick={fetchAutoWeather} disabled={weatherLoading}
            style={{
              ...S.btn("out"), fontSize: 10, padding: "5px 10px", borderRadius: 16,
              opacity: weatherLoading ? .6 : 1
            }}>
            {weatherLoading ? "…" : "Standort nutzen"}
          </button>
        </div>
        {weatherData && <WeatherWidget weatherData={weatherData} onUse={applyWeather} />}
        {!weatherData && !weatherLoading && <div style={{ fontSize: 10, color: "#B4B2A9" }}>Noch kein Wetter geladen – Klick lädt das Wetter für deinen Standort (Fallback: Kassel). Oder manuell unten auswählen.</div>}
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
const MOOD_GRADIENTS = {
  Floral:      { g: "linear-gradient(135deg, #FADADD 0%, #F4C2C2 30%, #E8A0BF 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✿" },
  Woody:       { g: "linear-gradient(135deg, #E8DCC8 0%, #C4A882 30%, #8B6F47 60%, #5C4033 100%)",    accent: "#8B6F47", icon: "⌁" },
  Oriental:    { g: "linear-gradient(135deg, #F7E8D0 0%, #C9956B 30%, #8B5E3C 50%, #4A2C17 100%)",    accent: "#8B5E3C", icon: "✦" },
  Fresh:       { g: "linear-gradient(135deg, #E0F7FA 0%, #B2EBF2 30%, #80DEEA 60%, #1D9E75 100%)",    accent: "#1D9E75", icon: "❃" },
  Chypre:      { g: "linear-gradient(135deg, #E8E4D9 0%, #A8B5A0 30%, #6B8E5A 60%, #3E5C2B 100%)",    accent: "#6B8E5A", icon: "⊛" },
  "Fougère":   { g: "linear-gradient(135deg, #E8EDE4 0%, #B5C9A8 30%, #7BA05B 60%, #3B6D11 100%)",    accent: "#7BA05B", icon: "⌘" },
  Gourmand:    { g: "linear-gradient(135deg, #FFF0E0 0%, #F5C6AA 30%, #E89B7A 55%, #C2604A 100%)",    accent: "#E89B7A", icon: "◉" },
  Aquatisch:   { g: "linear-gradient(135deg, #DAEEF3 0%, #A8D8EA 30%, #6CB4D4 60%, #2E86AB 100%)",    accent: "#2E86AB", icon: "≋" },
  Zitrisch:    { g: "linear-gradient(135deg, #FFFDE7 0%, #FFF176 30%, #FFD600 60%, #C9A825 100%)",    accent: "#C9A825", icon: "◌" },
  Süß:         { g: "linear-gradient(135deg, #FCE4EC 0%, #F8BBD9 30%, #F48FB1 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✶" },
  Würzig:      { g: "linear-gradient(135deg, #FFF3E0 0%, #FFCC80 30%, #FFA726 60%, #BA7517 100%)",    accent: "#BA7517", icon: "✳" },
  Grün:        { g: "linear-gradient(135deg, #E8F5E9 0%, #A5D6A7 30%, #66BB6A 60%, #5C6B4F 100%)",    accent: "#5C6B4F", icon: "✾" },
  Animalisch:  { g: "linear-gradient(135deg, #EFEBE9 0%, #BCAAA4 30%, #8D6E63 60%, #8B4513 100%)",    accent: "#8B4513", icon: "◈" },
  Harzig:      { g: "linear-gradient(135deg, #FBE9E7 0%, #FFAB91 30%, #A1632A 60%, #8B5E3C 100%)",    accent: "#8B5E3C", icon: "◆" },
  Rauchig:     { g: "linear-gradient(135deg, #ECEFF1 0%, #B0BEC5 30%, #78909C 60%, #5F5E5A 100%)",    accent: "#5F5E5A", icon: "◎" },
  Pudrig:      { g: "linear-gradient(135deg, #FCE4EC 0%, #E8C8D4 30%, #D4A8BC 60%, #C4A0B0 100%)",    accent: "#C4A0B0", icon: "◯" },
  Fruchtig:    { g: "linear-gradient(135deg, #FFF8E1 0%, #FFCC80 30%, #FF8A65 60%, #C2604A 100%)",    accent: "#C2604A", icon: "✺" },
  Erdig:       { g: "linear-gradient(135deg, #EFEBE9 0%, #D7CCC8 30%, #A1887F 60%, #6B5B3E 100%)",    accent: "#6B5B3E", icon: "◭" },
  Cremig:      { g: "linear-gradient(135deg, #FFF8E1 0%, #FFECB3 30%, #FFD54F 60%, #E89B7A 100%)",    accent: "#E89B7A", icon: "◍" },
  Synthetisch: { g: "linear-gradient(135deg, #EDE7F6 0%, #B39DDB 30%, #9575CD 60%, #7F77DD 100%)",    accent: "#7F77DD", icon: "⌖" },
  Sonstiges:   { g: "linear-gradient(135deg, #EDEDED 0%, #C8C8C8 30%, #9E9E9E 60%, #5F5E5A 100%)",    accent: "#888780", icon: "◇" },
};

function MoodHeader({ family, base, families }) {
  const primaryFamily = (families && families.length > 0) ? families[0] : family;
  const mood = MOOD_GRADIENTS[primaryFamily] || MOOD_GRADIENTS["Sonstiges"];
  const notes = splitNotes(base);
  const topNotes = notes.slice(0, 3);

  return (
    <div style={{
      position: "relative", borderRadius: 12, overflow: "hidden",
      marginBottom: 12, height: 140,
      background: mood.g,
    }}>
      {/* Inhalt */}
      <div style={{
        position: "absolute", bottom: 12, left: 14, right: 14,
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      }}>
        <span style={{
          fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase",
          background: "rgba(255,255,255,0.22)",
          color: "#fff", padding: "5px 14px", borderRadius: 20,
          fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ fontSize: 14 }}>{mood.icon}</span>
          {family || "Sonstiges"}
        </span>
        {topNotes.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {topNotes.map((n, i) => (
              <span key={i} style={{
                fontSize: 10, color: "rgba(255,255,255,0.85)",
                background: "rgba(0,0,0,0.15)",
                padding: "2px 8px", borderRadius: 20,
              }}>{n.trim()}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CostPerWearModal({ perfumeId, perfumeName, wearCount, priceMl, onSavePriceMl, onClose }) {
  useBodyLock(true);
  const data = priceMl[perfumeId] || null;
  const [editing, setEditing] = useState(!data);
  const [price, setPrice] = useState(data?.price ?? "");
  const [ml, setMl] = useState(data?.ml ?? "");

  useEffect(() => {
    const d = priceMl[perfumeId] || null;
    if (d) { setPrice(d.price); setMl(d.ml); setEditing(false); }
    else { setPrice(""); setMl(""); setEditing(true); }
  }, [perfumeId, priceMl]);

  function handleSave() {
    const p = parseFloat(price);
    const m = parseFloat(ml);
    if (!Number.isFinite(p) || p < 0 || !Number.isFinite(m) || m <= 0) return;
    onSavePriceMl(perfumeId, { price: p, ml: m });
    setEditing(false);
  }

  // Stats
  const totalSprays = data ? data.ml * 10 : 0;
  const costPerSpray = data ? data.price / totalSprays : 0;
  const costPerWear = data && wearCount > 0 ? data.price / wearCount : null;
  const spraysUsed = wearCount * 3;
  const spraysLeft = Math.max(0, totalSprays - spraysUsed);
  const pctUsed = totalSprays > 0 ? Math.min(100, (spraysUsed / totalSprays) * 100) : 0;
  const estWearsLeft = spraysLeft > 0 ? Math.floor(spraysLeft / 3) : 0;
  const barColor = pctUsed > 75 ? "#E24B4A" : pctUsed > 50 ? "#BA7517" : "#1D9E75";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
    }}
      onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 20, marginTop: 16,
        maxWidth: 400, width: "100%", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
        boxShadow: "0 8px 32px rgba(0,0,0,.2)"
      }}
        onClick={function (e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div className="lbl" style={{marginBottom: 2 }}>COST PER WEAR</div>
            <div style={{ fontSize: 14, color: "#1A1A18", fontFamily: "'Georgia',serif" }}>{perfumeName}</div>
          </div>
          <button onClick={onClose} aria-label="Modal schließen"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
        </div>

        {/* Edit form */}
        {(editing || !data) && (
          <div>
            <div style={{ fontSize: 12, color: "#888780", marginBottom: 12 }}>
              Preis und Größe eingeben, um die Kosten pro Tragung zu berechnen.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Preis €</div>
                <input id="detail-price" type="number" min="0" step="0.01" value={price}
                  onChange={e => setPrice(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                  placeholder="0.00" className="inp" style={{ ...S.inp, fontSize: 13 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Größe ml</div>
                <input id="detail-size" type="number" min="1" step="1" value={ml}
                  onChange={e => setMl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                  placeholder="100" className="inp" style={{ ...S.inp, fontSize: 13 }} />
              </div>
            </div>
            <button onClick={handleSave}
              disabled={!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0}
              style={{
                ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px",
                opacity: (!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0) ? 0.4 : 1
              }}>
              Speichern
            </button>
          </div>
        )}

        {/* Stats view */}
        {data && !editing && (
          <div>
            {/* Main stat */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 32, fontWeight: 400, color: "#1A1A18", lineHeight: 1 }}>
                {costPerWear !== null ? `${costPerWear.toFixed(2)} €` : "– €"}
              </div>
              <div style={{ fontSize: 11, color: "#888780", marginTop: 4 }}>pro Tragung</div>
            </div>

            {/* Details grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14,
              background: "#F1EFE8", borderRadius: 8, padding: "12px 8px"
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{(+data.price || 0).toFixed(2)} €</div>
                <div className="lbl" style={{marginBottom: 0 }}>GESAMTPREIS</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{costPerSpray.toFixed(3)} €</div>
                <div className="lbl" style={{marginBottom: 0 }}>PRO SPRAY</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{data.ml} ml</div>
                <div className="lbl" style={{marginBottom: 0 }}>FLAKON</div>
              </div>
            </div>

            {/* Usage bar */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: "#888780" }}>{spraysUsed} / {totalSprays} Sprays</div>
                <div style={{ fontSize: 10, color: "#888780" }}>{Math.round(pctUsed)}%</div>
              </div>
              <div style={{ height: 6, background: "#E8E6E0", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pctUsed}%`, background: barColor, borderRadius: 3, transition: "width .5s" }} />
              </div>
            </div>

            {/* Remaining */}
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#888780", marginBottom: 14 }}>
              <span>◎ {spraysLeft} Sprays übrig</span>
              <span>◎ ~{estWearsLeft} Tragungen</span>
            </div>

            {wearCount === 0 && (
              <div style={{ fontSize: 10, color: "#BA7517", fontStyle: "italic", marginBottom: 12 }}>
                Noch keine Tragungen – Cost-per-Wear berechnet sich nach dem ersten „Tragen".
              </div>
            )}

            <button onClick={() => setEditing(true)}
              style={{ ...S.btn("out"), width: "100%", fontSize: 13, padding: "10px" }}>
              Preis / Größe bearbeiten
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: BRAND INFO (Wikipedia)
// ══════════════════════════════════════════════════════════════════════════════
const _wikiCache = {};
async function fetchBrandInfo(brand) {
  if (!brand || brand.trim().length < 2) return null;
  const key = brand.trim().toLowerCase();
  if (_wikiCache[key] !== undefined) return _wikiCache[key];
  if (!getGroqKey()) return null; // kein Key → sofort null, kein Cache-Eintrag
  try {
    const { text } = await groqFetch({
      messages: [
        { role: "system", content: "Parfüm-Experte. Antworte NUR mit 2-3 Sätzen auf Deutsch: Gründer, Jahr, Land, bekannter Duft. Kein Markdown." },
        { role: "user", content: `Marke: ${brand}` },
      ],
      temperature: 0.4, max_tokens: 120,
      cacheKey: "brand:" + key,
    });
    if (text && text.length > 15) {
      const result = { text, url: null };
      _wikiCache[key] = result;
      return result;
    }
    _wikiCache[key] = null;
    return null;
  } catch(err) {
    // Nur bei dauerhaften Fehlern (kein Key, 404) cachen – nicht bei Rate-Limit oder Netzwerk
    const msg = err?.message || "";
    const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
    if (isPermanent) _wikiCache[key] = null;
    // Bei Rate-Limit oder Netzwerkfehler: nicht cachen → nächster Versuch klappt evtl.
    return null;
  }
}

function BrandInfo({ house }) {
  const [info, setInfo] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const houseRef = useRef(house);

  useEffect(() => {
    houseRef.current = house;
    setInfo(null);
    setExpanded(false);
    setErrMsg("");
  }, [house]);

  async function handleToggle() {
    if (expanded && info) { setExpanded(false); return; }
    setExpanded(true);
    if (info || !house) return;
    if (!getGroqKey()) {
      setErrMsg("Kein Groq API-Key – bitte unter Settings → API eintragen.");
      return;
    }
    setLoading(true); setErrMsg("");
    try {
      const result = await fetchBrandInfo(house);
      if (houseRef.current === house) {
        if (result) setInfo(result);
        else setErrMsg("Keine Infos gefunden – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
    }
    setLoading(false);
  }

  async function handleRetry() {
    const key = house.trim().toLowerCase();
    delete _wikiCache[key];
    setInfo(null); setErrMsg(""); setLoading(true);
    try {
      const result = await fetchBrandInfo(house);
      if (houseRef.current === house) {
        if (result) setInfo(result);
        else setErrMsg("Keine Infos gefunden.");
      }
    } catch(e) {
      if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
    }
    setLoading(false);
  }

  if (!house) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <input value={house} readOnly
          style={{
            fontSize: 12, color: "#5F5E5A", border: "none", background: "transparent",
            padding: 0, fontFamily: "'Georgia',serif", width: "auto", flex: "none",
            outline: "none", cursor: "default", WebkitUserSelect: "none", userSelect: "none"
          }} />
        <button onClick={handleToggle}
          style={{
            background: "none", border: "1px solid #D3D1C7", borderRadius: "50%",
            width: 18, height: 18, minWidth: 18, minHeight: 18, aspectRatio: "1 / 1", cursor: "pointer", display: "inline-flex",
            alignItems: "center", justifyContent: "center", fontSize: 10,
            color: expanded ? "#534AB7" : "#B4B2A9", lineHeight: 1, padding: 0,
            transition: "all .15s", flexShrink: 0, boxSizing: "content-box"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#534AB7'); e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', expanded ? '#534AB7' : '#B4B2A9') }}>
          i
        </button>
      </div>
      {expanded && (
        <div style={{
          marginTop: 8, padding: "10px 12px", background: "#F1EFE8", borderRadius: 8,
          fontSize: 12, color: "#5F5E5A", lineHeight: 1.6, animation: "fadeIn .3s"
        }}>
          {loading ? (
            <span style={{ color: "#B4B2A9", fontStyle: "italic" }}>Lade Hintergrundinfo…</span>
          ) : info ? (
            <div>{info.text}</div>
          ) : errMsg ? (
            <div>
              <div style={{ color: "#B4B2A9", fontStyle: "italic", marginBottom: errMsg.includes("Settings") ? 0 : 6 }}>{errMsg}</div>
              {!errMsg.includes("Settings") && (
                <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "4px 10px" }}>
                  Nochmal versuchen
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: FUN FACTS (Groq)
// ══════════════════════════════════════════════════════════════════════════════
const _factsCache = {};
async function fetchFunFacts(name, house, top, middle, base, extra = {}) {
  if (!name) return null;
  // Cache-Key inkludiert Noten-Fingerprint → neue Noten = neue Facts
  const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
  const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
  const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
  if (_factsCache[key] !== undefined) return _factsCache[key];
  if (!getGroqKey()) return null;

  // Zusatzinfos für präziseren Prompt
  const { conc, family, season, gender } = extra;
  const contextParts = [
    conc && `Konzentration: ${conc}`,
    family && `Familie: ${family}`,
    season && `Saison: ${season}`,
    gender && `Zielgruppe: ${gender}`,
  ].filter(Boolean).join(", ");

  const systemPrompt = `Du bist ein Parfüm-Experte. Gib genau 3 Fun-Facts auf Deutsch über das angegebene Parfüm.
Jeder Fact auf einer eigenen Zeile, kein Bullet-Point, kein Markdown.
Fokus: einzigartige Details die DIESEN Duft charakterisieren – Perfumeur, Inspiration, markante Noten-Kombination, Geschichte, Besonderheit.
Keine allgemeinen Aussagen über die Marke. Keine Wiederholung der Noten-Liste. Jeder Fact soll überraschen.`;

  const userPrompt = [
    `Parfüm: ${house ? house + " – " : ""}${name}`,
    contextParts && `Kontext: ${contextParts}`,
    noteStr && `Noten: ${noteStr}`,
  ].filter(Boolean).join("\n");

  try {
    const { text } = await groqFetch({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7, max_tokens: 180,
      cacheKey: "facts2:" + key.slice(0, 80),
    });
    if (text && text.length > 20) {
      _factsCache[key] = text;
      return text;
    }
    _factsCache[key] = null;
    return null;
  } catch(err) {
    const msg = err?.message || "";
    const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
    if (isPermanent) { _factsCache[key] = null; return null; }
    // Transiente Fehler (Rate-Limit, Netzwerk) hochwerfen, damit UI sie anzeigt
    throw err;
  }
}

function FunFactsCard({ name, house, top, middle, base, conc, family, season, gender }) {
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const nameRef = useRef(name);
  const extra = { conc, family, season, gender };

  // Reset wenn Name ODER Noten sich ändern (neue Noten = neue Facts)
  const noteFingerprint = [top, middle, base].filter(Boolean).join("|");
  useEffect(() => {
    nameRef.current = name;
    setFacts(null);
    setExpanded(false);
    setErrMsg("");
  }, [name, noteFingerprint]);

  async function handleLoad() {
    if (expanded && facts) { setExpanded(false); return; }
    setExpanded(true);
    if (facts) return;
    if (!getGroqKey()) {
      setErrMsg("Kein Groq API-Key – bitte unter Settings → API eintragen.");
      return;
    }
    setLoading(true); setErrMsg("");
    try {
      const result = await fetchFunFacts(name, house, top, middle, base, extra);
      if (nameRef.current === name) {
        if (result) setFacts(result);
        else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (nameRef.current === name) {
        const msg = e.message || "";
        const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
        if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
        else if (msg.includes("API-Limit")) setErrMsg(msg);
        else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
      }
    }
    setLoading(false);
  }

  async function handleRetry() {
    // Cache-Key muss mit neuem noteHash übereinstimmen → fetchFunFacts berechnet ihn intern
    const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
    const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
    const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
    delete _factsCache[key];
    setFacts(null); setErrMsg(""); setLoading(true);
    try {
      const result = await fetchFunFacts(name, house, top, middle, base, extra);
      if (nameRef.current === name) {
        if (result) setFacts(result);
        else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (nameRef.current === name) {
        const msg = e.message || "";
        const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
        if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
        else if (msg.includes("API-Limit")) setErrMsg(msg);
        else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
      }
    }
    setLoading(false);
  }

  if (!name) return null;

  return (
    <div className="card" style={{marginBottom: 12 }}>
      <button onClick={handleLoad} aria-expanded={expanded}
        style={{
          background: "none", border: "none", cursor: "pointer", width: "100%",
          display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }} aria-hidden="true">✦</span>
          <div className="lbl">FUN FACTS</div>
        </div>
        <span style={{
          fontSize: 12, color: "#B4B2A9", transition: "transform .2s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)"
        }} aria-hidden="true">▾</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1EFE8",
          animation: "fadeIn .3s"
        }}>
          {loading ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <span style={{ fontSize: 11, color: "#B4B2A9", animation: "pulse 1.2s ease-in-out infinite" }}>✦</span>
              <span style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic" }}>Sammle Facts zu diesem Duft…</span>
            </div>
          ) : facts ? (
            <div>
              {facts.split("\n").filter(s => s.trim()).map((s, i) => {
                const text = s.replace(/^[\d.\-•·]+\s*/, "").trim();
                if (!text) return null;
                return (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 10, color: "#534AB7", flexShrink: 0, marginTop: 3, fontWeight: 700 }}>
                      {["✦", "◎", "→"][i] || "·"}
                    </span>
                    <span style={{ fontSize: 13, color: "#1A1A18", lineHeight: 1.65 }}>{text}</span>
                  </div>
                );
              })}
              <button onClick={handleRetry} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit", padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                <span>↻</span><span>Neue Facts laden</span>
              </button>
            </div>
          ) : errMsg ? (
            <div>
              <div style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic", marginBottom: 6 }}>{errMsg}</div>
              {!errMsg.includes("Settings") && (
                <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "5px 12px" }}>
                  Nochmal versuchen
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: SPOTIFY CARD
// ══════════════════════════════════════════════════════════════════════════════
function getSpotifyEmbedUrl(url) {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
}
function getSpotifyOpenUrl(url) {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/${m[1]}/${m[2]}`;
}

function SpotifyCard({ spotifyUrl, onEdit }) {
  const openUrl = getSpotifyOpenUrl(spotifyUrl);

  if (openUrl) {
    return (
      <div style={{ marginBottom: 10 }}>
        <a href={openUrl} target="_blank" rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 10,
            background: "#1DB954", color: "#fff", textDecoration: "none",
            fontSize: 12, fontWeight: 500, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)",
            transform: "translateY(0)", boxShadow: "0 2px 8px rgba(29,185,84,0.3)"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(-2px)'); e.currentTarget.style.setProperty('box-shadow', '0 4px 15px rgba(29,185,84,0.4)') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(0)'); e.currentTarget.style.setProperty('box-shadow', '0 2px 8px rgba(29,185,84,0.3)') }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          Spotify
        </a>
        <button onClick={onEdit} aria-label="Spotify-URL bearbeiten"
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9",
            padding: "8px 0 0 2px", marginLeft: 4, transition: "color .12s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#B4B2A9') }}>
          ändern
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <button onClick={onEdit} aria-label="Soundtrack hinzufügen"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "8px 14px", borderRadius: 10,
          border: "1px dashed #D3D1C7", background: "transparent",
          color: "#B4B2A9", fontSize: 12, cursor: "pointer",
          transition: "all .15s", fontFamily: "'Georgia',serif"
        }}
        onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#1DB954'); e.currentTarget.style.setProperty('color', '#1DB954'); }}
        onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', '#B4B2A9'); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity=".5" aria-hidden="true" focusable="false">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        Soundtrack hinzufügen
      </button>
    </div>
  );
}

function NotesEditModal({ perfume, onClose, onUpdate, onSaveNote, localNotes, onSearchNote, removeTag, addTag, noteInput, setNoteInput }) {
  useBodyLock(true);
  const [local, setLocal] = useState({ ...perfume });

  function setField(k, v) {
    setLocal(prev => ({ ...prev, [k]: v }));
  }
  function handleSave() {
    const patch = {};
    ["house", "families", "season", "conc", "top", "middle", "base", "spotify_url"].forEach(k => {
      const oldVal = perfume[k];
      const newVal = local[k];
      const changed = (Array.isArray(newVal) || Array.isArray(oldVal))
        ? JSON.stringify(newVal || []) !== JSON.stringify(oldVal || [])
        : newVal !== oldVal;
      if (changed) patch[k] = newVal;
    });
    if (Object.keys(patch).length > 0) onUpdate(perfume.id, patch);
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "env(safe-area-inset-top,16px) 16px 16px", paddingTop: "max(env(safe-area-inset-top),20px)", overflowY: "auto", overscrollBehavior: "contain"
    }}
      onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 20,
        maxWidth: 420, width: "100%", maxHeight: "85dvh", overflowY: "auto",
        WebkitOverflowScrolling: "touch", marginTop: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,.2)"
      }}
        onClick={function (e) { e.stopPropagation() }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="lbl" style={{marginBottom: 0 }}>DUFTDATEN BEARBEITEN</div>
          <button onClick={onClose} aria-label="Modal schließen"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label htmlFor="note-house" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Haus / Marke</label>
          <input id="note-house" value={local.house || ""} onChange={e => setField("house", e.target.value)}
            placeholder="z.B. Bon Parfumeur" className="inp" style={{ ...S.inp, fontSize: 12 }} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#888780", marginBottom: 6, display: "block" }}>
              Familien · Reihenfolge = Priorität (#8)
            </label>
            {/* Ausgewählte Familien als geordnete Liste mit Prioritäts-Badges */}
            {(local.families && local.families.length > 0) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {local.families.map((fam, idx) => {
                  const col = FAM_COLORS[fam] || "#534AB7";
                  const priorityLabel = idx === 0 ? "1. Hauptfamilie" : idx === 1 ? "2. Nebenfamilie" : "3. weitere";
                  const weights = ["1.0×", "0.5×", "0.25×"];
                  return (
                    <div key={fam} style={{ display: "flex", alignItems: "center", gap: 3, background: col + "18", border: `1px solid ${col}`, borderRadius: 16, padding: "3px 8px 3px 4px" }}>
                      <span style={{ fontSize: 9, background: col, color: "#fff", borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }}>{idx + 1}</span>
                      <span style={{ fontSize: 11, color: col }}>{fam}</span>
                      <span style={{ fontSize: 9, color: col, opacity: 0.7 }}>{weights[idx] || "0.1×"}</span>
                      <button type="button" onClick={e => { e.stopPropagation(); setField("families", local.families.filter(f => f !== fam)); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: col, padding: "0 0 0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 6 }}>
              Tippen zum Hinzufügen · erste Auswahl = Hauptfamilie (volle Gewichtung)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...FAMILIES].filter(fam => !(local.families || []).includes(fam)).sort((a, b) => a.localeCompare(b)).map(fam => {
                const col = FAM_COLORS[fam] || "#534AB7";
                return (
                  <button key={fam} type="button" onClick={(e) => {
                    e.stopPropagation();
                    setField("families", [...(local.families || []), fam]);
                  }} style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 14,
                    border: "1px solid #E8E6E0",
                    background: "#fff", color: "#888780", cursor: "pointer",
                    transition: "all .12s",
                  }}>{fam}</button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="note-season" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Saison</label>
            <select id="note-season" value={local.season || "Ganzjährig"} onChange={e => setField("season", e.target.value)}
              className="inp" style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
              {SEASONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Konzentration – bei gescrapten Parfüms oft leer ("?" in der Detailansicht) */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="note-conc" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Konzentration</label>
          <select id="note-conc" value={local.conc || ""} onChange={e => setField("conc", e.target.value)}
            className="inp" style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
            <option value="">– keine –</option>
            {["EDC", "EDT", "EDP", "Parfum", "Extrait", "Cologne", "Eau Fraîche"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {[["Kopfnoten", "top"], ["Herznoten", "middle"], ["Basisnoten", "base"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: 10 }}>
            <label htmlFor={`note-${key}`} style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>{label}</label>
            <textarea id={`note-${key}`} value={local[key] || ""} onChange={e => setField(key, e.target.value)}
              className="ta" style={{ ...S.ta, minHeight: 52, fontSize: 12 }} />
          </div>
        ))}

        <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <label htmlFor="note-tag-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Tag eingeben</label>
            <input id="note-tag-input" value={noteInput} onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="Tag hinzufügen…" className="inp" style={{ ...S.inp, flex: 1, fontSize: 12 }} />
            <button onClick={addTag} aria-label="Tag hinzufügen" style={{ ...S.btn("pri"), padding: "8px 12px" }}>+</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="list" aria-label="Notiz-Tags">
            {localNotes.map(t => (
              <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 20, background: "#F1EFE8", fontSize: 12 }}>
                <button onClick={() => onSearchNote && onSearchNote(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}>{t}</button>
                <button onClick={() => removeTag(t)} aria-label={`Tag "${t}" entfernen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#888780" }}>✕</button>
              </span>
            ))}
            {localNotes.length === 0 && <div style={{ fontSize: 11, color: "#888780" }}>Noch keine Tags</div>}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Spotify-URL (Track oder Playlist)</div>
          <input id="note-spotify" value={local.spotify_url || ""} onChange={e => setField("spotify_url", e.target.value)}
            placeholder="https://open.spotify.com/track/…" className="inp" style={{ ...S.inp, fontSize: 12 }} />
        </div>

        <button onClick={handleSave} style={{ ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px" }}>
          Speichern
        </button>
      </div>
    </div>
  );
}

function CostPerWearButton({ perfumeId, wearCount, priceMl, onClick }) {
  const data = priceMl[perfumeId] || null;
  const cpw = data && wearCount > 0 ? (data.price / wearCount).toFixed(2) : null;

  return (
    <button onClick={onClick} aria-label={data ? `Kosten: ${cpw || data.price.toFixed(2)} Euro pro Tragung` : "Preis hinzufügen"}
      style={{
        background: "none", border: "1px solid #D3D1C7", borderRadius: 8, cursor: "pointer",
        padding: "6px 10px", fontSize: 11, fontFamily: "'Georgia',serif", color: "#888780",
        display: "inline-flex", alignItems: "center", gap: 4, transition: "all .12s"
      }}
      onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#BA7517'); e.currentTarget.style.setProperty('color', '#BA7517'); }}
      onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', '#888780'); }}>
      {data ? (
        <>{cpw !== null ? `${cpw} €/Trag` : `${(+data.price || 0).toFixed(2)} €`} · {data.ml}ml</>
      ) : (
        <>Preis hinzufügen</>
      )}
    </button>
  );
}

const FIELD_LABELS = { name:"Name", house:"Haus", conc:"Konzentration", family:"Familie",
  top:"Kopfnoten", middle:"Herznoten", base:"Basisnoten", season:"Saison", gender:"Geschlecht" };

function ReloadDiffModal({ reloadDiff, onApply, onClose }) {
  useBodyLock(true);
  const [selected, setSelected] = useState(() => new Set(reloadDiff.map(d => d.field)));
  const toggle = f => setSelected(prev => { const s = new Set(prev); s.has(f) ? s.delete(f) : s.add(f); return s; });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 20, maxWidth: 420, width: "100%",
        maxHeight: "80dvh", animation: "scaleIn .2s cubic-bezier(0.25,0.46,0.45,0.94) both", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        fontFamily: "'Georgia',serif"
      }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #1A1A18 0%, #534AB7 100%)", borderRadius: "20px 20px 0 0", padding: "20px 24px 16px" }}>
          <div style={{ fontSize: 10, letterSpacing: "1.5px", color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>PARFUMO ABGLEICH</div>
          <div style={{ fontSize: 18, color: "#fff", fontWeight: 400 }}>{reloadDiff.length} Änderung{reloadDiff.length !== 1 ? "en" : ""} gefunden</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>Wähle aus, was übernommen werden soll.</div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {reloadDiff.map(d => (
            <div key={d.field} onClick={() => toggle(d.field)}
              style={{
                padding: "12px 14px", marginBottom: 8, borderRadius: 12, cursor: "pointer",
                border: selected.has(d.field) ? "1.5px solid #534AB7" : "1px solid #E8E6E0",
                background: selected.has(d.field) ? "#F4F3FD" : "#FAFAF8",
                transition: "all .15s"
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, letterSpacing: "1px", color: selected.has(d.field) ? "#534AB7" : "#B4B2A9" }}>
                  {FIELD_LABELS[d.field] || d.field}
                </span>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${selected.has(d.field) ? "#534AB7" : "#D3D1C7"}`,
                  background: selected.has(d.field) ? "#1A1A18" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  {selected.has(d.field) && <span style={{ fontSize: 10, color: "#fff" }}>✓</span>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>AKTUELL</div>
                  <div style={{ color: "#888780", fontStyle: d.old ? "normal" : "italic" }}>{d.old || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#1D9E75", marginBottom: 2 }}>NEU VON PARFUMO</div>
                  <div style={{ color: "#1A1A18", fontWeight: 500 }}>{d.fresh || "—"}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 4 }}>
            <button onClick={() => setSelected(new Set(reloadDiff.map(d => d.field)))}
              style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Alle</button>
            <button onClick={() => setSelected(new Set())}
              style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Keine</button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onApply([...selected])}
              disabled={selected.size === 0}
              style={{ ...S.btn("pri"), flex: 2, padding: "14px", borderRadius: 10, fontSize: 13,
                opacity: selected.size === 0 ? 0.4 : 1,
                boxShadow: "0 2px 8px rgba(83,74,183,0.25)" }}>
              {selected.size} Feld{selected.size !== 1 ? "er" : ""} übernehmen
            </button>
            <button onClick={onClose}
              style={{ ...S.btn("out"), flex: 1, padding: "14px", borderRadius: 10, fontSize: 13 }}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailView({ perfume, items, log, notes, onClose, onDelete, onUpdate, onSaveNote, onLog, onSearchNote, fillLevels, onSetFill, priceMl, onSavePriceMl, containerRef, declutterStatus, onSaveDeclutterStatus }) {
  const rootRef = useRef(null);
  function openOverlay(setter) {
    const fixedEl = containerRef?.current; // App-Level: eigener fixed container
    if (fixedEl) {
      // Statistik/Heute/Ordner: fixed div scrollen
      if (fixedEl.scrollTop > 10) {
        fixedEl.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => setter(true), 120);
      } else {
        setter(true);
      }
    } else {
      // SammlungTab: scrollbarer Container ist PullToRefresh-Div
      const mainEl = document.getElementById('main-scroll-container');
      const scrollEl = mainEl || window;
      const scrollTop = mainEl ? mainEl.scrollTop : window.scrollY;
      if (scrollTop > 10) {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => setter(true), 120);
      } else {
        setter(true);
      }
    }
  }
  const [local, setLocal] = useState(perfume);
  const [localNotes, setLocalNotes] = useState(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []);
  const [noteInput, setNoteInput] = useState("");
  const [showCpw, setShowCpw] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [journalText, setJournalText] = useState(local.journal || "");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  // ── Declutter-Kategorie (Verkaufen/Verschenken) aus DetailView ──
  const [declCategory, setDeclCategory] = useState(() => declutterStatus?.[perfume.id] || null);
  const [declToast, setDeclToast] = useState("");
  function saveDeclCategory(cat) {
    const next = { ...(declutterStatus || {}) };
    if (cat) { next[perfume.id] = cat; }
    else { delete next[perfume.id]; }
    if (onSaveDeclutterStatus) { onSaveDeclutterStatus(next); }
    setDeclCategory(cat);
    if (cat) {
      setDeclToast(cat === "Verkaufen" ? "💰 Als Verkaufen markiert" : cat === "Verschenken" ? "🎁 Als Verschenken markiert" : "🏠 Behalten");
      setTimeout(() => setDeclToast(""), 2200);
    }
  }
  // ── Reload-State ──
  const [reloadState, setReloadState] = useState("idle"); // idle | loading | diff | error
  const [reloadDiff, setReloadDiff] = useState(null);   // { field, old, new }[]
  const [reloadData, setReloadData] = useState(null);
  const [reloadErr, setReloadErr] = useState("");
  useBodyLock(showCpw || showNotes || showJournal || showConfirmDelete || reloadState === "diff");

  async function handleReload() {
    if (!local.url) return;
    setReloadState("loading"); setReloadErr(""); setReloadDiff(null); setReloadData(null);
    try {
      const fresh = await lookupByUrl(local.url);
      const COMPARE_FIELDS = ["name","house","conc","family","top","middle","base","season","gender"];
      const diffs = COMPARE_FIELDS.filter(f => {
        const oldV = (local[f] || "").toString().trim();
        const newV = (fresh[f] || "").toString().trim();
        return oldV !== newV && newV !== "";
      }).map(f => ({ field: f, old: (local[f] || ""), fresh: (fresh[f] || "") }));
      if (diffs.length === 0) {
        setReloadState("idle");
        setReloadErr("✓ Alle Daten sind bereits aktuell.");
        setTimeout(() => setReloadErr(""), 3000);
      } else {
        setReloadDiff(diffs);
        setReloadData(fresh);
        setReloadState("diff");
      }
    } catch(e) {
      setReloadState("error");
      setReloadErr(e.message || "Unbekannter Fehler");
      setTimeout(() => setReloadState("idle"), 4000);
    }
  }

  function applyReload(selectedFields) {
    const patch = {};
    selectedFields.forEach(f => { patch[f] = reloadData[f]; });
    onUpdate(perfume.id, patch);
    setLocal(prev => ({ ...prev, ...patch }));
    setReloadState("idle"); setReloadDiff(null); setReloadData(null);
  }

  const safeLog = Array.isArray(log) ? log : [];
  const wearCount = safeLog.filter(l => l && l.id === perfume.id).length;
  const lastWear = safeLog.filter(l => l && l.id === perfume.id).sort((a, b) => (b?.ts || 0) - (a?.ts || 0))[0];
  const lastWearText = lastWear ? new Date(lastWear.ts).toLocaleDateString("de-DE") : "Noch nie";

  useEffect(() => { setLocal(perfume); }, [perfume]);
  useEffect(() => { setLocalNotes(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []); }, [notes, perfume.id]);

  function setFieldLocal(k, v) { setLocal(prev => ({ ...prev, [k]: v })); }
  function commitField(k) {
    onUpdate(perfume.id, { [k]: local[k] });
  }
  function addTag() {
    const t = noteInput.trim();
    if (!t) return;
    const next = [...new Set([...localNotes, t])];
    setLocalNotes(next);
    onSaveNote(perfume.id, next);
    setNoteInput("");
  }
  function removeTag(t) {
    const next = localNotes.filter(x => x !== t);
    setLocalNotes(next);
    onSaveNote(perfume.id, next);
  }

  // Normal React rendering - matches original src/components/DetailView.jsx
  return (
    <div ref={rootRef} style={{ fontFamily: "'Georgia',serif", background: "#FAFAF8", color: "#1A1A18", minHeight: "100%", paddingBottom: "5rem" }}>
      <button onClick={onClose} style={{ ...S.btn("out"), marginBottom: 12 }}>← Zurück</button>

      {/* ── Declutter-Kategorie Badge (Frage 1) ─────────────────────────────── */}
      {declToast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{declToast}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#B4B2A9", flexShrink: 0 }}>Kategorie:</span>
        {[
          { id: "Behalten", icon: "🏠", color: "#1D9E75" },
          { id: "Verkaufen", icon: "💰", color: "#534AB7" },
          { id: "Verschenken", icon: "🎁", color: "#993C1D" },
        ].map(cat => {
          const isActive = declCategory === cat.id;
          return (
            <button key={cat.id} onClick={() => saveDeclCategory(isActive ? null : cat.id)}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                borderRadius: 16, border: `1px solid ${isActive ? cat.color : "#E8E6E0"}`,
                background: isActive ? cat.color + "18" : "transparent",
                color: isActive ? cat.color : "#888780", fontSize: 11, cursor: "pointer",
                transition: "all .2s", fontFamily: "'Georgia',serif"
              }}>
              <span style={{ fontSize: 13 }}>{cat.icon}</span>
              <span>{cat.id}</span>
            </button>
          );
        })}
      </div>

      <MoodHeader family={local.family} base={local.base} />
      <div className="card" style={{marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input value={local.name || ""} onChange={e => setFieldLocal("name", e.target.value)} onBlur={() => commitField("name")}
              className="inp" style={{ ...S.inp, fontSize: 16, fontWeight: 500, marginBottom: 6 }} />
            <BrandInfo house={local.house} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 8 }}>
              <span className="pill" style={{ '--pill-bg': "#534AB722", '--pill-c': "#534AB7" }}>{local.conc || "?"}</span>
              <span className="pill" style={{ '--pill-bg': "#88888822", '--pill-c': "#888" }}>{local.format || "?"}</span>
              {((local.families && local.families.length > 0) ? local.families : [local.family || "Sonstiges"]).map((f, idx) => (
                <FamilyPill key={f} family={f} idx={idx} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <Stars rating={local.rating || 0} onSet={n => { setFieldLocal("rating", n); onUpdate(perfume.id, { rating: n }); }} size={18} />
            <button onClick={e => { onLog(local); triggerSprayAnimation(e.currentTarget); }} style={{ ...S.btn("pri"), fontSize: 11, padding: "6px 10px" }}>Tragen</button>
            {local.url && (
              <button onClick={handleReload} disabled={reloadState === "loading"}
                title="Noten & Daten von Parfumo neu laden"
                style={{
                  ...S.btn("out"), fontSize: 11, padding: "6px 10px",
                  opacity: reloadState === "loading" ? 0.5 : 1,
                  color: reloadState === "error" ? "#E24B4A" : "#888780",
                  borderColor: reloadState === "error" ? "#E24B4A" : "#D3D1C7",
                  transition: "all .2s"
                }}>
                {reloadState === "loading" ? "…" : "↻"}
              </button>
            )}
            {reloadErr && (
              <div style={{ fontSize: 11, color: reloadErr.startsWith("✓") ? "#1D9E75" : "#E24B4A", marginTop: 4, flex: "1 1 100%" }}>
                {reloadErr}
              </div>
            )}
          </div>
        </div>
        <FillLevelEditor item={local} fillLevels={fillLevels || {}} onSetFill={onSetFill} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "#888780" }}>Getragen: {wearCount}× · Zuletzt: {lastWearText}</div>
          <CostPerWearButton perfumeId={perfume.id} wearCount={wearCount} priceMl={priceMl || {}} onClick={() => openOverlay(setShowCpw)} />
        </div>
        {/* Spotify */}
        <div style={{ marginTop: 8 }}>
          {getSpotifyOpenUrl(local.spotify_url) ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <a href={getSpotifyOpenUrl(local.spotify_url) || "#"} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 14px", borderRadius: 10, background: "#1DB954", color: "#fff",
                  textDecoration: "none", fontSize: 12, fontWeight: 500, fontFamily: "'Georgia',serif"
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                Spotify öffnen
              </a>
              <button onClick={() => openOverlay(setShowNotes)} aria-label="Spotify-URL bearbeiten"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", padding: 0 }}>
                ändern
              </button>
            </div>
          ) : (
            <button onClick={() => openOverlay(setShowNotes)} aria-label="Soundtrack hinzufügen"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 14px", borderRadius: 10, border: "1px dashed #D3D1C7",
                background: "none", color: "#B4B2A9", fontSize: 12, cursor: "pointer",
                fontFamily: "'Georgia',serif"
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#B4B2A9" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
              Soundtrack hinzufügen
            </button>
          )}
        </div>
      </div>

      {showCpw && <CostPerWearModal perfumeId={perfume.id} perfumeName={local.name || ""} wearCount={wearCount} priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl} onClose={() => setShowCpw(false)} />}

      <FunFactsCard name={local.name} house={local.house} top={local.top} middle={local.middle} base={local.base} conc={local.conc} family={local.family} season={local.season} gender={local.gender} />

      <div className="card" style={{marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="lbl">DETAILS & NOTIZEN</div>
          <button onClick={() => openOverlay(setShowNotes)} aria-label="Details bearbeiten"
            style={{
              background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: 2,
              transition: "color .12s"
            }}
            onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
            onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#B4B2A9') }}
            title="Bearbeiten">✎</button>
        </div>
        {/* Familie + Saison */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="pill" style={{ fontSize: 10, background: (FAM_COLORS[local.family] || "#888") + "22", color: FAM_COLORS[local.family] || "#888" }}>{local.family || "Sonstiges"}</span>
          <span style={{ fontSize: 10, color: "#888780", padding: "3px 0" }}>{local.season || "Ganzjährig"}</span>
          {(local.note_categories || []).map(c => (
            <span key={c} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 20,
              background: (NOTE_CAT_COLORS[c] || "#888780") + "18", color: NOTE_CAT_COLORS[c] || "#888780"
            }}>{c}</span>
          ))}
        </div>
        {/* Noten prominent */}
        {[["☀", "Kopfnoten", local.top, "#BA7517"], ["♥", "Herznoten", local.middle, "#9B4D8C"], ["◎", "Basisnoten", local.base, "#5C6B4F"]].map(([icon, label, notes, color]) => {
          const n = splitNotes(notes);
          if (!n.length) return null;
          return (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                <span style={{ fontSize: 14, color }} aria-hidden="true">{icon}</span>
                <span className="lbl" style={{marginBottom: 0, textTransform: "uppercase" }}>{label}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 1 }}>
                {n.map((x, i) => <span key={i} style={{
                  fontSize: 14, color: "#1A1A18", padding: "5px 12px",
                  background: "#F1EFE8", borderRadius: 20,
                }}>{x}</span>)}
              </div>
            </div>
          );
        })}
        {/* Tags */}
        {localNotes.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F1EFE8" }} role="list" aria-label="Notiz-Tags">
            {localNotes.map(t => (
              <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 20, background: "#F1EFE8", fontSize: 10 }}>
                <button onClick={() => onSearchNote && onSearchNote(t)} aria-label={`Nach "${t}" suchen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10 }}>{t}</button>
                <button onClick={() => removeTag(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 9, color: "#B4B2A9" }}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
        <button onClick={() => openOverlay(setShowJournal)}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#888780",
            fontFamily: "'Georgia',serif", transition: "color .15s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#888780') }}>
          ✎ Notizbuch
        </button>
        <span style={{ color: "#D3D1C7", margin: "0 8px" }}>·</span>
        <button onClick={() => setShowConfirmDelete(true)}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#C8C6BE",
            fontFamily: "'Georgia',serif", transition: "color .15s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#E24B4A') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#C8C6BE') }}>
          Löschen
        </button>
      </div>

      {showJournal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
        }}
          onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 20,
            maxWidth: 420, width: "100%", maxHeight: "80dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
            boxShadow: "0 8px 32px rgba(0,0,0,.2)"
          }}
            onClick={function (e) { e.stopPropagation() }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="lbl" style={{marginBottom: 0 }}>NOTIZBUCH</div>
              <button onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }} aria-label="Schließen"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
            </div>
            <textarea value={journalText} onChange={e => setJournalText(e.target.value)}
              placeholder="Deine Gedanken, Eindrücke, Erinnerungen..."
              className="ta" style={{ ...S.ta, minHeight: 200, fontSize: 14, lineHeight: 1.7, padding: "12px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 10, color: "#888780" }}>{journalText.length} Zeichen</span>
              <button onClick={() => { onUpdate(perfume.id, { journal: journalText }); setShowJournal(false) }}
                style={{ ...S.btn("pri"), padding: "10px 20px" }}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {showNotes && <NotesEditModal perfume={local} onClose={() => setShowNotes(false)}
        onUpdate={onUpdate} onSaveNote={onSaveNote} localNotes={localNotes}
        onSearchNote={onSearchNote} removeTag={removeTag} addTag={addTag}
        noteInput={noteInput} setNoteInput={setNoteInput} />}

      {/* ── Reload Diff Modal ─────────────────────────────────────────── */}
      {reloadState === "diff" && reloadDiff && (
        <ReloadDiffModal
          reloadDiff={reloadDiff}
          onApply={fields => applyReload(fields)}
          onClose={() => { setReloadState("idle"); setReloadDiff(null); }}
        />
      )}

      <Dialog open={showConfirmDelete} onClose={() => setShowConfirmDelete(false)} className="relative z-[9100]">
        <div className="fixed inset-0 bg-black/45" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-5">
          <Dialog.Panel style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 340, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 500, color: "#1A1A18", marginBottom: 8 }}>
              „{local.name}" wirklich löschen?
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>
              Dieser Vorgang kann nicht rückgängig gemacht werden.
            </Dialog.Description>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { onDelete(local.id); onClose(); }}
                style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }}>Ja, löschen</button>
              <button onClick={() => setShowConfirmDelete(false)}
                style={{ ...S.btn("out"), flex: 1 }}>Abbrechen</button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}

// ── Reusable Parfum Components ─────────────────────────────────────────────────

// Memoized card for Sammlung
const PerfumeCard = React.memo(function PerfumeCard({ p, notes, onClick, noteFieldLabel, fillLevel }) {
  const noteCount = (notes[p.id] || []).length;
  const noteHits = (p._hits || []).filter(h => ["top", "middle", "base"].includes(h.field));
  const families = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];

  return (
    <div onClick={onClick}
      role="button" tabIndex={0}
      aria-label={`${p.name} – ${p.house}, ${p.conc || "?"}, ${p.family || "Sonstiges"}${p.rating > 0 ? ", " + p.rating + " Sterne" : ""}`}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="card" style={{cursor: "pointer", padding: "8px 12px", marginBottom: 4,
        transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", transform: "translateY(0)",
        boxShadow: "0 1px 3px rgba(26,26,24,0.04)"
      }}
      onMouseEnter={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(-3px)'); e.currentTarget.style.setProperty('box-shadow', '0 8px 25px rgba(26,26,24,0.1)') }}
      onMouseLeave={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(0)'); e.currentTarget.style.setProperty('box-shadow', '0 1px 3px rgba(26,26,24,0.04)') }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#888780" }}>{p.house}</span>
            <span className="pill" style={{ fontSize: 10, padding: "2px 8px", fontWeight: 700, border: `1px solid ${CONC_COLORS[p.conc] || "#888"}`, '--pill-bg': (CONC_COLORS[p.conc] || "#888") + "22", '--pill-c': CONC_COLORS[p.conc] || "#888" }}>{p.conc}</span>
            {/* Saison in der Übersicht anzeigen (Fallback: Ganzjährig, nie "?") */}
            <span style={{ fontSize: 10, color: "#888780" }}>{p.season || "Ganzjährig"}</span>
          </div>
        </div>
        <div style={{ marginLeft: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {families.map((f, idx) => (
                <FamilyPill key={f} family={f} idx={idx} />
              ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
            {noteCount > 0 && <span style={{ fontSize: 10, color: "#B4B2A9" }}>✎{noteCount}</span>}
          </div>
        </div>
      </div>
      {noteHits.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4, paddingTop: 4, borderTop: "1px solid #F1EFE8" }}>
          {noteHits.map((h, i) => (
            <span key={i} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "#EEEDFE", color: "#3C3489", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{ opacity: 0.5 }}>{noteFieldLabel[h.field]}</span>{h.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

// Virtuelle Liste für die Sammlung (react-window v2).
// Modulebene statt SammlungTab: bleibt stabil montiert, damit die dynamisch
// gemessenen Zeilenhöhen zwischen den Renders nicht verloren gehen.
// Dynamische Zeilenhöhen verhindern Überlappungen, auch wenn Karten
// unterschiedlich hoch sind (z. B. mit Noten-Treffern oder langen Namen).
function VirtualPerfumeList({ items, notes, onClick, noteFieldLabel, fillLevels, onSetFill, priceMl }) {
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 78 });

  function PerfumeRow({ index, style, ariaAttributes }) {
    const p = items[index];
    if (!p) return null;
    return (
      <div style={style} {...ariaAttributes}>
        <PerfumeCard
          p={p}
          notes={notes}
          onClick={() => onClick(p.id)}
          noteFieldLabel={noteFieldLabel}
          fillLevel={fillLevels?.[p.id] ?? null}
        />
      </div>
    );
  }

  return (
    <FixedSizeListVirtual
      defaultHeight={items.length * 78}
      rowCount={items.length}
      rowHeight={rowHeight}
      rowComponent={PerfumeRow}
      rowProps={{}}
      style={{ width: "100%", height: items.length * 78 }}
    />
  );
}

function SammlungTab({ items, log, notes, onDelete, onUpdate, onExport, onSaveNote, onLog, fillLevels, onSetFill, priceMl, onSavePriceMl, wishlist }) {
  const [rawSearch, setRawSearch] = useState("");
  const { debounced: debouncedRawSearch } = useDebounce(rawSearch, 300);
  const [activeTerms, setActiveTerms] = useState([]); // committed search terms
  const [fam, setFam] = useState("Alle");
  const [seas, setSeas] = useState("Alle");
  const [fmt, setFmt] = useState("Alle");
  const [sort, setSort] = useState("name");
  const [detail, setDetail] = useState(null);
  const [showNotesPicker, setShowNotesPicker] = useState(false);
  const [displayCount, setDisplayCount] = useState(15);
  const [filteredItems, setFilteredItems] = useState([]);
  const [exportToast, setExportToast] = useState("");
  const inputRef = useRef(null);
  const sammlungDetailRef = useRef(null);

  function showExportToast(msg) {
    setExportToast(msg);
    setTimeout(() => setExportToast(""), 2200);
  }

  // Sicherer lokaler Datenexport: JSON-Vollbackup (später wieder importierbar)
  // oder CSV für Excel/Numbers. Läuft komplett im Browser, keine Netzwerk-Calls.
  function handleDataExport(fmtKind) {
    if (!items.length) { showExportToast("Keine Daten zum Exportieren"); return; }
    const date = new Date().toISOString().slice(0, 10);
    if (fmtKind === "csv") {
      shareOrDownloadFile(buildExportCsv(items), `parfum-sammlung-${date}.csv`,
        "text/csv;charset=utf-8",
        () => showExportToast("✓ CSV exportiert"),
        () => showExportToast("Export fehlgeschlagen"));
      return;
    }
    let content;
    try {
      content = JSON.stringify(buildExportPayload(items, wishlist), exportReplacer, 2);
    } catch {
      showExportToast("Export fehlgeschlagen (Daten nicht serialisierbar)");
      return;
    }
    shareOrDownloadFile(content, `parfum-sammlung-${date}.json`, "application/json",
      () => showExportToast("✓ Backup exportiert"),
      () => showExportToast("Export fehlgeschlagen"));
  }

  

  useEffect(() => {
    if (detail && !items.find(x => x.id === detail)) setDetail(null);
  }, [detail, items]);

  // Commit rawSearch into activeTerms on Enter or comma
  function commitSearch() {
    const parts = rawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const newTerms = [...new Set([...activeTerms, ...parts])];
    setActiveTerms(newTerms);
    setRawSearch("");
  }
  function removeTerm(t) { setActiveTerms(prev => prev.filter(x => x !== t)); }
  function addNoteTerm(note) {
    if (!activeTerms.includes(note)) setActiveTerms(prev => [...prev, note]);
    setShowNotesPicker(false);
  }
  function clearAll() { setActiveTerms([]); setRawSearch(""); }

  // All unique notes sorted by frequency – for the picker
  const allNotes = useMemo(() => getAllNotes(items), [items]);
  const families = useMemo(() => ["Alle", ...new Set(items.map(i => i.family).filter(Boolean))].sort(), [items]);

        // Combined terms = committed + current rawSearch (live preview)
  const liveTerms = useMemo(() => {
    const extra = debouncedRawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    return [...new Set([...activeTerms, ...extra])].map(normalizeTerm);
  }, [activeTerms, debouncedRawSearch]);

// Helper: run the actual filtering logic (shared between effects)
  const runFilters = useCallback(() => {
    const wc = {}; log.forEach(l => { wc[l.id] = (wc[l.id] || 0) + 1; });
    let r = items
      .map(p => {
        const { matched, hits } = matchPerfume(p, liveTerms);
        return matched ? { ...p, _hits: hits } : null;
      })
      .filter(p => p !== null)
      .filter(p =>
        (fam === "Alle" || p.family === fam) &&
        (seas === "Alle" || (p.season || "").includes(seas)) &&
        (fmt === "Alle" || p.format === fmt)
      );
    if (sort === "name") r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "house") r = [...r].sort((a, b) => (a.house || "").localeCompare(b.house || ""));
    if (sort === "rating") r = [...r].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === "family") r = [...r].sort((a, b) => (a.family || "").localeCompare(b.family || ""));
    if (sort === "worn") r = [...r].sort((a, b) => (wc[b.id] || 0) - (wc[a.id] || 0));
    return r;
  }, [items, liveTerms, log, fam, seas, fmt, sort]);
  // Asynchronous search with AbortController to cancel obsolete requests
  // and prevent race conditions when new input arrives.
  useEffect(() => {
    // Lokaler AbortController: bricht genau diesen Suchlauf ab, wenn eine neue
    // Suche startet oder die Komponente unmounted – ohne ein fremdes Signal zu treffen
    const ctrl = new AbortController();
    const { signal } = ctrl;

    // Schedule the search asynchronously
    const timeoutId = setTimeout(() => {
      // Double-check that the search hasn't been aborted
      if (signal.aborted) return;

      // Run the actual filtering using shared helper
      const result = runFilters();
      // Only apply results if the search hasn't been cancelled
      if (!signal.aborted) {
        setFilteredItems(result);
      }
    }, 0);

    // Cleanup: abort this search when a new one starts or on unmount
    return () => {
      clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [debouncedRawSearch, runFilters]);

  // Also run filtering when non-search filters change (sync is fine here)
  useEffect(() => {
    setFilteredItems(runFilters());
  }, [runFilters]);
  // Reset displayCount when filters change
  useEffect(() => { setDisplayCount(15); }, [liveTerms, fam, seas, fmt, sort]);
  const visible = useMemo(() => filteredItems.slice(0, displayCount), [filteredItems, displayCount]);

  const noteFieldLabel = { top: "↑", middle: "○", base: "↓" };

  if (detail) {
    const p = items.find(x => x.id === detail);
    if (!p) return null;
    return (
      <DetailView perfume={p} items={items} log={log} notes={notes}
        onClose={() => setDetail(null)} onDelete={onDelete}
        onUpdate={onUpdate} onSaveNote={onSaveNote} onLog={onLog}
        onSearchNote={note => { addNoteTerm(note); setDetail(null); }}
        fillLevels={fillLevels || {}} onSetFill={onSetFill || ((id, l) => { })}
        priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl || ((id, d) => { })} />
    );
  }

  return (
    <div>
      {/* Dezent platzierte Export-Buttons (JSON-Backup / CSV) */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button onClick={() => handleDataExport("json")} aria-label="Sammlung als JSON-Backup exportieren"
          title="Daten als JSON-Backup exportieren (lokal, inkl. Wunschliste)"
          className="btn" style={{ ...S.btn("sm"), background: "transparent", border: "0.5px solid #D3D1C7", fontSize: 11, color: "#888780" }}>
          ⇩ JSON
        </button>
        <button onClick={() => handleDataExport("csv")} aria-label="Sammlung als CSV exportieren"
          title="Daten als CSV für Excel/Numbers exportieren"
          className="btn" style={{ ...S.btn("sm"), background: "transparent", border: "0.5px solid #D3D1C7", fontSize: 11, color: "#888780" }}>
          ⇩ CSV
        </button>
      </div>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 8 }}>
        <input id="sammlung-search" ref={inputRef} value={rawSearch}
          onChange={e => setRawSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitSearch(); }
            if (e.key === "Backspace" && !rawSearch && activeTerms.length) {
              setActiveTerms(prev => prev.slice(0, -1));
            }
          }}
          placeholder={activeTerms.length ? "Weiteren Begriff…" : "Name, Haus, Note… Enter zum Hinzufügen"}
          className="inp" style={{ ...S.inp, paddingRight: 80 }} />
        <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
          <button onClick={() => setShowNotesPicker(v => !v)}
            aria-label="Note aus Sammlung wählen"
            title="Note aus Sammlung wählen"
            style={{
              background: "none", border: "0.5px solid #D3D1C7", borderRadius: 6, cursor: "pointer",
              fontSize: 11, padding: "3px 7px", color: "#888780"
            }}>
            ♩
          </button>
          {(activeTerms.length > 0 || rawSearch) && (
            <button onClick={clearAll} aria-label="Suche leeren"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: "0 2px" }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Active term chips */}
      {activeTerms.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {activeTerms.map(t => (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
              padding: "3px 8px 3px 10px", borderRadius: 20, background: "#1A1A18", color: "#fff"
            }}>
              {t}
              <button onClick={() => removeTerm(t)} aria-label={`Suchbegriff "${t}" entfernen`}
                style={{
                  background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)",
                  fontSize: 12, padding: 0, lineHeight: 1, marginLeft: 2
                }}>✕</button>
            </span>
          ))}
          <span style={{ fontSize: 10, color: "#888780", alignSelf: "center" }}>
            {activeTerms.length > 1 ? "(alle müssen passen)" : ""}
          </span>
        </div>
      )}

      {/* Notes picker dropdown */}
      {showNotesPicker && (
        <div className="card" style={{marginBottom: 8, padding: "12px", maxHeight: 200, overflowY: "auto" }}>
          <div className="lbl">NOTE WÄHLEN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allNotes.slice(0, 60).map(n => {
              const active = activeTerms.includes(n) || activeTerms.includes(normalizeTerm(n));
              return (
                <button key={n} onClick={() => addNoteTerm(n)}
                  style={{ ...S.btn("out"), padding: "5px 9px", fontSize: 11, borderRadius: 16 }}>
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <select id="filter-familie" value={fam} onChange={e => setFam(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
          {families.map(f => <option key={f}>{f}</option>)}
        </select>
        <select id="filter-saison" value={seas} onChange={e => setSeas(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
          {["Alle", "Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select id="filter-format" value={fmt} onChange={e => setFmt(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px" }}>
          {["Alle", "Probe", "Flakon", "Decant"].map(f => <option key={f}>{f}</option>)}
        </select>
      </div>

      {/* Sort */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#888780" }}>SORT:</span>
        {[["name", "A–Z"], ["house", "Haus"], ["rating", "★"], ["family", "Familie"], ["worn", "Getragen"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)}
            className="btn" style={{ ...S.btn("out"), padding: "5px 10px", fontSize: 10, borderRadius: 16 }}>{l}</button>
        ))}
        <button onClick={onExport}
          className="btn" style={{ ...S.btn("out"), marginLeft: "auto", fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }}>
          TSV ↓
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#888780", marginBottom: 10 }}>
        {filteredItems.length} / {items.length}
        {filteredItems.length > displayCount ? ` · zeige ${displayCount}` : ""}
      </div>

      {/* Results */}
      {items.length === 0 ? (
        <div style={{ padding: 20 }}>
          <div className="skeleton" style={{ width: "60%", height: 18, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: "40%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "80%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "70%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "50%", height: 12, marginBottom: 24 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12, marginTop: 8 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12, marginTop: 8 }} />
        </div>
      ) : (
        <VirtualPerfumeList
          items={filteredItems}
          notes={notes}
          onClick={setDetail}
          noteFieldLabel={noteFieldLabel}
          fillLevels={fillLevels}
          onSetFill={onSetFill}
          priceMl={priceMl}
        />
      )}
      {filteredItems.length > displayCount && (
        <button onClick={() => setDisplayCount(c => c + 15)}
          style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}>
          Mehr anzeigen ({filteredItems.length - displayCount} weitere)
        </button>
      )}
      {filteredItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>🔍</div>
          <div style={{ fontSize: 14, color: "#888780", marginBottom: 16 }}>
            {liveTerms.length > 0
              ? `Keine Treffer für "${liveTerms.join(', ')}"`
              : "Keine Parfüms gefunden"}
          </div>
          {liveTerms.length > 0 && (
            <button onClick={() => { setActiveTerms([]); setRawSearch(""); setFam("Alle"); setSeas("Alle"); setFmt("Alle"); }}
              style={{ ...S.btn("out"), fontSize: 12, padding: "8px 16px" }}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {/* Export-Toast */}
      {exportToast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{exportToast}</div>
      )}
    </div>
  );
}



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
    <main key={state.tab} className="body" style={{ animation: "fadeInUp .18s ease-out both" }} role="tabpanel" id={`panel-${state.tab}`} aria-labelledby={`tab-${state.tab}`}>
      <Suspense fallback={<div className="skeleton" style={{ height: 220, margin: 16, borderRadius: 12 }} />}>
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
    <div ref={appDetailRef} style={{ position: "fixed", inset: 0, background: "#FAFAF8", zIndex: 9000, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", animation: "slideInRight .28s cubic-bezier(0.25,0.46,0.45,0.94) both", padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(56px + env(safe-area-inset-bottom))" }}>
      <DetailView perfume={appDetailPerfume} items={state.items} log={state.log} notes={state.notes}
        onClose={() => dispatch({ type: 'SET_DETAIL', payload: null })} onDelete={handleDelete}
        onUpdate={handleUpdate} onSaveNote={handleSaveNote} onLog={handleLog}
        onSearchNote={() => dispatch({ type: 'SET_DETAIL', payload: null })}
        fillLevels={state.fillLevels || {}} onSetFill={handleSetFill}
                        priceMl={state.priceMl || {}} onSavePriceMl={handleSavePriceMl}
        containerRef={appDetailRef} declutterStatus={state.declutterStatus} onSaveDeclutterStatus={onSaveDeclutterStatus} />
    </div>
  )}
</div>
);
}
export default App;
export { AppErrorBoundary };