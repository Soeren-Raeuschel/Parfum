/**
 * ReiseTab.jsx – Reise-/Set-Planer: "Ich fahre X Tage nach Y (Wetter, Anlässe)".
 *
 * Schlägt die 2–3 passendsten Flakons zum Mitnehmen vor. Wiederverwendet die
 * komplette Picker-Engine über src/picker/tripPlanner.js (getCriteriaScore).
 *
 * UI-Interaktion:
 *  - Reisedauer (1–7 Tage), Wetter-Multi-Chips, Anlass-Multi-Chips
 *  - Optional: Intensität & Haltbarkeit als weiche Präferenzen
 *  - "Anderer Vorschlag" pro Flakon (excludeIds dieser Sitzung) + Reset
 *  - Set-Zusammenfassung als Text zum Kopieren
 */
import React, { useMemo, useState } from "react";
import { S, MiniBar, FamilyPill } from "../shared/ui";
import { FAM_COLORS } from "../shared/constants";
import { WEATHERS, OCCASIONS, INTENSITIES, LONGEVITIES, getSeason } from "../picker/legacyScoring";
import { groqFetch, useGroqCountdown } from "../utils/groqClient";
import {
  planTrip,
  tripPickReason,
  TRIP_TOP_N,
} from "../picker/tripPlanner";

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

function ReiseTab({ items, onSelectPerfume }) {
  const season = getSeason();
  const [days, setDays] = useState(3);
  const [weathers, setWeathers] = useState(["sunny"]);
  const [occasions, setOccasions] = useState(["casual"]);
  const [intensityPref, setIntensityPref] = useState(null);
  const [longevityPref, setLongevityPref] = useState(null);
  const [excludedIds, setExcludedIds] = useState([]);
  const [copied, setCopied] = useState(false);

  // ── KI-Reisebeschreibung (gleiches Muster wie interpretDayDescription im HeuteTab) ──
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [aiReason, setAiReason] = useState("");
  const groqCountdownVal = useGroqCountdown(); // Sekunden bis Rate-Limit abläuft

  const toggle = (list, setList, id) =>
    setList(prev => (prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]));

  // ── KI: freie Reisebeschreibung → strukturierte Trip-Parameter ─────────────
  async function interpretTripDescription(text) {
    const systemPrompt = `Du bist ein Reise-Duft-Berater. Analysiere eine kurze Reisebeschreibung und gib optimierte Planungsparameter zurück.
Antworte NUR mit einem validen JSON-Objekt, kein Markdown, keine Erklärung.`;
    const userPrompt = `Reisebeschreibung: "${text}"

Gültige Werte:
- days: ganze Zahl 1 bis 7 (Reisedauer)
- weathers: Liste aus [sunny, cloudy, rainy, cold, hot] (Wetter während der Reise, leer = egal)
- occasions: Liste aus [casual, work, date, evening, sport, special, outdoor, travel, vacation] (Anlässe auf der Reise)
- intensityPref: eines von [light, medium, strong] oder null
- longevityPref: eines von [short, medium, long] oder null
- reasoning: ein deutscher Satz warum (max 100 Zeichen)

Antworte NUR mit JSON: {"days":3,"weathers":["..."],"occasions":["..."],"intensityPref":"...","longevityPref":"...","reasoning":"..."}`;

    const { text: raw, fromCache } = await groqFetch({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3, max_tokens: 160,
      cacheKey: "trip:" + text.trim().slice(0, 60).toLowerCase(),
    });
    const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
    if (!m) throw new Error("KI-Antwort konnte nicht gelesen werden.");
    try {
      return { ...JSON.parse(m[0]), _fromCache: fromCache };
    } catch {
      throw new Error("KI-Antwort konnte nicht verarbeitet werden.");
    }
  }

  async function handleAiPlan() {
    if (!aiText.trim()) return;
    setAiLoading(true); setAiErr("");
    // Validwert-Sets – unbekannte KI-Werte werden still verworfen (wie im HeuteTab)
    const VALID_WEATHERS = new Set(WEATHERS.map(w => w.id));
    const VALID_OCCASIONS = new Set(OCCASIONS.filter(o => o.id !== "sleep").map(o => o.id));
    const VALID_INT = new Set(INTENSITIES.map(i => i.id));
    const VALID_LON = new Set(LONGEVITIES.map(l => l.id));
    try {
      const r = await interpretTripDescription(aiText.trim());
      const safeDays = Number.isFinite(r.days) ? Math.min(7, Math.max(1, Math.round(r.days))) : null;
      const safeWeathers = Array.isArray(r.weathers) ? r.weathers.filter(w => VALID_WEATHERS.has(w)) : [];
      const safeOccasions = Array.isArray(r.occasions) ? r.occasions.filter(o => VALID_OCCASIONS.has(o)) : [];
      const safeInt = VALID_INT.has(r.intensityPref) ? r.intensityPref : null;
      const safeLon = VALID_LON.has(r.longevityPref) ? r.longevityPref : null;
      if (safeDays) setDays(safeDays);
      if (safeWeathers.length) setWeathers(safeWeathers);
      if (safeOccasions.length) setOccasions(safeOccasions);
      setIntensityPref(safeInt);
      setLongevityPref(safeLon);
      setAiReason(typeof r.reasoning === "string" ? r.reasoning.slice(0, 120) : "");
      setAiText("");
    } catch (e) {
      setAiErr(e?.message || "KI-Antwort konnte nicht verarbeitet werden.");
    } finally {
      setAiLoading(false);
    }
  }

  const plan = useMemo(() => {
    if (!items || items.length === 0) return null;
    return planTrip(items, {
      days, weathers, occasions, season, intensityPref, longevityPref,
      topN: TRIP_TOP_N, excludeIds: excludedIds,
    });
  }, [items, days, weathers, occasions, season, intensityPref, longevityPref, excludedIds]);

  function reject(p) {
    setExcludedIds(prev => [...prev, String(p.id)]);
  }

  function resetRejected() {
    setExcludedIds([]);
  }

  function copySet() {
    if (!plan || plan.picks.length === 0) return;
    const text = plan.picks
      .map((p, i) => `${i + 1}. ${p.perfume.name} – ${tripPickReason(p, plan.slots)}`)
      .join("\n");
    navigator.clipboard?.writeText(`Reise-Set (${days} Tage):\n${text}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      {/* Kopfkarte */}
      <div className="card" style={{ marginBottom: 16, padding: "12px 14px" }}>
        <div className="lbl" style={{ marginBottom: 4 }}>REISE-SET-PLANER</div>
        <div style={{ fontSize: 12, color: "#888780" }}>
          Ich fahre <b>{days} Tag{days > 1 ? "e" : ""}</b> los – Season: {season}.
          Wähle Wetter &amp; Anlässe, die App schlägt die {TRIP_TOP_N} passendsten Flakons vor.
        </div>
      </div>

      {/* KI-Reisebeschreibung */}
      <div className="card" style={{ marginBottom: 16, padding: "12px 14px" }}>
        <div className="lbl" style={{ marginBottom: 6 }}>REISE MIT KI PLANEN</div>
        <textarea
          value={aiText}
          onChange={e => { setAiText(e.target.value); setAiErr(""); }}
          placeholder={"z. B. \"Ich fahre 3 Tage nach Lissabon im Sommer – Stadtbummel tagsüber, Abendessen und ein Konzert.\""}
          style={{ ...S.ta, minHeight: 64, fontSize: 12, marginBottom: 8 }}
          maxLength={300}
          aria-label="Reisebeschreibung für die KI"
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleAiPlan} disabled={aiLoading || !aiText.trim()}
            style={{ ...S.btn("pri"), fontSize: 12, opacity: aiLoading || !aiText.trim() ? .6 : 1, flex: 1 }}>
            {aiLoading ? "Analysiere…" : "✦ Planen lassen"}
          </button>
          {groqCountdownVal > 0 && !aiLoading && (
            <span style={{ fontSize: 10, color: "#888780", flexShrink: 0 }}>Rate-Limit: {groqCountdownVal}s</span>
          )}
        </div>
        {aiErr && <div style={{ fontSize: 11, color: "#B34040", marginTop: 6 }}>{aiErr}</div>}
        {aiReason && (
          <div style={{ fontSize: 11, color: "#888780", marginTop: 6, fontStyle: "italic" }}>
            KI-Begründung: {aiReason}
          </div>
        )}
      </div>

      {/* Reisedauer */}
      <div style={{ marginBottom: 14 }}>
        <div className="lbl" style={{ marginBottom: 8 }}>REISEDAUER (TAGE)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAY_OPTIONS.map(n => (
            <button key={n} onClick={() => setDays(n)} aria-pressed={days === n}
              className={`chip ${days === n ? "active" : ""}`}
              style={{ ...S.chip(days === n), padding: "8px 14px", fontSize: 12, minHeight: 40 }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Wetter (Mehrfachauswahl) */}
      <div style={{ marginBottom: 14 }}>
        <div className="lbl" style={{ marginBottom: 8 }}>WETTER AUF DER REISE</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {WEATHERS.map(w => {
            const active = weathers.includes(w.id);
            return (
              <button key={w.id} onClick={() => toggle(weathers, setWeathers, w.id)}
                aria-pressed={active} className={`chip ${active ? "active" : ""}`}
                style={{ ...S.chip(active, "#185FA5"), padding: "8px 12px", fontSize: 11, minHeight: 40 }}>
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Anlässe (Mehrfachauswahl) */}
      <div style={{ marginBottom: 14 }}>
        <div className="lbl" style={{ marginBottom: 8 }}>ANLÄSSE</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OCCASIONS.filter(o => o.id !== "sleep").map(o => {
            const active = occasions.includes(o.id);
            return (
              <button key={o.id} onClick={() => toggle(occasions, setOccasions, o.id)}
                aria-pressed={active} className={`chip ${active ? "active" : ""}`}
                style={{ ...S.chip(active), padding: "8px 12px", fontSize: 11, minHeight: 40 }}>
                <span style={{ marginRight: 4, fontSize: 9 }}>{o.icon}</span>{o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Optionale Präferenzen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>INTENSITÄT (OPTIONAL)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {INTENSITIES.map(i => (
              <button key={i.id} onClick={() => setIntensityPref(cur => (cur === i.id ? null : i.id))}
                aria-pressed={intensityPref === i.id} className={`chip ${intensityPref === i.id ? "active" : ""}`}
                style={{ ...S.chip(intensityPref === i.id), padding: "8px 12px", fontSize: 11, minHeight: 40 }}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>HALTBARKEIT (OPTIONAL)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LONGEVITIES.map(l => (
              <button key={l.id} onClick={() => setLongevityPref(cur => (cur === l.id ? null : l.id))}
                aria-pressed={longevityPref === l.id} className={`chip ${longevityPref === l.id ? "active" : ""}`}
                style={{ ...S.chip(longevityPref === l.id), padding: "8px 12px", fontSize: 11, minHeight: 40 }}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tagesplan-Vorschau */}
      {plan && (
        <div className="card" style={{ marginBottom: 16, padding: "10px 14px" }}>
          <div className="lbl" style={{ marginBottom: 6 }}>TAGESPLAN</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {plan.slots.map(s => {
              const wLabel = (WEATHERS.find(w => w.id === s.weatherLabel) || {}).label || s.weatherLabel;
              const oLabel = (OCCASIONS.find(o => o.id === s.occasion) || {}).label || s.occasion;
              return (
                <div key={s.day} style={{
                  fontSize: 10, color: "#888780", border: "1px solid #E8E6E0",
                  borderRadius: 10, padding: "6px 10px", background: "#fff",
                }}>
                  <b style={{ color: "#1A1A18" }}>Tag {s.day}</b> · {wLabel} · {oLabel}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ergebnisse */}
      {!plan || plan.picks.length === 0 ? (
        <div className="card" style={{ padding: "14px", textAlign: "center", color: "#888780", fontSize: 12 }}>
          Keine Flakons im Set – Sammlung laden oder abgelehnte Vorschläge zurücksetzen.
          {excludedIds.length > 0 && (
            <button onClick={resetRejected} style={{ ...S.btn("sm"), display: "block", margin: "10px auto 0" }}>
              Zurücksetzen ({excludedIds.length})
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>DEIN REISE-SET ({plan.picks.length} FLAKONS)</div>
          {plan.picks.map((pick, i) => {
            const p = pick.perfume;
            const fc = FAM_COLORS[p.family] || "#888";
            const families = p.families && p.families.length > 0 ? p.families : (p.family ? [p.family] : []);
            return (
              <div key={p.id} className="card" style={{
                border: i === 0 ? "1.5px solid #1A1A18" : "1px solid #E8E6E0",
                marginBottom: 10, padding: "12px 14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <button onClick={() => onSelectPerfume && onSelectPerfume(p.id)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 14, color: "#1A1A18" }}>{p.name}</div>
                    {p.brand && <div style={{ fontSize: 10, color: "#888780" }}>{p.brand}</div>}
                  </button>
                  <span style={{ fontSize: 9, letterSpacing: "1px", background: i === 0 ? "#1A1A18" : fc + "22", color: i === 0 ? "#fff" : fc, padding: "2px 7px", borderRadius: 10, flexShrink: 0 }}>
                    #{i + 1}
                  </span>
                </div>
                {families.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {families.slice(0, 3).map((f, fi) => <FamilyPill key={f} family={f} idx={fi} />)}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <MiniBar pct={pick.avgScore * 100} color={fc} />
                  <span style={{ fontSize: 10, color: "#888780", flexShrink: 0 }}>{Math.round(pick.avgScore * 100)}%</span>
                </div>
                <div style={{ fontSize: 11, color: "#888780", marginBottom: 8 }}>
                  {tripPickReason(pick, plan.slots)}
                  {pick.duplicateOfPrimary && " · Familien-Doppelung abgewertet"}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => reject(p)} style={{ ...S.btn("sm"), ...S.btn("out"), fontSize: 10 }}>
                    Anderer Vorschlag
                  </button>
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={copySet} style={{ ...S.btn("pri"), flex: 1, fontSize: 12 }}>
              {copied ? "✓ Kopiert" : "Set kopieren"}
            </button>
            {excludedIds.length > 0 && (
              <button onClick={resetRejected} style={{ ...S.btn("out"), fontSize: 12 }}>
                Reset ({excludedIds.length})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ReiseTab;
