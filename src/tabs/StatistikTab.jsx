import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { S, MiniBar, FamilyPill, Stars } from "../shared/ui";
import { FAM_COLORS, getSeasonColor } from "../shared/constants";
import { splitNotes } from "../utils/helpers";

// Duft-DNA (inkl. Chart.js) als eigener Lazy-Chunk
const DuftDNASection = lazy(() => import("../components/DuftDNASection"));

// Zentrale ParfumLink Komponente für konsistente Navigation
function ParfumLink({ p, onClick, style, showRating = true, showHouse = true }) {
  const handleClick = () => onClick && onClick(p.id);
  return (
    <button type="button" onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        fontSize: 13, fontFamily: "'Georgia',serif", color: "inherit", textAlign: "left", ...style
      }}>
      {p.name}
      {showRating && p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517", marginLeft: 6 }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
      {showHouse && <span style={{ fontSize: 11, color: "#888780", marginLeft: 6 }}>{p.house}</span>}
    </button>
  );
}

// Memoized perfume list item for statistics
const StatistikPerfumeItem = React.memo(function StatistikPerfumeItem({ p, onSelectPerfume, fc }) {
  const noteCount = (p.top ? p.top.split(",").length : 0) + (p.middle ? p.middle.split(",").length : 0) + (p.base ? p.base.split(",").length : 0);
  return (
    <div style={{
      padding: "7px 0", borderBottom: "1px solid #F1EFE8", fontSize: 13,
      display: "flex", justifyContent: "space-between", alignItems: "center"
    }}>
      <ParfumLink p={p} onClick={onSelectPerfume} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {noteCount > 0 && <span style={{ fontSize: 9, color: "#B4B2A9" }}>{noteCount} Noten</span>}
        {p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
      </div>
    </div>
  );
});


// ── Duft-Kalender: Monats-Heatmap der Trage-Historie (GitHub-Contributions-Stil) ──
const HEAT_COLORS = ["#F1EFE8", "#C4E7D6", "#83CDA9", "#4BB489", "#1D9E75"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Lokaler Tag-Schlüssel (YYYY-MM-DD), ohne UTC-Verschiebung
function dayKeyOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function WearCalendar({ log, items, onSelectPerfume }) {
  const now = new Date();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selDay, setSelDay] = useState(null);

  // Trage-Einträge pro Tag: { "YYYY-MM-DD": [perfumeId, ...] } (Mehrfach-Tragen = mehrere Einträge)
  const byDay = useMemo(() => {
    const m = {};
    log.forEach(l => {
      const k = dayKeyOfDate(new Date(l.ts));
      (m[k] = m[k] || []).push(String(l.id));
    });
    return m;
  }, [log]);

  // Schneller Zugriff auf das Parfum-Objekt per ID (als String, wie im log)
  const perfumeById = useMemo(() => {
    const m = {};
    items.forEach(p => { m[String(p.id)] = p; });
    return m;
  }, [items]);

  // Wochenraster des Monats – Spalten = Wochen, Zeilen = Wochentage (Montag startend)
  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const cur = new Date(first);
    cur.setDate(1 - ((first.getDay() + 6) % 7)); // zurück zum Montag der ersten Woche
    const out = [];
    do {
      const wk = [];
      for (let i = 0; i < 7; i++) { wk.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      out.push(wk);
    } while (cur.getMonth() === month.getMonth());
    return out;
  }, [month]);

  // Maximum für die Farbskala (mind. 1, um Division durch 0 zu vermeiden)
  const maxDay = useMemo(() => Math.max(1, ...Object.values(byDay).map(a => a.length)), [byDay]);
  const todayKey = dayKeyOfDate(new Date());
  const monthLabel = month.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  // Trage-Einträge im angezeigten Monat (für die Kopfzeilen-Zusammenfassung)
  const monthWearCount = useMemo(() => {
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    return Object.entries(byDay).filter(([k]) => k.startsWith(prefix)).reduce((s, [, a]) => s + a.length, 0);
  }, [byDay, month]);

  // Düfte des gewählten Tages mit Anzahl (Duplikate zusammenfassen)
  const selDayWears = useMemo(() => {
    if (!selDay) return [];
    const c = {};
    (byDay[selDay] || []).forEach(id => { c[id] = (c[id] || 0) + 1; });
    return Object.entries(c)
      .map(([id, n]) => ({ p: perfumeById[id], n }))
      .filter(x => x.p)
      .sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name));
  }, [selDay, byDay, perfumeById]);

  const shiftMonth = delta => {
    setMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));
    setSelDay(null);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <button type="button" onClick={() => shiftMonth(-1)} style={{ ...S.btn(), padding: "4px 10px" }} aria-label="Voriger Monat">←</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500, textTransform: "capitalize" }}>{monthLabel}</div>
            <div style={{ fontSize: 10, color: "#888780" }}>
              {monthWearCount === 0 ? "keine Trage-Einträge" : `${monthWearCount}× getragen`}
            </div>
          </div>
          <button type="button" onClick={() => shiftMonth(1)} style={{ ...S.btn(), padding: "4px 10px" }} aria-label="Nächster Monat">→</button>
        </div>

        {/* Wochentags-Kopfzeile */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
          {WEEKDAYS.map(w => (
            <div key={w} style={{ fontSize: 9, color: "#888780", textAlign: "center" }}>{w}</div>
          ))}
        </div>

        {/* Heatmap-Raster: transparente Zellen für Tage außerhalb des Monats */}
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
            {wk.map(d => {
              const inMonth = d.getMonth() === month.getMonth();
              const k = dayKeyOfDate(d);
              const count = (byDay[k] || []).length;
              // Farbstufe: 0 = leer, sonst 1–4 relativ zum stärksten Tag im Zeitraum
              const level = count === 0 ? 0 : Math.min(4, Math.ceil(count / maxDay * 4));
              const isToday = k === todayKey;
              const isSel = k === selDay;
              // Tooltip: Datum + Namen der an dem Tag getragenen Düfte
              const dayNames = [...new Set((byDay[k] || []).map(id => perfumeById[id] ? perfumeById[id].name : null))].filter(Boolean).join(", ");
              return (
                <button key={k} type="button" disabled={!inMonth}
                  onClick={() => setSelDay(selDay === k ? null : k)}
                  title={inMonth
                    ? d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) +
                      (count === 0 ? " – nicht getragen" : ` – ${dayNames}`)
                    : undefined}
                  style={{
                    aspectRatio: "1 / 1", borderRadius: 6, padding: 0,
                    border: isSel ? "2px solid #BA7517" : isToday ? "1px solid #BA7517" : "1px solid transparent",
                    background: inMonth ? HEAT_COLORS[level] : "transparent",
                    cursor: inMonth ? "pointer" : "default",
                    fontSize: 8, color: level >= 3 ? "#fff" : "#888780",
                    display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
                    boxSizing: "border-box",
                  }}>
                  {inMonth ? d.getDate() : ""}
                </button>
              );
            })}
          </div>
        ))}

        {/* Farblegende */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 8, fontSize: 9, color: "#888780" }}>
          <span>weniger</span>
          {HEAT_COLORS.map(c => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: 3, background: c, display: "inline-block" }} />
          ))}
          <span>mehr</span>
        </div>
      </div>

      {/* Detail-Liste: Düfte des gewählten Tages */}
      {selDay && (
        <div className="card">
          <div className="lbl">GETRAGEN AM {new Date(selDay).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</div>
          {selDayWears.length === 0 ? (
            <div style={{ fontSize: 12, color: "#888780", padding: "6px 0" }}>An diesem Tag wurde nichts getragen.</div>
          ) : selDayWears.map(({ p, n }) => (
            <div key={p.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EFE8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "'Georgia',serif", color: "inherit", textAlign: "left" }}>
                {p.name}
                <span style={{ fontSize: 11, color: "#888780", marginLeft: 6 }}>{p.house}</span>
              </button>
              {n > 1 && <span style={{ fontSize: 10, color: "#1D9E75" }}>×{n}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Statistik tab (expanded) ──────────────────────────────────────────────────
function StatistikTab({ items, log, onSelectPerfume }) {
  const [drill, setDrill] = useState(null);
  const [statsTab, setStatsTab] = useState("profil");
  const total = items.length || 1;

  const famC = useMemo(() => {
    const c = {};
    items.forEach(p => {
      // Count all families (weighted: primary = 1.0, secondary = 0.5)
      const fams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
      fams.forEach((f, idx) => {
        const w = idx === 0 ? 1.0 : idx === 1 ? 0.5 : 0.25; // Prioritäts-Gewichtung (#8)
        c[f] = (c[f] || 0) + w;
      });
    });
    return Object.entries(c)
      .filter(([, v]) => v >= 0.25) // mindestens 1× als dritte Familie
      .sort((a, b) => b[1] - a[1])
      .map(([fam, count]) => [fam, Math.round(count)]); // auf ganze Zahl runden für Anzeige
  }, [items]);

  const noteC = useMemo(() => {
    const c = {};
    items.forEach(p => [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
      .forEach(n => { c[n] = (c[n] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const wearByPerfume = useMemo(() => {
    const c = {}; log.forEach(l => { c[l.id] = (c[l.id] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, n]) => ({ p: items.find(x => x.id === id), n })).filter(x => x.p);
  }, [log, items]);

  const avgRatingByFam = useMemo(() => {
    const sums = {}; const cnts = {};
    items.filter(p => p.rating > 0).forEach(p => {
      // Gleiche Mitgliedschaft wie Profil/Drill: alle Familien, nicht nur die primäre
      const fams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
      fams.forEach(f => {
        sums[f] = (sums[f] || 0) + p.rating; cnts[f] = (cnts[f] || 0) + 1;
      });
    });
    return Object.entries(sums).map(([f, s]) => ([f, (s / cnts[f]).toFixed(1), cnts[f]]))
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1])); // toFixed liefert Strings → parseFloat für numerische Sortierung
  }, [items]);

  const monthlyWear = useMemo(() => {
    const c = {};
    log.forEach(l => {
      // Chronologisch sortierbarer Schlüssel (YYYY-MM), Anzeige-Label erst danach
      const d = new Date(l.ts);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      c[k] = (c[k] || 0) + 1;
    });
    return Object.keys(c).sort().slice(-12)
      .map(k => {
        const [y, m] = k.split("-").map(Number);
        return [new Date(y, m - 1).toLocaleDateString("de-DE", { month: "short", year: "2-digit" }), c[k]];
      });
  }, [log]);

  const wearByFam = useMemo(() => {
    const c = {};
    log.forEach(l => {
      const p = items.find(x => x.id === l.id);
      // Gleiche Mitgliedschaft wie Profil/Drill: alle Familien zählen
      if (p) (p.families && p.families.length > 0 ? p.families : [p.family || "Sonstiges"]).forEach(f => { c[f] = (c[f] || 0) + 1; });
    });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [log, items]);

  const concC = useMemo(() => {
    const c = {}; items.forEach(p => { c[p.conc || "?"] = (c[p.conc || "?"] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const seasC = useMemo(() => {
    const c = { Frühling: 0, Sommer: 0, Herbst: 0, Winter: 0, Ganzjährig: 0 };
    items.forEach(p => Object.keys(c).forEach(k => { if ((p.season || "").includes(k)) c[k]++; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // EDGE CASE: Math.max(...spread) → Stack Overflow bei 400+ Einträgen → reduce
  const maxWear = wearByPerfume.reduce((m, x) => Math.max(m, x.n), 1);
  const maxMonth = monthlyWear.reduce((m, e) => Math.max(m, e[1]), 1);
  const maxFamWear = wearByFam.reduce((m, e) => Math.max(m, e[1]), 1);

  const STABS = [
    { id: "profil", label: "Profil" },
    { id: "nutzung", label: "Nutzung" },
    { id: "kalender", label: "Kalender" },
    { id: "noten", label: "Noten" },
    { id: "favoriten", label: "Favoriten" },
  ];

  if (drill) {
    // Familien-Mitgliedschaft (inkl. Sekundär-/Tertiärfamilien), passend zur gewichteten Profil-Zählung
    const hasFam = p => (p.families && p.families.length > 0 ? p.families : [p.family || "Sonstiges"]).includes(drill);
    const fi = items.filter(hasFam);
    const fc = FAM_COLORS[drill] || "#888";
    const notes = {};
    fi.forEach(p => [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
      .forEach(n => { notes[n] = (notes[n] || 0) + 1; }));
    const famWears = log.filter(l => fi.some(p => p.id === l.id)).length;
    return (
      <div>
        <button onClick={() => setDrill(null)} style={{ ...S.btn(), marginBottom: 16 }}>← Zurück</button>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: fc }} />
            <div style={{ fontSize: 18, fontWeight: 500, color: "#1A1A18" }}>{drill}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 10, marginBottom: 16 }}>
            <div><div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{fi.length}</div><div style={{ fontSize: 10, color: "#888780" }}>PARFÜMS</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{Math.round(fi.length / total * 100)}%</div><div style={{ fontSize: 10, color: "#888780" }}>DER SAMMLUNG</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{famWears}</div><div style={{ fontSize: 10, color: "#888780" }}>MAL GETRAGEN</div></div>
            {fi.filter(p => p.rating > 0).length > 0 && (
              <div>
                <div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                  {(fi.filter(p => p.rating > 0).reduce((s, p) => s + p.rating, 0) / (fi.filter(p => p.rating > 0).length || 1)).toFixed(1)}
                </div>
                <div style={{ fontSize: 10, color: "#888780" }}>Ø BEWERTUNG</div>
              </div>
            )}
          </div>
          <div className="lbl">HÄUFIGSTE NOTEN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
            {Object.entries(notes).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => (
              <span key={n} className="pill" style={{ fontSize: 11, padding: "4px 10px", '--pill-bg': (fc || "#888") + "22", '--pill-c': fc || "#888" }}>{n} ×{c}</span>
            ))}
          </div>
          <div className="lbl">PARFÜMS</div>
          {[...fi].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
            <StatistikPerfumeItem key={p.id} p={p} onSelectPerfume={onSelectPerfume} fc={fc} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
        {[["Gesamt", items.length], ["Flakons", items.filter(p => p.format === "Flakon").length],
        ["Bewertet", items.filter(p => p.rating > 0).length], ["Getragen", log.length]].map(([l, v]) => (
          <div key={l} style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", border: "1px solid #E8E6E0", borderRadius: 12, padding: "12px 8px 10px", textAlign: "center", boxShadow: "0 1px 2px rgba(26,26,24,0.04)" }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: "#1A1A18", fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{v}</div>
            <div style={{ fontSize: 9, color: "#888780", letterSpacing: "0.8px", marginTop: 2 }}>{l.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Sub-tabs (segmentiertes Pill-Control) */}
      <div style={{ display: "flex", background: "#F1EFE8", borderRadius: 10, padding: 3, marginBottom: 16 }}>
                    {STABS.map(t => (
          <button key={t.id} onClick={() => setStatsTab(t.id)}
            style={{
              flex: 1, fontSize: 11, padding: "7px 4px", borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: "inherit", transition: "background .15s ease, color .15s ease, box-shadow .15s ease",
              ...(statsTab === t.id
                ? { background: "#FFFFFF", color: "#1A1A18", fontWeight: 600, boxShadow: "0 1px 3px rgba(26,26,24,0.12)" }
                : { background: "transparent", color: "#888780", fontWeight: 400 })
            }}>{t.label}</button>
        ))}
      </div>

      {statsTab === "profil" && (
        <div>
          <div className="card" style={{marginBottom: 12 }}>
            <div className="lbl">DUFTPROFIL · tippen für Details</div>
            {famC.filter(([, count]) => count >= 1).map(([fam, count]) => {
              const pct = Math.round(count / total * 100), fc = FAM_COLORS[fam] || "#888";
              return (
                <div key={fam} onClick={() => setDrill(fam)} style={{ marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13 }}>{fam}</span>
                    <span style={{ fontSize: 11, color: "#888780" }}>{pct}% · {count}×</span>
                  </div>
                  <MiniBar pct={pct} color={fc} />
                </div>
              );
            })}
          </div>
          <div className="card" style={{marginBottom: 12 }}>
            <div className="lbl">SAISON-VERTEILUNG</div>
            {seasC.map(([s, n]) => {
              const sc = getSeasonColor(s);
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                  <div style={{ width: 64, fontSize: 12 }}>{s}</div>
                  <MiniBar pct={Math.round(n / total * 100)} color={sc.accent} />
                  <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
                </div>
              );
            })}
          </div>
          <div className="card" style={{marginBottom: 12 }}>
            <div className="lbl">KONZENTRATION</div>
            {concC.map(([c, n]) => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                <div style={{ width: 52, fontSize: 12, fontWeight: 500 }}>{c}</div>
                <MiniBar pct={Math.round(n / total * 100)} color="#534AB7" />
                <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
              </div>
            ))}
          </div>
          <Suspense fallback={<div className="skeleton" style={{ height: 260, margin: 12, borderRadius: 12 }} />}>
            <DuftDNASection items={items} log={log} />
          </Suspense>
        </div>
      )}

      {statsTab === "nutzung" && (
        <div>
          {log.length === 0 ? (
            <div className="card" style={{ textAlign: "center", color: "#888780", padding: "36px 16px", fontSize: 13 }}>
              <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.5 }}>◉</div>
              Noch kein Trage-Verlauf.<br />Nutze „Tragen" in der Heute-Ansicht.
            </div>
          ) : (
            <div>
              <div className="card" style={{marginBottom: 12 }}>
                <div className="lbl">TOP 10 MEISTGETRAGEN</div>
                {wearByPerfume.map(({ p, n }, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: "#B4B2A9", minWidth: 16 }}>#{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>{p.name}</button>
                      <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                    </div>
                    <MiniBar pct={n / maxWear * 100} color={FAM_COLORS[p.family] || "#888"} height={4} />
                    <div style={{ fontSize: 11, color: "#888780", minWidth: 24, textAlign: "right" }}>×{n}</div>
                  </div>
                ))}
              </div>
              {monthlyWear.length > 1 && (
                <div className="card" style={{marginBottom: 12 }}>
                  <div className="lbl">TRAGEHÄUFIGKEIT (MONATE)</div>
                  {monthlyWear.map(([k, n]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                      <div style={{ width: 56, fontSize: 11, color: "#888780" }}>{k}</div>
                      <MiniBar pct={n / maxMonth * 100} color="#1D9E75" />
                      <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="card">
                <div className="lbl">GETRAGEN NACH DUFTFAMILIE</div>
                {wearByFam.map(([f, n]) => {
                  const fc = FAM_COLORS[f] || "#888";
                  return (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                      <div style={{ width: 72, fontSize: 12 }}>{f}</div>
                      <MiniBar pct={n / maxFamWear * 100} color={fc} />
                      <div style={{ fontSize: 11, color: "#888780", minWidth: 24, textAlign: "right" }}>×{n}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {statsTab === "kalender" && (
        <WearCalendar log={log} items={items} onSelectPerfume={onSelectPerfume} />
      )}

      {statsTab === "noten" && (
        <div>
          <div className="card" style={{marginBottom: 12 }}>
            <div className="lbl">TOP 30 DUFTNOTEN</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {noteC.slice(0, 30).map(([n, c], i) => {
                const size = i < 5 ? 13 : i < 12 ? 11 : 10;
                const opacity = Math.max(0.5, 1 - i * 0.025);
                return (
                  <span key={n} className="pill" style={{ fontSize: size, opacity, padding: "3px 9px", background: "#5F5E5A22", color: "#5F5E5A" }}>
                    {n} <span style={{ opacity: .7 }}>×{c}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="lbl">NOTEN NACH KATEGORIE</div>
            {[["Kopfnoten", items.map(p => splitNotes(p.top)).flat()],
            ["Herznoten", items.map(p => splitNotes(p.middle)).flat()],
            ["Basisnoten", items.map(p => splitNotes(p.base)).flat()]].map(([cat, allNotes]) => {
              const c = {}; allNotes.forEach(n => { c[n] = (c[n] || 0) + 1; });
              const top5 = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "#1A1A18" }}>{cat}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {top5.map(([n, cnt]) => (
                      <span key={n} className="pill" style={{ fontSize: 10, padding: "2px 8px", background: "#5F5E5A22", color: "#5F5E5A" }}>{n} ×{cnt}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {statsTab === "favoriten" && (
        <div>
          <div className="card" style={{marginBottom: 12 }}>
            <div className="lbl">5-STERNE PARFÜMS</div>
            {items.filter(p => p.rating === 5).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
              <div key={p.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EFE8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                  <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {(p.families && p.families.length > 0 ? p.families : [p.family || "Sonstiges"]).map((f, idx) => (
                    <FamilyPill key={f} family={f} idx={idx} />
                  ))}
                </div>
              </div>
            ))}
            {items.filter(p => p.rating === 5).length === 0 && (
              <div className="card" style={{ textAlign: "center", color: "#888780", padding: "28px 16px", fontSize: 13, marginBottom: 12 }}>
                <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.5 }}>★★★★★</div>
                Noch keine 5-Sterne-Bewertungen.
              </div>
            )}
          </div>
          {avgRatingByFam.length > 0 && (
            <div className="card" style={{marginBottom: 12 }}>
              <div className="lbl">Ø BEWERTUNG PRO FAMILIE</div>
              {avgRatingByFam.map(([f, avg, cnt]) => {
                const fc = FAM_COLORS[f] || "#888";
                return (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 72, fontSize: 12 }}>{f}</div>
                    <MiniBar pct={parseFloat(avg) / 5 * 100} color={fc} />
                    <div style={{ fontSize: 11, color: "#888780", minWidth: 40, textAlign: "right" }}>{avg} ★</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            <div className="lbl">ALLE BEWERTETEN PARFÜMS</div>
            {items.filter(p => p.rating > 0).sort((a, b) => (b.rating || 0) - (a.rating || 0)).map(p => (
              <div key={p.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EFE8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                  <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                </div>
                <Stars rating={p.rating} size={13} />
              </div>
            ))}
            {items.filter(p => p.rating > 0).length === 0 && (
              <div className="card" style={{ textAlign: "center", color: "#888780", padding: "28px 16px", fontSize: 13 }}>
                Bewerte Parfüms in der Detailansicht.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


export default StatistikTab;
