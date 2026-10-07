/**
 * Tests für den wearStore: Reads über Wear-Map, Legacy-Log-Merge (keine
 * Datenverluste), recordWear und "fehlende Werte = noch nie getragen".
 * Läuft mit In-Memory-Backend, damit keine echten localStorage-Daten berührt werden.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setWearStoreBackend,
  getLastWornTs,
  getDaysSinceLastWorn,
  getWearDayCount,
  recordWear,
} from "../wearStore";

const DAY_MS = 86400000;
const NOW = 1_700_000_000_000;

function createInMemoryBackend() {
  const store = new Map();
  return {
    load: key => (store.has(key) ? store.get(key) : null),
    save: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
  };
}

describe("wearStore", () => {
  beforeEach(() => {
    setWearStoreBackend(createInMemoryBackend());
  });

  it("fehlende Werte bedeuten 'noch nie getragen'", () => {
    expect(getLastWornTs("unknown")).toBeNull();
    expect(getDaysSinceLastWorn("unknown", NOW)).toBeNull();
    expect(getWearDayCount("unknown")).toBe(0);
  });

  it("liest das Legacy-Log (parfum_log_v2) unverändert mit ein", () => {
    const backend = createInMemoryBackend();
    backend.save("parfum_log_v2", [
      { id: "a", ts: NOW - 10 * DAY_MS },
      { id: "a", ts: NOW - 3 * DAY_MS },
      { id: "b", ts: NOW - 50 * DAY_MS },
      { invalid: true }, // wird gefiltert
    ]);
    setWearStoreBackend(backend);

    expect(getLastWornTs("a")).toBe(NOW - 3 * DAY_MS);
    expect(getDaysSinceLastWorn("a", NOW)).toBeCloseTo(3, 6);
    expect(getWearDayCount("b")).toBe(1);
  });

  it("recordWear schreibt in den eigenen Store, ohne das Legacy-Log anzutasten", () => {
    const backend = createInMemoryBackend();
    const legacy = [{ id: "a", ts: NOW - 30 * DAY_MS }];
    backend.save("parfum_log_v2", legacy);
    setWearStoreBackend(backend);

    recordWear("a", NOW);
    // Legacy-Log unverändert
    expect(backend.load("parfum_log_v2")).toEqual(legacy);
    // Neuer Store enthält den frischen Eintrag
    expect(getLastWornTs("a")).toBe(NOW);
    expect(getWearDayCount("a")).toBe(2); // alter Tag + neuer Tag
  });

  it("recordWear zählt denselben Tag nur einmal", () => {
    // Mittags-Timestamps, damit kein Tagesgrenzen-Problem (Zeitzone) entsteht
    const noon = new Date(2024, 0, 15, 12, 0, 0).getTime();
    recordWear("x", noon);
    recordWear("x", noon + 3600_000); // gleicher Tag, 1h später
    expect(getWearDayCount("x")).toBe(1);
  });

  it("mehrere Tage hintereinander erhöhen die Trage-Tage", () => {
    const noon = new Date(2024, 0, 15, 12, 0, 0).getTime();
    recordWear("y", noon);
    recordWear("y", noon + DAY_MS);
    recordWear("y", noon + 2 * DAY_MS);
    expect(getWearDayCount("y")).toBe(3);
    expect(getDaysSinceLastWorn("y", noon + 2 * DAY_MS)).toBeCloseTo(0, 6);
  });

  it("merge: eigener Store und Legacy-Log kombinieren sich ohne Verlust", () => {
    const backend = createInMemoryBackend();
    backend.save("parfum_log_v2", [{ id: "z", ts: NOW - 5 * DAY_MS }]);
    setWearStoreBackend(backend);
    recordWear("z", NOW - 20 * DAY_MS); // älter als Legacy → lastWornTs bleibt Legacy

    expect(getLastWornTs("z")).toBe(NOW - 5 * DAY_MS);
    expect(getWearDayCount("z")).toBe(2);
  });
});