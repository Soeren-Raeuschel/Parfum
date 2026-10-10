import React from "react";
import { FAM_COLORS } from "./constants";

const S = {
  // Statische Klassennamen
  app: "app",
  hdr: "hdr",
  tabs: "tabs",
  body: "body",
  card: "card",
  lbl: "lbl",

  // Tab-Klasse (aktiv/inaktiv via aria-selected)
  tab: (active) => ({ className: active ? "tab active" : "tab" }),
  dtab: (active) => ({ className: active ? "tab active" : "tab" }),

  // Pill: CSS-Klasse, Farbe per CSS-Variable (in styles.css .pill genutzt)
  pill: (color) => ({
    style: {
      '--pill-bg': color + "22",  // CSS Variable für background
      '--pill-c': color            // CSS Variable für color
    }
  }),

  // Inline-Style-Objekte für bestehende style-Spreads
  inp: {
    width: "100%", padding: "10px 12px", border: "1px solid #D3D1C7", borderRadius: 8,
    fontSize: 14, fontFamily: "'Georgia',serif", background: "#fff", color: "#1A1A18",
    boxSizing: "border-box", outline: "none"
  },
  ta: {
    width: "100%", padding: "10px 12px", border: "1px solid #D3D1C7", borderRadius: 8,
    fontSize: 13, fontFamily: "'Georgia',serif", background: "#fff", color: "#1A1A18",
    boxSizing: "border-box", resize: "vertical", minHeight: 80, lineHeight: 1.6, outline: "none"
  },

  // Button-Varianten als gültige Inline-Style-Objekte
  btn: (v) => {
    const base = {
      minHeight: 44, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13,
      fontFamily: "'Georgia',serif", padding: "10px 16px", background: "#F1EFE8", color: "#1A1A18"
    };
    if (v === "pri") return { ...base, background: "#1A1A18", color: "#fff", boxShadow: "0 4px 15px rgba(26,26,24,0.2)" };
    if (v === "out") return { ...base, background: "transparent", border: "1px solid #D3D1C7" };
    if (v === "sm") return { ...base, padding: "6px 12px", minHeight: 36 };
    if (v === "lg") return { ...base, padding: "14px 24px" };
    return base;
  },

  // Chip: active/inactive via className .chip/.chip.active, Styles via S.chip()
  chip: (a, c) => ({
    background: a ? (c || "#1A1A18") : "transparent",
    color: a ? "#fff" : "#1A1A18",
    border: `1px solid ${a ? (c || "#1A1A18") : "#D3D1C7"}`
  }),

  // Skeleton: Klasse wird direkt am Element verwendet
  skeleton: () => "skeleton"
};

// ── FamilyPill: shared family pill renderer (idx === 0 ? filled : outlined) ──────
function FamilyPill({ family, idx }) {
  const color = FAM_COLORS[family] || "#888";
  if (idx === 0) {
    return <span className="pill" style={{ background: color + "22", color }}>{family}</span>;
  }
  return <span className="pill" style={{ fontSize: 9, padding: "2px 8px", borderRadius: 12, border: `1px solid ${color}`, background: "transparent", color, fontWeight: 400 }}>{family}</span>;
}

function MiniBar({ pct, color, height = 5 }) {
  return (
    <div style={{ height, background: "#F1EFE8", borderRadius: 3, overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3, transition: "width .5s" }} />
    </div>
  );
}

// ── Star rating ───────────────────────────────────────────────────────────────
function Stars({ rating, onSet, size = 18 }) {
  // Pop-Animation: der zuletzt geklickte Stern bekommt .star-pop (Keyframes in style.css)
  const [pop, setPop] = React.useState(null);
  const popTimer = React.useRef(null);
  function handleSet(n) {
    if (!onSet) return;
    setPop(n);
    clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPop(cur => (cur === n ? null : cur)), 400);
    onSet(n);
  }
  return (
    <div style={{ display: "flex", gap: 2 }} role="group" aria-label={`Bewertung: ${rating || 0} von 5 Sternen`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => handleSet(n)}
          className={`star-btn${pop === n ? " star-pop" : ""}`}
          aria-label={`${n} Stern${n > 1 ? "e" : ""}`}
          aria-pressed={n <= (rating || 0)}
          style={{
            background: "none", border: "none", fontSize: size, cursor: onSet ? "pointer" : "default",
            color: n <= (rating || 0) ? "#BA7517" : "#D3D1C7", padding: "6px 4px", lineHeight: 1, minHeight: 36, minWidth: 28
          }}>★</button>
      ))}
    </div>
  );
}

// ── TabSkeleton: mehrzeiliger Skeleton-Fallback für lazy Tabs (statt Spinner) ──
function TabSkeleton() {
  return (
    <div style={{ padding: 16 }} aria-busy="true" aria-live="polite">
      {/* Titelzeile */}
      <div className="skeleton" style={{ height: 16, width: "45%", marginBottom: 16 }} />
      {/* Hauptkarte */}
      <div className="skeleton" style={{ height: 128, borderRadius: 12, marginBottom: 12 }} />
      {/* Zwei Listenkarten */}
      <div className="skeleton" style={{ height: 72, borderRadius: 12, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 72, borderRadius: 12, marginBottom: 12 }} />
      {/* Fußzeile */}
      <div className="skeleton" style={{ height: 44, borderRadius: 12 }} />
    </div>
  );
}

function useBodyLock(active) {
  React.useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    document.body.classList.add("modal-open");
    document.body.style.top = "-" + scrollY + "px";
    return () => {
      document.body.classList.remove("modal-open");
      document.body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}


export { S, FamilyPill, MiniBar, Stars, useBodyLock, TabSkeleton };
