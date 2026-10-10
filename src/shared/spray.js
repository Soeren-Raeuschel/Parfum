// ── Spray-Animation (Partikel-Burst beim „Tragen") ──────────────────────────
// Rein DOM-basiert (kein React-State): 12 farbige Partikel sprühen fächerförmig
// vom Button-Zentrum nach außen. Keyframes `sprayParticle` liegen in style.css.
// Aufruf: triggerSprayAnimation(event.currentTarget)
export function triggerSprayAnimation(buttonEl) {
  if (!buttonEl) return;
  const rect = buttonEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ["#534AB7", "#1D9E75", "#BA7517", "#D4537E", "#185FA5"];
  // An #root anhängen (Fixed-Container der App) statt an body.
  // Auf iOS mit position:fixed am body landen Partikel sonst außerhalb des
  // sichtbaren Viewports oder werden vom Safe-Area-Bereich abgeschnitten.
  const container = document.getElementById("root") || document.body;
  for (let i = 0; i < 12; i++) {
    const el = document.createElement("div");
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    const dist = 28 + Math.random() * 32;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 10;
    const size = 4 + Math.random() * 5;
    el.style.cssText = `
      position:fixed; left:${cx}px; top:${cy}px;
      width:${size}px; height:${size}px; border-radius:50%;
      background:${colors[i % colors.length]};
      pointer-events:none; z-index:99999;
      --dx:${dx}px; --dy:${dy}px;
      animation:sprayParticle 0.55s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
      margin-left:-${size/2}px; margin-top:-${size/2}px;
    `;
    container.appendChild(el);
    setTimeout(() => el.remove(), 600);
  }
}
