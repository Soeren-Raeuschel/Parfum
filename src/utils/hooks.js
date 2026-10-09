/**
 * hooks.js – Allgemeine React-Hooks/Helfer (aus App.jsx ausgelagert).
 */

import { useState, useEffect, useRef } from "react";

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
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

export { debounce, useDebounce };
