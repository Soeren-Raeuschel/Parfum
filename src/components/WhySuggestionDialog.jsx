/**
 * WhySuggestionDialog.jsx – "Warum dieser Vorschlag?"-Dialog für den
 * Tages-Picker. Zeigt den Score-Breakdown eines Vorschlags in lesbarer Form
 * (Kriterien, Aging, Fairness, persönlicher Bonus aus der Lernschleife usw.),
 * basierend auf debugBreakdown aus der Picker-Engine.
 */
import React from "react";
import { Dialog } from "@headlessui/react";
import { debugBreakdown } from "../picker/todayIntegration";
import { FEEDBACK_BONUS_MAX } from "../picker/wearStore";

const pct = x => `${Math.round(x * 100)} %`;
const num = x => (typeof x === "number" ? Math.round(x * 100) / 100 : x);

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", borderBottom: "1px dashed #E8E6E0" }}>
      <span style={{ color: "#888780", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}

export default function WhySuggestionDialog({ perfume, selection, wearMap, open, onClose }) {
  if (!perfume || !selection) return null;
  const d = debugBreakdown(perfume, selection, wearMap, Date.now());
  if (!d) return null;

  const fb = d.personalFeedback;
  const fbText = fb
    ? `${fb.good}× passte gut · ${fb.ok}× naja · ${fb.bad}× passte nicht (${fb.events} Feedbacks)`
    : "noch kein Feedback in diesem Kontext";

  return (
    <Dialog open={open} onClose={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)" }} aria-hidden="true" />
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Dialog.Panel className="card" style={{ width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto", padding: "16px 18px" }}>
          <Dialog.Title style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>
            Warum {d.name}?
          </Dialog.Title>
          <div style={{ fontSize: 11, color: "#888780", marginBottom: 12 }}>
            Geschätzter Gesamt-Score: <strong>{d.estimatedTotal}</strong> (Kriterien {d.criteriaScore} × Aging ×{d.agingFactor} × Fairness ×{d.fairnessFactor})
          </div>

          {/* Kriterien */}
          <div style={{ fontSize: 10, letterSpacing: "1px", color: "#888780", margin: "10px 0 4px" }}>PASST ZU</div>
          {d.criteria.map(c => (
            <div key={c.key + (c.label || "")} style={{ fontSize: 12, marginBottom: 6 }}>
              <Row label={c.label}>
                {c.value === null || c.value === undefined ? "–" : pct(c.value)} · Gewicht {num(c.weight)}
              </Row>
              {c.details && c.details.matchedNotes && c.details.matchedNotes.length > 0 && (
                <div style={{ fontSize: 10, color: "#5C6B4F", marginTop: 2 }}>
                  Noten: {c.details.matchedNotes.map(m => m.note).join(", ")}
                </div>
              )}
              {c.details && c.details.matchedFamilies && c.details.matchedFamilies.length > 0 && (
                <div style={{ fontSize: 10, color: "#5C6B4F", marginTop: 2 }}>
                  Familien: {c.details.matchedFamilies.map(m => m.family).join(", ")}
                </div>
              )}
            </div>
          ))}

          {/* Rotation & Fairness */}
          <div style={{ fontSize: 10, letterSpacing: "1px", color: "#888780", margin: "10px 0 4px" }}>ROTATION & FAIRNESS</div>
          <div style={{ fontSize: 12 }}>
            <Row label="Zuletzt getragen">
              {d.daysSinceLastWorn === null ? "noch nie" : `vor ${d.daysSinceLastWorn} Tagen`} → Aging ×{d.agingFactor}
            </Row>
            <Row label="Fairness">×{d.fairnessFactor}</Row>
            {d.temperatureBlend && (
              <Row label={`Temperatur (${d.temperatureBlend.temperature} °C)`}>
                {d.temperatureBlend.t > 0.5 ? "tendiert zu frisch" : "tendiert zu warm"} (t = {d.temperatureBlend.t})
              </Row>
            )}
            <Row label="Diversität">{d.diversityApplied ? "Hauptfamilie kürzlich getragen → −10 %" : "kein Abzug"}</Row>
            <Row label="Zufall">{d.randomRange[0]}–{d.randomRange[1]} (macht die Auswahl lebendig)</Row>
          </div>

          {/* Lernschleife */}
          <div style={{ fontSize: 10, letterSpacing: "1px", color: "#888780", margin: "10px 0 4px" }}>DEIN FEEDBACK</div>
          <div style={{ fontSize: 12 }}>
            <Row label="Persönlicher Bonus">
              {d.personalBonus > 0 ? "+" : ""}{d.personalBonus} (max. ±{FEEDBACK_BONUS_MAX})
            </Row>
            <Row label="In diesem Kontext">{fbText}</Row>
          </div>

          <button onClick={onClose} style={{ width: "100%", marginTop: 14, padding: "10px", borderRadius: 10, border: "1px solid #1A1A18", background: "#fff", fontSize: 12, cursor: "pointer" }}>
            Schließen
          </button>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
