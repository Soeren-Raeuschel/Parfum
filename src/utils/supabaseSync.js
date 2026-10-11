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

  // Nach dem Full-Replace: Sync-Snapshot auf den gepushten Stand setzen,
  // damit die kontinuierliche Delta-Sync nichts redundant neu pusht.
  seedSnapshotFromLocal(uid, data);

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// KONTINUIERLICHE SYNC (Hybrid-Storage)
// ══════════════════════════════════════════════════════════════════════════════
// localStorage bleibt die sofortige Quelle (App bleibt schnell & offline-fähig).
// Jede Änderung wird debounced als DELTA nach Supabase gepusht (nur geänderte
// Zeilen). Beim App-Start wird der Cloud-Stand gepullt und gemerged.
// Konfliktregel (vom Benutzer bestätigt): Cloud gewinnt.
// Basis der Diffs ist ein persistenter Snapshot (localStorage) des zuletzt
// synchronisierten Zustands.

import { sanitizePerfume } from "../data/localAdapter";
import { isSupabaseConfigured } from "../lib/supabase";

const SYNC_SNAPSHOT_KEY = "parfum_cloud_sync_v1";

function loadSnapshot() {
  try { return JSON.parse(localStorage.getItem(SYNC_SNAPSHOT_KEY)) || null; }
  catch { return null; }
}
function persistSnapshot() {
  try { localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify(_snapshot)); } // eslint-disable-line no-use-before-define -- sicher: wird erst nach Initialisierung von _snapshot aufgerufen
  catch { /* Quota o. ä. – Sync läuft weiter, Diffs werden nur größer */ }
}
let _snapshot = loadSnapshot();

/** Snapshot zurücksetzen (z. B. beim Benutzerwechsel). */
function resetSnapshot(uid) {
  _snapshot = { uid, perfumes: {}, wishlist: {}, wearLog: {}, settings: null };
  persistSnapshot();
}

/** Stellt sicher, dass der Snapshot zum eingeloggten Benutzer passt. */
function ensureSnapshot(uid) {
  if (!_snapshot || _snapshot.uid !== uid) resetSnapshot(uid);
  return _snapshot;
}

// Kanonischer Vergleich: Rows ohne updated_at serialisieren (updated_at wird
// bei jedem Push neu gesetzt und würde jeden Vergleich trivial machen).
function rowCore(row) {
  // eslint-disable-next-line no-unused-vars -- Rest-Property, updated_at bewusst entfernt
  const { updated_at, ...rest } = row;
  return JSON.stringify(rest);
}

/**
 * Initialisiert den Snapshot aus lokalen Daten nach einem Full-Replace-Migration.
 */
function seedSnapshotFromLocal(uid, data) {
  const snap = ensureSnapshot(uid);
  snap.perfumes = {};
  for (const it of (data.items ?? [])) {
    const row = toPerfumeRow(it, data.notes, data.fillLevels, data.priceMl, data.declutterStatus);
    snap.perfumes[row.id] = rowCore(row);
  }
  snap.wishlist = {};
  for (const w of (data.wishlist ?? [])) {
    const id = typeof w?.id === "string" && w.id ? w.id : newId();
    snap.wishlist[id] = JSON.stringify(w ?? {});
  }
  snap.wearLog = {};
  for (const l of (data.log ?? [])) {
    if (l && typeof l.ts === "number" && l.id) snap.wearLog[`${l.id}|${new Date(l.ts).toISOString()}`] = null;
  }
  snap.settings = JSON.stringify({
    prefs: data.prefs ?? { appName: "Sillage" },
    user_note_prefs: data.userNotePrefs ?? [],
    user_family_prefs: data.userFamilyPrefs ?? [],
    onboarded: !!data.onboarded,
  });
  persistSnapshot();
}

// ── Delta-Pusher (werden vom cloudAdapter debounced aufgerufen) ───────────────

/** Auth-Helper: liefert uid oder null (still, ohne zu werfen). */
async function getUidQuiet() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  } catch { return null; }
}

/**
 * Push der Sammlung als Delta: neue/geänderte Zeilen upserten, entfernte löschen.
 * Zusatzdaten (notes/fill/price/declutter) werden frisch lokal gelesen, da sie
 * Spalten von perfumes sind.
 */
export async function pushPerfumesDiff(items) {
  const uid = await getUidQuiet();
  if (!uid) return false;
  const supabase = getSupabase();
  const snap = ensureSnapshot(uid);

  const local = await localAdapter.loadAll().catch(() => ({}));
  const localIds = new Set((items ?? []).map(it => String(it?.id)).filter(Boolean));
  const rows = (items ?? [])
    .filter(it => it && typeof it === "object" && it.id)
    .map(it => toPerfumeRow(it, local.notes, local.fillLevels, local.priceMl, local.declutterStatus));

  const upserts = rows.filter(r => snap.perfumes[r.id] !== rowCore(r));
  // Lokal entfernt: im Snapshot, aber nicht mehr in items
  const removedIds = Object.keys(snap.perfumes).filter(id => !localIds.has(id));

  if (upserts.length > 0) {
    const { error } = await supabase.from("perfumes").upsert(upserts);
    if (error) throw new Error("perfumes (upsert): " + error.message);
    for (const r of upserts) snap.perfumes[r.id] = rowCore(r);
  }
  if (removedIds.length > 0) {
    const { error } = await supabase.from("perfumes").delete().in("id", removedIds);
    if (error) throw new Error("perfumes (delete): " + error.message);
    for (const id of removedIds) delete snap.perfumes[id];
  }
  persistSnapshot();
  return upserts.length > 0 || removedIds.length > 0;
}

/** Delta-Push der Wunschliste (Upsert geänderter, Löschen entfernter IDs). */
export async function pushWishlistDiff(wishlist) {
  const uid = await getUidQuiet();
  if (!uid) return false;
  const supabase = getSupabase();
  const snap = ensureSnapshot(uid);

  const rows = (wishlist ?? [])
    .filter(w => w && typeof w === "object")
    .map(w => ({ id: typeof w?.id === "string" && w.id ? w.id : newId(), data: w }));
  const localIds = new Set(rows.map(r => r.id));

  const upserts = rows.filter(r => snap.wishlist[r.id] !== JSON.stringify(r.data));
  const removedIds = Object.keys(snap.wishlist).filter(id => !localIds.has(id));

  if (upserts.length > 0) {
    const { error } = await supabase.from("wishlist").upsert(upserts);
    if (error) throw new Error("wishlist (upsert): " + error.message);
    for (const r of upserts) snap.wishlist[r.id] = JSON.stringify(r.data);
  }
  if (removedIds.length > 0) {
    const { error } = await supabase.from("wishlist").delete().in("id", removedIds);
    if (error) throw new Error("wishlist (delete): " + error.message);
    for (const id of removedIds) delete snap.wishlist[id];
  }
  persistSnapshot();
  return upserts.length > 0 || removedIds.length > 0;
}

/** Delta-Push des Trage-Logs (Insert neuer Keys, Delete entfernter Keys). */
export async function pushWearLogDiff(log) {
  const uid = await getUidQuiet();
  if (!uid) return false;
  const supabase = getSupabase();
  const snap = ensureSnapshot(uid);

  const localKeys = new Set();
  const inserts = [];
  // FK-Schutz: nur Log-Einträge pushen, deren perfume_id noch in der Sammlung ist
  const local = await localAdapter.loadAll().catch(() => ({}));
  const knownIds = new Set((local.items ?? []).map(it => String(it.id)));
  for (const l of (log ?? [])) {
    if (!l || typeof l.ts !== "number" || !l.id) continue;
    const key = `${l.id}|${new Date(l.ts).toISOString()}`;
    localKeys.add(key);
    if (!(key in snap.wearLog) && knownIds.has(String(l.id))) {
      inserts.push({ perfume_id: l.id, worn_at: new Date(l.ts).toISOString() });
    }
  }
  const removedKeys = Object.keys(snap.wearLog).filter(k => !localKeys.has(k));

  if (inserts.length > 0) {
    // .select() liefert die generierten Identity-IDs zurück – nötig, um später
    // entfernte Einträge gezielt löschen zu können.
    const { data: inserted, error } = await supabase.from("wear_log").insert(inserts).select("id");
    if (error) throw new Error("wear_log (insert): " + error.message);
    for (const row of inserted ?? []) {
      if (row?.worn_at) snap.wearLog[`${row.perfume_id}|${row.worn_at}`] = row.id;
    }
  }
  if (removedKeys.length > 0) {
    const ids = removedKeys.map(k => snap.wearLog[k]).filter(Boolean);
    if (ids.length > 0) {
      const { error } = await supabase.from("wear_log").delete().in("id", ids);
      if (error) throw new Error("wear_log (delete): " + error.message);
    }
    for (const k of removedKeys) delete snap.wearLog[k];
  }
  persistSnapshot();
  return inserts.length > 0 || removedKeys.length > 0;
}

/** Push der Einstellungen (Upsert der einen user_settings-Zeile). */
export async function pushSettingsDiff() {
  const uid = await getUidQuiet();
  if (!uid) return false;
  const supabase = getSupabase();
  const snap = ensureSnapshot(uid);

  const local = await localAdapter.loadAll().catch(() => ({}));
  const row = {
    prefs: local.prefs ?? { appName: "Sillage" },
    user_note_prefs: local.userNotePrefs ?? [],
    user_family_prefs: local.userFamilyPrefs ?? [],
    onboarded: !!local.onboarded,
    updated_at: new Date().toISOString(),
  };
  const core = JSON.stringify({
    prefs: row.prefs, user_note_prefs: row.user_note_prefs,
    user_family_prefs: row.user_family_prefs, onboarded: row.onboarded,
  });
  if (snap.settings === core) return false;

  const { error } = await supabase.from("user_settings").upsert(row);
  if (error) throw new Error("user_settings (upsert): " + error.message);
  snap.settings = core;
  persistSnapshot();
  return true;
}

// ── Pull & Merge (Cloud gewinnt bei Konflikt) ─────────────────────────────────

/** Cloud-Zeile → lokales Item-Format. */
function rowToItem(row) {
  return sanitizePerfume({
    id: row.id,
    name: row.name,
    house: row.house,
    conc: row.conc,
    family: row.family,
    families: row.families,
    top: row.top,
    middle: row.middle,
    base: row.base,
    season: row.season,
    gender: row.gender,
    format: row.format,
    url: row.url,
    spotify_url: row.spotify_url,
    rating: row.rating,
    note_categories: row.note_categories,
    addedAt: row.added_at ? Date.parse(row.added_at) : Date.now(),
  });
}

/**
 * Lädt den Cloud-Stand und mergt ihn in den lokalen Speicher.
 * Konfliktregel: Cloud gewinnt, wenn eine Cloud-Zeile vom letzten Sync-Snapshot
 * abweicht. Unveränderte Cloud-Zeilen überschreiben lokale Änderungen nicht
 * (diese werden beim nächsten Delta-Push hochgeladen). Lokale Neuzugänge, die
 * noch nie synchronisiert wurden, bleiben erhalten.
 * Gibt die gemergten Daten zurück (für die App-Hydration) oder null.
 */
export async function pullAndMergeCloud() {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return null;
  const uid = userData.user.id;
  const snap = ensureSnapshot(uid);

  const [perf, wish, log, settingsRes] = await Promise.all([
    supabase.from("perfumes").select("*").eq("user_id", uid),
    supabase.from("wishlist").select("*").eq("user_id", uid),
    supabase.from("wear_log").select("id,perfume_id,worn_at").eq("user_id", uid),
    supabase.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
  ]);
  for (const r of [perf, wish, log]) {
    if (r.error) throw new Error("pull: " + r.error.message);
  }

  const local = await localAdapter.loadAll().catch(() => ({}));
  const localItems = new Map((local.items ?? []).map(it => [String(it.id), it]));

  // 1) Parfüms + Zusatzdaten (notes/fill/price/declutter)
  const mergedItems = [];
  const notes = {};
  const fillLevels = {};
  const priceMl = {};
  const declutterStatus = {};
  const cloudPerfumeIds = new Set();
  for (const row of perf.data ?? []) {
    cloudPerfumeIds.add(row.id);
    const cloudChanged = rowCore(row) !== snap.perfumes[row.id];
    const localItem = localItems.get(row.id);
    if (cloudChanged || !localItem) {
      // Cloud neu/geändert (oder lokal unbekannt) → Cloud gewinnt
      mergedItems.push(rowToItem(row));
      if (Array.isArray(row.notes)) notes[row.id] = row.notes;
      if (row.fill_level !== null && row.fill_level !== undefined) fillLevels[row.id] = row.fill_level;
      if (row.price_ml !== null && row.price_ml !== undefined) priceMl[row.id] = row.price_ml;
      if (row.declutter_status !== null && row.declutter_status !== undefined) declutterStatus[row.id] = row.declutter_status;
    } else {
      // Cloud unverändert → lokalen Stand behalten (wird später gepusht)
      mergedItems.push(localItem);
      if (local.notes?.[row.id] !== null && local.notes?.[row.id] !== undefined) notes[row.id] = local.notes[row.id];
      if (local.fillLevels?.[row.id] !== null && local.fillLevels?.[row.id] !== undefined) fillLevels[row.id] = local.fillLevels[row.id];
      if (local.priceMl?.[row.id] !== null && local.priceMl?.[row.id] !== undefined) priceMl[row.id] = local.priceMl[row.id];
      if (local.declutterStatus?.[row.id] !== null && local.declutterStatus?.[row.id] !== undefined) declutterStatus[row.id] = local.declutterStatus[row.id];
    }
    // Snapshot auf Cloud-Stand setzen (diff-fähig für den nächsten Push)
    snap.perfumes[row.id] = rowCore(row);
  }
  // Lokale Neuzugänge (nie synchronisiert) behalten; cloudseitig gelöschte
  // (im Snapshot, nicht mehr in der Cloud) entfernen.
  const mergedItemIds = new Set(mergedItems.map(i => String(i.id)));
  for (const it of (local.items ?? [])) {
    const id = String(it.id);
    if (mergedItemIds.has(id)) continue;
    if (id in snap.perfumes) {
      delete snap.perfumes[id]; // cloudseitig gelöscht
    } else {
      mergedItems.push(it); // lokaler Neuzugang
    }
  }

  // 2) Trage-Log: Union nach Key (perfume_id|worn_at)
  const mergedLogKeys = new Map(); // key -> {id, ts}
  for (const l of (local.log ?? [])) {
    if (l && typeof l.ts === "number" && l.id) {
      mergedLogKeys.set(`${l.id}|${new Date(l.ts).toISOString()}`, l);
    }
  }
  const cloudLogKeys = new Set();
  for (const row of log.data ?? []) {
    const key = `${row.perfume_id}|${row.worn_at}`;
    cloudLogKeys.add(key);
    if (!mergedLogKeys.has(key)) {
      mergedLogKeys.set(key, { id: row.perfume_id, ts: Date.parse(row.worn_at) });
    }
    snap.wearLog[key] = row.id;
  }
  // Cloudseitig gelöschte Log-Einträge lokal mit entfernen
  for (const key of Object.keys(snap.wearLog)) {
    if (!cloudLogKeys.has(key)) {
      mergedLogKeys.delete(key);
      delete snap.wearLog[key];
    }
  }
  const mergedLog = [...mergedLogKeys.values()]
    .filter(l => Number.isFinite(l.ts))
    .sort((a, b) => a.ts - b.ts)
    .slice(-1000);

  // 3) Wunschliste: Union nach ID, Cloud gewinnt für gemeinsame IDs
  const localWish = new Map((local.wishlist ?? []).map(w => [String(w?.id ?? ""), w]));
  const cloudWishIds = new Set();
  const mergedWishlist = [];
  for (const row of wish.data ?? []) {
    cloudWishIds.add(row.id);
    const cloudChanged = snap.wishlist[row.id] !== JSON.stringify(row.data ?? {});
    if (cloudChanged || !localWish.has(row.id)) {
      mergedWishlist.push(row.data ?? {});
    } else {
      mergedWishlist.push(localWish.get(row.id));
    }
    snap.wishlist[row.id] = JSON.stringify(row.data ?? {});
  }
  for (const [id, w] of localWish) {
    if (cloudWishIds.has(id)) continue; // schon gemergt
    if (id in snap.wishlist) {
      delete snap.wishlist[id]; // cloudseitig gelöscht
    } else {
      mergedWishlist.push(w); // lokaler Neuzugang
    }
  }

  // 4) Einstellungen: Cloud gewinnt, wenn die Zeile vom Snapshot abweicht
  const cloudSettings = settingsRes?.data ?? null;
  const mergedSettings = {
    prefs: local.prefs ?? { appName: "Sillage" },
    userNotePrefs: local.userNotePrefs ?? [],
    userFamilyPrefs: local.userFamilyPrefs ?? [],
    onboarded: !!local.onboarded,
  };
  if (cloudSettings) {
    const core = JSON.stringify({
      prefs: cloudSettings.prefs ?? null,
      user_note_prefs: cloudSettings.user_note_prefs ?? null,
      user_family_prefs: cloudSettings.user_family_prefs ?? null,
      onboarded: !!cloudSettings.onboarded,
    });
    if (core !== snap.settings) {
      mergedSettings.prefs = cloudSettings.prefs ?? { appName: "Sillage" };
      mergedSettings.userNotePrefs = Array.isArray(cloudSettings.user_note_prefs) ? cloudSettings.user_note_prefs : [];
      mergedSettings.userFamilyPrefs = Array.isArray(cloudSettings.user_family_prefs) ? cloudSettings.user_family_prefs : [];
      mergedSettings.onboarded = !!cloudSettings.onboarded;
    }
    snap.settings = core;
  }

  // 5) Gemergten Stand in den lokalen Speicher schreiben (direkt über
  //    localAdapter, damit kein Cloud-Push getriggert wird – Cloud ist Quelle)
  await Promise.all([
    localAdapter.saveItems(mergedItems),
    localAdapter.saveLog(mergedLog),
    localAdapter.saveWishlist(mergedWishlist),
    localAdapter.saveNotes(notes),
    localAdapter.saveFillLevels(fillLevels),
    localAdapter.savePriceMl(priceMl),
    localAdapter.saveDeclutterStatus(declutterStatus),
    localAdapter.saveSettings(mergedSettings),
  ]);
  if (mergedSettings.onboarded) {
    try { localStorage.setItem("parfum_onboard_v1", JSON.stringify({ done: true, ts: Date.now() })); }
    catch { /* ignore */ }
  }
  persistSnapshot();

  return {
    items: mergedItems, log: mergedLog, wishlist: mergedWishlist,
    notes, fillLevels, priceMl, declutterStatus, ...mergedSettings,
  };
}

/**
 * Einstieg für die App-Hydration: Wenn konfiguriert und eingeloggt, Cloud-Stand
 * pullen + mergen. Fehler werden still abgefangen (App läuft offline normal
 * weiter). Liefert die gemergten Daten oder null.
 */
/**
 * Liest die aggregierte Trage-Statistik aus der View wear_stats_monthly:
 * pro Monat und Parfum { month: "YYYY-MM-DD", perfume_id, name, house,
 * rating, wear_count }. RLS greift via security_invoker weiter (nur eigene
 * Zeilen). Gibt null zurück, wenn Supabase nicht konfiguriert/nicht
 * eingeloggt ist oder der Abruf fehlschlägt.
 */
export async function fetchWearStatsMonthly() {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = getSupabase();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return null;
    const { data, error } = await supabase
      .from("wear_stats_monthly")
      .select("month,perfume_id,name,house,rating,wear_count")
      .order("month", { ascending: true });
    if (error) return null;
    return data ?? [];
  } catch {
    return null;
  }
}

export async function initCloudSync() {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) return null;
    return await pullAndMergeCloud();
  } catch (e) {
    console.warn("Cloud-Sync (Pull) fehlgeschlagen – starte mit lokalen Daten:", e);
    return null;
  }
}