/**
 * supabase.js – Zentraler Supabase-Client:
 * Werte kommen ausschließlich aus Umgebungsvariablen (VITE_-Präfix, .env.local).
 * Es wird nur der publishable/anon-Key verwendet, niemals der service_role-Key.
 * Client wird lazy erzeugt, damit App-Start ohne Konfiguration nicht crasht.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// true, wenn URL + Key vorhanden sind (sonst Migration-UI dezent ausblenden)
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

let _client = null;

/**
 * Liefert den (gecachten) Supabase-Client.
 * Session-Persistenz im localStorage ist Standard – der eingeloggte
 * Benutzer bleibt also über Reloads hinweg eingeloggt.
 */
export function getSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase nicht konfiguriert: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY fehlen.");
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
}