/**
 * Tests für den request-guard der Netlify-Functions: Zeichen-Whitelist für
 * Pfad-Parameter, Client-IP-Ermittlung und der Sliding-Window-Rate-Limiter
 * (mit gefakter Zeit, damit keine echten Wartezeiten entstehen).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isValidSlugParam, getClientIp, createRateLimiter } from "../request-guard.mjs";

describe("isValidSlugParam", () => {
  it("akzeptiert normale Marken- und Duftnamen", () => {
    expect(isValidSlugParam("Aventus")).toBe(true);
    expect(isValidSlugParam("L'Eau d'Issey")).toBe(true);
    expect(isValidSlugParam("Terre d'Hermès")).toBe(true);
    expect(isValidSlugParam("No. 5")).toBe(true);
    expect(isValidSlugParam("N°5")).toBe(true);
  });

  it("lehnt leere und zu lange Werte ab", () => {
    expect(isValidSlugParam("")).toBe(false);
    expect(isValidSlugParam("x".repeat(81))).toBe(false);
    expect(isValidSlugParam("x".repeat(80))).toBe(true);
    expect(isValidSlugParam(undefined)).toBe(false);
    expect(isValidSlugParam(null)).toBe(false);
  });

  it("lehnt Pfad- und URL-Sonderzeichen ab", () => {
    expect(isValidSlugParam("a/b")).toBe(false);      // Pfadtrenner
    expect(isValidSlugParam("a\\b")).toBe(false);     // Backslash
    expect(isValidSlugParam("a?b")).toBe(false);      // Query
    expect(isValidSlugParam("a&b")).toBe(false);      // Query-Trenner
    expect(isValidSlugParam("a#b")).toBe(false);      // Fragment
    expect(isValidSlugParam("a%b")).toBe(false);      // %-Escape
    expect(isValidSlugParam("..")).toBe(true);        // nur Punkte sind ok (kein /)
    expect(isValidSlugParam("../..")).toBe(false);    // Traversal wird blockiert
  });

  it("lehnt Steuerzeichen ab", () => {
    expect(isValidSlugParam("a\nb")).toBe(false);
    expect(isValidSlugParam("a\tb")).toBe(false);
    expect(isValidSlugParam("a\u0000b")).toBe(false);
  });
});

describe("getClientIp", () => {
  it("bevorzugt x-nf-client-connection-ip (Netlify)", () => {
    const req = new Request("https://example.com/", {
      headers: {
        "x-nf-client-connection-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      },
    });
    expect(getClientIp(req)).toBe("203.0.113.7");
  });

  it("fällt auf den ersten x-forwarded-for-Eintrag zurück", () => {
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("198.51.100.1");
  });

  it("liefert 'unknown', wenn keine IP-Header vorhanden sind", () => {
    const req = new Request("https://example.com/");
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("erlaubt Requests bis zum Limit und blockiert dann", () => {
    const rl = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect(rl.check("ip1").allowed).toBe(true);
    expect(rl.check("ip1").allowed).toBe(true);
    expect(rl.check("ip1").allowed).toBe(true);

    const blocked = rl.check("ip1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("begrenzt pro Schlüssel (IP), nicht global", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(rl.check("ip1").allowed).toBe(true);
    expect(rl.check("ip2").allowed).toBe(true);
    expect(rl.check("ip1").allowed).toBe(false);
    expect(rl.check("ip2").allowed).toBe(false);
  });

  it("gibt nach Ablauf des Fensters wieder frei", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(rl.check("ip1").allowed).toBe(true);
    expect(rl.check("ip1").allowed).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(rl.check("ip1").allowed).toBe(true);
  });

  it("retryAfterSec entspricht der Restlaufzeit des Fensters", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    rl.check("ip1");
    vi.advanceTimersByTime(30_000);
    const blocked = rl.check("ip1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(30);
  });

  it("räumt veraltete IPs auf, damit die Map nicht unendlich wächst", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    for (let i = 0; i < 1001; i++) rl.check(`ip-${i}`);
    expect(rl._size()).toBe(1001);

    vi.advanceTimersByTime(61_000);
    rl.check("neue-ip"); // triggert den Aufräumlauf
    expect(rl._size()).toBe(1); // alle veralteten Einträge wurden entfernt
  });
});