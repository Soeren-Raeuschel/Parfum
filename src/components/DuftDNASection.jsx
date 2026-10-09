import React, { useState, useEffect, useMemo, useRef } from "react";
import { splitNotes } from "../utils/helpers";

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: DUFT-DNA RADAR CHART (SVG, kein externes Chart-Lib)
// ══════════════════════════════════════════════════════════════════════════════
const DNA_DIMS = [
  { id: "holzig",       label: "Holzig",    color: "#BA7517", notes: ["sandelholz", "zedernholz", "vetiver", "patschuli", "holz", "oud", "leder", "guaiac", "teak", "kastanie"] },
  { id: "suess",        label: "Süß",       color: "#D4537E", notes: ["vanille", "tonkabohne", "karamell", "honig", "benzoe", "heliotrop", "praline", "marshmallow", "schokolade"] },
  { id: "frisch",       label: "Frisch",    color: "#1D9E75", notes: ["bergamotte", "zitrone", "grapefruit", "neroli", "minze", "petitgrain", "limette", "orange", "yuzu", "pomelo"] },
  { id: "orientalisch", label: "Oriental",  color: "#993C1D", notes: ["safran", "weihrauch", "oud", "zimt", "nelke", "rum", "tabak", "tonka", "kardamom", "muskat"] },
  { id: "wuerzig",      label: "Würzig",    color: "#534AB7", notes: ["pfeffer", "ingwer", "kardamom", "kümmel", "muskatnuss", "thymian", "koriander", "rosa pfeffer", "sternanis"] },
  { id: "gruen",        label: "Grün",      color: "#3B6D11", notes: ["gras", "basilikum", "veilchen", "iris", "tee", "kräuter", "farn", "eichenmoos", "galbanum", "bambus"] },
  { id: "aquatisch",    label: "Aquatisch", color: "#185FA5", notes: ["meer", "ozean", "wasser", "alge", "salz", "regen", "calone", "lotus", "seegras", "marin"] },
  { id: "floral",       label: "Floral",    color: "#E075A0", notes: ["rose", "jasmin", "ylang", "maiglöckchen", "lilie", "pfingstrose", "tuberose", "freesie", "neroli", "gardenie", "lavendel"] },
  { id: "gourmand",     label: "Gourmand",  color: "#C2604A", notes: ["kokos", "kaffe", "kakao", "mandel", "sahne", "milch", "butter", "kirsche", "beere", "mango", "pfirsich"] },
  { id: "harzig",       label: "Harzig",    color: "#8B5E3C", notes: ["labdanum", "benzoe", "opoponax", "elemi", "copaiba", "mastix", "peru balsam", "tolu balsam", "amber", "ambra", "ambergris", "styrax", "myrrhe"] },
  { id: "pudrig",       label: "Pudrig",    color: "#C4A0B0", notes: ["iris", "puder", "veilchen", "heliotrop", "lippenstift", "kosmetisch", "mimose", "amber"] },
  { id: "zitrisch",     label: "Zitrisch",  color: "#C9A825", notes: ["zitrone", "bergamotte", "orange", "limette", "grapefruit", "mandarine", "neroli", "petitgrain", "yuzu", "kumquat"] },
  { id: "animalisch",   label: "Animalisch",color: "#8B4513", notes: ["civette", "castoreum", "hyraceum", "moschus noir", "animalisch", "musc animal", "zibeth"] },
  { id: "rauchig",      label: "Rauchig",   color: "#5F5E5A", notes: ["tabak", "rauch", "birke", "guaiac", "vetiver", "incense", "teer", "kohle", "kreosot"] },
  { id: "ledrig",       label: "Ledrig",    color: "#7B4F3A", notes: ["leder", "cuir", "birke", "castoreum", "aldehyd", "isoeugenol", "benzyl benzoat", "labdanum", "suede", "wildleder"] },
];

// ── matchNoteKeyword ─────────────────────────────────────────────────────────
// Wortgrenzen-Matching zwischen einer Noten-Bezeichnung und einem Kategorie-Keyword.
// Verhindert Fehltreffer durch substring-Matching (z. B. „Kaffee" → „Tee"),
// erlaubt aber Teiltreffer wie „Sandelholz" → „holz" (Wortgrenze zwischen Wörtern).
// ─────────────────────────────────────────────────────────────────────────────
function matchNoteKeyword(note, keyword) {
  if (note === keyword) return true;
  // Exaktes Schlüsselwort als eigenständiges Wort in der Note (auch in Mehrwort-Notes)
  const kw = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${kw}(\\s|$)`).test(note);
}

function computeDNA(items, log, weightByUsage = false) {
  const wc = {};
  if (weightByUsage) log.forEach(l => { wc[l.id] = (wc[l.id] || 0) + 1; });

  const scores = {};
  DNA_DIMS.forEach(d => { scores[d.id] = 0; });
  let itemWeightSum = 0;

  items.forEach(p => {
    const w = weightByUsage ? (wc[p.id] || 0) + 1 : 1;
    itemWeightSum += w;
    const allNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
      .map(n => n.toLowerCase().trim())
      .filter(Boolean);
    DNA_DIMS.forEach(dim => {
      // Jede Note zählt max. 1× pro Dimension (verhindert Doppelwertung, z. B.
      // „Sandelholz" matcht „sandelholz" UND „holz")
      const matches = allNotes.some(n =>
        dim.notes.some(k => matchNoteKeyword(n, k))
      );
      if (matches) scores[dim.id] += w;
    });
  });

  if (!itemWeightSum) return DNA_DIMS.map(d => ({ ...d, value: 0 }));
  // Summe aller Dimensions-Scores (Noten können mehreren Kategorien zählen, z. B. Oud → holzig + orientalisch)
  const sumScores = DNA_DIMS.reduce((s, d) => s + scores[d.id], 0);
  if (sumScores <= 0) return DNA_DIMS.map(d => ({ ...d, value: 0 }));
  // Anteil jeder Dimension an der Gesamt-Trefferzahl → Werte summieren sich zu 1 (Radar = Mischungsverhältnis)
  return DNA_DIMS.map(d => ({ ...d, value: scores[d.id] / sumScores }));
}

// ── DuftDNAChart – Chart.js Radar (als npm-Abhängigkeit gebundelt, kein CDN) ─
// Interaktiv: Hover-Tooltip, alle 15 Familien-Achsen, pro-Achsen-Farben.
// Chart.js wird lazy geladen (eigener Chunk), die Modul-Instanz wird gecacht,
// damit das Modul bei Re-Renders nur einmal geladen wird (offline-fähig,
// da im Bundle enthalten).
// ─────────────────────────────────────────────────────────────────────────────
let _chartModulePromise = null;
function loadChart() {
  if (!_chartModulePromise) _chartModulePromise = import("./chartSetup");
  return _chartModulePromise;
}

function DuftDNAChart({ dna }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [chartReady, setChartReady] = useState(false);

  // Chart.js-Modul einmalig vorladen
  useEffect(() => {
    let mounted = true;
    loadChart().then(() => { if (mounted) setChartReady(true); });
    return () => { mounted = false; };
  }, []);

  const allZero = !dna || dna.every(d => d.value === 0);

  // Build chart data
  const labels = dna ? dna.map(d => d.label) : [];
  const values = dna ? dna.map(d => Math.round(d.value * 100)) : [];
  const colors = dna ? dna.map(d => d.color) : [];
  const dominant = dna ? [...dna].sort((a, b) => b.value - a.value)[0] : null;
  const maxVal = dna ? Math.max(...dna.map(d => d.value), 1e-12) : 1;

  useEffect(() => {
    let cancelled = false;
    if (allZero || !canvasRef.current) return;

    loadChart().then(({ default: Chart }) => {
      if (cancelled || !canvasRef.current) return;

      // Vorherige Chart-Instanz sauber zerstören (verhindert Leaks bei Re-Renders)
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const ctx = canvasRef.current.getContext("2d");
    // Farbverlauf in der Dominant-Farbe (oben kräftig, unten fast transparent)
    const domColor = dominant ? dominant.color : "#534AB7";
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasRef.current.height || 320);
    gradient.addColorStop(0, domColor + "44");
    gradient.addColorStop(1, domColor + "12");

    // Guard: stepSize 0 würde Chart.js zum Absturz bringen, wenn maxVal sehr klein ist
    const stepSize = Math.max(1, Math.round(maxVal * 25));

    chartRef.current = new Chart(ctx, {
      type: "radar",
      data: {
        labels,
        datasets: [{
          label: "Duft-DNA",
          data: values,
          backgroundColor: gradient,
          borderColor: domColor,
          borderWidth: 2,
          borderJoinStyle: "round",
          pointBackgroundColor: colors,
          pointBorderColor: "#fff",
          pointBorderWidth: 1.5,
          pointRadius: values.map(v => v >= 1 ? 4 : 2),
          pointHoverRadius: 7,
          pointHoverBackgroundColor: colors,
          pointHoverBorderColor: "#1A1A18",
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 500, easing: "easeInOutQuart" },
        scales: {
          r: {
            beginAtZero: true,
            max: Math.round(maxVal * 100) + 5,
            ticks: { display: false, stepSize },
            grid: { color: "#ECEAE4" },
            angleLines: { color: "#D3D1C744" },
            pointLabels: {
              padding: 4,
              font: { size: 10, family: "'Georgia', serif" },
              color: (c) => colors[c.index] || "#888780",
              callback: (label, idx) => {
                const v = values[idx] || 0;
                return v >= 1 ? `${label} ${v}%` : label;
              }
            },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.r;
                return ` ${c.label}: ${v}%`;
              }
            },
            backgroundColor: "#1A1A18",
            titleColor: "#fff",
            bodyColor: "#fff",
            cornerRadius: 8,
            padding: 10,
            titleFont: { family: "'Georgia', serif" },
            bodyFont: { family: "'Georgia', serif" },
          }
        },
        interaction: { mode: "index" }
      }
    });
    });

    return () => {
      cancelled = true;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [chartReady, dna]); // chartReady: Effect läuft nach Modul-Load erneut; dna ist in DuftDNASection memoized

  if (allZero) return (
    <div style={{ textAlign: "center", color: "#888780", padding: "28px 0", fontSize: 12, lineHeight: 1.6 }}>
      Keine Noten-Daten verfügbar.<br />
      <span style={{ fontSize: 11 }}>Füge Noten zu deinen Parfüms hinzu, um die DNA zu sehen.</span>
    </div>
  );

  // Fallback while Chart.js chunk is loading
  if (!chartReady) {
    return (
      <div style={{ textAlign: "center", color: "#888780", padding: "16px 0", fontSize: 12 }}>
        Chart.js wird geladen…
      </div>
    );
  }

  const sorted = dna ? [...dna].sort((a, b) => b.value - a.value) : [];

  return (
    <div style={{ userSelect: "none" }}>
      <div style={{ position: "relative", maxWidth: 320, margin: "0 auto" }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "auto" }} />
      </div>

      {/* Legende: Top 8 als horizontale Bars */}
      <div style={{ marginTop: 12, padding: "0 4px" }}>
        {sorted.filter(d => d.value >= 0.01).slice(0, 8).map((d, i) => (
          <div key={d.id} style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#1A1A18", minWidth: 68 }}>{d.label}</span>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: "#ECEAE4", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${Math.round(d.value / maxVal * 100)}%`,
                background: d.color,
                transition: "width .4s ease-out",
              }} />
            </div>
            <span style={{ fontSize: 10, color: d.color, fontWeight: 600, minWidth: 30, textAlign: "right" }}>
              {Math.round(d.value * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
// ── DuftDNASection ────────────────────────────────────────────────────────────
// BUGFIX: War nie definiert → React-Laufzeitfehler im Profil-Tab.
// Wrapping-Komponente mit Sammlung/Nutzung-Toggle für DuftDNAChart.
// ─────────────────────────────────────────────────────────────────────────────
function DuftDNASection({ items, log }) {
  const [weighted, setWeighted] = useState(false);
  // EDGE CASE: leere items/log → computeDNA gibt value:0 zurück → Chart zeigt Leer-Hinweis
  const dna = useMemo(() => computeDNA(items, log, weighted), [items, log, weighted]);
  const toggleBtn = (active) => ({
    fontSize: 10, padding: "5px 10px", borderRadius: 16,
    // Aktiver Toggle ist gefüllt, inaktiver nur umrandet
    background: active ? "#E24B4A" : "transparent",
    color: active ? "#fff" : "#E24B4A",
    borderColor: "#F09595",
  });
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="lbl">DUFT-DNA RADAR</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setWeighted(false)}
            className="btn btn-out" style={toggleBtn(!weighted)} aria-pressed={!weighted}>
            Sammlung
          </button>
          <button type="button" onClick={() => setWeighted(true)}
            className="btn btn-out" style={toggleBtn(weighted)} aria-pressed={weighted}>
            Nutzung
          </button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#888780", marginBottom: 12, lineHeight: 1.45 }}>
        Prozent = Anteil an allen Duft-DNA-Treffern (Summe der Achsen ≈ 100&nbsp;%).
        Die Grafik skaliert auf die stärkste Achse, damit die Form den Rahmen ausfüllt.
        Eine Note kann in mehreren Kategorien zählen (z.&nbsp;B. Oud → holzig und orientalisch).
      </div>
      <DuftDNAChart dna={dna} />
    </div>
  );
}

export default DuftDNASection;
