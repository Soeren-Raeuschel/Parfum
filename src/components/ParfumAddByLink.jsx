/**
 * ParfumAddByLink.jsx – Parfüm per Parfumo-URL hinzufügen:
 * Modal mit URL-Eingabe, automatischem Daten-Lookup, bearbeitbarer
 * Vorschau und EvolveCard-Celebration nach dem Hinzufügen.
 * Wird aus der Sammlung (SammlungTab) geöffnet.
 */

import { useState } from "react";
import { Dialog } from "@headlessui/react";
import { S } from "../shared/ui";
import { SEASONS, validateParfumoLookupUrl, extrahiereBrandName } from "../shared/constants";
import EvolveCard from "./EvolveCard";
import { newId } from "../data/localAdapter";
import { ladeParfumdaten } from "../utils/parfumoLookup";

export default function ParfumAddByLink({ items, onAdd, onClose, open }) {
  const [linkUrl, setLinkUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [format, setFormat] = useState("Probe");
  // Celebration-Overlay (EvolveCard) nach erfolgreichem Hinzufügen
  const [celebrate, setCelebrate] = useState(null);

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
    setCelebrate({ ...preview, format }); // Celebration-Card mit 3D-Animation zeigen
    setPreview(null); setLinkUrl(""); setStatus("");
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="relative z-[9100]">
      <div className="fixed inset-0 bg-black/45" aria-hidden="true" />
      <div className="fixed inset-0 overflow-y-auto flex items-start justify-center p-5 pt-[8vh]">
        <Dialog.Panel style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)", maxHeight: "80vh", overflowY: "auto" }}>
          <Dialog.Title style={{ fontSize: 14, fontWeight: 500, color: "#1A1A18", marginBottom: 10, fontFamily: "'Georgia',serif" }}>
            Parfüm hinzufügen
          </Dialog.Title>
          <div style={{ marginBottom: 12 }}>
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
            autoFocus
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
              {/* Saison: bewusst als Auswahlfeld, damit sich die Jahreszeit auch
                  nachträglich setzen lässt, wenn Parfumo kein Chart liefert. */}
              <div>
                <label htmlFor="preview-season" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Saison</label>
                <select id="preview-season" value={preview.season || "Ganzjährig"}
                  onChange={e => setPreview(p => ({
                    ...p,
                    season: e.target.value,
                    // Jahreszeiten-Verteilung mitführen, damit die Anzeige konsistent bleibt
                    seasons: e.target.value === "Ganzjährig" ? p.seasons : { [e.target.value]: 100 },
                  }))}
                  className="inp" style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
                  {SEASONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
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
                  // Führende Saison (höchster Anteil) automatisch ins Saison-Feld übernehmen
                  const top = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
                  return { ...p, seasons: map, season: top ? top[0] : p.season };
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

        </Dialog.Panel>
      </div>
    </Dialog>

      {/* Celebration-Card nach dem Bestätigen eines gescrapten Parfums.
          WICHTIG: außerhalb des <Dialog> rendern! Headless UI unmountet beim
          Schließen (open=false) das komplette Panel inkl. aller Kinder –
          steht die EvolveCard darin, verschwindet sie sofort wieder und die
          Animation läuft nie an (das war der Bug, warum auf iOS/überall die
          Celebration beim Hinzufügen „weg“ war).
          key: stellt sicher, dass die Animation bei jedem Hinzufügen neu startet. */}
      {celebrate && <EvolveCard key={celebrate.id} perfume={celebrate} onClose={() => setCelebrate(null)} />}
    </>
  );
}
