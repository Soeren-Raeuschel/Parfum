/**
 * supabaseSync.js – Migration der lokalen Daten in Supabase:
 * Login mit E-Mail/Passwort (nur der eigene Account), Session-Prüfung
 * und Upload des kompletten Datenbestands in die normalisierten Tabellen:
 *   items          → perfumes  (inkl. notes/fill_level/price_ml/declutter_status)
 *   log            → wear_log
 *   wishlist       → wishlist
 *   prefs u. a.    → user_settings
 * Die Migration ersetzt jeweils die Zeilen des eingeloggten Benutzers
 * (idempotent – mehrfach ausführbar). localStorage bleibt unangetastet
 * und dient weiterhin als lokales Backup.
 */

import { getSupabase } from "../lib/supabase";
import { localAdapter, newId } from "../data/localAdapter";

/**
 * Login mit E-Mail/Passwort. Gibt bei Erfolg den Benutzer zurück,
 * wirft bei Fehlern (falsche Zugangsdaten, Netzwerk) einen Error.
 */
export async function signInWithPassword(email, password) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}

/** Gibt die aktuelle Session (oder null) zurück. */
export async function getCurrentUser() {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session?.user ?? null;
}

/** Logout des aktuellen Benutzers. */
export async function signOutUser() {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

// ── Mapping-Helfer ──────────────────────────────────────────────────────────

// Lokales Item + Zusatzdaten → Zeile für public.perfumes
function toPerfumeRow(item, notes, fillLevels, priceMl, declutterStatus) {
  const id = String(item.id);
  const families = Array.isArray(item.families) && item.families.length > 0
    ? item.families
    : [item.family].filter(Boolean);
  return {
    id,
    name: item.name ?? "",
    house: item.house ?? "",
    conc: item.conc ?? "",
    family: item.family || "Sonstiges",
    families,
    top: item.top ?? "",
    middle: item.middle ?? "",
    base: item.base ?? "",
    season: item.season || "Ganzjährig",
    gender: item.gender || "Unisex",
    format: item.format ?? "",
    url: item.url ?? "",
    spotify_url: item.spotify_url ?? "",
    rating: Math.min(5, Math.max(0, Math.round(typeof item.rating === "number" ? item.rating : 0))),
    // CHECK rating BETWEEN 0 UND 5: Wert begrenzen, damit ungültige lokale
    // Ratings (z. B. > 5) die Migration nicht abbrechen.
    note_categories: Array.isArray(item.note_categories) ? item.note_categories : [],
    // User-Notiz-Tags aus der lokalen notes-Map (parfum_notes_v1)
    notes: Array.isArray(notes?.[id]) ? notes[id] : [],
    fill_level: fillLevels?.[id] ?? null,
    price_ml: priceMl?.[id] ?? null,
    declutter_status: declutterStatus?.[id] ?? null,
    // added_at: bei ungültigem/fehlendem Datum Fallback auf jetzt,
    // sonst schlägt der Insert mit "Invalid Date" fehl.
    added_at: item.addedAt && !Number.isNaN(new Date(item.addedAt).getTime())
      ? new Date(item.addedAt).toISOString()
      : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Schreibt den kompletten lokalen Datenbestand nach Supabase.
 * Erwartet einen eingeloggten Benutzer (getCurrentUser muss einen User liefern).
 * Ablauf pro Tabelle: alte Zeilen des Benutzers löschen, dann alles einfügen –
 * damit ist die Migration idempotent und das Ziel entspricht immer exakt lokal.
 */
export async function migrateCollectionToSupabase({
  items, wishlist, notes, fillLevels, priceMl, declutterStatus,
  prefs, userNotePrefs, userFamilyPrefs, log, onboarded,
}) {
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) throw new Error("Nicht eingeloggt – bitte zuerst anmelden.");
  const uid = userData.user.id;

  // Fallback: Daten, die der Aufrufer nicht übergeben hat, direkt lokal laden
  // (SammlungTab hat z. B. prefs/declutterStatus nicht als Props).
  const data = { items, wishlist, notes, fillLevels, priceMl, declutterStatus,
    prefs, userNotePrefs, userFamilyPrefs, log, onboarded };
  const missing = Object.entries(data).filter(([, v]) => v === undefined).map(([k]) => k);
  if (missing.length > 0) {
    const local = await localAdapter.loadAll().catch(() => ({}));
    for (const key of missing) {
      // CamelCase-Prop → gleicher Key im loadAll-Ergebnis (identische Namen)
      data[key] = local[key];
    }
  }

  const result = { perfumes: 0, wearLog: 0, wishlist: 0, settings: false };

  // 1) Parfüms (Replace: alte löschen, dann Bulk-Insert in Chunks)
  // PK (user_id, id): doppelte lokale IDs entfernen (letzte Version gewinnt),
  // sonst bricht der Bulk-Insert mit PK-Verletzung ab.
  const seenPerfumeIds = new Set();
  const perfumeRows = (data.items ?? [])
    .map(it => toPerfumeRow(it, data.notes, data.fillLevels, data.priceMl, data.declutterStatus))
    .filter(row => {
      if (seenPerfumeIds.has(row.id)) return false;
      seenPerfumeIds.add(row.id);
      return true;
    });
  { const { error } = await supabase.from("perfumes").delete().eq("user_id", uid);
    if (error) throw new Error("perfumes (delete): " + error.message); }
  for (let i = 0; i < perfumeRows.length; i += 200) {
    const { error } = await supabase.from("perfumes").insert(perfumeRows.slice(i, i + 200));
    if (error) throw new Error("perfumes (insert): " + error.message);
  }
  result.perfumes = perfumeRows.length;

  // 2) Trage-Log (Replace)
  // FK wear_log_user_id_perfume_id_fkey: nur Einträge übernehmen, deren
  // perfume_id wirklich in der Sammlung existiert (z. B. gelöschte Parfüms
  // hinterlassen sonst verwaiste Log-Einträge → Foreign-Key-Fehler).
  const knownIds = new Set((data.items ?? []).map(it => String(it.id)));
  const allLogRows = (data.log ?? [])
    .filter(l => l && typeof l.ts === "number" && l.id);
  const logRows = allLogRows
    .filter(l => knownIds.has(String(l.id)))
    .map(l => ({ perfume_id: l.id, worn_at: new Date(l.ts).toISOString() }));
  result.skippedWearLog = allLogRows.length - logRows.length;
  { const { error } = await supabase.from("wear_log").delete().eq("user_id", uid);
    if (error) throw new Error("wear_log (delete): " + error.message); }
  for (let i = 0; i < logRows.length; i += 500) {
    const { error } = await supabase.from("wear_log").insert(logRows.slice(i, i + 500));
    if (error) throw new Error("wear_log (insert): " + error.message);
  }
  result.wearLog = logRows.length;

  // 3) Wunschliste (Replace)
  const wishRows = (data.wishlist ?? []).map(w => ({
    id: typeof w?.id === "string" && w.id ? w.id : newId(),
    data: w ?? {},
  }));
  { const { error } = await supabase.from("wishlist").delete().eq("user_id", uid);
    if (error) throw new Error("wishlist (delete): " + error.message); }
  for (let i = 0; i < wishRows.length; i += 200) {
    const { error } = await supabase.from("wishlist").insert(wishRows.slice(i, i + 200));
    if (error) throw new Error("wishlist (insert): " + error.message);
  }
  result.wishlist = wishRows.length;

  // 4) Einstellungen (Upsert auf user_id)
  const settingsRow = {
    prefs: data.prefs ?? { appName: "Sillage" },
    user_note_prefs: data.userNotePrefs ?? [],
    user_family_prefs: data.userFamilyPrefs ?? [],
    onboarded: !!data.onboarded,
    updated_at: new Date().toISOString(),
  };
  { const { error } = await supabase.from("user_settings").upsert(settingsRow);
    if (error) throw new Error("user_settings: " + error.message); }
  result.settings = true;

  return result;
}