import { useEffect, useState } from "react";
import { splitNotes } from "../utils/helpers";

// Sterne fächern sich nach oben auf (-160° bis -20°) – Celebration beim Hinzufügen
const STARS = Array.from({ length: 12 }, (_, i) => {
  const angle = ((-160 + (i / 11) * 140) * Math.PI) / 180;
  const dist = 90 + (i % 3) * 35;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    delay: 650 + i * 40, // startet kurz bevor die Karte stehen bleibt
    size: 12 + (i % 4) * 5,
  };
});

function Star({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{ fill: "#F5C872", filter: "drop-shadow(0 0 6px rgba(245,200,114,.9))" }}>
      <path d="M12 1.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 8.8l7.1-.7L12 1.5z" />
    </svg>
  );
}

function NoteRow({ label, notes }) {
  if (!notes || notes.length === 0) return null;
  // Max. 4 Noten zeigen – verhindert, dass die Karte bei langen Listen platzt
  const shown = notes.slice(0, 4);
  const more = notes.length - shown.length;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 8, letterSpacing: "1.5px", color: "#C9C4F0", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "#FAFAF8", opacity: 0.92 }}>
        {shown.join(", ")}{more > 0 && ` +${more}`}
      </div>
    </div>
  );
}

/**
 * EvolveCard – Celebration-Overlay nach dem Bestätigen eines gescrapten Parfums.
 * Karte dreht sich in 3D herein, Sterne fächern auf, danach schließt sie von selbst
 * (oder per Tap). Angepasst an das App-Design (Serif, Creme/Dunkel, Akzent #534AB7).
 */
export default function EvolveCard({ perfume, onClose }) {
  const [closing, setClosing] = useState(false);

  // Zentrale Timings (ms) – synchron zu den Animationen
  const SPIN_MS = 1100;   // Dauer von cardSpinIn
  const HOLD_MS = 2200;   // Pause, bevor ausgeblendet wird
  const FADE_MS = 400;    // Dauer des Fade-outs

  // Auto-Close: kurze Pause nach der Animation, dann sanft ausblenden
  useEffect(() => {
    if (!perfume) return;
    // Haptisches Feedback (mobil; Browser ohne Vibration API ignorieren)
    try { navigator.vibrate?.([25, 40, 15]); } catch { /* nicht unterstützt */ }
    const t1 = setTimeout(() => setClosing(true), SPIN_MS + HOLD_MS);
    const t2 = setTimeout(onClose, SPIN_MS + HOLD_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [perfume, onClose]);

  if (!perfume) return null;

  const families = (perfume.families && perfume.families.length > 0)
    ? perfume.families
    : perfume.family ? [perfume.family] : [];

  const top = splitNoteList(perfume.top);
  const middle = splitNoteList(perfume.middle);
  const base = splitNoteList(perfume.base);

  return (
    <div
      onClick={() => setClosing(true)}
      style={{
        position: "fixed", inset: 0, zIndex: 9500,
        background: "rgba(26,26,24,.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: closing ? 0 : 1, transition: "opacity .35s ease",
        pointerEvents: closing ? "none" : "auto",
      }}
    >
      {/* Perspektive für den 3D-Dreheffekt */}
      <div style={{ position: "relative", perspective: 900 }}>
        {/* Sterne */}
        {STARS.map((s, i) => (
          <span key={i} style={{
            position: "absolute", left: "50%", top: 0, pointerEvents: "none",
            // reduced-motion: Sterne komplett weglassen
            display: prefersReducedMotion() ? "none" : undefined,
            animation: `starBurst 1.1s cubic-bezier(.22,1,.36,1) ${s.delay}ms both`,
            // Custom Props für die Keyframes
            ...({ "--dx": `${s.dx}px`, "--dy": `${s.dy}px` }),
          }}>
            <Star size={s.size} />
          </span>
        ))}

        {/* Karte */}
        <div
          role="status"
          aria-live="polite"
          style={{
            width: 216, minHeight: 300, borderRadius: 18, padding: 18,
            background: "linear-gradient(155deg, #534AB7 0%, #7C6FE0 55%, #4A429E 100%)",
            color: "#FAFAF8", boxShadow: "0 20px 50px rgba(26,26,24,.45)",
            transformStyle: "preserve-3d",
            fontFamily: "'Georgia', serif",
            willChange: "transform, opacity", // GPU-Hint für flüssigen 3D-Spin
            overflow: "hidden", // damit der Licht-Sweep nicht über die Ecken läuft
            animation: prefersReducedMotion() ? "scaleIn .2s ease-out both" : "cardSpinIn 1.1s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          {/* Licht-Sweep nach dem Landen (nur bei aktivierten Animationen) */}
          {!prefersReducedMotion() && (
            <span aria-hidden="true" style={{
              position: "absolute", top: 0, bottom: 0, left: 0, width: "45%",
              background: "linear-gradient(90deg, transparent, rgba(250,250,248,.35), transparent)",
              animation: `cardShine .9s ease-out ${SPIN_MS + 150}ms both`,
              pointerEvents: "none",
            }} />
          )}
          {/* Familie als Chip oben */}
          {families.length > 0 && (
            <div style={{
              display: "inline-block", fontSize: 9, letterSpacing: "1.5px",
              padding: "3px 10px", borderRadius: 999, marginBottom: 10,
              background: "rgba(250,250,248,.14)", border: "1px solid rgba(250,250,248,.25)",
              textTransform: "uppercase",
            }}>
              {families.slice(0, 2).join(" · ")}
            </div>
          )}

          <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{perfume.name}</div>
          {perfume.house && (
            <div style={{ fontSize: 12, color: "#D8D4FA", marginTop: 3 }}>{perfume.house}</div>
          )}
          {/* Format + Jahr (falls vorhanden), rechtsbündig dezente Zusatzinfo */}
          {(perfume.format || perfume.year) && (
            <div style={{ fontSize: 9, letterSpacing: "1.5px", color: "#C9C4F0", marginTop: 4, textTransform: "uppercase" }}>
              {[perfume.format, perfume.year].filter(Boolean).join(" · ")}
            </div>
          )}

          <div style={{ height: 1, background: "rgba(250,250,248,.2)", margin: "12px 0" }} />

          <NoteRow label="KOPF" notes={top} />
          <NoteRow label="HERZ" notes={middle} />
          <NoteRow label="BASIS" notes={base} />

          <div style={{ marginTop: 14, fontSize: 9, letterSpacing: "2px", color: "#C9C4F0", textAlign: "center" }}>
            ZUR SAMMLUNG HINZUGEFÜGT
          </div>
        </div>
      </div>
    </div>
  );
}

/** Noten-String sicher in Liste umwandeln (akzeptiert String oder Array). */
function splitNoteList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return splitNotes(String(v)).map(s => s.trim()).filter(Boolean);
}

function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
