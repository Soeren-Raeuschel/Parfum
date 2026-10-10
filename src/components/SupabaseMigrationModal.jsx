/**
 * SupabaseMigrationModal.jsx – Dialog für Login + Migration:
 * 1) Falls nicht eingeloggt: E-Mail/Passwort (Supabase Auth).
 * 2) Migriert die komplette Sammlung nach Supabase (collection_backups).
 * Lokale Daten (localStorage) bleiben unverändert als Backup.
 */

import React, { useEffect, useState } from "react";
import { Dialog } from "@headlessui/react";
import { S } from "../shared/ui";
import { isSupabaseConfigured } from "../lib/supabase";
import { signInWithPassword, getCurrentUser, signOutUser, migrateCollectionToSupabase } from "../utils/supabaseSync";

export default function SupabaseMigrationModal({ open, onClose, items, wishlist, notes, fillLevels, priceMl }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: "ok"|"err", text }

  // Beim Öffnen prüfen, ob bereits eine Session existiert
  useEffect(() => {
    if (!open || !isSupabaseConfigured) return;
    let alive = true;
    getCurrentUser().then(u => { if (alive) setUser(u); }).catch(() => {});
    return () => { alive = false; };
  }, [open]);

  function handleClose() {
    setEmail(""); setPassword(""); setStatus(null); setBusy(false); setUser(null);
    onClose();
  }

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true); setStatus(null);
    try {
      const u = await signInWithPassword(email.trim(), password);
      setUser(u);
      setStatus({ type: "ok", text: "✓ Angemeldet als " + (u.email || "") });
      setPassword("");
    } catch (err) {
      setStatus({ type: "err", text: "Login fehlgeschlagen: " + (err.message || "Unbekannter Fehler") });
    } finally {
      setBusy(false);
    }
  }

  async function handleMigrate() {
    setBusy(true); setStatus(null);
    try {
      const res = await migrateCollectionToSupabase({ items, wishlist, notes, fillLevels, priceMl, log });
      setStatus({ type: "ok", text: `✓ Migriert: ${res.perfumes} Parfüms, ${res.wearLog} Trage-Einträge, ${res.wishlist} Wunschliste-Einträge${res.settings ? ", Einstellungen" : ""}. Lokale Daten bleiben erhalten.` });
    } catch (err) {
      setStatus({ type: "err", text: "Migration fehlgeschlagen: " + (err.message || "Unbekannter Fehler") });
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await signOutUser();
      setUser(null);
      setStatus(null);
    } catch (err) {
      setStatus({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? () => {} : handleClose} className="relative z-[10000]">
      <div className="fixed inset-0" style={{ background: "rgba(26,26,24,.45)" }} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="card" style={{ width: "100%", maxWidth: 380, padding: 20, background: "#FDFCF8" }}>
          <Dialog.Title style={{ fontSize: 15, marginBottom: 4 }}>☁ Supabase-Migration</Dialog.Title>
          <p style={{ fontSize: 11, color: "#888780", marginBottom: 14 }}>
            Schreibt die komplette Sammlung nach Supabase (perfumes, wear_log, wishlist, user_settings). Deine lokalen Daten (localStorage) bleiben als Backup unverändert.
          </p>

          {!isSupabaseConfigured && (
            <div style={{ fontSize: 12, color: "#E24B4A", marginBottom: 10 }}>
              Supabase ist nicht konfiguriert (Umgebungsvariablen fehlen).
            </div>
          )}

          {status && (
            <div style={{
              fontSize: 12, marginBottom: 12, padding: "8px 10px", borderRadius: 8,
              background: status.type === "ok" ? "#E7F5EE" : "#FBEAEA",
              color: status.type === "ok" ? "#0F6E56" : "#E24B4A",
              wordBreak: "break-word"
            }}>{status.text}</div>
          )}

          {user ? (
            <>
              <div style={{ fontSize: 12, color: "#5F5E5A", marginBottom: 14 }}>
                Angemeldet: <strong>{user.email}</strong>
              </div>
              <button onClick={handleMigrate} disabled={busy || !items?.length}
                style={{ ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px", marginBottom: 8, opacity: busy || !items?.length ? 0.6 : 1 }}>
                {busy ? "Migriere…" : "Jetzt alle Daten migrieren"}
              </button>
              <button onClick={handleLogout} disabled={busy}
                style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "8px" }}>
                Abmelden
              </button>
            </>
          ) : (
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 10 }}>
                <label htmlFor="supabase-email" style={{ fontSize: 10, color: "#888780", display: "block", marginBottom: 4 }}>E-MAIL</label>
                <input id="supabase-email" type="email" required value={email}
                  onChange={e => setEmail(e.target.value)} autoComplete="username"
                  className="inp" style={{ ...S.inp, fontSize: 13 }} placeholder="du@beispiel.de" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="supabase-password" style={{ fontSize: 10, color: "#888780", display: "block", marginBottom: 4 }}>PASSWORT</label>
                <input id="supabase-password" type="password" required value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                  className="inp" style={{ ...S.inp, fontSize: 13 }} placeholder="••••••••" />
              </div>
              <button type="submit" disabled={busy || !isSupabaseConfigured}
                style={{ ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Anmeldung…" : "Anmelden"}
              </button>
            </form>
          )}

          <button onClick={handleClose} disabled={busy}
            style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "8px", marginTop: 8 }}>
            Schließen
          </button>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}