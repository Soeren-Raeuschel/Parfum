/**
 * cloudAdapter.js – Hybrid-Storage: localStorage sofort + Delta-Push nach Supabase.
 *
 * Implementiert dieselbe Schnittstelle wie localAdapter, damit sie in
 * storage.js als Drop-in-Ersatz dienen kann:
 *   1) Jeder save*-Aufruf schreibt SOFORT in localStorage (App bleibt schnell
 *      und offline-fähig).
 *   2) Anschließend wird ein debounced Delta-Push nach Supabase geplant.
 *      Nicht eingeloggt / nicht konfiguriert → Push entfällt stillschweigend.
 *
 * Pull-Richtung (Cloud → lokal) passiert beim App-Start über initCloudSync()
 * in der Hydration von App.jsx.
 */

import { localAdapter } from "./localAdapter";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  pushPerfumesDiff, pushWishlistDiff, pushWearLogDiff, pushSettingsDiff,
} from "../utils/supabaseSync";

// Pro Tabelle ein eigener Debounce-Timer, damit häufige Änderungen (z. B.
// Notizen tippen) zu einem einzigen Push zusammengefasst werden.
const PUSH_DEBOUNCE_MS = 1500;
const timers = {};

function schedulePush(kind, fn) {
  if (!isSupabaseConfigured) return;
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => {
    timers[kind] = null;
    // Fehler still abfangen: Cloud-Ausfall darf die App nicht stören
    fn().catch(e => console.warn(`Cloud-Sync (Push ${kind}) fehlgeschlagen:`, e));
  }, PUSH_DEBOUNCE_MS);
}

// Perfume-Spalten (notes/fill/price/declutter) werden beim pushPerfumesDiff
// frisch aus dem lokalen Speicher gelesen → jede dieser save*-Aktionen plant
// einen perfumes-Push (der Diff-Pusher sendet nur tatsächlich geänderte Zeilen).

const cloudAdapter = {
  async loadAll() {
    return localAdapter.loadAll();
  },

  async saveItems(items) {
    await localAdapter.saveItems(items);
    schedulePush("perfumes", () => pushPerfumesDiff(items));
  },

  async saveLog(log) {
    await localAdapter.saveLog(log);
    schedulePush("wearLog", () => pushWearLogDiff(log));
  },

  async saveNotes(notes) {
    await localAdapter.saveNotes(notes);
    schedulePush("perfumes", async () => {
      const local = await localAdapter.loadAll().catch(() => ({}));
      return pushPerfumesDiff(local.items ?? []);
    });
  },

  async saveWishlist(list) {
    await localAdapter.saveWishlist(list);
    schedulePush("wishlist", () => pushWishlistDiff(list));
  },

  async saveSettings(settings) {
    await localAdapter.saveSettings(settings);
    schedulePush("settings", () => pushSettingsDiff());
  },

  async saveFillLevels(map) {
    await localAdapter.saveFillLevels(map);
    schedulePush("perfumes", async () => {
      const local = await localAdapter.loadAll().catch(() => ({}));
      return pushPerfumesDiff(local.items ?? []);
    });
  },

  async savePriceMl(map) {
    await localAdapter.savePriceMl(map);
    schedulePush("perfumes", async () => {
      const local = await localAdapter.loadAll().catch(() => ({}));
      return pushPerfumesDiff(local.items ?? []);
    });
  },

  async saveDeclutterStatus(map) {
    await localAdapter.saveDeclutterStatus(map);
    schedulePush("perfumes", async () => {
      const local = await localAdapter.loadAll().catch(() => ({}));
      return pushPerfumesDiff(local.items ?? []);
    });
  },

  async setOnboarded(bool) {
    await localAdapter.setOnboarded(bool);
    schedulePush("settings", () => pushSettingsDiff());
  },

  setPushError(fn) {
    localAdapter.setPushError(fn);
  },
};

export { cloudAdapter };
