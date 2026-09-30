/**
 * Speicherschicht: zentrale Persistenz-Schnittstelle.
 *
 * Alle Methoden geben Promises zurück, damit sie später durch einen
 * Supabase-Adapter (oder andere Backends) ersetzt werden können,
 * ohne die App-Komponente anpassen zu müssen.
 *
 * Derzeit ist `localAdapter` (localStorage-basiert) aktiv.
 * `setPushError` muss nach dem Import mit der App-Fehlerfunktion aufgerufen werden.
 */

import { localAdapter } from './localAdapter';

export const storage = localAdapter;
export { localAdapter };