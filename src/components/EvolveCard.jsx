import { useEffect, useState } from "react";
import { splitNotes } from "../utils/helpers";

// Sterne fächern sich nach oben auf (-160° bis -20°) – Celebration beim Hinzufügen
const STARS = Array.from({ length: 12 }, (_, i) => {
  const angle = ((-160 + (i / 11) * 140) * Math.PI) / 180;
  const dist = 90 + (i % 3) * 35;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    delay: 950 + i * 45, // startet, wenn der Flip kurz vorm Einrasten ist
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
  const SPIN_MS = 1400;   // Dauer von cardSpinIn (muss zur CSS-Animation passen)
  const HOLD_MS = 2200;   // Pause, bevor ausgeblendet wird
  const FADE_MS = 400;    // Dauer des Fade-outs

  // Auto-Close: kurze Pause nach der Animation, dann sanft ausblenden
  useEffect(() => {
    if (!perfume) return;
        // Feedback: Vibration (Android) + Audio-Klick (iOS Safari)
    // User-Präferenz via localStorage: { intensity: 0..1, preferAudio: true/false }
    const hapticPref = (() => {
      try { return JSON.parse(localStorage.getItem('parfum_haptic') || '{}'); } catch { return {}; }
    })();
    const intensity = Math.max(0, Math.min(1, hapticPref.intensity ?? 1)); // 0..1
    // iOS-Erkennung (iPad meldet sich teils als Mac -> Touch-Support prüfen)
    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const useAudio = hapticPref.preferAudio ?? isIOS(); // Default: Audio auf iOS
    
    // Start-Puls: Vibration ODER Audio-Klick
    if (intensity > 0) {
      if (useAudio) {
        playClick(intensity);
      } else {
        const scale = (ms) => Math.round(ms * intensity);
        try { navigator.vibrate?.([scale(25), scale(40), scale(15)]); } catch {}
      }
    }
    const t1 = setTimeout(() => setClosing(true), SPIN_MS + HOLD_MS);
    const t2 = setTimeout(onClose, SPIN_MS + HOLD_MS + FADE_MS);
    
    // Einrasten-Puls kurz vor Ende der Drehung
    if (intensity > 0) {
      const t3 = setTimeout(() => {
        if (useAudio) {
          playLock(intensity);
        } else {
          try { navigator.vibrate?.([15, 25, 15, 25, 60].map(ms => Math.round(ms * intensity))); } catch {}
        }
      }, SPIN_MS - 120);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };;
  }, [perfume, onClose]);

  if (!perfume) return null;

  const families = (perfume.families && perfume.families.length > 0)
    ? perfume.families
    : perfume.family ? [perfume.family] : [];

  const top = splitNoteList(perfume.top);
  const middle = splitNoteList(perfume.middle);
  const base = splitNoteList(perfume.base);

  // 3D-Flip auch auf Safari: performant gemacht durch
  // – Blur in separater, statischer Ebene (keine animierten Kinder mehr,
  //   das war der Compositing-Konflikt -> Ruckeln, siehe public/evolve-test.html)
  // – Schatten ohne filter:blur (Radial-Gradient statt Blur-Filter)
  // – kein transform-style:preserve-3d (ungültige Kombi mit overflow:hidden)
  const isSafari = isSafariUA();
  const animate3D = !prefersReducedMotion() && supports3DFlip();

  return (
    <div
      onClick={() => setClosing(true)}
      style={{
        position: "fixed", inset: 0, zIndex: 9500,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: closing ? 0 : 1, transition: "opacity .35s ease",
        pointerEvents: closing ? "none" : "auto",
      }}
    >
      {/* Blur in EIGENER, statischer Ebene: backdrop-filter + animiertes Kind
          in derselben Ebene ruckelt in Safari (Compositing-Konflikt). Diese
          Ebene selbst animiert nie. */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "rgba(26,26,24,.55)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      }} />
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

        {/* Schattenwurf-Ebene hinter der Karte – folgt dem Flip und macht
            die Bewegung räumlicher. Nur beim 3D-Flip (Blur ist auf alten
            Geräten teuer). */}
        {animate3D && (
          <span aria-hidden="true" style={{
            position: "absolute", inset: 0, borderRadius: 18,
            // Radial-Gradient statt filter:blur -> Safari rendert sonst pro
            // Frame einen teuren Blur neu (Ruckeln beim Flip)
            background: "radial-gradient(ellipse at center, rgba(26,26,24,.55) 0%, rgba(26,26,24,.28) 55%, transparent 74%)",
            pointerEvents: "none", zIndex: 0,
            animation: `cardShadowIn 1.4s cubic-bezier(.35,.9,.25,1) both`,
          }} />
        )}

        {/* Karte */}
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "relative", zIndex: 1, // über der Schatten-Ebene
            width: 216, minHeight: 300, borderRadius: 18, padding: 18,
            background: "linear-gradient(155deg, #534AB7 0%, #7C6FE0 55%, #4A429E 100%)",
            color: "#FAFAF8", boxShadow: "0 20px 50px rgba(26,26,24,.45)",
            // transform-style:preserve-3d bewusst NICHT gesetzt: ungültige
            // Kombi mit overflow:hidden, kostet in Safari unnötig Compositing
            fontFamily: "'Georgia', serif",
            willChange: "transform, opacity", // GPU-Hint für flüssigen Spin
            overflow: "hidden", // damit der Licht-Sweep nicht über die Ecken läuft
            // Animation je nach Gerät: 3D-Flip, 2D-Fallback (schwache/alte
            // Geräte) oder einfaches Scale-in bei prefers-reduced-motion
            animation: prefersReducedMotion()
              ? "scaleIn .2s ease-out both"
              : animate3D
                ? "cardSpinIn 1.4s cubic-bezier(.35,.9,.25,1) both"
                : "cardSpinIn2D 1.4s cubic-bezier(.35,.9,.25,1) both",
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

/**
 * 3D-Flip nur auf Geräten, die das auch performant können:
 * – CSS.supports-Check für perspective/preserve-3d (sehr alte Browser)
 * – Hardware-Heuristik: CPU-Cores + deviceMemory (falls verfügbar)
 *   ≤ 2 Cores ODER ≤ 2 GB RAM → schwaches/altes Gerät → 2D-Fallback.
 */
function supports3DFlip() {
  try {
    const cssOK = window.CSS?.supports?.("(perspective: 1px) and (transform-style: preserve-3d)");
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory;
    const lowMem = typeof mem === 'number' && mem <= 2;
    // Zusätzlich: alte iOS-Geräte (iPhone 8 und älter) erkennen
    const oldIOS = isOldIOS();
    return cssOK && cores > 2 && !lowMem && !oldIOS;
  } catch { return false; }
}

/**
 * Erkennt alte iOS-Geräte (kein / schwaches 3D-Compositing).
 * Wichtig: Funktion fehlte vorher -> ReferenceError in supports3DFlip,
 * wodurch alle Browser still in den 2D-Fallback fielen.
 */
function isOldIOS() {
  try {
    const match = navigator.userAgent.match(/OS (\d+)_/);
    return match ? parseInt(match[1], 10) < 13 : false;
  } catch { return false; }
}


/**
 * Safari-Erkennung (Mac + iOS): Safari hat ein Compositing-Problem mit
 * backdrop-filter + rotateY gleichzeitig (Ruckeln, Drehung kaum sichtbar).
 * Chrome/Edge enthalten "Chrome" bzw. "Chromium" im User-Agent, Firefox nicht.
 */
function isSafariUA() {
  try {
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS/i.test(ua);
  } catch { return false; }
}
