// AiSparkle – animiertes "Equalizer + Funkeln"-Icon für den KI-Bereich im Heute-Tab
// Balken pulsieren gestaffelt (Audio-Wellen-Look), Sterne twinkeln.
// Animation über inline <style>-Keyframes, damit keine zusätzliche CSS-Datei nötig ist.
export function AiSparkle({ size = 32 }) {
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#1A1A18" }}
    >
      <style>{`
        @keyframes aiEq {
          0%, 100% { transform: scaleY(1); }
          50%      { transform: scaleY(0.4); }
        }
        @keyframes aiTwinkle {
          0%, 100% { opacity: 0.25; transform: scale(0.65); }
          50%      { opacity: 1;    transform: scale(1); }
        }
        .aiEqBar {
          transform-box: fill-box;
          transform-origin: bottom center;
          animation: aiEq 1.1s ease-in-out infinite;
        }
        .aiSpark {
          transform-box: fill-box;
          transform-origin: center;
          animation: aiTwinkle 1.4s ease-in-out infinite;
        }
      `}</style>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        {/* Balken (von links nach rechts, gestaffelte Verzögerung) */}
        <rect className="aiEqBar" x="1"    y="25" width="3" height="7"  rx="1.5" style={{ animationDelay: "0s" }} />
        <rect className="aiEqBar" x="6.5"  y="20" width="3" height="12" rx="1.5" style={{ animationDelay: "0.15s" }} />
        <rect className="aiEqBar" x="12"   y="11" width="3" height="21" rx="1.5" style={{ animationDelay: "0.3s" }} />
        <rect className="aiEqBar" x="17.5" y="19" width="3" height="13" rx="1.5" style={{ animationDelay: "0.45s" }} />
        <rect className="aiEqBar" x="23"   y="25" width="3" height="7"  rx="1.5" style={{ animationDelay: "0.6s" }} />
        <rect className="aiEqBar" x="28.5" y="27" width="3" height="5"  rx="1.5" style={{ animationDelay: "0.75s" }} />
        {/* Großer Funkel-Stern (4-zackig, konkav) */}
        <path className="aiSpark" style={{ animationDelay: "0.2s" }}
          d="M25 1 Q25 6 30 6 Q25 6 25 11 Q25 6 20 6 Q25 6 25 1 Z" />
        {/* Kleiner Funkel-Stern */}
        <path className="aiSpark" style={{ animationDelay: "0.8s" }}
          d="M29.5 7.5 Q29.5 10 32 10 Q29.5 10 29.5 12.5 Q29.5 10 27 10 Q29.5 10 29.5 7.5 Z" />
      </svg>
    </div>
  );
}

export default AiSparkle;