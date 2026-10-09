/**
 * SammlungTab.jsx – Sammlungs-Ansicht (aus App.jsx ausgelagert):
 * SammlungTab, DetailView, PerfumeCard, PerfumeList,
 * SpotifyCard, NotesEditModal, ReloadDiffModal, CostPerWear*,
 * BrandInfo, FunFactsCard, FillLevelEditor und MoodHeader.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog } from "@headlessui/react";
import { S, FamilyPill, Stars, useBodyLock } from "../shared/ui";
import { CONC_COLORS, FAMILIES, FAM_COLORS, NOTE_CAT_COLORS, SEASONS, primaryFamily } from "../shared/constants";
import { splitNotes } from "../utils/helpers";
import { groqFetch } from "../utils/groqClient";
import { lookupByUrl } from "../utils/parfumoLookup";
import { buildExportCsv, buildExportPayload, exportReplacer, shareOrDownloadFile } from "../utils/collectionIO";
import { getAllNotes, matchPerfume, normalizeTerm } from "../utils/perfumeSearch";
import { useDebounce } from "../utils/hooks";

const FILL_LEVELS = [100, 75, 50, 25, 0];
const FILL_LABELS = { 100: "Voll", 75: "¾", 50: "½", 25: "¼", 0: "Leer" };
const FILL_COLORS = { 100: "#1D9E75", 75: "#0F6E56", 50: "#BA7517", 25: "#E24B4A", 0: "#5F5E5A" };

function FillLevelEditor({ item, fillLevels, onSetFill }) {
  if (item.format !== "Flakon") return null; // CRITICAL: only for Flakons
  const current = fillLevels[item.id] ?? null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="lbl">FÜLLSTAND</div>
      <div style={{ display: "flex", gap: 6 }}>
        {FILL_LEVELS.map(level => {
          const active = current === level;
          const color = FILL_COLORS[level];
          return (
            <button key={level} onClick={() => onSetFill(item.id, active ? null : level)}
              title={FILL_LABELS[level]}
              style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${active ? color : "#E8E6E0"}`,
                background: active ? color + "22" : "transparent", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2
              }}>
              <div style={{
                width: "100%", height: 28, background: "#F1EFE8", borderRadius: 4,
                overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end"
              }}>
                <div style={{
                  width: "100%", height: `${level}%`, background: active ? color : color + "55",
                  transition: "height .3s"
                }} />
              </div>
              <div style={{ fontSize: 9, color: active ? color : "#888780" }}>{FILL_LABELS[level]}</div>
            </button>
          );
        })}
      </div>
      {current !== null && current <= 25 && (
        <div style={{ fontSize: 11, color: "#E24B4A", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span>◎</span>
          <span>{current === 0 ? "Leer – evtl. nachfüllen oder ersetzen" : "Fast leer – bald aufbrauchen oder ersetzen"}</span>
        </div>
      )}
    </div>
  );
}

const MOOD_GRADIENTS = {
  Floral:      { g: "linear-gradient(135deg, #FADADD 0%, #F4C2C2 30%, #E8A0BF 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✿" },
  Woody:       { g: "linear-gradient(135deg, #E8DCC8 0%, #C4A882 30%, #8B6F47 60%, #5C4033 100%)",    accent: "#8B6F47", icon: "⌁" },
  Oriental:    { g: "linear-gradient(135deg, #F7E8D0 0%, #C9956B 30%, #8B5E3C 50%, #4A2C17 100%)",    accent: "#8B5E3C", icon: "✦" },
  Fresh:       { g: "linear-gradient(135deg, #E0F7FA 0%, #B2EBF2 30%, #80DEEA 60%, #1D9E75 100%)",    accent: "#1D9E75", icon: "❃" },
  Chypre:      { g: "linear-gradient(135deg, #E8E4D9 0%, #A8B5A0 30%, #6B8E5A 60%, #3E5C2B 100%)",    accent: "#6B8E5A", icon: "⊛" },
  "Fougère":   { g: "linear-gradient(135deg, #E8EDE4 0%, #B5C9A8 30%, #7BA05B 60%, #3B6D11 100%)",    accent: "#7BA05B", icon: "⌘" },
  Gourmand:    { g: "linear-gradient(135deg, #FFF0E0 0%, #F5C6AA 30%, #E89B7A 55%, #C2604A 100%)",    accent: "#E89B7A", icon: "◉" },
  Aquatisch:   { g: "linear-gradient(135deg, #DAEEF3 0%, #A8D8EA 30%, #6CB4D4 60%, #2E86AB 100%)",    accent: "#2E86AB", icon: "≋" },
  Zitrisch:    { g: "linear-gradient(135deg, #FFFDE7 0%, #FFF176 30%, #FFD600 60%, #C9A825 100%)",    accent: "#C9A825", icon: "◌" },
  Süß:         { g: "linear-gradient(135deg, #FCE4EC 0%, #F8BBD9 30%, #F48FB1 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✶" },
  Würzig:      { g: "linear-gradient(135deg, #FFF3E0 0%, #FFCC80 30%, #FFA726 60%, #BA7517 100%)",    accent: "#BA7517", icon: "✳" },
  Grün:        { g: "linear-gradient(135deg, #E8F5E9 0%, #A5D6A7 30%, #66BB6A 60%, #5C6B4F 100%)",    accent: "#5C6B4F", icon: "✾" },
  Animalisch:  { g: "linear-gradient(135deg, #EFEBE9 0%, #BCAAA4 30%, #8D6E63 60%, #8B4513 100%)",    accent: "#8B4513", icon: "◈" },
  Harzig:      { g: "linear-gradient(135deg, #FBE9E7 0%, #FFAB91 30%, #A1632A 60%, #8B5E3C 100%)",    accent: "#8B5E3C", icon: "◆" },
  Rauchig:     { g: "linear-gradient(135deg, #ECEFF1 0%, #B0BEC5 30%, #78909C 60%, #5F5E5A 100%)",    accent: "#5F5E5A", icon: "◎" },
  Pudrig:      { g: "linear-gradient(135deg, #FCE4EC 0%, #E8C8D4 30%, #D4A8BC 60%, #C4A0B0 100%)",    accent: "#C4A0B0", icon: "◯" },
  Fruchtig:    { g: "linear-gradient(135deg, #FFF8E1 0%, #FFCC80 30%, #FF8A65 60%, #C2604A 100%)",    accent: "#C2604A", icon: "✺" },
  Erdig:       { g: "linear-gradient(135deg, #EFEBE9 0%, #D7CCC8 30%, #A1887F 60%, #6B5B3E 100%)",    accent: "#6B5B3E", icon: "◭" },
  Cremig:      { g: "linear-gradient(135deg, #FFF8E1 0%, #FFECB3 30%, #FFD54F 60%, #E89B7A 100%)",    accent: "#E89B7A", icon: "◍" },
  Synthetisch: { g: "linear-gradient(135deg, #EDE7F6 0%, #B39DDB 30%, #9575CD 60%, #7F77DD 100%)",    accent: "#7F77DD", icon: "⌖" },
  Sonstiges:   { g: "linear-gradient(135deg, #EDEDED 0%, #C8C8C8 30%, #9E9E9E 60%, #5F5E5A 100%)",    accent: "#888780", icon: "◇" },
};

function MoodHeader({ family, base, families }) {
  const primaryFamily = (families && families.length > 0) ? families[0] : family;
  const mood = MOOD_GRADIENTS[primaryFamily] || MOOD_GRADIENTS["Sonstiges"];
  const notes = splitNotes(base);
  const topNotes = notes.slice(0, 3);

  return (
    <div style={{
      position: "relative", borderRadius: 12, overflow: "hidden",
      marginBottom: 12, height: 140,
      background: mood.g,
    }}>
      {/* Inhalt */}
      <div style={{
        position: "absolute", bottom: 12, left: 14, right: 14,
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      }}>
        <span style={{
          fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase",
          background: "rgba(255,255,255,0.22)",
          color: "#fff", padding: "5px 14px", borderRadius: 20,
          fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ fontSize: 14 }}>{mood.icon}</span>
          {family || "Sonstiges"}
        </span>
        {topNotes.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {topNotes.map((n, i) => (
              <span key={i} style={{
                fontSize: 10, color: "rgba(255,255,255,0.85)",
                background: "rgba(0,0,0,0.15)",
                padding: "2px 8px", borderRadius: 20,
              }}>{n.trim()}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CostPerWearModal({ perfumeId, perfumeName, wearCount, priceMl, onSavePriceMl, onClose }) {
  useBodyLock(true);
  const data = priceMl[perfumeId] || null;
  const [editing, setEditing] = useState(!data);
  const [price, setPrice] = useState(data?.price ?? "");
  const [ml, setMl] = useState(data?.ml ?? "");

  useEffect(() => {
    const d = priceMl[perfumeId] || null;
    if (d) { setPrice(d.price); setMl(d.ml); setEditing(false); }
    else { setPrice(""); setMl(""); setEditing(true); }
  }, [perfumeId, priceMl]);

  function handleSave() {
    const p = parseFloat(price);
    const m = parseFloat(ml);
    if (!Number.isFinite(p) || p < 0 || !Number.isFinite(m) || m <= 0) return;
    onSavePriceMl(perfumeId, { price: p, ml: m });
    setEditing(false);
  }

  // Stats
  const totalSprays = data ? data.ml * 10 : 0;
  const costPerSpray = data ? data.price / totalSprays : 0;
  const costPerWear = data && wearCount > 0 ? data.price / wearCount : null;
  const spraysUsed = wearCount * 3;
  const spraysLeft = Math.max(0, totalSprays - spraysUsed);
  const pctUsed = totalSprays > 0 ? Math.min(100, (spraysUsed / totalSprays) * 100) : 0;
  const estWearsLeft = spraysLeft > 0 ? Math.floor(spraysLeft / 3) : 0;
  const barColor = pctUsed > 75 ? "#E24B4A" : pctUsed > 50 ? "#BA7517" : "#1D9E75";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
    }}
      onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 20, marginTop: 16,
        maxWidth: 400, width: "100%", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
        boxShadow: "0 8px 32px rgba(0,0,0,.2)"
      }}
        onClick={function (e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div className="lbl" style={{marginBottom: 2 }}>COST PER WEAR</div>
            <div style={{ fontSize: 14, color: "#1A1A18", fontFamily: "'Georgia',serif" }}>{perfumeName}</div>
          </div>
          <button onClick={onClose} aria-label="Modal schließen"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
        </div>

        {/* Edit form */}
        {(editing || !data) && (
          <div>
            <div style={{ fontSize: 12, color: "#888780", marginBottom: 12 }}>
              Preis und Größe eingeben, um die Kosten pro Tragung zu berechnen.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Preis €</div>
                <input id="detail-price" type="number" min="0" step="0.01" value={price}
                  onChange={e => setPrice(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                  placeholder="0.00" className="inp" style={{ ...S.inp, fontSize: 13 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Größe ml</div>
                <input id="detail-size" type="number" min="1" step="1" value={ml}
                  onChange={e => setMl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                  placeholder="100" className="inp" style={{ ...S.inp, fontSize: 13 }} />
              </div>
            </div>
            <button onClick={handleSave}
              disabled={!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0}
              style={{
                ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px",
                opacity: (!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0) ? 0.4 : 1
              }}>
              Speichern
            </button>
          </div>
        )}

        {/* Stats view */}
        {data && !editing && (
          <div>
            {/* Main stat */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 32, fontWeight: 400, color: "#1A1A18", lineHeight: 1 }}>
                {costPerWear !== null ? `${costPerWear.toFixed(2)} €` : "– €"}
              </div>
              <div style={{ fontSize: 11, color: "#888780", marginTop: 4 }}>pro Tragung</div>
            </div>

            {/* Details grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14,
              background: "#F1EFE8", borderRadius: 8, padding: "12px 8px"
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{(+data.price || 0).toFixed(2)} €</div>
                <div className="lbl" style={{marginBottom: 0 }}>GESAMTPREIS</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{costPerSpray.toFixed(3)} €</div>
                <div className="lbl" style={{marginBottom: 0 }}>PRO SPRAY</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: "#1A1A18" }}>{data.ml} ml</div>
                <div className="lbl" style={{marginBottom: 0 }}>FLAKON</div>
              </div>
            </div>

            {/* Usage bar */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: "#888780" }}>{spraysUsed} / {totalSprays} Sprays</div>
                <div style={{ fontSize: 10, color: "#888780" }}>{Math.round(pctUsed)}%</div>
              </div>
              <div style={{ height: 6, background: "#E8E6E0", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pctUsed}%`, background: barColor, borderRadius: 3, transition: "width .5s" }} />
              </div>
            </div>

            {/* Remaining */}
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#888780", marginBottom: 14 }}>
              <span>◎ {spraysLeft} Sprays übrig</span>
              <span>◎ ~{estWearsLeft} Tragungen</span>
            </div>

            {wearCount === 0 && (
              <div style={{ fontSize: 10, color: "#BA7517", fontStyle: "italic", marginBottom: 12 }}>
                Noch keine Tragungen – Cost-per-Wear berechnet sich nach dem ersten „Tragen".
              </div>
            )}

            <button onClick={() => setEditing(true)}
              style={{ ...S.btn("out"), width: "100%", fontSize: 13, padding: "10px" }}>
              Preis / Größe bearbeiten
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: BRAND INFO (Wikipedia)
// ══════════════════════════════════════════════════════════════════════════════
const _wikiCache = {};
async function fetchBrandInfo(brand) {
  if (!brand || brand.trim().length < 2) return null;
  const key = brand.trim().toLowerCase();
  if (_wikiCache[key] !== undefined) return _wikiCache[key];
  try {
    const { text } = await groqFetch({
      messages: [
        { role: "system", content: "Parfüm-Experte. Antworte NUR mit 2-3 Sätzen auf Deutsch: Gründer, Jahr, Land, bekannter Duft. Kein Markdown." },
        { role: "user", content: `Marke: ${brand}` },
      ],
      temperature: 0.4, max_tokens: 120,
      cacheKey: "brand:" + key,
    });
    if (text && text.length > 15) {
      const result = { text, url: null };
      _wikiCache[key] = result;
      return result;
    }
    _wikiCache[key] = null;
    return null;
  } catch(err) {
    // Nur bei dauerhaften Fehlern (kein Key, 404) cachen – nicht bei Rate-Limit oder Netzwerk
    const msg = err?.message || "";
    const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
    if (isPermanent) _wikiCache[key] = null;
    // Bei Rate-Limit oder Netzwerkfehler: nicht cachen → nächster Versuch klappt evtl.
    return null;
  }
}

function BrandInfo({ house }) {
  const [info, setInfo] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const houseRef = useRef(house);

  useEffect(() => {
    houseRef.current = house;
    setInfo(null);
    setExpanded(false);
    setErrMsg("");
  }, [house]);

  async function handleToggle() {
    if (expanded && info) { setExpanded(false); return; }
    setExpanded(true);
    if (info || !house) return;
    setLoading(true); setErrMsg("");
    try {
      const result = await fetchBrandInfo(house);
      if (houseRef.current === house) {
        if (result) setInfo(result);
        else setErrMsg("Keine Infos gefunden – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
    }
    setLoading(false);
  }

  async function handleRetry() {
    const key = house.trim().toLowerCase();
    delete _wikiCache[key];
    setInfo(null); setErrMsg(""); setLoading(true);
    try {
      const result = await fetchBrandInfo(house);
      if (houseRef.current === house) {
        if (result) setInfo(result);
        else setErrMsg("Keine Infos gefunden.");
      }
    } catch(e) {
      if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
    }
    setLoading(false);
  }

  if (!house) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <input value={house} readOnly
          style={{
            fontSize: 12, color: "#5F5E5A", border: "none", background: "transparent",
            padding: 0, fontFamily: "'Georgia',serif", width: "auto", flex: "none",
            outline: "none", cursor: "default", WebkitUserSelect: "none", userSelect: "none"
          }} />
        <button onClick={handleToggle}
          style={{
            background: "none", border: "1px solid #D3D1C7", borderRadius: "50%",
            width: 18, height: 18, minWidth: 18, minHeight: 18, aspectRatio: "1 / 1", cursor: "pointer", display: "inline-flex",
            alignItems: "center", justifyContent: "center", fontSize: 10,
            color: expanded ? "#534AB7" : "#B4B2A9", lineHeight: 1, padding: 0,
            transition: "all .15s", flexShrink: 0, boxSizing: "content-box"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#534AB7'); e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', expanded ? '#534AB7' : '#B4B2A9') }}>
          i
        </button>
      </div>
      {expanded && (
        <div style={{
          marginTop: 8, padding: "10px 12px", background: "#F1EFE8", borderRadius: 8,
          fontSize: 12, color: "#5F5E5A", lineHeight: 1.6, animation: "fadeIn .3s"
        }}>
          {loading ? (
            <span style={{ color: "#B4B2A9", fontStyle: "italic" }}>Lade Hintergrundinfo…</span>
          ) : info ? (
            <div>{info.text}</div>
          ) : errMsg ? (
            <div>
              <div style={{ color: "#B4B2A9", fontStyle: "italic", marginBottom: errMsg.includes("Settings") ? 0 : 6 }}>{errMsg}</div>
              {!errMsg.includes("Settings") && (
                <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "4px 10px" }}>
                  Nochmal versuchen
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: FUN FACTS (Groq)
// ══════════════════════════════════════════════════════════════════════════════
const _factsCache = {};
async function fetchFunFacts(name, house, top, middle, base, extra = {}) {
  if (!name) return null;
  // Cache-Key inkludiert Noten-Fingerprint → neue Noten = neue Facts
  const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
  const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
  const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
  if (_factsCache[key] !== undefined) return _factsCache[key];

  // Zusatzinfos für präziseren Prompt
  const { conc, family, season, gender } = extra;
  const contextParts = [
    conc && `Konzentration: ${conc}`,
    family && `Familie: ${family}`,
    season && `Saison: ${season}`,
    gender && `Zielgruppe: ${gender}`,
  ].filter(Boolean).join(", ");

  const systemPrompt = `Du bist ein Parfüm-Experte. Gib genau 3 Fun-Facts auf Deutsch über das angegebene Parfüm.
Jeder Fact auf einer eigenen Zeile, kein Bullet-Point, kein Markdown.
Fokus: einzigartige Details die DIESEN Duft charakterisieren – Perfumeur, Inspiration, markante Noten-Kombination, Geschichte, Besonderheit.
Keine allgemeinen Aussagen über die Marke. Keine Wiederholung der Noten-Liste. Jeder Fact soll überraschen.`;

  const userPrompt = [
    `Parfüm: ${house ? house + " – " : ""}${name}`,
    contextParts && `Kontext: ${contextParts}`,
    noteStr && `Noten: ${noteStr}`,
  ].filter(Boolean).join("\n");

  try {
    const { text } = await groqFetch({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7, max_tokens: 180,
      cacheKey: "facts2:" + key.slice(0, 80),
    });
    if (text && text.length > 20) {
      _factsCache[key] = text;
      return text;
    }
    _factsCache[key] = null;
    return null;
  } catch(err) {
    const msg = err?.message || "";
    const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
    if (isPermanent) { _factsCache[key] = null; return null; }
    // Transiente Fehler (Rate-Limit, Netzwerk) hochwerfen, damit UI sie anzeigt
    throw err;
  }
}

function FunFactsCard({ name, house, top, middle, base, conc, family, season, gender }) {
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const nameRef = useRef(name);
  const extra = { conc, family, season, gender };

  // Reset wenn Name ODER Noten sich ändern (neue Noten = neue Facts)
  const noteFingerprint = [top, middle, base].filter(Boolean).join("|");
  useEffect(() => {
    nameRef.current = name;
    setFacts(null);
    setExpanded(false);
    setErrMsg("");
  }, [name, noteFingerprint]);

  async function handleLoad() {
    if (expanded && facts) { setExpanded(false); return; }
    setExpanded(true);
    if (facts) return;
    setLoading(true); setErrMsg("");
    try {
      const result = await fetchFunFacts(name, house, top, middle, base, extra);
      if (nameRef.current === name) {
        if (result) setFacts(result);
        else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (nameRef.current === name) {
        const msg = e.message || "";
        const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
        if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
        else if (msg.includes("API-Limit")) setErrMsg(msg);
        else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
      }
    }
    setLoading(false);
  }

  async function handleRetry() {
    // Cache-Key muss mit neuem noteHash übereinstimmen → fetchFunFacts berechnet ihn intern
    const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
    const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
    const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
    delete _factsCache[key];
    setFacts(null); setErrMsg(""); setLoading(true);
    try {
      const result = await fetchFunFacts(name, house, top, middle, base, extra);
      if (nameRef.current === name) {
        if (result) setFacts(result);
        else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
      }
    } catch(e) {
      if (nameRef.current === name) {
        const msg = e.message || "";
        const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
        if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
        else if (msg.includes("API-Limit")) setErrMsg(msg);
        else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
      }
    }
    setLoading(false);
  }

  if (!name) return null;

  return (
    <div className="card" style={{marginBottom: 12 }}>
      <button onClick={handleLoad} aria-expanded={expanded}
        style={{
          background: "none", border: "none", cursor: "pointer", width: "100%",
          display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }} aria-hidden="true">✦</span>
          <div className="lbl">FUN FACTS</div>
        </div>
        <span style={{
          fontSize: 12, color: "#B4B2A9", transition: "transform .2s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)"
        }} aria-hidden="true">▾</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1EFE8",
          animation: "fadeIn .3s"
        }}>
          {loading ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <span style={{ fontSize: 11, color: "#B4B2A9", animation: "pulse 1.2s ease-in-out infinite" }}>✦</span>
              <span style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic" }}>Sammle Facts zu diesem Duft…</span>
            </div>
          ) : facts ? (
            <div>
              {facts.split("\n").filter(s => s.trim()).map((s, i) => {
                const text = s.replace(/^[\d.\-•·]+\s*/, "").trim();
                if (!text) return null;
                return (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 10, color: "#534AB7", flexShrink: 0, marginTop: 3, fontWeight: 700 }}>
                      {["✦", "◎", "→"][i] || "·"}
                    </span>
                    <span style={{ fontSize: 13, color: "#1A1A18", lineHeight: 1.65 }}>{text}</span>
                  </div>
                );
              })}
              <button onClick={handleRetry} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit", padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                <span>↻</span><span>Neue Facts laden</span>
              </button>
            </div>
          ) : errMsg ? (
            <div>
              <div style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic", marginBottom: 6 }}>{errMsg}</div>
              {!errMsg.includes("Settings") && (
                <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "5px 12px" }}>
                  Nochmal versuchen
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: SPOTIFY CARD
// ══════════════════════════════════════════════════════════════════════════════
function getSpotifyEmbedUrl(url) {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
}
function getSpotifyOpenUrl(url) {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/${m[1]}/${m[2]}`;
}

function SpotifyCard({ spotifyUrl, onEdit }) {
  const openUrl = getSpotifyOpenUrl(spotifyUrl);

  if (openUrl) {
    return (
      <div style={{ marginBottom: 10 }}>
        <a href={openUrl} target="_blank" rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 10,
            background: "#1DB954", color: "#fff", textDecoration: "none",
            fontSize: 12, fontWeight: 500, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)",
            transform: "translateY(0)", boxShadow: "0 2px 8px rgba(29,185,84,0.3)"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(-2px)'); e.currentTarget.style.setProperty('box-shadow', '0 4px 15px rgba(29,185,84,0.4)') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(0)'); e.currentTarget.style.setProperty('box-shadow', '0 2px 8px rgba(29,185,84,0.3)') }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          Spotify
        </a>
        <button onClick={onEdit} aria-label="Spotify-URL bearbeiten"
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9",
            padding: "8px 0 0 2px", marginLeft: 4, transition: "color .12s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#B4B2A9') }}>
          ändern
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <button onClick={onEdit} aria-label="Soundtrack hinzufügen"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "8px 14px", borderRadius: 10,
          border: "1px dashed #D3D1C7", background: "transparent",
          color: "#B4B2A9", fontSize: 12, cursor: "pointer",
          transition: "all .15s", fontFamily: "'Georgia',serif"
        }}
        onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#1DB954'); e.currentTarget.style.setProperty('color', '#1DB954'); }}
        onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', '#B4B2A9'); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity=".5" aria-hidden="true" focusable="false">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        Soundtrack hinzufügen
      </button>
    </div>
  );
}

function NotesEditModal({ perfume, onClose, onUpdate, onSaveNote, localNotes, onSearchNote, removeTag, addTag, noteInput, setNoteInput }) {
  useBodyLock(true);
  const [local, setLocal] = useState({ ...perfume });

  function setField(k, v) {
    setLocal(prev => ({ ...prev, [k]: v }));
  }
  function handleSave() {
    const patch = {};
    ["house", "families", "season", "conc", "top", "middle", "base", "spotify_url"].forEach(k => {
      const oldVal = perfume[k];
      const newVal = local[k];
      const changed = (Array.isArray(newVal) || Array.isArray(oldVal))
        ? JSON.stringify(newVal || []) !== JSON.stringify(oldVal || [])
        : newVal !== oldVal;
      if (changed) patch[k] = newVal;
    });
    if (Object.keys(patch).length > 0) onUpdate(perfume.id, patch);
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "env(safe-area-inset-top,16px) 16px 16px", paddingTop: "max(env(safe-area-inset-top),20px)", overflowY: "auto", overscrollBehavior: "contain"
    }}
      onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 20,
        maxWidth: 420, width: "100%", maxHeight: "85dvh", overflowY: "auto",
        WebkitOverflowScrolling: "touch", marginTop: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,.2)"
      }}
        onClick={function (e) { e.stopPropagation() }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="lbl" style={{marginBottom: 0 }}>DUFTDATEN BEARBEITEN</div>
          <button onClick={onClose} aria-label="Modal schließen"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label htmlFor="note-house" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Haus / Marke</label>
          <input id="note-house" value={local.house || ""} onChange={e => setField("house", e.target.value)}
            placeholder="z.B. Bon Parfumeur" className="inp" style={{ ...S.inp, fontSize: 12 }} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#888780", marginBottom: 6, display: "block" }}>
              Familien · Reihenfolge = Priorität (#8)
            </label>
            {/* Ausgewählte Familien als geordnete Liste mit Prioritäts-Badges */}
            {(local.families && local.families.length > 0) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {local.families.map((fam, idx) => {
                  const col = FAM_COLORS[fam] || "#534AB7";
                  const priorityLabel = idx === 0 ? "1. Hauptfamilie" : idx === 1 ? "2. Nebenfamilie" : "3. weitere";
                  const weights = ["1.0×", "0.5×", "0.25×"];
                  return (
                    <div key={fam} style={{ display: "flex", alignItems: "center", gap: 3, background: col + "18", border: `1px solid ${col}`, borderRadius: 16, padding: "3px 8px 3px 4px" }}>
                      <span style={{ fontSize: 9, background: col, color: "#fff", borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }}>{idx + 1}</span>
                      <span style={{ fontSize: 11, color: col }}>{fam}</span>
                      <span style={{ fontSize: 9, color: col, opacity: 0.7 }}>{weights[idx] || "0.1×"}</span>
                      <button type="button" onClick={e => { e.stopPropagation(); setField("families", local.families.filter(f => f !== fam)); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: col, padding: "0 0 0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 6 }}>
              Tippen zum Hinzufügen · erste Auswahl = Hauptfamilie (volle Gewichtung)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...FAMILIES].filter(fam => !(local.families || []).includes(fam)).sort((a, b) => a.localeCompare(b)).map(fam => {
                const col = FAM_COLORS[fam] || "#534AB7";
                return (
                  <button key={fam} type="button" onClick={(e) => {
                    e.stopPropagation();
                    setField("families", [...(local.families || []), fam]);
                  }} style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 14,
                    border: "1px solid #E8E6E0",
                    background: "#fff", color: "#888780", cursor: "pointer",
                    transition: "all .12s",
                  }}>{fam}</button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="note-season" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Saison</label>
            <select id="note-season" value={local.season || "Ganzjährig"} onChange={e => setField("season", e.target.value)}
              className="inp" style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
              {SEASONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Konzentration – bei gescrapten Parfüms oft leer ("?" in der Detailansicht) */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="note-conc" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Konzentration</label>
          <select id="note-conc" value={local.conc || ""} onChange={e => setField("conc", e.target.value)}
            className="inp" style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
            <option value="">– keine –</option>
            {["EDC", "EDT", "EDP", "Parfum", "Extrait", "Cologne", "Eau Fraîche"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {[["Kopfnoten", "top"], ["Herznoten", "middle"], ["Basisnoten", "base"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: 10 }}>
            <label htmlFor={`note-${key}`} style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>{label}</label>
            <textarea id={`note-${key}`} value={local[key] || ""} onChange={e => setField(key, e.target.value)}
              className="ta" style={{ ...S.ta, minHeight: 52, fontSize: 12 }} />
          </div>
        ))}

        <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <label htmlFor="note-tag-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Tag eingeben</label>
            <input id="note-tag-input" value={noteInput} onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="Tag hinzufügen…" className="inp" style={{ ...S.inp, flex: 1, fontSize: 12 }} />
            <button onClick={addTag} aria-label="Tag hinzufügen" style={{ ...S.btn("pri"), padding: "8px 12px" }}>+</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="list" aria-label="Notiz-Tags">
            {localNotes.map(t => (
              <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 20, background: "#F1EFE8", fontSize: 12 }}>
                <button onClick={() => onSearchNote && onSearchNote(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}>{t}</button>
                <button onClick={() => removeTag(t)} aria-label={`Tag "${t}" entfernen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#888780" }}>✕</button>
              </span>
            ))}
            {localNotes.length === 0 && <div style={{ fontSize: 11, color: "#888780" }}>Noch keine Tags</div>}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Spotify-URL (Track oder Playlist)</div>
          <input id="note-spotify" value={local.spotify_url || ""} onChange={e => setField("spotify_url", e.target.value)}
            placeholder="https://open.spotify.com/track/…" className="inp" style={{ ...S.inp, fontSize: 12 }} />
        </div>

        <button onClick={handleSave} style={{ ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px" }}>
          Speichern
        </button>
      </div>
    </div>
  );
}

function CostPerWearButton({ perfumeId, wearCount, priceMl, onClick }) {
  const data = priceMl[perfumeId] || null;
  const cpw = data && wearCount > 0 ? (data.price / wearCount).toFixed(2) : null;

  return (
    <button onClick={onClick} aria-label={data ? `Kosten: ${cpw || data.price.toFixed(2)} Euro pro Tragung` : "Preis hinzufügen"}
      style={{
        background: "none", border: "1px solid #D3D1C7", borderRadius: 8, cursor: "pointer",
        padding: "6px 10px", fontSize: 11, fontFamily: "'Georgia',serif", color: "#888780",
        display: "inline-flex", alignItems: "center", gap: 4, transition: "all .12s"
      }}
      onMouseEnter={function (e) { e.currentTarget.style.setProperty('border-color', '#BA7517'); e.currentTarget.style.setProperty('color', '#BA7517'); }}
      onMouseLeave={function (e) { e.currentTarget.style.setProperty('border-color', '#D3D1C7'); e.currentTarget.style.setProperty('color', '#888780'); }}>
      {data ? (
        <>{cpw !== null ? `${cpw} €/Trag` : `${(+data.price || 0).toFixed(2)} €`} · {data.ml}ml</>
      ) : (
        <>Preis hinzufügen</>
      )}
    </button>
  );
}

const FIELD_LABELS = { name:"Name", house:"Haus", conc:"Konzentration", family:"Familie",
  top:"Kopfnoten", middle:"Herznoten", base:"Basisnoten", season:"Saison", gender:"Geschlecht" };

function ReloadDiffModal({ reloadDiff, onApply, onClose }) {
  useBodyLock(true);
  const [selected, setSelected] = useState(() => new Set(reloadDiff.map(d => d.field)));
  const toggle = f => setSelected(prev => { const s = new Set(prev); s.has(f) ? s.delete(f) : s.add(f); return s; });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 20, maxWidth: 420, width: "100%",
        maxHeight: "80dvh", animation: "scaleIn .2s cubic-bezier(0.25,0.46,0.45,0.94) both", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        fontFamily: "'Georgia',serif"
      }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #1A1A18 0%, #534AB7 100%)", borderRadius: "20px 20px 0 0", padding: "20px 24px 16px" }}>
          <div style={{ fontSize: 10, letterSpacing: "1.5px", color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>PARFUMO ABGLEICH</div>
          <div style={{ fontSize: 18, color: "#fff", fontWeight: 400 }}>{reloadDiff.length} Änderung{reloadDiff.length !== 1 ? "en" : ""} gefunden</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>Wähle aus, was übernommen werden soll.</div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {reloadDiff.map(d => (
            <div key={d.field} onClick={() => toggle(d.field)}
              style={{
                padding: "12px 14px", marginBottom: 8, borderRadius: 12, cursor: "pointer",
                border: selected.has(d.field) ? "1.5px solid #534AB7" : "1px solid #E8E6E0",
                background: selected.has(d.field) ? "#F4F3FD" : "#FAFAF8",
                transition: "all .15s"
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, letterSpacing: "1px", color: selected.has(d.field) ? "#534AB7" : "#B4B2A9" }}>
                  {FIELD_LABELS[d.field] || d.field}
                </span>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${selected.has(d.field) ? "#534AB7" : "#D3D1C7"}`,
                  background: selected.has(d.field) ? "#1A1A18" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  {selected.has(d.field) && <span style={{ fontSize: 10, color: "#fff" }}>✓</span>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>AKTUELL</div>
                  <div style={{ color: "#888780", fontStyle: d.old ? "normal" : "italic" }}>{d.old || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#1D9E75", marginBottom: 2 }}>NEU VON PARFUMO</div>
                  <div style={{ color: "#1A1A18", fontWeight: 500 }}>{d.fresh || "—"}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 4 }}>
            <button onClick={() => setSelected(new Set(reloadDiff.map(d => d.field)))}
              style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Alle</button>
            <button onClick={() => setSelected(new Set())}
              style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Keine</button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onApply([...selected])}
              disabled={selected.size === 0}
              style={{ ...S.btn("pri"), flex: 2, padding: "14px", borderRadius: 10, fontSize: 13,
                opacity: selected.size === 0 ? 0.4 : 1,
                boxShadow: "0 2px 8px rgba(83,74,183,0.25)" }}>
              {selected.size} Feld{selected.size !== 1 ? "er" : ""} übernehmen
            </button>
            <button onClick={onClose}
              style={{ ...S.btn("out"), flex: 1, padding: "14px", borderRadius: 10, fontSize: 13 }}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailView({ perfume, items, log, notes, onClose, onDelete, onUpdate, onSaveNote, onLog, onSearchNote, fillLevels, onSetFill, priceMl, onSavePriceMl, containerRef, declutterStatus, onSaveDeclutterStatus }) {
  const rootRef = useRef(null);
  function openOverlay(setter) {
    const fixedEl = containerRef?.current; // App-Level: eigener fixed container
    if (fixedEl) {
      // Statistik/Heute/Ordner: fixed div scrollen
      if (fixedEl.scrollTop > 10) {
        fixedEl.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => setter(true), 120);
      } else {
        setter(true);
      }
    } else {
      // SammlungTab: scrollbarer Container ist PullToRefresh-Div
      const mainEl = document.getElementById('main-scroll-container');
      const scrollEl = mainEl || window;
      const scrollTop = mainEl ? mainEl.scrollTop : window.scrollY;
      if (scrollTop > 10) {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => setter(true), 120);
      } else {
        setter(true);
      }
    }
  }
  const [local, setLocal] = useState(perfume);
  const [localNotes, setLocalNotes] = useState(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []);
  const [noteInput, setNoteInput] = useState("");
  const [showCpw, setShowCpw] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [journalText, setJournalText] = useState(local.journal || "");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  // ── Declutter-Kategorie (Verkaufen/Verschenken) aus DetailView ──
  const [declCategory, setDeclCategory] = useState(() => declutterStatus?.[perfume.id] || null);
  const [declToast, setDeclToast] = useState("");
  function saveDeclCategory(cat) {
    const next = { ...(declutterStatus || {}) };
    if (cat) { next[perfume.id] = cat; }
    else { delete next[perfume.id]; }
    if (onSaveDeclutterStatus) { onSaveDeclutterStatus(next); }
    setDeclCategory(cat);
    if (cat) {
      setDeclToast(cat === "Verkaufen" ? "💰 Als Verkaufen markiert" : cat === "Verschenken" ? "🎁 Als Verschenken markiert" : "🏠 Behalten");
      setTimeout(() => setDeclToast(""), 2200);
    }
  }
  // ── Reload-State ──
  const [reloadState, setReloadState] = useState("idle"); // idle | loading | diff | error
  const [reloadDiff, setReloadDiff] = useState(null);   // { field, old, new }[]
  const [reloadData, setReloadData] = useState(null);
  const [reloadErr, setReloadErr] = useState("");
  useBodyLock(showCpw || showNotes || showJournal || showConfirmDelete || reloadState === "diff");

  async function handleReload() {
    if (!local.url) return;
    setReloadState("loading"); setReloadErr(""); setReloadDiff(null); setReloadData(null);
    try {
      const fresh = await lookupByUrl(local.url);
      const COMPARE_FIELDS = ["name","house","conc","family","top","middle","base","season","gender"];
      const diffs = COMPARE_FIELDS.filter(f => {
        const oldV = (local[f] || "").toString().trim();
        const newV = (fresh[f] || "").toString().trim();
        return oldV !== newV && newV !== "";
      }).map(f => ({ field: f, old: (local[f] || ""), fresh: (fresh[f] || "") }));
      if (diffs.length === 0) {
        setReloadState("idle");
        setReloadErr("✓ Alle Daten sind bereits aktuell.");
        setTimeout(() => setReloadErr(""), 3000);
      } else {
        setReloadDiff(diffs);
        setReloadData(fresh);
        setReloadState("diff");
      }
    } catch(e) {
      setReloadState("error");
      setReloadErr(e.message || "Unbekannter Fehler");
      setTimeout(() => setReloadState("idle"), 4000);
    }
  }

  function applyReload(selectedFields) {
    const patch = {};
    selectedFields.forEach(f => { patch[f] = reloadData[f]; });
    onUpdate(perfume.id, patch);
    setLocal(prev => ({ ...prev, ...patch }));
    setReloadState("idle"); setReloadDiff(null); setReloadData(null);
  }

  const safeLog = Array.isArray(log) ? log : [];
  const wearCount = safeLog.filter(l => l && l.id === perfume.id).length;
  const lastWear = safeLog.filter(l => l && l.id === perfume.id).sort((a, b) => (b?.ts || 0) - (a?.ts || 0))[0];
  const lastWearText = lastWear ? new Date(lastWear.ts).toLocaleDateString("de-DE") : "Noch nie";

  useEffect(() => { setLocal(perfume); }, [perfume]);
  useEffect(() => { setLocalNotes(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []); }, [notes, perfume.id]);

  function setFieldLocal(k, v) { setLocal(prev => ({ ...prev, [k]: v })); }
  function commitField(k) {
    onUpdate(perfume.id, { [k]: local[k] });
  }
  function addTag() {
    const t = noteInput.trim();
    if (!t) return;
    const next = [...new Set([...localNotes, t])];
    setLocalNotes(next);
    onSaveNote(perfume.id, next);
    setNoteInput("");
  }
  function removeTag(t) {
    const next = localNotes.filter(x => x !== t);
    setLocalNotes(next);
    onSaveNote(perfume.id, next);
  }

  // Normal React rendering - matches original src/components/DetailView.jsx
  return (
    <div ref={rootRef} style={{ fontFamily: "'Georgia',serif", background: "#FAFAF8", color: "#1A1A18", minHeight: "100%", paddingBottom: "5rem" }}>
      <button onClick={onClose} style={{ ...S.btn("out"), marginBottom: 12 }}>← Zurück</button>

      {/* ── Declutter-Kategorie Badge (Frage 1) ─────────────────────────────── */}
      {declToast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{declToast}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#B4B2A9", flexShrink: 0 }}>Kategorie:</span>
        {[
          { id: "Behalten", icon: "🏠", color: "#1D9E75" },
          { id: "Verkaufen", icon: "💰", color: "#534AB7" },
          { id: "Verschenken", icon: "🎁", color: "#993C1D" },
        ].map(cat => {
          const isActive = declCategory === cat.id;
          return (
            <button key={cat.id} onClick={() => saveDeclCategory(isActive ? null : cat.id)}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                borderRadius: 16, border: `1px solid ${isActive ? cat.color : "#E8E6E0"}`,
                background: isActive ? cat.color + "18" : "transparent",
                color: isActive ? cat.color : "#888780", fontSize: 11, cursor: "pointer",
                transition: "all .2s", fontFamily: "'Georgia',serif"
              }}>
              <span style={{ fontSize: 13 }}>{cat.icon}</span>
              <span>{cat.id}</span>
            </button>
          );
        })}
      </div>

      <MoodHeader family={local.family} base={local.base} />
      <div className="card" style={{marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input value={local.name || ""} onChange={e => setFieldLocal("name", e.target.value)} onBlur={() => commitField("name")}
              className="inp" style={{ ...S.inp, fontSize: 16, fontWeight: 500, marginBottom: 6 }} />
            <BrandInfo house={local.house} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 8 }}>
              <span className="pill" style={{ '--pill-bg': "#534AB722", '--pill-c': "#534AB7" }}>{local.conc || "?"}</span>
              <span className="pill" style={{ '--pill-bg': "#88888822", '--pill-c': "#888" }}>{local.format || "?"}</span>
              {((local.families && local.families.length > 0) ? local.families : [local.family || "Sonstiges"]).map((f, idx) => (
                <FamilyPill key={f} family={f} idx={idx} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <Stars rating={local.rating || 0} onSet={n => { setFieldLocal("rating", n); onUpdate(perfume.id, { rating: n }); }} size={18} />
            <button onClick={e => { onLog(local); triggerSprayAnimation(e.currentTarget); }} style={{ ...S.btn("pri"), fontSize: 11, padding: "6px 10px" }}>Tragen</button>
            {local.url && (
              <button onClick={handleReload} disabled={reloadState === "loading"}
                title="Noten & Daten von Parfumo neu laden"
                style={{
                  ...S.btn("out"), fontSize: 11, padding: "6px 10px",
                  opacity: reloadState === "loading" ? 0.5 : 1,
                  color: reloadState === "error" ? "#E24B4A" : "#888780",
                  borderColor: reloadState === "error" ? "#E24B4A" : "#D3D1C7",
                  transition: "all .2s"
                }}>
                {reloadState === "loading" ? "…" : "↻"}
              </button>
            )}
            {reloadErr && (
              <div style={{ fontSize: 11, color: reloadErr.startsWith("✓") ? "#1D9E75" : "#E24B4A", marginTop: 4, flex: "1 1 100%" }}>
                {reloadErr}
              </div>
            )}
          </div>
        </div>
        <FillLevelEditor item={local} fillLevels={fillLevels || {}} onSetFill={onSetFill} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "#888780" }}>Getragen: {wearCount}× · Zuletzt: {lastWearText}</div>
          <CostPerWearButton perfumeId={perfume.id} wearCount={wearCount} priceMl={priceMl || {}} onClick={() => openOverlay(setShowCpw)} />
        </div>
        {/* Spotify */}
        <div style={{ marginTop: 8 }}>
          {getSpotifyOpenUrl(local.spotify_url) ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <a href={getSpotifyOpenUrl(local.spotify_url) || "#"} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 14px", borderRadius: 10, background: "#1DB954", color: "#fff",
                  textDecoration: "none", fontSize: 12, fontWeight: 500, fontFamily: "'Georgia',serif"
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                Spotify öffnen
              </a>
              <button onClick={() => openOverlay(setShowNotes)} aria-label="Spotify-URL bearbeiten"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", padding: 0 }}>
                ändern
              </button>
            </div>
          ) : (
            <button onClick={() => openOverlay(setShowNotes)} aria-label="Soundtrack hinzufügen"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 14px", borderRadius: 10, border: "1px dashed #D3D1C7",
                background: "none", color: "#B4B2A9", fontSize: 12, cursor: "pointer",
                fontFamily: "'Georgia',serif"
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#B4B2A9" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
              Soundtrack hinzufügen
            </button>
          )}
        </div>
      </div>

      {showCpw && <CostPerWearModal perfumeId={perfume.id} perfumeName={local.name || ""} wearCount={wearCount} priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl} onClose={() => setShowCpw(false)} />}

      <FunFactsCard name={local.name} house={local.house} top={local.top} middle={local.middle} base={local.base} conc={local.conc} family={local.family} season={local.season} gender={local.gender} />

      <div className="card" style={{marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="lbl">DETAILS & NOTIZEN</div>
          <button onClick={() => openOverlay(setShowNotes)} aria-label="Details bearbeiten"
            style={{
              background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: 2,
              transition: "color .12s"
            }}
            onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
            onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#B4B2A9') }}
            title="Bearbeiten">✎</button>
        </div>
        {/* Familie + Saison */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="pill" style={{ fontSize: 10, background: (FAM_COLORS[local.family] || "#888") + "22", color: FAM_COLORS[local.family] || "#888" }}>{local.family || "Sonstiges"}</span>
          <span style={{ fontSize: 10, color: "#888780", padding: "3px 0" }}>{local.season || "Ganzjährig"}</span>
          {(local.note_categories || []).map(c => (
            <span key={c} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 20,
              background: (NOTE_CAT_COLORS[c] || "#888780") + "18", color: NOTE_CAT_COLORS[c] || "#888780"
            }}>{c}</span>
          ))}
        </div>
        {/* Noten prominent */}
        {[["☀", "Kopfnoten", local.top, "#BA7517"], ["♥", "Herznoten", local.middle, "#9B4D8C"], ["◎", "Basisnoten", local.base, "#5C6B4F"]].map(([icon, label, notes, color]) => {
          const n = splitNotes(notes);
          if (!n.length) return null;
          return (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                <span style={{ fontSize: 14, color }} aria-hidden="true">{icon}</span>
                <span className="lbl" style={{marginBottom: 0, textTransform: "uppercase" }}>{label}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 1 }}>
                {n.map((x, i) => <span key={i} style={{
                  fontSize: 14, color: "#1A1A18", padding: "5px 12px",
                  background: "#F1EFE8", borderRadius: 20,
                }}>{x}</span>)}
              </div>
            </div>
          );
        })}
        {/* Tags */}
        {localNotes.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F1EFE8" }} role="list" aria-label="Notiz-Tags">
            {localNotes.map(t => (
              <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 20, background: "#F1EFE8", fontSize: 10 }}>
                <button onClick={() => onSearchNote && onSearchNote(t)} aria-label={`Nach "${t}" suchen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10 }}>{t}</button>
                <button onClick={() => removeTag(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 9, color: "#B4B2A9" }}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
        <button onClick={() => openOverlay(setShowJournal)}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#888780",
            fontFamily: "'Georgia',serif", transition: "color .15s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#888780') }}>
          ✎ Notizbuch
        </button>
        <span style={{ color: "#D3D1C7", margin: "0 8px" }}>·</span>
        <button onClick={() => setShowConfirmDelete(true)}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#C8C6BE",
            fontFamily: "'Georgia',serif", transition: "color .15s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#E24B4A') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#C8C6BE') }}>
          Löschen
        </button>
      </div>

      {showJournal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
        }}
          onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 20,
            maxWidth: 420, width: "100%", maxHeight: "80dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
            boxShadow: "0 8px 32px rgba(0,0,0,.2)"
          }}
            onClick={function (e) { e.stopPropagation() }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="lbl" style={{marginBottom: 0 }}>NOTIZBUCH</div>
              <button onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }} aria-label="Schließen"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
            </div>
            <textarea value={journalText} onChange={e => setJournalText(e.target.value)}
              placeholder="Deine Gedanken, Eindrücke, Erinnerungen..."
              className="ta" style={{ ...S.ta, minHeight: 200, fontSize: 14, lineHeight: 1.7, padding: "12px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 10, color: "#888780" }}>{journalText.length} Zeichen</span>
              <button onClick={() => { onUpdate(perfume.id, { journal: journalText }); setShowJournal(false) }}
                style={{ ...S.btn("pri"), padding: "10px 20px" }}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {showNotes && <NotesEditModal perfume={local} onClose={() => setShowNotes(false)}
        onUpdate={onUpdate} onSaveNote={onSaveNote} localNotes={localNotes}
        onSearchNote={onSearchNote} removeTag={removeTag} addTag={addTag}
        noteInput={noteInput} setNoteInput={setNoteInput} />}

      {/* ── Reload Diff Modal ─────────────────────────────────────────── */}
      {reloadState === "diff" && reloadDiff && (
        <ReloadDiffModal
          reloadDiff={reloadDiff}
          onApply={fields => applyReload(fields)}
          onClose={() => { setReloadState("idle"); setReloadDiff(null); }}
        />
      )}

      <Dialog open={showConfirmDelete} onClose={() => setShowConfirmDelete(false)} className="relative z-[9100]">
        <div className="fixed inset-0 bg-black/45" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-5">
          <Dialog.Panel style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 340, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 500, color: "#1A1A18", marginBottom: 8 }}>
              „{local.name}" wirklich löschen?
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>
              Dieser Vorgang kann nicht rückgängig gemacht werden.
            </Dialog.Description>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { onDelete(local.id); onClose(); }}
                style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }}>Ja, löschen</button>
              <button onClick={() => setShowConfirmDelete(false)}
                style={{ ...S.btn("out"), flex: 1 }}>Abbrechen</button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}

// ── Reusable Parfum Components ─────────────────────────────────────────────────

// Memoized card for Sammlung
const PerfumeCard = React.memo(function PerfumeCard({ p, notes, onClick, noteFieldLabel, fillLevel }) {
  const noteCount = (notes[p.id] || []).length;
  const noteHits = (p._hits || []).filter(h => ["top", "middle", "base"].includes(h.field));
  const families = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];

  return (
    <div onClick={onClick}
      role="button" tabIndex={0}
      aria-label={`${p.name} – ${p.house}, ${p.conc || "?"}, ${p.family || "Sonstiges"}${p.rating > 0 ? ", " + p.rating + " Sterne" : ""}`}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="card" style={{cursor: "pointer", padding: "8px 12px", marginBottom: 4,
        transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", transform: "translateY(0)",
        boxShadow: "0 1px 3px rgba(26,26,24,0.04)"
      }}
      onMouseEnter={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(-3px)'); e.currentTarget.style.setProperty('box-shadow', '0 8px 25px rgba(26,26,24,0.1)') }}
      onMouseLeave={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(0)'); e.currentTarget.style.setProperty('box-shadow', '0 1px 3px rgba(26,26,24,0.04)') }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#888780" }}>{p.house}</span>
            <span className="pill" style={{ fontSize: 10, padding: "2px 8px", fontWeight: 700, border: `1px solid ${CONC_COLORS[p.conc] || "#888"}`, '--pill-bg': (CONC_COLORS[p.conc] || "#888") + "22", '--pill-c': CONC_COLORS[p.conc] || "#888" }}>{p.conc}</span>
            {/* Saison in der Übersicht anzeigen (Fallback: Ganzjährig, nie "?") */}
            <span style={{ fontSize: 10, color: "#888780" }}>{p.season || "Ganzjährig"}</span>
          </div>
        </div>
        <div style={{ marginLeft: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {families.map((f, idx) => (
                <FamilyPill key={f} family={f} idx={idx} />
              ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
            {noteCount > 0 && <span style={{ fontSize: 10, color: "#B4B2A9" }}>✎{noteCount}</span>}
          </div>
        </div>
      </div>
      {noteHits.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4, paddingTop: 4, borderTop: "1px solid #F1EFE8" }}>
          {noteHits.map((h, i) => (
            <span key={i} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "#EEEDFE", color: "#3C3489", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{ opacity: 0.5 }}>{noteFieldLabel[h.field]}</span>{h.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

// Liste der Sammlungs-Karten: bewusst KEINE react-window-Virtualisierung mehr.
// react-window rendert einen eigenen inneren Scroll-Container – auf dem iPhone
// führt das zu doppeltem Scrollen (Kopf scrollt, danach scrollen die Parfums
// ein zweites Mal). Stattdessen normal im Seiten-Container scrollen und die
// Anzahl der Karten über displayCount ("Weitere laden") begrenzen.
function PerfumeList({ items, notes, onClick, noteFieldLabel, fillLevels }) {
  return (
    <div role="list" aria-label="Parfums">
      {items.map(p => (
        <PerfumeCard
          key={p.id}
          p={p}
          notes={notes}
          onClick={() => onClick(p.id)}
          noteFieldLabel={noteFieldLabel}
          fillLevel={fillLevels?.[p.id] ?? null}
        />
      ))}
    </div>
  );
}

function SammlungTab({ items, log, notes, onDelete, onUpdate, onExport, onSaveNote, onLog, fillLevels, onSetFill, priceMl, onSavePriceMl, wishlist }) {
  const [rawSearch, setRawSearch] = useState("");
  const { debounced: debouncedRawSearch } = useDebounce(rawSearch, 300);
  const [activeTerms, setActiveTerms] = useState([]); // committed search terms
  const [fam, setFam] = useState("Alle");
  const [seas, setSeas] = useState("Alle");
  const [fmt, setFmt] = useState("Alle");
  const [sort, setSort] = useState("name");
  const [detail, setDetail] = useState(null);
  const [showNotesPicker, setShowNotesPicker] = useState(false);
  const [displayCount, setDisplayCount] = useState(20);
  const [filteredItems, setFilteredItems] = useState([]);
  const [exportToast, setExportToast] = useState("");
  const inputRef = useRef(null);
  const sammlungDetailRef = useRef(null);

  function showExportToast(msg) {
    setExportToast(msg);
    setTimeout(() => setExportToast(""), 2200);
  }

  // Sicherer lokaler Datenexport: JSON-Vollbackup (später wieder importierbar)
  // oder CSV für Excel/Numbers. Läuft komplett im Browser, keine Netzwerk-Calls.
  function handleDataExport(fmtKind) {
    if (!items.length) { showExportToast("Keine Daten zum Exportieren"); return; }
    const date = new Date().toISOString().slice(0, 10);
    if (fmtKind === "csv") {
      shareOrDownloadFile(buildExportCsv(items), `parfum-sammlung-${date}.csv`,
        "text/csv;charset=utf-8",
        () => showExportToast("✓ CSV exportiert"),
        () => showExportToast("Export fehlgeschlagen"));
      return;
    }
    let content;
    try {
      content = JSON.stringify(buildExportPayload(items, wishlist), exportReplacer, 2);
    } catch {
      showExportToast("Export fehlgeschlagen (Daten nicht serialisierbar)");
      return;
    }
    shareOrDownloadFile(content, `parfum-sammlung-${date}.json`, "application/json",
      () => showExportToast("✓ Backup exportiert"),
      () => showExportToast("Export fehlgeschlagen"));
  }

  

  useEffect(() => {
    if (detail && !items.find(x => x.id === detail)) setDetail(null);
  }, [detail, items]);

  // Commit rawSearch into activeTerms on Enter or comma
  function commitSearch() {
    const parts = rawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const newTerms = [...new Set([...activeTerms, ...parts])];
    setActiveTerms(newTerms);
    setRawSearch("");
  }
  function removeTerm(t) { setActiveTerms(prev => prev.filter(x => x !== t)); }
  function addNoteTerm(note) {
    if (!activeTerms.includes(note)) setActiveTerms(prev => [...prev, note]);
    setShowNotesPicker(false);
  }
  function clearAll() { setActiveTerms([]); setRawSearch(""); }

  // All unique notes sorted by frequency – for the picker
  const allNotes = useMemo(() => getAllNotes(items), [items]);
  const families = useMemo(() => ["Alle", ...new Set(items.map(i => i.family).filter(Boolean))].sort(), [items]);

        // Combined terms = committed + current rawSearch (live preview)
  const liveTerms = useMemo(() => {
    const extra = debouncedRawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    return [...new Set([...activeTerms, ...extra])].map(normalizeTerm);
  }, [activeTerms, debouncedRawSearch]);

// Helper: run the actual filtering logic (shared between effects)
  const runFilters = useCallback(() => {
    const wc = {}; log.forEach(l => { wc[l.id] = (wc[l.id] || 0) + 1; });
    let r = items
      .map(p => {
        const { matched, hits } = matchPerfume(p, liveTerms);
        return matched ? { ...p, _hits: hits } : null;
      })
      .filter(p => p !== null)
      .filter(p =>
        (fam === "Alle" || p.family === fam) &&
        (seas === "Alle" || (p.season || "").includes(seas)) &&
        (fmt === "Alle" || p.format === fmt)
      );
    if (sort === "name") r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "house") r = [...r].sort((a, b) => (a.house || "").localeCompare(b.house || ""));
    if (sort === "rating") r = [...r].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === "family") r = [...r].sort((a, b) => (a.family || "").localeCompare(b.family || ""));
    if (sort === "worn") r = [...r].sort((a, b) => (wc[b.id] || 0) - (wc[a.id] || 0));
    return r;
  }, [items, liveTerms, log, fam, seas, fmt, sort]);
  // Asynchronous search with AbortController to cancel obsolete requests
  // and prevent race conditions when new input arrives.
  useEffect(() => {
    // Lokaler AbortController: bricht genau diesen Suchlauf ab, wenn eine neue
    // Suche startet oder die Komponente unmounted – ohne ein fremdes Signal zu treffen
    const ctrl = new AbortController();
    const { signal } = ctrl;

    // Schedule the search asynchronously
    const timeoutId = setTimeout(() => {
      // Double-check that the search hasn't been aborted
      if (signal.aborted) return;

      // Run the actual filtering using shared helper
      const result = runFilters();
      // Only apply results if the search hasn't been cancelled
      if (!signal.aborted) {
        setFilteredItems(result);
      }
    }, 0);

    // Cleanup: abort this search when a new one starts or on unmount
    return () => {
      clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [debouncedRawSearch, runFilters]);

  // Also run filtering when non-search filters change (sync is fine here)
  useEffect(() => {
    setFilteredItems(runFilters());
  }, [runFilters]);
  // Reset displayCount when filters change
  useEffect(() => { setDisplayCount(20); }, [liveTerms, fam, seas, fmt, sort]);
  const visible = useMemo(() => filteredItems.slice(0, displayCount), [filteredItems, displayCount]);

  const noteFieldLabel = { top: "↑", middle: "○", base: "↓" };

  if (detail) {
    const p = items.find(x => x.id === detail);
    if (!p) return null;
    return (
      <DetailView perfume={p} items={items} log={log} notes={notes}
        onClose={() => setDetail(null)} onDelete={onDelete}
        onUpdate={onUpdate} onSaveNote={onSaveNote} onLog={onLog}
        onSearchNote={note => { addNoteTerm(note); setDetail(null); }}
        fillLevels={fillLevels || {}} onSetFill={onSetFill || ((id, l) => { })}
        priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl || ((id, d) => { })} />
    );
  }

  return (
    <div>
      {/* Dezent platzierte Export-Buttons (JSON-Backup / CSV) */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button onClick={() => handleDataExport("json")} aria-label="Sammlung als JSON-Backup exportieren"
          title="Daten als JSON-Backup exportieren (lokal, inkl. Wunschliste)"
          className="btn" style={{ ...S.btn("sm"), background: "transparent", border: "0.5px solid #D3D1C7", fontSize: 11, color: "#888780" }}>
          ⇩ JSON
        </button>
        <button onClick={() => handleDataExport("csv")} aria-label="Sammlung als CSV exportieren"
          title="Daten als CSV für Excel/Numbers exportieren"
          className="btn" style={{ ...S.btn("sm"), background: "transparent", border: "0.5px solid #D3D1C7", fontSize: 11, color: "#888780" }}>
          ⇩ CSV
        </button>
      </div>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 8 }}>
        <input id="sammlung-search" ref={inputRef} value={rawSearch}
          onChange={e => setRawSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitSearch(); }
            if (e.key === "Backspace" && !rawSearch && activeTerms.length) {
              setActiveTerms(prev => prev.slice(0, -1));
            }
          }}
          placeholder={activeTerms.length ? "Weiteren Begriff…" : "Name, Haus, Note… Enter zum Hinzufügen"}
          className="inp" style={{ ...S.inp, paddingRight: 80 }} />
        <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
          <button onClick={() => setShowNotesPicker(v => !v)}
            aria-label="Note aus Sammlung wählen"
            title="Note aus Sammlung wählen"
            style={{
              background: "none", border: "0.5px solid #D3D1C7", borderRadius: 6, cursor: "pointer",
              fontSize: 11, padding: "3px 7px", color: "#888780"
            }}>
            ♩
          </button>
          {(activeTerms.length > 0 || rawSearch) && (
            <button onClick={clearAll} aria-label="Suche leeren"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: "0 2px" }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Active term chips */}
      {activeTerms.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {activeTerms.map(t => (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
              padding: "3px 8px 3px 10px", borderRadius: 20, background: "#1A1A18", color: "#fff"
            }}>
              {t}
              <button onClick={() => removeTerm(t)} aria-label={`Suchbegriff "${t}" entfernen`}
                style={{
                  background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)",
                  fontSize: 12, padding: 0, lineHeight: 1, marginLeft: 2
                }}>✕</button>
            </span>
          ))}
          <span style={{ fontSize: 10, color: "#888780", alignSelf: "center" }}>
            {activeTerms.length > 1 ? "(alle müssen passen)" : ""}
          </span>
        </div>
      )}

      {/* Notes picker dropdown */}
      {showNotesPicker && (
        <div className="card" style={{marginBottom: 8, padding: "12px", maxHeight: 200, overflowY: "auto" }}>
          <div className="lbl">NOTE WÄHLEN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allNotes.slice(0, 60).map(n => {
              const active = activeTerms.includes(n) || activeTerms.includes(normalizeTerm(n));
              return (
                <button key={n} onClick={() => addNoteTerm(n)}
                  style={{ ...S.btn("out"), padding: "5px 9px", fontSize: 11, borderRadius: 16 }}>
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <select id="filter-familie" value={fam} onChange={e => setFam(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
          {families.map(f => <option key={f}>{f}</option>)}
        </select>
        <select id="filter-saison" value={seas} onChange={e => setSeas(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
          {["Alle", "Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select id="filter-format" value={fmt} onChange={e => setFmt(e.target.value)}
          className="inp" style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px" }}>
          {["Alle", "Probe", "Flakon", "Decant"].map(f => <option key={f}>{f}</option>)}
        </select>
      </div>

      {/* Sort */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#888780" }}>SORT:</span>
        {[["name", "A–Z"], ["house", "Haus"], ["rating", "★"], ["family", "Familie"], ["worn", "Getragen"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)}
            className="btn" style={{ ...S.btn("out"), padding: "5px 10px", fontSize: 10, borderRadius: 16 }}>{l}</button>
        ))}
        <button onClick={onExport}
          className="btn" style={{ ...S.btn("out"), marginLeft: "auto", fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }}>
          TSV ↓
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#888780", marginBottom: 10 }}>
        {filteredItems.length} / {items.length}
        {filteredItems.length > displayCount ? ` · zeige ${displayCount}` : ""}
      </div>

      {/* Results */}
      {items.length === 0 ? (
        <div style={{ padding: 20 }}>
          <div className="skeleton" style={{ width: "60%", height: 18, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: "40%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "80%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "70%", height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "50%", height: 12, marginBottom: 24 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12, marginTop: 8 }} />
          <div className="skeleton" style={{ width: "100%", height: 40, borderRadius: 12, marginTop: 8 }} />
        </div>
      ) : (
        <PerfumeList
          items={visible}
          notes={notes}
          onClick={setDetail}
          noteFieldLabel={noteFieldLabel}
          fillLevels={fillLevels}
        />
      )}
      {filteredItems.length > displayCount && (
        <button onClick={() => setDisplayCount(c => c + 20)}
          style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}>
          Mehr anzeigen ({filteredItems.length - displayCount} weitere)
        </button>
      )}
      {filteredItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>🔍</div>
          <div style={{ fontSize: 14, color: "#888780", marginBottom: 16 }}>
            {liveTerms.length > 0
              ? `Keine Treffer für "${liveTerms.join(', ')}"`
              : "Keine Parfüms gefunden"}
          </div>
          {liveTerms.length > 0 && (
            <button onClick={() => { setActiveTerms([]); setRawSearch(""); setFam("Alle"); setSeas("Alle"); setFmt("Alle"); }}
              style={{ ...S.btn("out"), fontSize: 12, padding: "8px 16px" }}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {/* Export-Toast */}
      {exportToast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{exportToast}</div>
      )}
    </div>
  );
}

export default SammlungTab;
export { DetailView, FillLevelEditor };
