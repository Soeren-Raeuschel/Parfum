// Declutter-Logik (rein): wird von App.jsx (Badge) und DeclutterTab genutzt
// FEATURE: DECLUTTER MODUS
// ══════════════════════════════════════════════════════════════════════════════
const DECLUTTER_DAYS = 180;
// Neue Parfums erst nach X Tagen im Vergessen-Tab anzeigen (frisch hinzugefügt sollen dort nicht sofort auftauchen)
const FORGOTTEN_NEW_DELAY_DAYS = 7;
function getDeclutterSuggestions(items, log) {
  const now = Date.now();
  const wears = {};
  log.forEach(l => { if (!wears[l.id] || l.ts > wears[l.id]) wears[l.id] = l.ts; });
  return items.map(p => {
    // Neue Parfums ausblenden: erst nach FORGOTTEN_NEW_DELAY_DAYS Tagen
    if (p.addedAt && (now - p.addedAt) < FORGOTTEN_NEW_DELAY_DAYS * 86400000) return null;
    const lastTs = wears[p.id];
    const daysSince = lastTs ? (now - lastTs) / 86400000 : Infinity;
    const neverWorn = !lastTs;
    if (daysSince < DECLUTTER_DAYS && !neverWorn) return null;
    let suggestion = "Behalten", color = "#1D9E75", reason = "";
    if (neverWorn) {
      suggestion = "Ausprobieren"; color = "#BA7517";
      reason = "Noch nie getragen – vielleicht mal eine Chance geben?";
    } else if (daysSince > 365) {
      suggestion = "Verschenken"; color = "#993C1D";
      reason = `Seit ${Math.round(daysSince / 30)} Monaten nicht getragen.`;
    } else {
      suggestion = "Verkaufen"; color = "#534AB7";
      reason = `Seit ${Math.round(daysSince)} Tagen nicht getragen.`;
    }
    return { ...p, _days: Math.round(daysSince), _suggestion: suggestion, _reason: reason, _color: color };
  }).filter(Boolean).sort((a, b) => b._days - a._days);
}

export { getDeclutterSuggestions, DECLUTTER_DAYS, FORGOTTEN_NEW_DELAY_DAYS };
