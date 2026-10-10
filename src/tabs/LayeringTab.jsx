import React, { useState, useEffect, useMemo, useRef } from "react";
import { Combobox } from "@headlessui/react";
import { S } from "../shared/ui";
import { splitNotes } from "../utils/helpers";
import { stripDiacritics } from "../utils/perfumeMatch";
import { NOTE_TO_CAT, FAM_COLORS, primaryFamily } from "../shared/constants";
import { LAYERING_COMPAT, getLayerCompat, analyzeNoteCompat, notesMatch, normNote } from "../shared/layering";
import { triggerSprayAnimation } from "../shared/spray";


function LayeringPerfumeSelect({ label, inputId, search, setSearch, filtered, selected, setSelected, items }) {
  const selectedP = items.find(p => p.id === selected) || null;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="lbl">{label}</div>
      <Combobox value={selectedP} onChange={p => { setSelected(p?.id || ""); setSearch(""); }} nullable>
        {({ open }) => (
          <div style={{ position: "relative" }}>
            <Combobox.Input id={inputId} displayValue={p => p ? `${p.name} – ${p.house}` : search}
              onChange={e => { setSearch(e.target.value); if (selected) setSelected(""); }}
              placeholder="Parfüm suchen…"
              className="inp" style={{ ...S.inp, fontSize: 12 }} />
            {selectedP && (
              <Combobox.Button aria-label="Auswahl zurücksetzen" onClick={() => { setSelected(""); setSearch(""); }}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#B4B2A9" }}>✕</Combobox.Button>
            )}
            {open && (
              <Combobox.Options static style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200, background: "#fff", border: "1px solid #E8E6E0", borderRadius: 8, maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.1)" }}>
                {filtered.slice(0, 20).map(p => {
                  const pFams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
                  return (
                    <Combobox.Option key={p.id} value={p} style={({ active }) => ({ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #F1EFE8", background: active ? "#F1EFE8" : "transparent" })}>
                      <div>{p.name}</div>
                      <div style={{ fontSize: 10, color: "#888780" }}>{p.house} · {pFams.map((f, idx) => <span key={f} style={idx === 0 ? { fontWeight: 500 } : { fontWeight: 400, opacity: 0.7 }}>{f}{idx < pFams.length - 1 ? ", " : ""}</span>)}</div>
                    </Combobox.Option>
                  );
                })}
                {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#888780" }}>Kein Treffer</div>}
              </Combobox.Options>
            )}
          </div>
        )}
      </Combobox>
    </div>
  );
}

// ── SMART MATCH: Beste Layering-Partner aus der Sammlung finden ──────────────
// Algorithmus: rein faktenbasiert auf LAYERING_COMPAT (Duftfamilien-Theorie)
// + Noten-Überlappung (geteilte Noten erhöhen Score). Keine KI-Spekulation.
const KNOWN_FAMILIES = [
  "Fresh","Floral","Woody","Oriental","Gourmand","Aquatisch","Chypre",
  "Fougère","Würzig","Grün","Animalisch","Harzig","Rauchig","Cremig",
  "Fruchtig","Pudrig","Zitrisch","Erdig","Synthetisch"
];

function detectFamiliesFromText(text) {
  const t = text.toLowerCase();
  const detected = [];
  const keywordMap = {
    "Fresh":      ["fresh","frisch","zitrus","citrus","bergamotte","limette","grapefruit"],
    "Floral":     ["floral","blumig","rose","jasmin","ylang","iris","maiglöckchen","blüte"],
    "Woody":      ["woody","holz","holzig","zedernholz","sandelholz","vetiver","oud","zedern"],
    "Oriental":   ["oriental","orientalisch","ambra","amber","weihrauch","vanille","oud"],
    "Gourmand":   ["gourmand","süß","vanilla","karamell","schokolade","tonkabohne"],
    "Aquatisch":  ["aqua","aquatisch","ozean","marine","meeresluft","ozon","salzig"],
    "Chypre":     ["chypre","eichenmoos","oakmoss","labdanum"],
    "Fougère":    ["fougère","fougere","lavendel","cumarin"],
    "Würzig":     ["würzig","spicy","pfeffer","kardamom","ingwer","zimt","safran","gewürz"],
    "Grün":       ["grün","green","galbanum","veilchenblatt","farn"],
    "Harzig":     ["harzig","harz","benzoe","myrrhe","weihrauch","olibanum"],
    "Rauchig":    ["rauchig","smoke","räucher","birkenholzteer","leder"],
    "Cremig":     ["cremig","cream","kokosnuss"],
    "Fruchtig":   ["fruchtig","fruit","pfirsich","himbeere","pflaume","apfel","birne"],
    "Pudrig":     ["pudrig","powdery","puder"],
    "Zitrisch":   ["zitrisch","zitrone","lemon"],
    "Erdig":      ["erdig","earth","patchouli","moos"],
    "Animalisch": ["animalisch","animal","moschus","musk","zibet","bibergeil"],
    "Synthetisch":["synthetisch","ambroxan","iso e super","calone","molekular"],
  };
  for (const [fam, kws] of Object.entries(keywordMap)) {
    if (kws.some(kw => t.includes(kw))) detected.push(fam);
  }
  return detected.length > 0 ? [...new Set(detected)] : ["Sonstiges"];
}

// NOTE_CAT_COMPAT: Welche Notenkategorien harmonieren beim Layering?
// Basis: Parfümchemie & Akkord-Theorie – geteilte oder komplementäre Kategorien
// ergeben harmonische Layers. Quelle: dieselbe Logik wie LAYERING_COMPAT-Tabelle.
const NOTE_CAT_COMPAT = {
  // Eine Kategorie mit sich selbst (Verstärkung)
  "Süß+Süß":0.6, "Würzig+Würzig":0.6, "Harzig+Harzig":0.75, "Cremig+Cremig":0.7,
  "Zitrisch+Zitrisch":0.7, "Erdig+Erdig":0.7, "Rauchig+Rauchig":0.6,
  "Aquatisch+Aquatisch":0.7, "Floral+Floral":0.65, "Grün+Grün":0.7,
  // Klassische Harmonie-Paare (aus LAYERING_COMPAT ableitbar)
  "Süß+Cremig":0.92, "Süß+Harzig":0.80, "Süß+Würzig":0.82, "Süß+Erdig":0.65,
  "Würzig+Harzig":0.88, "Würzig+Erdig":0.80, "Würzig+Rauchig":0.82,
  "Würzig+Animalisch":0.75, "Würzig+Zitrisch":0.72,
  "Harzig+Rauchig":0.90, "Harzig+Erdig":0.82, "Harzig+Animalisch":0.78,
  "Harzig+Cremig":0.85,
  "Cremig+Floral":0.88, "Cremig+Pudrig":0.82,
  "Erdig+Rauchig":0.80, "Erdig+Animalisch":0.72, "Erdig+Grün":0.80,
  "Zitrisch+Aquatisch":0.90, "Zitrisch+Grün":0.88, "Zitrisch+Floral":0.85,
  "Zitrisch+Fougère":0.88, "Zitrisch+Fruchtig":0.80,
  "Aquatisch+Grün":0.85, "Aquatisch+Fougère":0.80, "Aquatisch+Floral":0.82,
  "Grün+Floral":0.85, "Grün+Fougère":0.82,
  "Floral+Pudrig":0.88, "Floral+Fruchtig":0.88, "Floral+Fougère":0.78,
  "Pudrig+Animalisch":0.78, "Pudrig+Cremig":0.82, "Pudrig+Süß":0.75,
  "Fruchtig+Süß":0.80, "Fruchtig+Floral":0.88,
  "Animalisch+Rauchig":0.75, "Fougère+Harzig":0.75,
};
function getNoteCatCompat(c1, c2) {
  if (!c1 || !c2) return 0.5;
  if (c1 === c2) return NOTE_CAT_COMPAT[`${c1}+${c1}`] || 0.65;
  return NOTE_CAT_COMPAT[`${c1}+${c2}`] || NOTE_CAT_COMPAT[`${c2}+${c1}`] || 0.5;
}



// Hauptscore-Funktion – vollständig faktenbasiert
// Gewichtung: 40% Familien-Kompatibilität + 35% Noten-Kategorien-Kompatibilität + 25% direkte Noten-Überlappung
function computeSmartScore(inputFamilies, inputNotes, inputTop, inputMiddle, inputBase, collectionPerfume) {
  const n = s => normNote(s);

  // ── 1) FAMILIEN-KOMPATIBILITÄT (40%) ─────────────────────────────────────
  const collFams = (collectionPerfume.families && collectionPerfume.families.length > 0)
    ? collectionPerfume.families : [collectionPerfume.family || "Sonstiges"];
  let bestFamScore = 0;
  let bestCompat = null;
  for (const f1 of inputFamilies) {
    for (const f2 of collFams) {
      const c = getLayerCompat(f1, f2);
      if (c.score > bestFamScore) { bestFamScore = c.score; bestCompat = c; }
    }
  }

  // ── 2) NOTEN-KATEGORIEN-KOMPATIBILITÄT (35%) ─────────────────────────────
  // Welche Kategorien hat das Input-Parfum vs. das Sammlungs-Parfum?
  // Bridge-Logic: Input-Base ↔ Coll-Top ist die eigentliche Überlappungszone beim Layering
  const iTop    = (inputTop    ? splitNotes(inputTop)    : inputNotes.slice(0, Math.ceil(inputNotes.length/3))).map(n);
  const iMid    = (inputMiddle ? splitNotes(inputMiddle) : inputNotes.slice(Math.ceil(inputNotes.length/3), Math.ceil(2*inputNotes.length/3))).map(n);
  const iBase   = (inputBase   ? splitNotes(inputBase)   : inputNotes.slice(Math.ceil(2*inputNotes.length/3))).map(n);
  const cTop    = splitNotes(collectionPerfume.top).map(n);
  const cMid    = splitNotes(collectionPerfume.middle).map(n);
  const cBase   = splitNotes(collectionPerfume.base).map(n);

  // Kategorien für jede Zone bestimmen
  function zoneCats(notes) {
    const cats = new Set();
    notes.forEach(note => { const c = NOTE_TO_CAT[note]; if (c) cats.add(c); });
    return [...cats];
  }
  const iTopCats  = zoneCats(iTop);
  const iMidCats  = zoneCats(iMid);
  const iBaseCats = zoneCats(iBase);
  const cTopCats  = zoneCats(cTop);
  const cMidCats  = zoneCats(cMid);
  const cBaseCats = zoneCats(cBase);

  // Bridge-Pairs: iBase↔cTop (hauptsächlich) + iMid↔cMid + iTop↔cBase
  const bridgePairs = [
    { a: iBaseCats, b: cTopCats,  weight: 0.5 },  // Hauptbridge
    { a: iMidCats,  b: cMidCats,  weight: 0.3 },  // Herznoten
    { a: iTopCats,  b: cBaseCats, weight: 0.2 },  // Umgekehrt
  ];
  let catScore = 0;
  let catWeight = 0;
  for (const { a, b, weight } of bridgePairs) {
    if (a.length === 0 && b.length === 0) continue;
    if (a.length === 0 || b.length === 0) {
      catScore += 0.5 * weight; // Keine Daten → neutraler Score
      catWeight += weight;
      continue;
    }
    // Bestes Kategorien-Paar aus dieser Zone
    let bestPairScore = 0;
    for (const ca of a) for (const cb of b) {
      const s = getNoteCatCompat(ca, cb);
      if (s > bestPairScore) bestPairScore = s;
    }
    catScore += bestPairScore * weight;
    catWeight += weight;
  }
  const finalCatScore = catWeight > 0 ? catScore / catWeight : 0.5;

  // ── 3) DIREKTE NOTEN-ÜBERLAPPUNG (25%) ───────────────────────────────────
  // Shared Notes (identisch) geben hohen Score; Bridge-Notes (iBase↔cTop) extra
  const allInput  = [...iTop, ...iMid, ...iBase].filter(Boolean);
  const allColl   = [...cTop, ...cMid, ...cBase].filter(Boolean);

  // a) Shared notes (exakt/Substring)
  let sharedCount = 0;
  const usedColl = new Set();
  for (const ni of allInput) {
    for (let j = 0; j < allColl.length; j++) {
      if (!usedColl.has(j) && notesMatch(ni, allColl[j])) {
        sharedCount++;
        usedColl.add(j);
        break;
      }
    }
  }
  // b) Bridge overlap: Input-Base-Noten die in Coll-Top vorkommen
  let bridgeCount = 0;
  for (const nb of iBase) {
    if (cTop.some(ct => notesMatch(nb, ct))) bridgeCount++;
  }

  const maxPossible = Math.max(allInput.length, allColl.length, 1);
  const rawNoteScore = allInput.length === 0 || allColl.length === 0
    ? 0.5  // Keine Noten vorhanden → neutral
    : Math.min(1, (sharedCount / maxPossible) + (bridgeCount * 0.05));

  // ── GESAMTSCORE ──────────────────────────────────────────────────────────
  const W_FAM  = 0.40;
  const W_CAT  = 0.35;
  const W_NOTE = 0.25;
  // Wenn keine Noten-Daten vorhanden: Gewicht auf Familien verschieben
  const hasInputNotes = allInput.length > 0;
  const hasCollNotes  = allColl.length > 0;
  const effectiveWNote = (hasInputNotes && hasCollNotes) ? W_NOTE : 0;
  const effectiveWCat  = (hasInputNotes && hasCollNotes) ? W_CAT  : 0;
  const effectiveWFam  = 1 - effectiveWCat - effectiveWNote;

  const totalScore = (bestFamScore * effectiveWFam)
                   + (finalCatScore * effectiveWCat)
                   + (rawNoteScore  * effectiveWNote);

  return {
    score: Math.min(1, Math.max(0, totalScore)),
    compat: bestCompat || { score: 0.5, label: "Experimentell", desc: "Unbekannte Kombination." },
    collFams,
    sharedCount,
    bridgeCount,
    catScore: Math.round(finalCatScore * 100),
  };
}

function SmartMatchMode({ items }) {
  // Primär: Parfum aus Sammlung wählen (wie LayeringPerfumeSelect)
  const [selId, setSelId]             = useState("");
  const [search, setSearch]           = useState("");
  // Fallback: manuelle Familie + Noten (nur wenn kein Sammlung-Parfum gewählt)
  const [manualFamText, setManualFamText]   = useState("");
  const [manualNoteText, setManualNoteText] = useState("");
  const [showManual, setShowManual]         = useState(false);
  const [results, setResults]               = useState(null);

  const sorted = useMemo(() => [...items].sort((a,b) => a.name.localeCompare(b.name)), [items]);
  const selectedP = items.find(p => p.id === selId);

  const filtered = useMemo(() => sorted.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.house||"").toLowerCase().includes(search.toLowerCase())
  ), [sorted, search]);

  function runSmartMatch() {
    let inputFamilies, inputTop, inputMiddle, inputBase;

    if (selectedP) {
      inputFamilies = (selectedP.families && selectedP.families.length > 0)
        ? selectedP.families : [selectedP.family || "Sonstiges"];
      inputTop    = selectedP.top    || "";
      inputMiddle = selectedP.middle || "";
      inputBase   = selectedP.base   || "";
      // Manuelle Ergänzungen
      if (manualFamText.trim()) {
        const extra = detectFamiliesFromText(manualFamText);
        inputFamilies = [...new Set([...inputFamilies, ...extra])];
      }
      if (manualNoteText.trim()) {
        // Zusätzliche manuelle Noten an die Base hängen
        inputBase = [inputBase, manualNoteText].filter(Boolean).join(", ");
      }
    } else {
      inputFamilies = detectFamiliesFromText(manualFamText + " " + manualNoteText);
      inputTop = ""; inputMiddle = ""; inputBase = manualNoteText;
    }

    const inputAllNotes = [
      ...splitNotes(inputTop), ...splitNotes(inputMiddle), ...splitNotes(inputBase)
    ];

    const scored = items
      .filter(p => !selectedP || p.id !== selectedP.id)
      .map(p => {
        const res = computeSmartScore(inputFamilies, inputAllNotes, inputTop, inputMiddle, inputBase, p);
        return { p, ...res };
      });
    scored.sort((a, b) => b.score - a.score);
    setResults({ inputFamilies, inputAllNotes, inputTop, inputMiddle, inputBase, scored });
  }

  const compatColor = s => s >= .8 ? "#1D9E75" : s >= .6 ? "#BA7517" : "#993C1D";
  const canSearch = selectedP || manualFamText.trim() || manualNoteText.trim();

  return (
    <div>
      <div className="card" style={{background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", border: "1px solid #E8E6E0", boxShadow: "0 1px 2px rgba(26,26,24,0.04)", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Smart Match</div>
        <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6, marginBottom: 10 }}>
          Wähle ein Parfum – die App findet die besten Layer-Partner aus deiner Sammlung. Basiert auf Duftfamilien-Theorie &amp; Noten-Analyse.
        </div>

        {/* Parfum-Picker (aus der Sammlung) */}
        <div className="lbl">PARFUM WÄHLEN</div>
        <Combobox value={selectedP || null} onChange={p => { setSelId(p?.id || ""); setSearch(""); setResults(null); }} nullable>
          {({ open }) => (
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Combobox.Input
                displayValue={p => p ? `${p.name} – ${p.house}` : search}
                onChange={e => { setSearch(e.target.value); if (selId) setSelId(""); setResults(null); }}
                placeholder="Parfum aus Sammlung suchen…"
                className="inp" style={{ ...S.inp, fontSize: 12 }} />
              {selectedP && (
                <Combobox.Button onClick={() => { setSelId(""); setSearch(""); setResults(null); }}
                  aria-label="Auswahl zurücksetzen"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#B4B2A9" }}>✕</Combobox.Button>
              )}
              {open && (
                <Combobox.Options static style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200, background: "#fff", border: "1px solid #E8E6E0", borderRadius: 8, maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.1)" }}>
                  {filtered.slice(0, 25).map(p => {
                    const pFams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
                    return (
                      <Combobox.Option key={p.id} value={p} style={({ active }) => ({ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #F1EFE8", background: active ? "#F1EFE8" : "transparent" })}>
                        <div>{p.name}</div>
                        <div style={{ fontSize: 10, color: "#888780" }}>{p.house} · {pFams.map((f, i) => <span key={f} style={i === 0 ? { fontWeight: 500 } : { opacity: 0.7 }}>{f}{i < pFams.length - 1 ? ", " : ""}</span>)}</div>
                      </Combobox.Option>
                    );
                  })}
                  {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#888780" }}>Kein Treffer</div>}
                </Combobox.Options>
              )}
            </div>
          )}
        </Combobox>

        {/* Gewählte Familie anzeigen */}
        {selectedP && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {((selectedP.families && selectedP.families.length > 0)
              ? selectedP.families : [selectedP.family || "Sonstiges"]).map((f,i) => (
              <span key={f} className="pill" style={{ fontSize: 10, opacity: i === 0 ? 1 : 0.7, '--pill-bg': (FAM_COLORS[f] || "#888") + "22", '--pill-c': FAM_COLORS[f] || "#888" }}>{f}</span>
            ))}
          </div>
        )}

        {/* Optionale manuelle Ergänzung */}
        <button onClick={() => setShowManual(h => !h)}
          style={{ background: "none", border: "none", fontSize: 11, color: "#888780", cursor: "pointer",
            padding: 0, marginBottom: 10, minHeight: "auto", textDecoration: "underline" }}>
          {showManual ? "▲ Manuell ausblenden" : (selectedP ? "▾ Weitere Familien/Noten ergänzen" : "▾ Ohne Sammlung: Familie & Noten manuell eingeben")}
        </button>

        {showManual && (
          <div style={{ marginBottom: 10 }}>
            <div className="lbl">WEITERE DUFTFAMILIEN <span style={{ fontWeight: 400, color: "#AAA" }}>(Stichwörter)</span></div>
            <input value={manualFamText} onChange={e => setManualFamText(e.target.value)}
              placeholder="z.B. woody oriental, fresh citrus…"
              className="inp" style={{ ...S.inp, marginBottom: 8 }} />
            <div style={{ fontSize: 9, color: "#AAA", marginBottom: 8, lineHeight: 1.6 }}>
              {KNOWN_FAMILIES.join(" · ")}
            </div>
            <div className="lbl">NOTEN <span style={{ fontWeight: 400, color: "#AAA" }}>(kommagetrennt)</span></div>
            <input value={manualNoteText} onChange={e => setManualNoteText(e.target.value)}
              placeholder="z.B. Bergamotte, Ambra, Vetiver, Vanille…"
              className="inp" style={{ ...S.inp }} />
          </div>
        )}

        <button onClick={runSmartMatch} disabled={!canSearch}
          style={{
            width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
            background: canSearch ? "#1A1A18" : "#E8E6E0",
            color: canSearch ? "#fff" : "#B4B2A9",
            fontSize: 13, fontWeight: 500, cursor: canSearch ? "pointer" : "default",
            transition: "background .2s", marginTop: 2
          }}>
          Beste Partner finden ✧
        </button>
      </div>

      {/* Results */}
      {results && (
        <div>
          <div className="card" style={{background: "#F9F8F5", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#888780", marginBottom: 4 }}>
              {selectedP ? `Layering-Partner für ${selectedP.name}:` : "Erkannte Familien:"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {results.inputFamilies.map(f => (
                <span key={f} className="pill" style={{ fontSize: 11, '--pill-bg': (FAM_COLORS[f] || "#888") + "22", '--pill-c': FAM_COLORS[f] || "#888" }}>{f}</span>
              ))}
            </div>
            {results.inputAllNotes.length > 0 && (
              <div style={{ fontSize: 10, color: "#888780", marginTop: 5 }}>
                Noten analysiert: {results.inputAllNotes.slice(0, 8).join(", ")}{results.inputAllNotes.length > 8 ? " …" : ""}
              </div>
            )}
            <div style={{ fontSize: 9, color: "#B4B2A9", marginTop: 4, lineHeight: 1.5 }}>
              Score = 40% Familien-Compat + 35% Noten-Kategorien + 25% direkte Noten-Überlappung
            </div>
          </div>

          {results.scored.length === 0 && (
            <div style={{ textAlign: "center", color: "#888780", fontSize: 13, padding: "24px 0" }}>Keine weiteren Parfums in der Sammlung.</div>
          )}

          {results.scored.slice(0, 10).map(({ p, score, compat, collFams, sharedCount, bridgeCount, catScore }, idx) => {
            const cc = compatColor(score);
            const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
            const hasNoteData = sharedCount !== undefined;
            return (
              <div key={p.id} className="card" style={{marginBottom: 8, borderLeft: `3px solid ${cc}`, opacity: score < 0.4 ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                      {medal && <span style={{ marginRight: 4 }}>{medal}</span>}{p.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#888780", marginBottom: 5 }}>{p.house}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      {collFams.map((f, i) => (
                        <span key={f} className="pill" style={{ fontSize: 10, opacity: i === 0 ? 1 : 0.65, background: (FAM_COLORS[f] || "#888") + "22", color: FAM_COLORS[f] || "#888" }}>{f}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "#888780", fontStyle: "italic", lineHeight: 1.5 }}>
                      {compat.label} — {compat.desc}
                    </div>
                    {hasNoteData && (sharedCount > 0 || bridgeCount > 0) && (
                      <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                        {sharedCount > 0 && (
                          <span style={{ fontSize: 9, background: "#EDF7F2", color: "#1D9E75", borderRadius: 4, padding: "2px 6px" }}>
                            {sharedCount} gemeinsame Note{sharedCount > 1 ? "n" : ""}
                          </span>
                        )}
                        {bridgeCount > 0 && (
                          <span style={{ fontSize: 9, background: "#F5F0FF", color: "#534AB7", borderRadius: 4, padding: "2px 6px" }}>
                            {bridgeCount} Bridge-Note{bridgeCount > 1 ? "n" : ""} ✧
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 20, color: cc, fontWeight: 400, marginLeft: 10, flexShrink: 0 }}>
                    {Math.round(score * 100)}%
                  </div>
                </div>
                <div style={{ height: 4, background: "#F1EFE8", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: "100%", background: cc, borderRadius: 2,
                    transform: `scaleX(${score})`, transformOrigin: "left center",
                    transition: "transform .5s cubic-bezier(0.25,0.46,0.45,0.94)"
                  }} />
                </div>
              </div>
            );
          })}

          {results.scored.length > 10 && (
            <div style={{ textAlign: "center", fontSize: 11, color: "#B4B2A9", padding: "4px 0 8px" }}>
              Top 10 von {results.scored.length} angezeigt
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LayeringTab({ items }) {
  const [mode, setMode]           = useState("analyse");
  const [sel1, setSel1] = useState("");
  const [sel2, setSel2] = useState("");
  const [search1, setSearch1] = useState("");
  const [search2, setSearch2] = useState("");

  const p1 = items.find(p => p.id === sel1);
  const p2 = items.find(p => p.id === sel2);

  const sorted = useMemo(() =>
    [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);

  // Memoized filter lists — avoids re-scanning all items on every keystroke
  const filter1 = useMemo(() => sorted.filter(p =>
    (!search1 || p.name.toLowerCase().includes(search1.toLowerCase()) ||
      (p.house || "").toLowerCase().includes(search1.toLowerCase())) && p.id !== sel2
  ), [sorted, search1, sel2]);

  const filter2 = useMemo(() => sorted.filter(p =>
    (!search2 || p.name.toLowerCase().includes(search2.toLowerCase()) ||
      (p.house || "").toLowerCase().includes(search2.toLowerCase())) && p.id !== sel1
  ), [sorted, search2, sel1]);

  const isSamePerfume = p1 && p2 && p1.id === p2.id;

  // Use primaryFamily() so multi-family perfumes are looked up correctly
  const compat    = p1 && p2 && !isSamePerfume ? getLayerCompat(primaryFamily(p1), primaryFamily(p2)) : null;
  const noteAna   = p1 && p2 && !isSamePerfume ? analyzeNoteCompat(p1, p2) : null;
  const compatColor = compat ? (compat.score >= .8 ? "#1D9E75" : compat.score >= .6 ? "#BA7517" : "#993C1D") : "#888";

  // Smart application tip: the perfume with longer longevity should be the base layer.
  // Fall back to score threshold when longevity data is absent.
  function buildApplicationTip(p1, p2, compat) {
    const lonOrder = { short: 0, medium: 1, long: 2 };
    const lon1 = lonOrder[p1.longevity] ?? 1;
    const lon2 = lonOrder[p2.longevity] ?? 1;
    const [base, over] = lon1 >= lon2 ? [p1, p2] : [p2, p1];
    if (compat.score >= .85) {
      return `Trage ${base.name} zuerst als Basis auf, dann ${over.name} darüber. Warte 2–3 Minuten zwischen den Anwendungen.`;
    } else if (compat.score >= .65) {
      return `Vorsichtig schichten: ${base.name} sparsam als Basis, dann ${over.name} als Hauptduft.`;
    }
    return `Diese Kombination ist gewagt – teste sie zuerst auf der Handgelenk-Innenseite, bevor du sie trägst.`;
  }

  // Helper: get all family pills for a perfume
  function FamilyPills({ p }) {
    const fams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginTop: 4 }}>
        {fams.map((f, idx) => (
          <span key={f} className="pill" style={{ opacity: idx === 0 ? 1 : 0.65, '--pill-bg': (FAM_COLORS[f] || "#888") + "22", '--pill-c': FAM_COLORS[f] || "#888" }}>{f}</span>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Mode switcher */}
      <div style={{ display: "flex", background: "#F1EFE8", borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {[{ id: "analyse", label: "Analyse" }, { id: "smartmatch", label: "✧ Smart Match" }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} aria-label={`Modus: ${m.label}`}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
              background: mode === m.id ? "#FFFFFF" : "transparent",
              color: mode === m.id ? "#1A1A18" : "#888780",
              fontSize: 12, fontWeight: mode === m.id ? 600 : 400,
              cursor: "pointer", transition: "background .2s, color .2s, box-shadow .2s",
              ...(mode === m.id ? { boxShadow: "0 1px 3px rgba(26,26,24,0.12)" } : {})
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "smartmatch" && <SmartMatchMode items={items} />}
      {mode === "analyse" && <div>

      <div className="card" style={{background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", border: "1px solid #E8E6E0", boxShadow: "0 1px 2px rgba(26,26,24,0.04)", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Layering-Analyse</div>
        <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6 }}>
          Wähle zwei Parfüms – die App analysiert wie gut sie sich kombinieren lassen.
        </div>
      </div>

      {/* Selector row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
        <LayeringPerfumeSelect label="PARFÜM 1" inputId="layering-search-1"
          search={search1} setSearch={setSearch1}
          filtered={filter1} selected={sel1} setSelected={setSel1} items={items} />
        <div style={{ fontSize: 20, color: "#B4B2A9", marginTop: 28, flexShrink: 0 }}>+</div>
        <LayeringPerfumeSelect label="PARFÜM 2" inputId="layering-search-2"
          search={search2} setSearch={setSearch2}
          filtered={filter2} selected={sel2} setSelected={setSel2} items={items} />
      </div>

      {/* Same-perfume warning */}
      {isSamePerfume && (
        <div className="card" style={{border: "1px solid #BA751744", background: "#FFF8EE", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#BA7517" }}>Bitte zwei <em>verschiedene</em> Parfüms wählen – Layering mit sich selbst ergibt keine sinnvolle Analyse.</div>
        </div>
      )}

      {/* Result */}
      {p1 && p2 && !isSamePerfume && compat && noteAna && (
        <div>
          {/* Compatibility score */}
          <div className="card" style={{marginBottom: 12, borderLeft: `3px solid ${compatColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{compat.label}</div>
              <div style={{ fontSize: 22, color: compatColor, fontWeight: 400 }}>
                {Math.round(compat.score * 100)}%
              </div>
            </div>
            {/* scaleX instead of width – GPU-composited, no layout recalc */}
            <div style={{ height: 6, background: "#F1EFE8", borderRadius: 3, marginBottom: 10, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: "100%",
                background: compatColor, borderRadius: 3,
                transform: `scaleX(${compat.score})`, transformOrigin: "left center",
                transition: "transform .5s cubic-bezier(0.25,0.46,0.45,0.94)"
              }} />
            </div>
            <div style={{ fontSize: 12, color: "#888780", fontStyle: "italic" }}>{compat.desc}</div>
          </div>

          {/* Family cards – show all families, not just primary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <div className="card" style={{marginBottom: 0, textAlign: "center", padding: "10px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p1.name}</div>
              <FamilyPills p={p1} />
            </div>
            <div style={{ fontSize: 14, color: "#B4B2A9", textAlign: "center" }}>+</div>
            <div className="card" style={{marginBottom: 0, textAlign: "center", padding: "10px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p2.name}</div>
              <FamilyPills p={p2} />
            </div>
          </div>

          {/* Missing notes hint */}
          {(!noteAna.hasP1Notes || !noteAna.hasP2Notes) && (
            <div className="card" style={{background: "#FFFBF0", border: "1px solid #E8E6E044", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#888780" }}>
                ⓘ {!noteAna.hasP1Notes && !noteAna.hasP2Notes
                  ? "Für beide Parfüms sind keine Noten hinterlegt"
                  : `Für ${(!noteAna.hasP1Notes ? p1 : p2).name} sind keine Noten hinterlegt`}
                {" "}– Noten-Analyse nicht möglich. Trage Noten in der Sammlung nach für eine vollständige Analyse.
              </div>
            </div>
          )}

          {/* Bridge notes */}
          {noteAna.bridgeNotes.length > 0 && (
            <div className="card" style={{marginBottom: 12 }}>
              <div className="lbl">BRÜCKEN-NOTEN (was du wirklich riechst)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {noteAna.bridgeNotes.map(n => (
                  <span key={n} className="pill" style={{ fontSize: 11, padding: "3px 9px", '--pill-bg': "#534AB722", '--pill-c': "#534AB7" }}>{n}</span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#888780", marginTop: 6 }}>
                Basisnoten beider Parfüms treffen auf die jeweiligen Kopfnoten des anderen
              </div>
            </div>
          )}

          {/* Shared notes */}
          {noteAna.shared.length > 0 && (
            <div className="card" style={{marginBottom: 12 }}>
              <div className="lbl">GEMEINSAME NOTEN ({noteAna.shared.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {noteAna.shared.slice(0, 10).map(n => (
                  <span key={n} className="pill" style={{ fontSize: 11, padding: "3px 9px", '--pill-bg': "#1D9E7522", '--pill-c': "#1D9E75" }}>{n}</span>
                ))}
                {noteAna.shared.length > 10 && (
                  <span style={{ fontSize: 10, color: "#888780", alignSelf: "center" }}>+{noteAna.shared.length - 10} weitere</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#888780", marginTop: 6 }}>
                Gemeinsame Noten stärken die Harmonie
              </div>
            </div>
          )}

          {/* Application tip */}
          <div className="card" style={{ background: "#F9F8F5" }}>
            <div className="lbl">ANWENDUNGS-TIPP</div>
            <div style={{ fontSize: 12, color: "#888780", lineHeight: 1.6 }}>
              {buildApplicationTip(p1, p2, compat)}
            </div>
          </div>
        </div>
      )}

      {(!p1 || !p2) && !isSamePerfume && (
        <div className="card" style={{ textAlign: "center", color: "#888780", fontSize: 13, padding: "36px 16px" }}>
          <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.5 }}>+</div>
          Wähle zwei Parfüms aus deiner Sammlung
        </div>
      )}
      </div>}
    </div>
  );
}


export default LayeringTab;
