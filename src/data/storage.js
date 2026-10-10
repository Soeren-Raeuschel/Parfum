/**
 * Speicherschicht: zentrale Persistenz-Schnittstelle.
 *
 * Alle Methoden geben Promises zurück. Aktiv ist der Hybrid-Adapter
 * (cloudAdapter): schreibt sofort in localStorage und pusht Änderungen
 * debounced nach Supabase (wenn konfiguriert und eingeloggt). Beim App-Start
 * wird der Cloud-Stand über initCloudSync() gepullt (siehe App.jsx).
 *
 * `setPushError` muss nach dem Import mit der App-Fehlerfunktion aufgerufen werden.
 */

import { localAdapter } from './localAdapter';
import { cloudAdapter } from './cloudAdapter';

export const storage = cloudAdapter;
export { localAdapter, cloudAdapter };