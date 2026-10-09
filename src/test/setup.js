import '@testing-library/jest-dom'

// jsdom stellt in dieser Vitest/jsdom-Kombination kein localStorage bereit.
// Einfacher In-Memory-Ersatz (gleiche API), damit speicherbezogene Module
// (z. B. localAdapter) realistisch getestet werden können.
if (typeof globalThis.localStorage === "undefined") {
  class InMemoryStorage {
    constructor() { this._store = new Map(); }
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; }
    setItem(k, v) { this._store.set(k, String(v)); }
    removeItem(k) { this._store.delete(k); }
    clear() { this._store.clear(); }
    key(i) { return [...this._store.keys()][i] ?? null; }
    get length() { return this._store.size; }
  }
  globalThis.Storage = globalThis.Storage ?? InMemoryStorage;
  globalThis.localStorage = new InMemoryStorage();
}
