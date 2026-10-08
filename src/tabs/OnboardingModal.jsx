import React, { useState, useEffect } from "react";
import { S, useBodyLock } from "../shared/ui";
import { ONBOARD_STYLES } from "../data/localAdapter";

// 14 Duftfamilien für Onboarding-Auswahl
const ONBOARD_FAMILIES = [
  { id: "Fresh",      label: "Frisch",        icon: "🍋" },
  { id: "Floral",     label: "Blumig",        icon: "🌸" },
  { id: "Woody",      label: "Holzig",        icon: "🌲" },
  { id: "Oriental",   label: "Orientalisch",  icon: "🌙" },
  { id: "Chypre",     label: "Chypre",        icon: "🌿" },
  { id: "Fougère",    label: "Fougère",       icon: "🪨" },
  { id: "Gourmand",   label: "Gourmand",      icon: "🍮" },
  { id: "Aquatisch",  label: "Aquatisch",     icon: "🌊" },
  { id: "Würzig",     label: "Würzig",        icon: "🌶️" },
  { id: "Harzig",     label: "Harzig",        icon: "🪵" },
  { id: "Ledrig",     label: "Ledrig",        icon: "🧥" },
  { id: "Grün",       label: "Grün",          icon: "🍃" },
  { id: "Fruchtig",   label: "Fruchtig",      icon: "🍑" },
  { id: "Pudrig",     label: "Pudrig",        icon: "🌫️" },
  { id: "Rauchig",    label: "Rauchig",       icon: "🔥" },
];
const ONBOARD_OCC = [
  { id: "casual", label: "Alltag" }, { id: "work", label: "Büro" },
  { id: "evening", label: "Abend" }, { id: "date", label: "Date" },
  { id: "sport", label: "Sport" }, { id: "outdoor", label: "Outdoor" },
];


function OnboardingModal({ onComplete }) {
  const [step, setStep] = useState(0);
  useBodyLock(true);
  const [styles, setStyles] = useState([]);
  const [favFamilies, setFavFamilies] = useState([]);
  const [occs, setOccs] = useState([]);

  function toggle(arr, setArr, val) {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  const steps = [
    {
      title: "Welche Düfte magst du?",
      sub: "Wähle deinen Duftstil – mehrere möglich.",
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {ONBOARD_STYLES.map(s => (
            <button key={s.id} onClick={() => toggle(styles, setStyles, s.id)} aria-label={`Stil: ${s.label}`} className={`chip ${styles.includes(s.id) ? "active" : ""}`}
              style={{
                ...S.chip(styles.includes(s.id)), padding: "12px", borderRadius: 10,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center"
              }}>
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <span style={{ fontSize: 12 }}>{s.label}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Lieblingsduftfamilien",
      sub: "Welche Duftfamilien liebst du? (mehrere möglich)",
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7 }}>
          {ONBOARD_FAMILIES.map(f => (
            <button key={f.id} onClick={() => toggle(favFamilies, setFavFamilies, f.id)} aria-label={`Duftfamilie: ${f.label}`} className={`chip ${favFamilies.includes(f.id) ? "active" : ""}`}
              style={{
                ...S.chip(favFamilies.includes(f.id), "#534AB7"), padding: "10px 12px", borderRadius: 10,
                display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontSize: 12
              }}>
              <span style={{ fontSize: 18 }}>{f.icon}</span>
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Hauptanlässe",
      sub: "Wofür trägst du Parfüm meistens?",
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {ONBOARD_OCC.map(o => (
            <button key={o.id} onClick={() => toggle(occs, setOccs, o.id)} aria-label={`Anlass: ${o.label}`} className={`chip ${occs.includes(o.id) ? "active" : ""}`}
              style={{
                ...S.chip(occs.includes(o.id)), padding: "10px", borderRadius: 8,
                textAlign: "center", fontSize: 12
              }}>
              {o.label}
            </button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      animation: "fadeIn .3s ease-out"
    }}>
      <div style={{
        background: "#FAFAF8", borderRadius: 16, padding: 24,
        maxWidth: 440, width: "100%", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
        animation: "fadeIn .4s ease-out", transform: "scale(1)"
      }}>
        {/* Progress */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? "#1A1A18" : "#E8E6E0"
            }} />
          ))}
        </div>
        <div style={{ fontSize: 18, marginBottom: 4 }}>{steps[step].title}</div>
        <div style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>{steps[step].sub}</div>
        {steps[step].body}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="btn" aria-label="Zurück zum vorherigen Schritt"
            style={{ ...S.btn("out"), flex: 1, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)" }}>Zurück</button>
          )}
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} aria-label="Weiter zum nächsten Schritt" style={{
              ...S.btn("pri"), flex: 2,
              transition: "all .3s cubic-bezier(0.25,.46,.45,.94)"
            }}>Weiter</button>
          ) : (
            <button onClick={() => onComplete({ styles, favFamilies, occasions: occs })} aria-label="Onboarding abschließen"
              style={{
                ...S.btn("pri"), flex: 2,
                transition: "all .3s cubic-bezier(0.25,.46,.45,.94)"
              }}>Fertig →</button>
          )}
        </div>
        <button onClick={() => onComplete(null)}
          style={{
            display: "block", width: "100%", textAlign: "center", fontSize: 11,
            color: "#B4B2A9", background: "none", border: "none", cursor: "pointer", marginTop: 12,
            transition: "color .2s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#534AB7') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#B4B2A9') }}>
          Überspringen
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: LAYERING EMPFEHLUNGEN
// ══════════════════════════════════════════════════════════════════════════════
// Layering-Kompatibilität: basiert auf Parfümerie-Theorie (Duftpyramide, Akkord-Harmonie)
// Prinzip: ähnliche Basisnoten binden gut; Kontrast in Kopfnoten erzeugt Interesse;
// Sandelholz/Vetiver/Moschus als Basisnoten harmonieren mit fast allem.

export default OnboardingModal;
