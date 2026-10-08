import React, { useState, useEffect } from "react";
import { Disclosure, Dialog } from "@headlessui/react";
import { S } from "../shared/ui";
import { KEYS, FAMILIES, FAM_COLORS, NOTE_CATEGORIES, NOTE_CAT_COLORS, validateParfumoLookupUrl, extrahiereBrandName } from "../shared/constants";
import EvolveCard from "../components/EvolveCard";
import { FileUpload } from "../components/ui/file-upload";
import { newId } from "../data/localAdapter";
import { useGroqCountdown, GTM_MODEL_POOL, _gtmState, parseImportFile, MAX_IMPORT_BYTES, ladeParfumdaten } from "../App.jsx";

function SettingsSection({ title, icon, children, defaultOpen = false }) {
  return (
    <Disclosure as="div" className="card" style={{ marginBottom: 10, overflow: "hidden" }} defaultOpen={defaultOpen}>
      {({ open }) => (
        <>
          <Disclosure.Button style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: 0, fontFamily: "'Georgia',serif", textAlign: "left"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1A18" }}>{title}</span>
            </div>
            <span style={{
              fontSize: 12, color: "#B4B2A9", transition: "transform .2s",
              transform: open ? "rotate(180deg)" : "none", display: "inline-block"
            }} aria-hidden="true">▾</span>
          </Disclosure.Button>
          <Disclosure.Panel style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #F1EFE8", animation: "fadeIn .15s ease-out both" }}>
            {children}
          </Disclosure.Panel>
        </>
      )}
    </Disclosure>
  );
}

// ── Groq Rate-Limit Status Widget ────────────────────────────────────────────
function GroqRateLimitStatus() {
  const countdown = useGroqCountdown();
  const [cacheCount, setCacheCount] = useState(0);
  const [modelStatus, setModelStatus] = useState([]);
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
      setCacheCount(Object.keys(all).length);
    } catch {}
    // Live Model-Status aus GTM
    const now = Date.now();
    setModelStatus(GTM_MODEL_POOL.map(m => {
      const s = _gtmState[m.id];
      if (!s || typeof s !== 'object' || s === null) return { id: m.id, blocked: false, req: 0, tok: 0, quality: m.quality };
      const blocked = s.blockedUntil > now;
      return { id: m.id.split("-").slice(0,3).join("-"), blocked, req: s.reqRemainingDay, tok: s.tokRemaining, quality: m.quality };
    }));
  }, [countdown]);

  return (
    <div style={{ marginTop: 12 }}>
      {countdown > 0 && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "#FFF8EE", border: "1px solid #BA751744", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>⏱</span>
            <div>
              <div style={{ fontSize: 12, color: "#BA7517", fontWeight: 500 }}>Hauptmodell geblockt</div>
              <div style={{ fontSize: 11, color: "#888780" }}>Rotation aktiv · frei in <strong>{countdown}s</strong></div>
            </div>
          </div>
        </div>
      )}
      {/* Model Pool Status */}
      <div style={{ padding: "10px 12px", borderRadius: 8, background: "#F9F8F5", border: "1px solid #E8E6E0" }}>
        <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>MODEL POOL STATUS</div>
        {modelStatus.map((m, i) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: i < modelStatus.length-1 ? 5 : 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.blocked ? "#E24B4A" : "#1D9E75", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#1A1A18", flex: 1, fontFamily: "monospace" }}>{m.id}</span>
            <span style={{ fontSize: 10, color: m.blocked ? "#E24B4A" : "#888780" }}>{m.blocked ? "geblockt" : `${m.req} req übrig`}</span>
          </div>
        ))}
        {cacheCount > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #F1EFE8", fontSize: 11, color: "#1D9E75" }}>
            ◎ {cacheCount} Antworten gecacht
          </div>
        )}
      </div>
    </div>
  );
}

function EinstellungenTab({ items, onImport, onExport, onAdd, onClearAll, onClearAllData, appName, onSetAppName, userNotePrefs, setUserNotePrefs, userFamilyPrefs, setUserFamilyPrefs }) {
  // msg can be { text, type: "ok"|"err" } — renders green or red accordingly
  const [msg, setMsg] = useState(null);
  const [confirmMode, setConfirmMode] = useState(null); // null | "items" | "all"
  const [linkUrl, setLinkUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [format, setFormat] = useState("Probe");
  // Celebration-Overlay (EvolveCard) nach erfolgreichem Hinzufügen
  const [celebrate, setCelebrate] = useState(null);
  // Sync nameInput with appName prop (e.g. after external reset)
  const [nameInput, setNameInput] = useState(appName);
  useEffect(() => { setNameInput(appName); }, [appName]);

  const [groqKeyDraft, setGroqKeyDraft] = useState(() => {
    try { return localStorage.getItem(KEYS.groqKey) || ""; } catch { return ""; }
  });
  const [groqKeyMsg, setGroqKeyMsg] = useState("");

  function showMsg(text, type = "ok") {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { showMsg("Datei zu groß (max. 2 MB).", "err"); return; }
    const reader = new FileReader();
    reader.onerror = () => showMsg("Datei konnte nicht gelesen werden.", "err");
    reader.onload = e => {
      const parsed = parseImportFile(e.target.result, file.name);
      if (!parsed.length) { showMsg("Keine Einträge – Format prüfen (TSV/CSV/JSON).", "err"); return; }
      // Merge: existing items matched by URL keep their ID; new items get new IDs.
      // This appends to the collection rather than replacing it.
      const urlToId = {};
      items.forEach(ex => { if (ex.url) urlToId[ex.url] = ex.id; });
      const merged = parsed.map(p => ({ ...p, id: (p.url && urlToId[p.url]) ? urlToId[p.url] : p.id }));
      // Items already in collection (matched by ID) are updated; new items are appended.
      const existingIds = new Set(items.map(p => p.id));
      const updatedItems = items.map(p => {
        const incoming = merged.find(m => m.id === p.id);
        return incoming ? { ...p, ...incoming } : p;
      });
      const newItems = merged.filter(m => !existingIds.has(m.id));
      onImport([...updatedItems, ...newItems]);
      showMsg(`✓ ${newItems.length} neu importiert, ${merged.length - newItems.length} aktualisiert.`);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleLookup() {
    const url = linkUrl.trim();
    if (!url) { setLinkErr("Bitte URL eingeben."); return; }
    // Duplicate check: warn if URL is already in collection
    const alreadyExists = items.some(p => p.url && p.url === url);
    setLoading(true); setLinkErr(""); setPreview(null); setStatus("Suche Parfumo-Seite…");
    try {
      const safeUrl = validateParfumoLookupUrl(url);
      const { brand, name } = extrahiereBrandName(safeUrl);
      const result = await ladeParfumdaten(brand, name);
      setPreview({ ...result, url: safeUrl, format, rating: 0, id: newId() });
      setStatus(alreadyExists ? "⚠ Diese URL ist bereits in deiner Sammlung." : "");
    } catch (e) {
      setLinkErr(`Fehler: ${e.message}`); setStatus("");
    }
    setLoading(false);
  }

  function confirmAdd() {
    if (!preview || !preview.name?.trim()) { setLinkErr("Name fehlt."); return; }
    onAdd({ ...preview, format });
    const name = preview.name;
    setCelebrate({ ...preview, format }); // Celebration-Card mit 3D-Animation zeigen
    setPreview(null); setLinkUrl(""); setStatus(""); showMsg(`✓ "${name}" hinzugefügt.`);
  }

  const totalPrefSelected = (userNotePrefs?.length || 0) + (userFamilyPrefs?.length || 0);

  return (
    <div>
      {/* ── Präferenzen ─────────────────────────────────────── */}
      <SettingsSection title="Präferenzen" icon="◈">
        {/* App-Name */}
        <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #F1EFE8" }}>
          <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>APP-NAME</div>
          <div style={{ display: "flex", gap: 8 }}>
            <label htmlFor="settings-app-name" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>App-Name</label>
            <input id="settings-app-name" value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && onSetAppName(nameInput.trim() || "Sillage")}
              className="inp" style={{ ...S.inp, flex: 1, fontSize: 13 }} placeholder="Sillage" />
            <button onClick={() => onSetAppName(nameInput.trim() || "Sillage")}
              className="btn" style={{ ...S.btn("pri"), padding: "10px 14px", fontSize: 12 }}>OK</button>
          </div>
        </div>

        {/* Duftpräferenzen */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9" }}>LIEBLINGSDUFTFAMILIEN</div>
            {(userFamilyPrefs || []).length > 0 && (
              <button onClick={() => setUserFamilyPrefs([])} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit" }}>
                Alle löschen
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {[...FAMILIES].sort((a, b) => a.localeCompare(b)).map(fam => {
              const isSelected = userFamilyPrefs && userFamilyPrefs.includes(fam);
              const col = FAM_COLORS[fam] || "#534AB7";
              return (
                <button key={fam} onClick={() => {
                  const current = userFamilyPrefs || [];
                  setUserFamilyPrefs(isSelected ? current.filter(f => f !== fam) : [...current, fam]);
                }} style={{
                  fontSize: 11, padding: "6px 12px", borderRadius: 16, cursor: "pointer",
                  border: isSelected ? `1.5px solid ${col}` : "1px solid #E8E6E0",
                  background: isSelected ? col : "#fff",
                  color: isSelected ? "#fff" : "#888780", transition: "all .12s",
                }}>{fam}</button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9" }}>BEVORZUGTE NOTEN-TYPEN</div>
            {(userNotePrefs || []).length > 0 && (
              <button onClick={() => setUserNotePrefs([])} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit" }}>
                Alle löschen
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#B4B2A9", marginBottom: 8, lineHeight: 1.5 }}>
            Beeinflusst die Empfehlungs-Engine – je mehr ausgewählt, desto personalisierter.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...NOTE_CATEGORIES].sort((a, b) => a.localeCompare(b)).map(cat => {
              const isSelected = userNotePrefs && userNotePrefs.includes(cat);
              return (
                <button key={cat} onClick={() => {
                  const current = userNotePrefs || [];
                  setUserNotePrefs(isSelected ? current.filter(c => c !== cat) : [...current, cat]);
                }} style={{
                  fontSize: 11, padding: "6px 12px", borderRadius: 16, cursor: "pointer",
                  border: isSelected ? `1.5px solid ${NOTE_CAT_COLORS[cat] || "#534AB7"}` : "1px solid #E8E6E0",
                  background: isSelected ? (NOTE_CAT_COLORS[cat] || "#534AB7") : "#fff",
                  color: isSelected ? "#fff" : "#888780", transition: "all .12s",
                }}>{cat}</button>
              );
            })}
          </div>
          {totalPrefSelected > 0 && (
            <div style={{ fontSize: 10, color: "#1D9E75", marginTop: 10 }}>
              ✓ {totalPrefSelected} Präferenz{totalPrefSelected !== 1 ? "en" : ""} aktiv – Empfehlungen sind personalisiert
            </div>
          )}
        </div>
      </SettingsSection>

      {/* ── API ─────────────────────────────────────────────── */}
      <SettingsSection title="API & Datenquellen" icon="⌗">
        <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, lineHeight: 1.6 }}>
          Kostenloser Groq-Key unter{" "}
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
            style={{ color: "#185FA5" }}>console.groq.com/keys</a>
          {" "}– lokal gespeichert. Free-Tier: 30 Req/Min, 1.000/Tag.
          Token Manager rotiert automatisch zwischen 3 Modellen.
        </div>
        <label htmlFor="groq-key" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Groq API Key</label>
        <input id="groq-key" type="password" autoComplete="off" spellCheck={false}
          value={groqKeyDraft}
          onChange={e => { setGroqKeyDraft(e.target.value); setGroqKeyMsg(""); }}
          placeholder="gsk_…"
          style={{ ...S.inp, marginBottom: 10, fontFamily: "ui-monospace,monospace", fontSize: 12 }} className="inp" />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => {
            const t = groqKeyDraft.trim();
            // Validate format: Groq keys start with "gsk_" and are at least 30 chars
            if (!t.startsWith("gsk_") || t.length < 30) {
              setGroqKeyMsg('Ungültiger Schlüssel – Groq-Keys beginnen mit "gsk_".');
              return;
            }
            try { localStorage.setItem(KEYS.groqKey, t); setGroqKeyMsg("✓ Gespeichert."); }
            catch { setGroqKeyMsg("Speichern fehlgeschlagen."); }
          }} style={{ ...S.btn("pri"), padding: "10px 16px" }} className="btn">Speichern</button>
          <button type="button" onClick={() => {
            try { localStorage.removeItem(KEYS.groqKey); } catch { }
            setGroqKeyDraft(""); setGroqKeyMsg("Schlüssel entfernt.");
          }} style={{ ...S.btn("out"), padding: "10px 16px" }} className="btn">Entfernen</button>
        </div>
        {groqKeyMsg && <div style={{ fontSize: 12, marginTop: 8, color: groqKeyMsg.includes("✓") ? "#1D9E75" : "#993C1D" }}>{groqKeyMsg}</div>}
        <GroqRateLimitStatus />
      </SettingsSection>

      {/* ── Daten ───────────────────────────────────────────── */}
      <SettingsSection title="Daten & Backup" icon="◎">
        {/* Parfumo-Link */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, lineHeight: 1.5 }}>
            Parfumo-URL eingeben → Daten werden automatisch extrahiert.
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 6 }}>FORMAT</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["Probe", "Flakon", "Decant"].map(f => (
                <button key={f} onClick={() => setFormat(f)}
                                        className="btn" style={{ ...S.btn("out"), padding: "8px 14px", fontSize: 11 }}>{f}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <label htmlFor="parfumo-url" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Parfumo URL</label>
            <input id="parfumo-url" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setLinkErr(""); setStatus(""); }}
              onKeyDown={e => e.key === "Enter" && !loading && handleLookup()}
              placeholder="https://www.parfumo.de/Parfums/…"
              style={{ ...S.inp, flex: 1, fontSize: 12 }} className="inp" />
            <button onClick={handleLookup} disabled={loading || !linkUrl.trim()}
              style={{ ...S.btn("pri"), padding: "10px 14px", opacity: loading || !linkUrl.trim() ? 0.5 : 1 }}
              className="btn">
              {loading ? "…" : "Laden"}
            </button>
          </div>
          {status && <div style={{ fontSize: 11, color: status.startsWith("⚠") ? "#BA7517" : "#888780", marginBottom: 6 }}>{status}</div>}
          {linkErr && <div style={{ fontSize: 11, color: "#E24B4A", marginBottom: 6 }}>{linkErr}</div>}
          {preview && (
            <div style={{ background: "#F1EFE8", borderRadius: 10, padding: "14px", marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Vorschau</div>
              <div style={{ display: "grid", gap: 7, marginBottom: 10 }}>
                <input value={preview.name || ""} onChange={e => setPreview(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name *" className="inp" style={{ ...S.inp, fontSize: 12 }} />
                <input value={preview.house || ""} onChange={e => setPreview(p => ({ ...p, house: e.target.value }))}
                  placeholder="Haus" className="inp" style={{ ...S.inp, fontSize: 12 }} />
                <textarea value={preview.top || ""} onChange={e => setPreview(p => ({ ...p, top: e.target.value }))}
                  placeholder="Kopfnoten" className="ta" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                <textarea value={preview.middle || ""} onChange={e => setPreview(p => ({ ...p, middle: e.target.value }))}
                  placeholder="Herznoten" className="ta" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                <textarea value={preview.base || ""} onChange={e => setPreview(p => ({ ...p, base: e.target.value }))}
                  placeholder="Basisnoten" className="ta" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                {/* Neue Felder aus der Netlify Function (optional, zur Information) */}
                <input value={preview.year || ""} onChange={e => setPreview(p => ({ ...p, year: e.target.value }))}
                  placeholder="Jahr (Veröffentlichung)" className="inp" style={{ ...S.inp, fontSize: 12 }} />
                <input value={preview.maker || ""} onChange={e => setPreview(p => ({ ...p, maker: e.target.value }))}
                  placeholder="Hersteller" className="inp" style={{ ...S.inp, fontSize: 12 }} />
                <input value={preview.target || ""} onChange={e => setPreview(p => ({ ...p, target: e.target.value }))}
                  placeholder="Zielgruppe (Damen/Herren/Damen und Herren)" className="inp" style={{ ...S.inp, fontSize: 12 }} />
                <textarea value={preview.scent_character || ""} onChange={e => setPreview(p => ({ ...p, scent_character: e.target.value }))}
                  placeholder="Duftcharakter" className="ta" style={{ ...S.ta, minHeight: 40, fontSize: 12 }} />
                <textarea value={preview.longevity_sillage || ""} onChange={e => setPreview(p => ({ ...p, longevity_sillage: e.target.value }))}
                  placeholder="Haltbarkeit und Sillage" className="ta" style={{ ...S.ta, minHeight: 40, fontSize: 12 }} />
                <textarea value={preview.accords && preview.accords.map(a => a.name).join(", ") || ""}
                  onChange={e => setPreview(p => ({ ...p, accords: e.target.value.split(",").map(s => ({ name: s.trim() })).filter(Boolean) }))}
                  placeholder="Accorde (durch Komma getrennt)" className="ta" style={{ ...S.ta, minHeight: 40, fontSize: 12 }} />
                <textarea value={Object.entries(preview.seasons || {})
                  .map(([k, v]) => `${k} (${v}%)`).join(", ") || ""}
                  onChange={e => setPreview(p => {
                    const map = {};
                    e.target.value.split(",").forEach(part => {
                      const m = part.match(/(.+?)\((\d+)%\)/);
                      if (m) map[m[1].trim()] = parseInt(m[2], 10);
                    });
                    return { ...p, seasons: map };
                  })}
                  placeholder="Jahreszeiten (durch Komma getrennt, z.B. Sommer (40%), Herbst (30%))" className="ta" style={{ ...S.ta, minHeight: 40, fontSize: 12 }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmAdd} style={{ ...S.btn("pri"), flex: 1, padding: "10px" }}>
                  Hinzufügen als {format}
                </button>
                <button onClick={() => { setPreview(null); setStatus(""); }} style={{ ...S.btn("out"), padding: "10px" }}>✕</button>
              </div>
            </div>
          )}
        </div>

        {/* TSV Import */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#B4B2A9", marginBottom: 8 }}>IMPORTIEREN (TSV / CSV / JSON)</div>
          <FileUpload onChange={files => handleFile(files[0])} />
          {msg && (
            <div style={{ fontSize: 12, marginTop: 8, textAlign: "center", color: msg.type === "err" ? "#993C1D" : "#1D9E75" }}>
              {msg.text}
            </div>
          )}
        </div>

        {/* Export */}
        <div>
          <button onClick={onExport} className="btn" style={{ ...S.btn("out"), width: "100%" }}>
            TSV exportieren ({items.length} Einträge)
          </button>
          <div style={{ fontSize: 11, color: "#888780", marginTop: 6 }}>Tab-getrennt, UTF-8 inkl. Bewertungen.</div>
        </div>
      </SettingsSection>

      {/* ── Gefahrenzone ────────────────────────────────────── */}
      <SettingsSection title="Gefahrenzone" icon="⚠">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => setConfirmMode("items")}
            className="btn" style={{ ...S.btn("out"), width: "100%", color: "#A32D2D", borderColor: "#F09595" }}>
            Sammlung leeren
          </button>
          <button onClick={() => setConfirmMode("all")}
            className="btn" style={{ ...S.btn("out"), width: "100%", color: "#A32D2D", borderColor: "#F09595", fontSize: 12 }}>
            Alle Daten zurücksetzen
          </button>
        </div>
      </SettingsSection>
      <Dialog open={Boolean(confirmMode)} onClose={() => setConfirmMode(null)} className="relative z-[9100]">
        <div className="fixed inset-0 bg-black/45" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-5">
          <Dialog.Panel style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 360, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 500, color: "#A32D2D", marginBottom: 8 }}>
              {confirmMode === "items" ? `Alle ${items.length} Parfüms wirklich löschen?` : "Wirklich alle Daten löschen?"}
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: 11, color: "#888780", marginBottom: 16 }}>
              {confirmMode === "items" ? "Log, Notizen und Einstellungen bleiben erhalten." : "Sammlung, Log, Notizen, Füllstände – alles wird unwiderruflich gelöscht."}
            </Dialog.Description>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => {
                if (confirmMode === "items") onClearAll();
                else if (onClearAllData) onClearAllData();
                setConfirmMode(null);
              }} style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }} className="btn">
                Ja, löschen
              </button>
              <button onClick={() => setConfirmMode(null)} style={{ ...S.btn("out"), flex: 1 }} className="btn">
                Abbrechen
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* Celebration-Card nach dem Bestätigen eines gescrapten Parfums.
          key: stellt sicher, dass die Animation bei jedem Hinzufügen neu startet. */}
      {celebrate && <EvolveCard key={celebrate.id} perfume={celebrate} onClose={() => setCelebrate(null)} />}
    </div>
  );
}

export default EinstellungenTab;
