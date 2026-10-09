// request-guard.mjs – Eingabehärtung und Rate-Limiting für die Netlify-Functions.
// Bewusst als eigene, reine Bibliothek gehalten, damit sie in Vitest testbar ist.

// Erlaubt 1–80 Zeichen, aber keine Pfad-/URL-Sonderzeichen, %-Escapes und
// Steuerzeichen. Schutz zusätzlich zu encodeURIComponent in der Function.
const SLUG_PARAM_RE = /^[^/\\?&#%\x00-\x1f\x7f]{1,80}$/;

/**
 * Prüft einen Pfad-Parameter (Marke/Duftname) auf sicherheitstechnisch
 * kritische Zeichen.
 * @param {string} s - Der zu prüfende Parameter
 * @returns {boolean} true, wenn der Parameter für die Upstream-URL sicher ist
 */
export function isValidSlugParam(s) {
  return typeof s === "string" && SLUG_PARAM_RE.test(s);
}

/**
 * Ermittelt die Client-IP für das Rate-Limiting.
 * Netlify setzt x-nf-client-connection-ip; Fallback: erster Eintrag von
 * x-forwarded-for, sonst "unknown".
 * @param {Request} req - Der eingehende Request
 * @returns {string} Die Client-IP oder "unknown"
 */
export function getClientIp(req) {
  const h = req.headers;
  const nf = h.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

/**
 * Einfacher Sliding-Window-Rate-Limiter (in-memory).
 * Hinweis: Bei Netlify Functions ist der Speicher pro Instanz begrenzt –
 * für harte Garantien zusätzlich "Rate Limit Rules" im Netlify-Dashboard setzen.
 * @param {object} opts
 * @param {number} opts.max - Erlaubte Requests pro Fenster
 * @param {number} opts.windowMs - Fenstergröße in Millisekunden
 */
export function createRateLimiter({ max = 30, windowMs = 60_000 } = {}) {
  const hits = new Map(); // key -> Array von Timestamps

  return {
    /**
     * Zählt einen Request und entscheidet, ob er erlaubt ist.
     * @param {string} key - z. B. die Client-IP
     * @returns {{ allowed: boolean, retryAfterSec: number }}
     */
    check(key) {
      const now = Date.now();

      // Aufräumen: verhindert unendliches Wachstum der Map bei vielen IPs
      if (hits.size > 1000) {
        for (const [k, arr] of hits) {
          const fresh = arr.filter(ts => now - ts < windowMs);
          if (fresh.length === 0) hits.delete(k);
          else hits.set(k, fresh);
        }
      }

      const fresh = (hits.get(key) || []).filter(ts => now - ts < windowMs);
      if (fresh.length >= max) {
        // Ältester Treffer im Fenster + Fensterlänge = Zeitpunkt der Freigabe
        const retryAfterSec = Math.max(1, Math.ceil((fresh[0] + windowMs - now) / 1000));
        hits.set(key, fresh);
        return { allowed: false, retryAfterSec };
      }
      fresh.push(now);
      hits.set(key, fresh);
      return { allowed: true, retryAfterSec: 0 };
    },
    // Nur für Tests: aktuelle Einträge pro Schlüssel
    _size: () => hits.size,
  };
}