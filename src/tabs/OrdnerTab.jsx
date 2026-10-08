import React, { useState, useMemo } from "react";
import { S } from "../shared/ui";
import { FAM_COLORS, SEASON_COLORS, primaryFamily } from "../shared/constants";

// Hierarchie: Ebene 1 = Saison → Ebene 2 = Familie → Ebene 3 = Haus → Parfüm
const ORDNER_SCHEMES = [
  { id: "season_family", label: "Saison → Familie",   desc: "Hauptordner nach Jahreszeit, Unterordner nach Duftfamilie" },
  { id: "family_season", label: "Familie → Saison",   desc: "Hauptordner nach Duftfamilie, Unterordner nach Jahreszeit" },
  { id: "season_house",  label: "Saison → Haus",      desc: "Saisonal sortiert, darin alphabetisch nach Haus" },
  { id: "house_alpha",   label: "Haus A–Z",           desc: "Hauptordner nach Anfangsbuchstabe, Unterordner nach Haus" },
  { id: "format_season", label: "Format → Saison",    desc: "Alle Formate aus deiner Sammlung getrennt, darin nach Jahreszeit" },
];

// Canonical season order used for consistent sorting across all schemes.
const SEASON_ORDER = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];

// Returns the single primary season for a perfume.
// Rule: take the first SEASON_ORDER entry that appears in p.season.
// If nothing matches (or season is empty) → "Ganzjährig".
// This avoids the old .includes() bug where a perfume with
// season="Frühling, Sommer" was placed in BOTH folders.
function primarySeason(p) {
  const raw = (p.season || "").trim();
  if (!raw) return "Ganzjährig";
  return SEASON_ORDER.find(s => raw.includes(s)) || "Ganzjährig";
}



// Sorts an object's entries by a custom key order, then alphabetically for keys not in the order list.
function sortedEntries(obj, orderedKeys) {
  return Object.entries(obj).sort(([a], [b]) => {
    const ia = orderedKeys.indexOf(a);
    const ib = orderedKeys.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;   // both known → use defined order
    if (ia !== -1) return -1;                       // only a known → a first
    if (ib !== -1) return 1;                        // only b known → b first
    return a.localeCompare(b);                      // both unknown → alphabetical
  });
}

// Format colors — defined once so format_season and any future scheme share them.
const FORMAT_COLORS = { Flakon: "#993C1D", Probe: "#185FA5", Decant: "#3B6D11" };
function formatColor(fmt) { return FORMAT_COLORS[fmt] || "#5F5E5A"; }

function buildStructure(items, scheme) {
  const result = {};

  if (scheme === "season_family") {
    // Primary season → primary family. Each perfume appears exactly once.
    SEASON_ORDER.forEach(s => {
      const group = items.filter(p => primarySeason(p) === s);
      if (!group.length) return;
      const byFam = {};
      group.forEach(p => {
        const f = primaryFamily(p);
        if (!byFam[f]) byFam[f] = [];
        byFam[f].push(p);
      });
      result[s] = { color: SEASON_COLORS[s].accent, children: byFam, sortL2: "alpha" };
    });

  } else if (scheme === "family_season") {
    // Primary family → primary season. Each perfume appears exactly once.
    // L1 order: FAM_COLORS key order (stable), then alphabetical for unknowns.
    const famOrder = Object.keys(FAM_COLORS);
    const allFams = [...new Set(items.map(p => primaryFamily(p)))];
    allFams.sort((a, b) => {
      const ia = famOrder.indexOf(a), ib = famOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    allFams.forEach(f => {
      const group = items.filter(p => primaryFamily(p) === f);
      if (!group.length) return;
      const bySeas = {};
      group.forEach(p => {
        const s = primarySeason(p);
        if (!bySeas[s]) bySeas[s] = [];
        bySeas[s].push(p);
      });
      result[f] = { color: FAM_COLORS[f] || "#5F5E5A", children: bySeas, sortL2: "season" };
    });

  } else if (scheme === "season_house") {
    // Primary season → house. Each perfume appears exactly once.
    SEASON_ORDER.forEach(s => {
      const group = items.filter(p => primarySeason(p) === s);
      if (!group.length) return;
      const byHouse = {};
      group.forEach(p => {
        const h = (p.house || "Unbekannt").trim();
        if (!byHouse[h]) byHouse[h] = [];
        byHouse[h].push(p);
      });
      result[s] = { color: SEASON_COLORS[s].accent, children: byHouse, sortL2: "alpha" };
    });

  } else if (scheme === "house_alpha") {
    // Alphabetical letter → house. Each perfume appears exactly once.
    // L1: first letter of house name (or "#" for non-letter starts).
    // L2: full house name, sorted A–Z.
    items.forEach(p => {
      const h = (p.house || "Unbekannt").trim();
      const letter = /^[A-Za-zÄÖÜäöüß]/.test(h) ? h[0].toUpperCase() : "#";
      if (!result[letter]) result[letter] = { color: "#534AB7", children: {}, sortL2: "alpha" };
      if (!result[letter].children[h]) result[letter].children[h] = [];
      result[letter].children[h].push(p);
    });
    // Sort L1 keys: A–Z, then "#" at the end
    const letters = Object.keys(result).sort((a, b) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });
    const sorted = {};
    letters.forEach(l => { sorted[l] = result[l]; });
    return sorted;

  } else if (scheme === "format_season") {
    // Format → primary season. Formats are derived dynamically from the actual
    // collection, not hardcoded, so "Miniatur" or any future format isn't lost.
    // Known formats appear first in a defined order; unknown formats follow alphabetically.
    const FORMAT_ORDER = ["Flakon", "Probe", "Decant"];
    const allFormats = [...new Set(items.map(p => p.format || "Probe"))];
    allFormats.sort((a, b) => {
      const ia = FORMAT_ORDER.indexOf(a), ib = FORMAT_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    allFormats.forEach(fmt => {
      const group = items.filter(p => (p.format || "Probe") === fmt);
      if (!group.length) return;
      const bySeas = {};
      group.forEach(p => {
        const s = primarySeason(p);
        if (!bySeas[s]) bySeas[s] = [];
        bySeas[s].push(p);
      });
      result[fmt] = { color: formatColor(fmt), children: bySeas, sortL2: "season" };
    });
  }

  return result;
}

function OrdnerTab({ items, onSelectPerfume }) {
  const [scheme, setScheme] = useState("season_family");
  const [openL1, setOpenL1] = useState({});
  const [openL2, setOpenL2] = useState({});
  const [searchFilt, setSearch] = useState("");
  const [showPrint, setShowPrint] = useState(false);

  // Nur Proben (kein Flakon) in der physischen Ordnerstruktur
  const probenItems = useMemo(() => items.filter(p => p.format !== "Flakon"), [items]);
  const structure = useMemo(() => buildStructure(probenItems, scheme), [probenItems, scheme]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!searchFilt.trim()) return null;
    const q = searchFilt.toLowerCase();
    return probenItems.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.house || "").toLowerCase().includes(q)
    );
  }, [probenItems, searchFilt]);

  function toggleL1(k) { setOpenL1(o => ({ ...o, [k]: !o[k] })); }
  function toggleL2(k) { setOpenL2(o => ({ ...o, [k]: !o[k] })); }
  function expandAll() {
    const l1 = {}, l2 = {};
    Object.keys(structure).forEach(k => {
      l1[k] = true;
      Object.keys(structure[k].children || {}).forEach(k2 => { l2[k + "/" + k2] = true; });
    });
    setOpenL1(l1); setOpenL2(l2);
  }
  function collapseAll() { setOpenL1({}); setOpenL2({}); }
  const hasAnyOpen = Object.values(openL1).some(Boolean) || Object.values(openL2).some(Boolean);

  // Find which folder a specific item belongs to (for search result)
  function findPath(item) {
    for (const [l1key, l1val] of Object.entries(structure)) {
      for (const [l2key, l2items] of Object.entries(l1val.children || {})) {
        if (l2items.some(p => p.id === item.id)) return [l1key, l2key];
      }
    }
    return ["?", "?"];
  }

  const totalFolders = Object.keys(structure).length;
  const totalSubfolders = Object.values(structure).reduce((s, v) => s + Object.keys(v.children || {}).length, 0);

  return (
    <div>
      {/* Header */}
      <div className="card" style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", border: "1px solid #E8E6E0", boxShadow: "0 1px 2px rgba(26,26,24,0.04)", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>Physische Ordnerstruktur</div>
            <div style={{ fontSize: 11, color: "#888780" }}>
              {probenItems.length} Proben · Flakons separat
            </div>
          </div>
        </div>
        {/* Mini-Stat-Kacheln */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {[[totalFolders, "HAUPTORDNER"], [totalSubfolders, "UNTERORDNER"], [probenItems.length, "PROBEN"]].map(([v, l]) => (
            <div key={l} style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: "#1A1A18", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{v}</div>
              <div style={{ fontSize: 8, color: "#888780", letterSpacing: "0.7px", marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Scheme selector */}
        <div className="lbl">SORTIERUNG</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ORDNER_SCHEMES.map(sc => {
            const active = scheme === sc.id;
            return (
              <button key={sc.id} onClick={() => { setScheme(sc.id); setOpenL1({}); setOpenL2({}); }}
                style={{
                  ...S.btn("out"), padding: "9px 12px", borderRadius: 12,
                  display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left",
                  ...(active
                    ? { background: "#FFFFFF", border: "1px solid #534AB7", boxShadow: "0 1px 3px rgba(83,74,183,0.15)" }
                    : { background: "#FFFFFF" })
                }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ fontSize: 12, fontWeight: active ? 600 : 400 }}>{sc.label}</span>
                  <span style={{ fontSize: 11, color: "#534AB7", opacity: active ? 1 : 0 }}>✓</span>
                </span>
                <span style={{ fontSize: 10, opacity: .7, marginTop: 1 }}>{sc.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input id="folder-search" value={searchFilt} onChange={e => setSearch(e.target.value)}
          placeholder="Parfüm suchen → Ordner finden…"
          className="inp" style={{ ...S.inp, paddingRight: 36 }} />
        {searchFilt && (
          <button onClick={() => setSearch("")}
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9"
            }}>✕</button>
        )}
      </div>

      {/* Search results: show path */}
      {filteredItems && (
        <div className="card" style={{marginBottom: 12 }}>
          <div className="lbl">SUCHERGEBNIS ({filteredItems.length})</div>
          {filteredItems.length === 0 && (
            <div style={{ textAlign: "center", color: "#888780", padding: "24px 0", fontSize: 12 }}>
              <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.5 }}>⌕</div>
              Kein Treffer.
            </div>
          )}
          {filteredItems.slice(0, 20).map(p => {
            const [l1, l2] = findPath(p);
            const l1color = structure[l1]?.color || "#888";
            return (
              <div key={p.id} style={{
                padding: "7px 0", borderBottom: "1px solid #F1EFE8",
                display: "flex", justifyContent: "space-between", alignItems: "center"
              }}>
                <div>
                  <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                  <div style={{ fontSize: 10, color: "#888780", marginTop: 2 }}>
                    <span style={{ color: l1color, fontWeight: 500 }}>{l1}</span>
                    <span style={{ color: "#B4B2A9" }}> › </span>
                    <span>{l2}</span>
                  </div>
                </div>
                <span className="pill" style={{ fontSize: 10, background: (FAM_COLORS[p.family] || "#888") + "22", color: FAM_COLORS[p.family] || "#888" }}>{p.format}</span>
              </div>
            );
          })}
          {filteredItems.length > 20 && (
            <div style={{ fontSize: 11, color: "#B4B2A9", marginTop: 6 }}>+{filteredItems.length - 20} weitere</div>
          )}
        </div>
      )}

      {/* Expand/Collapse all */}
      {!filteredItems && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => hasAnyOpen ? collapseAll() : expandAll()}
            style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>
            {hasAnyOpen ? "Alles einklappen" : "Alles ausklappen"}
          </button>
        </div>
      )}

      {/* Tree structure */}
      {!filteredItems && Object.entries(structure).map(([l1key, l1val]) => {
        const isOpenL1 = openL1[l1key];
        const subCount = Object.keys(l1val.children || {}).length;
        const itemCount = Object.values(l1val.children || {}).flat().length;
        const color = l1val.color;
        // Sort L2 keys: kalendarisch for season sub-folders, alphabetical otherwise
        const l2Entries = l1val.sortL2 === "season"
          ? sortedEntries(l1val.children || {}, SEASON_ORDER)
          : Object.entries(l1val.children || {}).sort(([a], [b]) => a.localeCompare(b));

        return (
          <div key={l1key} style={{ marginBottom: 8 }}>
            {/* Level 1: Hauptordner */}
            <button onClick={() => toggleL1(l1key)}
              aria-expanded={isOpenL1}
              aria-label={`${l1key} – ${subCount} Unterordner, ${itemCount} Parfüms`}
              style={{
                width: "100%", background: "#fff", border: `1px solid ${color}44`,
                borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                borderLeft: `3px solid ${color}`
              }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} aria-hidden="true" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: "#1A1A18", fontWeight: 500 }}>{l1key}</div>
                <div style={{ fontSize: 10, color: "#888780", marginTop: 1 }}>
                  {subCount} Unterordner · {itemCount} Parfüms
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#888780" }} aria-hidden="true">{isOpenL1 ? "▲" : "▼"}</div>
            </button>

            {/* Level 2: Unterordner */}
            <div style={{ marginLeft: 16, marginTop: 4, display: "grid", gridTemplateRows: isOpenL1 ? "1fr" : "0fr", opacity: isOpenL1 ? 1 : 0, transition: "grid-template-rows .25s ease, opacity .2s ease" }}>
              <div style={{ overflow: "hidden" }}>
              {l2Entries
                .map(([l2key, l2items]) => {
                  const l2key_full = l1key + "/" + l2key;
                  const isOpenL2 = openL2[l2key_full];
                  const subColor = FAM_COLORS[l2key] || SEASON_COLORS[l2key]?.accent || "#888780";

                  return (
                    <div key={l2key} style={{ marginBottom: 4 }}>
                      {/* Level 2 header */}
                      <button onClick={() => toggleL2(l2key_full)}
                        aria-expanded={isOpenL2}
                        aria-label={`${l2key} – ${l2items.length} Parfüms`}
                        style={{
                          width: "100%", background: "#F9F8F5", border: "1px solid #E8E6E0",
                          borderRadius: 8, padding: "9px 12px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 8, textAlign: "left"
                        }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: subColor, flexShrink: 0 }} aria-hidden="true" />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: "#1A1A18" }}>{l2key}</div>
                          <div style={{ fontSize: 10, color: "#888780" }}>{l2items.length} Parfüms</div>
                        </div>
                        <div style={{ fontSize: 10, color: "#B4B2A9" }} aria-hidden="true">{isOpenL2 ? "▲" : "▼"}</div>
                      </button>

                      {/* Level 3: Parfüms */}
                      <div style={{ marginLeft: 12, marginTop: 3, display: "grid", gridTemplateRows: isOpenL2 ? "1fr" : "0fr", opacity: isOpenL2 ? 1 : 0, transition: "grid-template-rows .22s ease, opacity .18s ease" }}>
                        <div style={{ overflow: "hidden" }}>
                        {[...l2items]
                          .sort((a, b) => (a.house || "").localeCompare(b.house || "") || (a.name || "").localeCompare(b.name || ""))
                          .map((p, idx) => (
                            <div key={p.id}
                              style={{
                                padding: "7px 10px",
                                borderBottom: idx < l2items.length - 1 ? "1px solid #F1EFE8" : "none",
                                background: "#fff",
                                borderRadius: idx === 0 && l2items.length === 1 ? "6px" : idx === 0 ? "6px 6px 0 0" : idx === l2items.length - 1 ? "0 0 6px 6px" : "0",
                                border: "1px solid #F1EFE8",
                                borderTop: idx === 0 ? "1px solid #F1EFE8" : "none",
                                display: "flex", justifyContent: "space-between", alignItems: "center"
                              }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>
                                  {p.name}
                                </button>
                                <div style={{ fontSize: 10, color: "#888780", marginTop: 1 }}>
                                  {p.house}
                                  {p.conc ? ` · ${p.conc}` : ""}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                                <span className="pill" style={{ fontSize: 9, background: (FAM_COLORS[p.family] || "#888") + "22", color: FAM_COLORS[p.family] || "#888" }}>{p.format}</span>
                                {(p.rating || 0) > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
                              </div>
                            </div>
                          ))}
                        </div>{/* inner overflow:hidden */}
                      </div>{/* grid wrapper L2 */}
                    </div>
                  );
                })}
              </div>{/* inner overflow:hidden */}
            </div>{/* grid wrapper L1 */}
          </div>
        );
      })}

      {/* Legend */}
      <div className="card" style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", marginTop: 4 }}>
        <div className="lbl">LEGENDE</div>
        <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: "#888780", flexShrink: 0 }} />
            Hauptordner = physischer Karton / Regalfach
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "#B4B2A9", flexShrink: 0 }} />
            Unterordner = Trennkarte oder Gruppe
          </div>
          <div style={{ marginTop: 4 }}>Jedes Parfüm erscheint genau einmal (primäre Saison / Familie).</div>
          <div>Parfüms innerhalb: nach Haus A–Z, dann Name A–Z sortiert.</div>
        </div>
      </div>
    </div>
  );
}


export default OrdnerTab;
