import React, { useState, useEffect, useMemo } from "react";
import { Tab, Dialog } from "@headlessui/react";
import { S } from "../shared/ui";
import { getDeclutterSuggestions, DECLUTTER_DAYS, FORGOTTEN_NEW_DELAY_DAYS } from "../shared/declutter";

function DeclutterTab({ items, log, onDelete, onSelectPerfume, onUpdate, declutterStatus, onSaveDeclutterStatus }) {
  const [filter, setFilter] = useState("all");
  const [dismissed, setDismissed] = useState(new Set());
  const [declDisplayCount, setDeclDisplayCount] = useState(15);
  // Persistent user decisions: { [id]: "Behalten"|"Verkaufen"|"Verschenken"|"Entfernt" }
  const [decisions, setDecisions] = useState(() => declutterStatus || {});
  const [toast, setToast] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  function saveDecision(id, decision) {
    setDecisions(prev => {
      const next = { ...prev, [id]: decision };
      if (onSaveDeclutterStatus) { onSaveDeclutterStatus(next); }
      return next;
    });
  }
  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  const suggestions = useMemo(() => getDeclutterSuggestions(items, log), [items, log]);
  // Items not yet "Behalten"-dismissed (dismissed = hidden from view entirely)
  const active = suggestions.filter(p => !dismissed.has(p.id));

  const visible = active.filter(p => {
    const dec = decisions[p.id];
    if (filter === "all") return true;
    if (filter === "Behalten") return dec === "Behalten";
    if (filter === "Verkaufen") return dec === "Verkaufen" || (!dec && p._suggestion === "Verkaufen");
    if (filter === "Verschenken") return dec === "Verschenken" || (!dec && p._suggestion === "Verschenken");
    if (filter === "Ausprobieren") return !dec && p._suggestion === "Ausprobieren";
    return true;
  });

  useEffect(() => { setDeclDisplayCount(15); }, [filter]);

  const counts = useMemo(() => {
    const c = { Ausprobieren: 0, Verkaufen: 0, Verschenken: 0, Behalten: 0 };
    active.forEach(p => {
      const dec = decisions[p.id];
      if (dec === "Behalten") c.Behalten++;
      else if (dec === "Verkaufen") c.Verkaufen++;
      else if (dec === "Verschenken") c.Verschenken++;
      else c[p._suggestion] = (c[p._suggestion] || 0) + 1;
    });
    return c;
  }, [active, decisions]);

  // Category button config
  const CATS = [
    { id: "Behalten",    icon: "🏠", color: "#1D9E75" },
    { id: "Verkaufen",   icon: "💰", color: "#534AB7" },
    { id: "Verschenken", icon: "🎁", color: "#993C1D" },
  ];

  function handleCategoryChange(p, newCat) {
    if (newCat === "Behalten") {
      // Behalten → dismiss from view
      setDismissed(prev => new Set([...prev, p.id]));
      showToast(`„${p.name}" als Behalten markiert`);
    } else {
      saveDecision(p.id, newCat);
      showToast(`„${p.name}" → ${newCat === "Verkaufen" ? "💰 Verkaufen" : "🎁 Verschenken"}`);
    }
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
          fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(26,26,24,.25)"
        }}>{toast}</div>
      )}

      <div className="card" style={{background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F4 100%)", border: "1px solid #E8E6E0", boxShadow: "0 1px 2px rgba(26,26,24,0.04)", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sammlung aufräumen</div>
        <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6 }}>
          Parfüms die du seit {DECLUTTER_DAYS} Tagen nicht getragen hast. Neu hinzugefügte Parfüms erscheinen erst nach {FORGOTTEN_NEW_DELAY_DAYS} Tagen.
          Markiere sie als 🏠 Behalten, 💰 Verkaufen oder 🎁 Verschenken.
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
        {[["Ausprobieren", "#BA7517"], ["Verkaufen", "#534AB7"], ["Verschenken", "#993C1D"], ["Behalten", "#1D9E75"]].map(([l, c]) => (
          <button key={l} onClick={() => setFilter(filter === l ? "all" : l)}
              aria-label={`Filter: ${l}`} className="card" style={{marginBottom: 0, padding: "8px 4px", textAlign: "center",
                border: `1px solid ${filter === l ? c : "#E8E6E0"}`, cursor: "pointer",
                background: filter === l ? c + "11" : "#fff"
              }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: c, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{counts[l] || 0}</div>
              <div style={{ fontSize: 8, color: c, letterSpacing: "0.5px", marginTop: 2 }}>{l.toUpperCase()}</div>
            </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "#888780", padding: "36px 16px", fontSize: 13 }}>
          <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.5 }}>✓</div>
          {suggestions.length === 0
            ? "Alles bestens – alle Parfüms wurden kürzlich getragen!"
            : "Alle Vorschläge abgearbeitet"}
        </div>
      ) : visible.slice(0, declDisplayCount).map(p => {
        const userDec = decisions[p.id];
        const effectiveColor = userDec === "Behalten" ? "#1D9E75"
          : userDec === "Verkaufen" ? "#534AB7"
          : userDec === "Verschenken" ? "#993C1D"
          : p._color;
        const effectiveLabel = userDec || p._suggestion;
        return (
          <div key={p.id} className="card" style={{padding: "12px 14px", marginBottom: 8,
            borderLeft: `3px solid ${effectiveColor}`,
            transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", transform: "translateY(0)",
            boxShadow: "0 1px 3px rgba(26,26,24,0.04)"
          }}
            onMouseEnter={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(-2px)'); e.currentTarget.style.setProperty('box-shadow', '0 6px 20px rgba(26,26,24,0.08)') }}
            onMouseLeave={function (e) { e.currentTarget.style.setProperty('transform', 'translateY(0)'); e.currentTarget.style.setProperty('box-shadow', '0 1px 3px rgba(26,26,24,0.04)') }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>{p.name}</button>
                <div style={{ fontSize: 11, color: "#888780" }}>{p.house} · {p.format}</div>
              </div>
              <span className="pill" style={{ '--pill-bg': effectiveColor + "22", '--pill-c': effectiveColor, fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{effectiveLabel}</span>
            </div>
            <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, fontStyle: "italic" }}>{p._reason}</div>

            {/* Category buttons */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {CATS.map(cat => {
                const isActive = userDec === cat.id || (!userDec && p._suggestion === cat.id && cat.id !== "Behalten");
                return (
                  <button key={cat.id} onClick={() => handleCategoryChange(p, cat.id)} aria-label={`Kategorie: ${cat.id}`}
                    style={{
                      flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${isActive ? cat.color : "#E8E6E0"}`,
                      background: isActive ? cat.color + "18" : "transparent",
                      fontSize: 10, color: isActive ? cat.color : "#888780",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      transition: "all .2s", fontFamily: "'Georgia',serif"
                    }}>
                    <span style={{ fontSize: 14 }}>{cat.icon}</span>
                    <span>{cat.id}</span>
                  </button>
                );
              })}
            </div>

            {/* Remove button */}
            {p._suggestion !== "Ausprobieren" && (
              <button onClick={() => setPendingDelete(p)}
                className="btn"
                style={{ ...S.btn("out"), fontSize: 11, padding: "6px 10px", width: "100%", color: "#E24B4A", borderColor: "#F09595" }}>
                Aus Sammlung entfernen
                <span className="sr-only">: {p.name}</span>
              </button>
            )}
            {p._suggestion === "Ausprobieren" && (
              <div style={{ fontSize: 10, color: "#888780", textAlign: "center" }}>
                Trag es heute! · <button onClick={() => { setDismissed(prev => new Set([...prev, p.id])); }} aria-label="Parfüm ausblenden" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit", textDecoration: "underline" }}>Ausblenden</button>
              </div>
            )}
          </div>
        );
      })}
      {visible.length > declDisplayCount && (
        <button onClick={() => setDeclDisplayCount(c => c + 15)}
          className="btn btn-out"
          style={{ width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}
          aria-label="Mehr Parfüms anzeigen">
          Mehr anzeigen ({visible.length - declDisplayCount} weitere)
        </button>
      )}
      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} className="relative z-[9100]">
        <div className="fixed inset-0 bg-black/45" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-5">
          <Dialog.Panel style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 340, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 500, color: "#1A1A18", marginBottom: 8 }}>
              „{pendingDelete?.name}" wirklich entfernen?
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>
              Dieser Vorgang kann nicht rückgängig gemacht werden.
            </Dialog.Description>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { onDelete(pendingDelete.id); saveDecision(pendingDelete.id, "Entfernt"); setPendingDelete(null); }}
                style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }}>Ja, entfernen</button>
              <button onClick={() => setPendingDelete(null)} style={{ ...S.btn("out"), flex: 1 }}>Abbrechen</button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: ONBOARDING
// ══════════════════════════════════════════════════════════════════════════════
/*const ONBOARD_STYLES = [
  { id: "fresh", label: "Frisch & Sauber", icon: "◎", family: "Fresh" },
  { id: "woody", label: "Holzig & Warm", icon: "◈", family: "Woody" },
  { id: "sweet", label: "Süß & Weich", icon: "◇", family: "Gourmand" },
  { id: "oriental", label: "Orientalisch", icon: "◆", family: "Oriental" },
  { id: "floral", label: "Blumig", icon: "♥", family: "Floral" },
  { id: "chypre", label: "Chypre & Moosig", icon: "★", family: "Chypre" },
];*/

export default DeclutterTab;
