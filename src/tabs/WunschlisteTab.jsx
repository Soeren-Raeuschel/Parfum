import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { S, useBodyLock } from "../shared/ui";
import { WISH_PRIOS, SEASON_COLORS, FAM_COLORS, validateParfumoLookupUrl, extrahiereBrandName } from "../shared/constants";
import { newId } from "../data/localAdapter";
import { ladeParfumdaten } from "../utils/parfumoLookup";

// ── Wunschliste detail portal (renders into document.body to escape tab stacking context) ──
function WishDetailPortal({ selectedWish, wishDetails, loadingDetails, items, prioLabels, moveToCollection, setSelectedWish, setWishDetails }) {
  const alreadyOwned = items.some(p => p.url && selectedWish.url && p.url === selectedWish.url);
  const content = (
    <div onClick={() => { setSelectedWish(null); setWishDetails(null); }}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overscrollBehavior: "contain" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 400, width: "100%", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        {/* Header with gradient */}
        <div style={{ height: 100, background: "linear-gradient(135deg, #1A1A18 0%, #534AB7 100%)", position: "relative" }}>
          <button onClick={() => { setSelectedWish(null); setWishDetails(null); }} style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 20, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 14 }}>✕</button>
          <div style={{ position: "absolute", bottom: 16, left: 20 }}>
            <span style={{ fontSize: 10, letterSpacing: "1.5px", background: "rgba(255,255,255,0.2)", padding: "4px 12px", borderRadius: 20, color: "#fff" }}>{prioLabels[selectedWish.prio]}</span>
          </div>
        </div>
        {/* Content */}
        <div style={{ padding: 24, maxHeight: "70dvh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {loadingDetails ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 14, color: "#888780" }}>Lade Duftdetails…</div>
            </div>
          ) : wishDetails ? (
            <div>
              <h3 style={{ fontSize: 22, fontFamily: "'Georgia',serif", fontWeight: 400, color: "#1A1A18", margin: "0 0 4px" }}>{wishDetails.name || selectedWish.name}</h3>
              {(wishDetails.house || selectedWish.house) && <p style={{ fontSize: 14, color: "#888780", margin: "0 0 16px" }}>{wishDetails.house || selectedWish.house}</p>}
              {(wishDetails.top || wishDetails.middle || wishDetails.base) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>DUFTNOTEN</div>
                  {wishDetails.top && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 9, color: "#BA7517", fontWeight: 500, marginRight: 6 }}>KOPF</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.top}</span></div>}
                  {wishDetails.middle && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 9, color: "#534AB7", fontWeight: 500, marginRight: 6 }}>HERZ</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.middle}</span></div>}
                  {wishDetails.base && <div><span style={{ fontSize: 9, color: "#1D9E75", fontWeight: 500, marginRight: 6 }}>BASIS</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.base}</span></div>}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {wishDetails.family && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>FAMILIE</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.family}</div></div>}
                {wishDetails.season && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>SAISON</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.season}</div></div>}
                {wishDetails.conc && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>KONZ.</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.conc}</div></div>}
                {wishDetails.gender && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>GENDER</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.gender}</div></div>}
              </div>
              {selectedWish.note && <div style={{ background: "#FAFAF8", borderRadius: 12, padding: 14, marginBottom: 16 }}><p style={{ fontSize: 12, fontStyle: "italic", color: "#888780", margin: 0, fontFamily: "'Georgia',serif", lineHeight: 1.5 }}>„{selectedWish.note}"</p></div>}
              <div style={{ display: "flex", gap: 10 }}>
                {!alreadyOwned && <button onClick={() => { moveToCollection({ ...selectedWish, ...wishDetails }); setSelectedWish(null); setWishDetails(null); }} className="btn" style={{ flex: 1, ...S.btn("pri"), padding: "14px", borderRadius: 10, fontSize: 13 }}>→ Zur Sammlung</button>}
                {selectedWish.url && <a href={selectedWish.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, ...S.btn("out"), padding: "14px", borderRadius: 10, fontSize: 13, textAlign: "center", textDecoration: "none", color: "#1A1A18" }}>Parfumo ↗</a>}
              </div>
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: 22, fontFamily: "'Georgia',serif", fontWeight: 400, color: "#1A1A18", margin: "0 0 8px" }}>{selectedWish.name}</h3>
              {selectedWish.house && <p style={{ fontSize: 14, color: "#888780", margin: "0 0 20px" }}>{selectedWish.house}</p>}
              {selectedWish.note && <div style={{ background: "#FAFAF8", borderRadius: 12, padding: 16, marginBottom: 16 }}><p style={{ fontSize: 13, fontStyle: "italic", color: "#888780", margin: 0, fontFamily: "'Georgia',serif", lineHeight: 1.6 }}>"{selectedWish.note}"</p></div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div style={{ background: "#FAFAF8", borderRadius: 10, padding: 12, textAlign: "center" }}><div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 4 }}>HINZUGEFÜGT</div><div style={{ fontSize: 12, color: "#1A1A18" }}>{selectedWish.added ? new Date(selectedWish.added).toLocaleDateString("de-DE") : "Unbekannt"}</div></div>
                <div style={{ background: "#FAFAF8", borderRadius: 10, padding: 12, textAlign: "center" }}><div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 4 }}>STATUS</div><div style={{ fontSize: 12, color: alreadyOwned ? "#1D9E75" : "#888780" }}>{alreadyOwned ? "In Sammlung" : "Noch nicht"}</div></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {!alreadyOwned && <button onClick={() => { moveToCollection(selectedWish); setSelectedWish(null); }} className="btn" style={{ flex: 1, ...S.btn("pri"), padding: "14px", borderRadius: 10, fontSize: 13 }}>→ Zur Sammlung</button>}
                {selectedWish.url && <a href={selectedWish.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, ...S.btn("out"), padding: "14px", borderRadius: 10, fontSize: 13, textAlign: "center", textDecoration: "none", color: "#1A1A18" }}>Parfumo ↗</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(content, document.body);
}

// ── WishCard: hochwertige Karte im Stil der Sammlungs-Karten ───────────────────
function WishCard({ wish, prioColors, prioLabels, alreadyOwned, daysAgo, onOpen, onMove, onRemove }) {
  return (
    <div onClick={() => onOpen(wish)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(wish); } }}
      className="card" style={{ padding: "16px 18px", marginBottom: 10,
        borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        borderLeft: `4px solid ${prioColors[wish.prio] || "#D3D1C7"}`,
        cursor: "pointer", transition: "box-shadow .2s, transform .2s", outline: "none"
      }}
      onMouseEnter={function (e) { e.currentTarget.style.setProperty('box-shadow', '0 4px 16px rgba(0,0,0,0.08)') }}
      onMouseLeave={function (e) { e.currentTarget.style.setProperty('box-shadow', '0 2px 8px rgba(0,0,0,0.04)') }}
      onFocus={function (e) { e.currentTarget.style.setProperty('box-shadow', '0 4px 16px rgba(0,0,0,0.08)') }}
      onBlur={function (e) { e.currentTarget.style.setProperty('box-shadow', '0 2px 8px rgba(0,0,0,0.04)') }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "'Georgia',serif", color: "#1A1A18", marginBottom: 4 }}>{wish.name}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {wish.house && <span style={{ fontSize: 12, color: "#888780" }}>{wish.house}</span>}
            {daysAgo !== null && <span style={{ fontSize: 10, color: "#B4B2A9" }}>vor {daysAgo}d</span>}
            {alreadyOwned && <span style={{ fontSize: 10, color: "#1D9E75" }}>✓ In Sammlung</span>}
          </div>
        </div>
        <span style={{
          fontSize: 10, letterSpacing: "1px", padding: "4px 10px", borderRadius: 20, flexShrink: 0,
          background: (prioColors[wish.prio] || "#D3D1C7") + "15", color: prioColors[wish.prio] || "#888780", fontWeight: 500
        }}>
          {prioLabels[wish.prio]}
        </span>
      </div>

      {wish.note && <div style={{ fontSize: 12, color: "#888780", marginTop: 8, fontStyle: "italic", lineHeight: 1.5, fontFamily: "'Georgia',serif" }}>„{wish.note}"</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        {!alreadyOwned && (
          <button onClick={(e) => { e.stopPropagation(); onMove(wish); }} aria-label={`„${wish.name}" in die Sammlung verschieben`}
            className="btn" style={{ ...S.btn("out"), flex: 1, fontSize: 12, padding: "12px 14px", borderRadius: 10, color: "#534AB7", borderColor: "#E8E6E0", background: "#fff" }}>
            → Sammlung
          </button>
        )}
        {wish.url && (
          <a href={wish.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            className="btn" style={{ ...S.btn("out"), flex: 1, fontSize: 12, padding: "12px 14px", borderRadius: 10, background: "#fff", borderColor: "#E8E6E0", color: "#888780", textAlign: "center", textDecoration: "none" }}>
            Parfumo ↗
          </a>
        )}
        <button onClick={(e) => { e.stopPropagation(); onRemove(wish.id); }} aria-label={`„${wish.name}" von Wunschliste entfernen`}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#D3D1C7",
            width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 10, transition: "color .12s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.setProperty('color', '#E24B4A') }}
          onMouseLeave={function (e) { e.currentTarget.style.setProperty('color', '#D3D1C7') }}>✕</button>
      </div>
    </div>
  );
}

// ── WishEmptyState: ansprechender Leerzustand ──────────────────────────────────
function WishEmptyState() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 24px", borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #F5F4F1 0%, #E8E6E0 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <span style={{ fontSize: 28, color: "#B4B2A9" }}>✦</span>
      </div>
      <div style={{ fontSize: 15, color: "#1A1A18", fontFamily: "'Georgia',serif", marginBottom: 6 }}>Noch keine Wünsche</div>
      <div style={{ fontSize: 12, color: "#888780", lineHeight: 1.6 }}>
        Füge Parfüms per Parfumo-Link oder manuell hinzu –<br />sie erscheinen hier sortiert nach Priorität.
      </div>
    </div>
  );
}

// ── Wunschliste tab ───────────────────────────────────────────────────────────
function WunschlisteTab({ wishlist, onSave, items, onAddToCollection, onSelectPerfume, wishDetailsCache, setWishDetailsCache }) {
  const [form, setForm] = useState({ name: "", house: "", url: "", prio: 2, note: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [wishDisplayCount, setWishDisplayCount] = useState(15);
  const [showForm, setShowForm] = useState(false);
  const [selectedWish, setSelectedWish] = useState(null);
  useBodyLock(!!selectedWish);
  const [wishDetails, setWishDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function fetchWishDetails(wish) {
    const cacheKey = wish.url || wish.name;
    console.log("fetchWishDetails called:", wish.name, "cacheKey:", cacheKey, "cached:", !!wishDetailsCache[cacheKey]);
    console.log("wishDetailsCache:", wishDetailsCache);

    if (cacheKey && wishDetailsCache[cacheKey]) {
      console.log("Using cached data");
      setWishDetails(wishDetailsCache[cacheKey]);
      return;
    }

    setLoadingDetails(true);
    setWishDetails(null);
    try {
      let data = null;
      if (wish.url) {
        const r = await lookupByUrl(wish.url);
        data = r;
      } else if (wish.name) {
        const searchUrl = `https://www.parfumo.de/search?search=${encodeURIComponent(wish.name)}`;
        const r = await lookupByUrl(searchUrl);
        data = r;
      }
      if (data) {
        setWishDetailsCache(prev => ({ ...prev, [cacheKey]: data }));
      }
      setWishDetails(data);
    } catch (e) {
      console.error("Fehler beim Laden der Details:", e);
    }
    setLoadingDetails(false);
  }

  function handleWishClick(w) {
    setSelectedWish(w);
    fetchWishDetails(w);
  }

  async function lookupWish() {
    if (!linkUrl.trim()) return;
    setLoading(true); setErr("");
    try {
      const raw = linkUrl.trim();
      const safeUrl = validateParfumoLookupUrl(raw);
      const { brand, name } = extrahiereBrandName(safeUrl);
      const r = await ladeParfumdaten(brand, name);
      setForm(f => ({ ...f, name: r.name, house: r.house, url: safeUrl }));
      setLinkUrl("");
      setShowForm(true);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  function addItem() {
    if (!form.name.trim()) return;
    const item = {
      id: newId(), name: form.name.trim(), house: form.house.trim(),
      url: form.url.trim(), prio: form.prio, note: form.note.trim(), added: new Date().toISOString()
    };
    onSave([...wishlist, item]);
    setForm({ name: "", house: "", url: "", prio: 2, note: "" });
    setShowForm(false);
  }

  function removeItem(id) { onSave(wishlist.filter(w => w.id !== id)); }

  function moveToCollection(w) {
    const newItem = {
      id: newId(), name: w.name, house: w.house, url: w.url,
      conc: "", family: "Sonstiges", top: "", middle: "", base: "", season: "Ganzjährig",
      gender: "Unisex", format: "Flakon", rating: 0
    };
    onAddToCollection(newItem);
    removeItem(w.id);
  }

  const sorted = [...wishlist].sort((a, b) => a.prio - b.prio);
  const prioColors = { 1: "#E24B4A", 2: "#BA7517", 3: "#B4B2A9" };
  const prioLabels = { 1: "Must Have", 2: "Sehnsucht", 3: "Irgendwann" };

  return (
    <div>
      {/* Header with elegant title */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 400, fontFamily: "'Georgia',serif", color: "#1A1A18", margin: "0 0 4px", letterSpacing: "-0.5px" }}>Wunschliste</h2>
          <p style={{ fontSize: 12, color: "#888780", margin: 0 }}>Deine Duft-Träume</p>
        </div>
        {wishlist.length > 0 && (
          <span style={{ fontSize: 10, letterSpacing: "1.5px", color: "#B4B2A9" }}>{wishlist.length} {wishlist.length === 1 ? "WUNSCH" : "WÜNSCHE"}</span>
        )}
      </div>

      {/* Quick-add bar - elegant design */}
      <div className="card" style={{marginBottom: 16, padding: showForm ? "20px" : "14px 16px", borderRadius: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {!showForm ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <label htmlFor="wish-quick-add" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Parfumo-Link oder Name</label>
              <input id="wish-quick-add" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setErr(""); }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); linkUrl.trim() && lookupWish(); } }}
                placeholder="Parfumo-Link oder Name hinzufügen…"
                className="inp" style={{ ...S.inp, paddingRight: 10, borderColor: "#E8E6E0", background: "#FAFAF8", fontSize: 13, borderRadius: 10 }} />
            </div>
            {linkUrl.trim() ? (
              <button onClick={linkUrl.includes("parfumo.de") ? lookupWish : () => { set("name", linkUrl); setLinkUrl(""); setShowForm(true); }}
                disabled={loading}
                style={{ ...S.btn("pri"), padding: "12px 18px", whiteSpace: "nowrap", fontSize: 12, borderRadius: 10 }}>
                {loading ? "…" : linkUrl.includes("parfumo.de") ? "Laden" : "Weiter"}
              </button>
            ) : (
              <button onClick={() => setShowForm(true)}
                style={{
                  background: "linear-gradient(135deg, #1A1A18 0%, #3a3a3a 100%)", border: "none", borderRadius: 10, cursor: "pointer",
                  padding: "12px", fontSize: 16, color: "#fff", lineHeight: 1, boxShadow: "0 2px 8px rgba(26,26,24,0.2)"
                }}>+</button>
            )}
          </div>
        ) : (
          <div>
            {/* Expanded form */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: "1.5px", color: "#888780" }}>NEUER WUNSCH</div>
              <button onClick={() => { setShowForm(false); setForm({ name: "", house: "", url: "", prio: 2, note: "" }); setErr(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#B4B2A9", padding: 0 }}>✕</button>
            </div>

            {/* Link input */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input id="wish-link-input" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setErr(""); }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupWish(); } }}
                placeholder="Parfumo-Link einfügen…"
                className="inp" style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10 }} />
              <button onClick={lookupWish} disabled={loading || !linkUrl.trim()}
                style={{
                  ...S.btn("out"), padding: "12px 16px", whiteSpace: "nowrap", fontSize: 12, borderRadius: 10,
                  opacity: loading || !linkUrl.trim() ? 0.5 : 1
                }}>
                {loading ? "…" : "Auto"}
              </button>
            </div>

            {/* Name + House */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input id="wish-name" value={form.name} onChange={e => set("name", e.target.value)}
                placeholder="Name *" className="inp" style={{ ...S.inp, flex: 2, fontSize: 13, borderRadius: 10 }} />
              <input id="wish-house" value={form.house} onChange={e => set("house", e.target.value)}
                placeholder="Haus" className="inp" style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10 }} />
            </div>

            {/* Priority */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {WISH_PRIOS.map(p => (
                <button key={p.id} onClick={() => set("prio", p.id)}
                  style={{ ...S.btn("out"), padding: "10px", fontSize: 11, borderRadius: 12 }}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Note */}
            <textarea id="wish-note" value={form.note} onChange={e => set("note", e.target.value)}
              placeholder="Notiz (optional)…"
              className="ta" style={{ ...S.ta, minHeight: 50, fontSize: 13, marginBottom: 12, borderRadius: 10 }} />

            {err && <div style={{ fontSize: 12, color: "#E24B4A", marginBottom: 10 }}>{err}</div>}

            <button onClick={addItem} disabled={!form.name.trim()}
              style={{
                ...S.btn("pri"), width: "100%", fontSize: 13, padding: "14px", borderRadius: 10,
                opacity: form.name.trim() ? 1 : .4, boxShadow: "0 2px 8px rgba(26,26,24,0.15)"
              }}>
              Zur Wunschliste
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {wishlist.length === 0 && (
        <WishEmptyState />
      )}

      {/* Wish cards */}
      {sorted.slice(0, wishDisplayCount).map(w => {
        const alreadyOwned = items.some(p => p.url && p.url === w.url);
        const daysAgo = w.added ? Math.floor((Date.now() - new Date(w.added).getTime()) / (1000 * 60 * 60 * 24)) : null;
        return (
          <WishCard key={w.id} wish={w}
            prioColors={prioColors} prioLabels={prioLabels}
            alreadyOwned={alreadyOwned} daysAgo={daysAgo}
            onOpen={handleWishClick}
            onMove={moveToCollection}
            onRemove={removeItem} />
        );
      })}

      {/* Mehr anzeigen */}
      {sorted.length > wishDisplayCount && (
        <button onClick={() => setWishDisplayCount(c => c + 15)}
          style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}>
          Mehr anzeigen ({sorted.length - wishDisplayCount} weitere)
        </button>
      )}

      {/* Wish detail overlay – Portal-Komponente rendert in document.body */}
      {selectedWish && (
        <WishDetailPortal
          selectedWish={selectedWish}
          wishDetails={wishDetails}
          loadingDetails={loadingDetails}
          items={items}
          prioLabels={prioLabels}
          moveToCollection={moveToCollection}
          setSelectedWish={setSelectedWish}
          setWishDetails={setWishDetails}
        />
      )}
    </div>
  );
}

// ── Einstellungen tab ─────────────────────────────────────────────────────────

// ── Ordnerstruktur ────────────────────────────────────────────────────────────

export default WunschlisteTab;
