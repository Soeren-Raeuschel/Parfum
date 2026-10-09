/**
 * Tests für den Groq-Proxy (/api/groq): Methoden-Prüfung, Body-Validierung
 * (Modell-Whitelist, Nachrichten-Regeln, Feld-Bereinigung), Rate-Limit,
 * Key-Prüfung und Upstream-Durchreichung inkl. Rate-Limit-Header.
 * fetch wird global gemockt; der Limiter kommt frisch pro Test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleGroqRequest, validateGroqBody } from "../../groq.mjs";
import { createRateLimiter } from "../request-guard.mjs";

const VALID_BODY = {
  model: "openai/gpt-oss-120b",
  messages: [{ role: "user", content: "Beschreibe Aventus." }],
};

function jsonReq(raw) {
  return new Request("https://site.netlify.app/api/groq", {
    method: "POST",
    headers: { "x-nf-client-connection-ip": "203.0.113.5" },
    body: raw,
  });
}

function mockUpstream(overrides = {}) {
  const fn = vi.fn(async () => new Response(
    overrides.body ?? '{"choices":[{"message":{"content":"ok"}}]}',
    {
      status: overrides.status ?? 200,
      headers: { "content-type": "application/json", ...(overrides.headers ?? {}) },
    },
  ));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("validateGroqBody", () => {
  it("akzeptiert einen gültigen Body und bereinigt unbekannte Felder", () => {
    const v = validateGroqBody(JSON.stringify({
      ...VALID_BODY,
      temperature: 0.3,
      max_tokens: 150,
      // bösartige/unbekannte Felder dürfen nicht an Groq durchgereicht werden
      apiKey: "hacker-key",
      Authorization: "Bearer spoof",
      user: "x",
    }));
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Beschreibe Aventus." }],
      temperature: 0.3,
      max_tokens: 150,
    });
  });

  it("lehnt kaputtes JSON und Nicht-Objekte ab", () => {
    expect(validateGroqBody("{kaputt").ok).toBe(false);
    expect(validateGroqBody("[]").ok).toBe(false);
    expect(validateGroqBody("null").ok).toBe(false);
  });

  it("lehnt nicht whitelistete Modelle ab", () => {
    const v = validateGroqBody(JSON.stringify({
      model: "llama-3.3-70b", messages: VALID_BODY.messages,
    }));
    expect(v.ok).toBe(false);
    expect(v.error).toContain("Modell");
  });

  it("lehnt ungültige messages ab (kein Array, leer, falsche Felder, zu viele)", () => {
    const m = "openai/gpt-oss-120b";
    expect(validateGroqBody(JSON.stringify({ model: m, messages: [] })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: "hi" })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: [{ foo: 1 }] })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: [{ role: "root", content: "x" }] })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: [{ role: "user", content: 42 }] })).ok).toBe(false);
    const tooMany = Array.from({ length: 13 }, () => ({ role: "user", content: "x" }));
    expect(validateGroqBody(JSON.stringify({ model: m, messages: tooMany })).ok).toBe(false);
  });

  it("lehnt überlange Nachrichten-Inhalte ab", () => {
    const v = validateGroqBody(JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "x".repeat(20_001) }],
    }));
    expect(v.ok).toBe(false);
    expect(v.error).toContain("zu lang");
  });

  it("lehnt ungültige temperature/max_tokens ab", () => {
    const m = "openai/gpt-oss-120b";
    const msgs = VALID_BODY.messages;
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, temperature: 3 })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, temperature: "hoch" })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, max_tokens: 0 })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, max_tokens: 99_999 })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, max_tokens: 1.5 })).ok).toBe(false);
    expect(validateGroqBody(JSON.stringify({ model: m, messages: msgs, max_tokens: 1000 })).ok).toBe(true);
describe("handleGroqRequest", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "gsk_test_key_1234567890";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
  });

  it("antwortet mit 405 auf GET", async () => {
    const res = await handleGroqRequest(
      new Request("https://x/api/groq"),
      createRateLimiter({ max: 100 }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("antwortet mit 429 und Retry-After bei überschrittenem Limit", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), limiter);
    const res = await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), limiter);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("antwortet mit 413 bei zu großem Body", async () => {
    const res = await handleGroqRequest(
      jsonReq('{"x":"' + "y".repeat(70_000) + '"}'),
      createRateLimiter({ max: 100 }),
    );
    expect(res.status).toBe(413);
  });

  it("antwortet mit 400 bei ungültigem Body", async () => {
    const res = await handleGroqRequest(jsonReq("kein json"), createRateLimiter({ max: 100 }));
    expect(res.status).toBe(400);
  });

  it("antwortet mit 503, wenn kein Server-Key gesetzt ist", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), createRateLimiter({ max: 100 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("GROQ_API_KEY") });
  });

  it("leitet valide Requests an Groq weiter und reicht Antwort + Rate-Limit-Header durch", async () => {
    const upstream = mockUpstream({
      headers: {
        "x-ratelimit-remaining-requests": "29",
        "x-ratelimit-remaining-tokens": "7900",
        "x-ratelimit-reset-requests": "2.5s",
        "x-ratelimit-reset-tokens": "60s",
      },
    });
    const res = await handleGroqRequest(jsonReq(JSON.stringify({
      ...VALID_BODY, temperature: 0.2, max_tokens: 150, evil: "field",
    })), createRateLimiter({ max: 100 }));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"ok"');
    expect(res.headers.get("x-ratelimit-remaining-requests")).toBe("29");
    expect(res.headers.get("x-ratelimit-remaining-tokens")).toBe("7900");

    // Es darf nur der bereinigte Body mit dem Server-Key gesendet werden
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer gsk_test_key_1234567890");
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Beschreibe Aventus." }],
      temperature: 0.2,
      max_tokens: 150,
    });
  });

  it("reicht Upstream-Fehler (z. B. 429) mit Retry-After durch", async () => {
    mockUpstream({ status: 429, headers: { "retry-after": "42" } });
    const res = await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), createRateLimiter({ max: 100 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("antwortet mit 502, wenn Groq nicht erreichbar ist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const res = await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), createRateLimiter({ max: 100 }));
    expect(res.status).toBe(502);
  });

  it("antwortet mit 502 bei Timeout (TimeoutError)", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => { throw timeoutError; }));
    const res = await handleGroqRequest(jsonReq(JSON.stringify(VALID_BODY)), createRateLimiter({ max: 100 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Zeitüberschreitung") });
  });
});
  });
});