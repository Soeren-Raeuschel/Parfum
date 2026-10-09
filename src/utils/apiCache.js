/**
 * apiCache.js – TTL-basierter API-Response-Cache mit LRU-Eviction.
 *
 * Aus App.jsx ausgelagert: Memory-Cache + localStorage-Backup (entprellt),
 * ausgelagerter Flush bei pagehide/visibilitychange.
 */

// ── Enhanced API Response Cache (TTL-basiert mit LRU-Eviction und Prefetching) ─────
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 Minuten
const MAX_CACHE_SIZE = 200; // Maximale Anzahl an Einträgen im Speicher
const CACHE_STORAGE_KEY = 'parfum_api_cache_v2';
// Lazy-load cache persistence - wird erst verwendet, wenn nötig
let _cacheStorage = null;
function _getCacheStorage() {
  if (_cacheStorage !== null) return _cacheStorage;
  try {
    const stored = localStorage.getItem(CACHE_STORAGE_KEY);
    if (stored) {
      _cacheStorage = new Map(JSON.parse(stored));
      const now = Date.now();
      let toDelete = 0;
      _cacheStorage.forEach((entry) => {
        if (now - entry.timestamp > CACHE_TTL) toDelete++;
      });
      if (toDelete > 0) {
        const arr = Array.from(_cacheStorage.entries());
        const kept = arr.filter(([, entry]) => now - entry.timestamp <= CACHE_TTL);
        _cacheStorage = new Map(kept);
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
      }
    } else {
      _cacheStorage = new Map();
    }
  } catch {
    _cacheStorage = new Map();
  }
  return _cacheStorage;
}

// Persistenz entprellen: viele schnelle Cache-Updates führen zu genau einem
// localStorage-Write (synchrones localStorage ist auf iOS/Safari teuer)
let _persistTimer = null;
function persistCache() {
  if (_persistTimer) return; // Es ist bereits ein Write geplant
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
    } catch {
      // Speicherversuche ignorieren
    }
  }, 1000);
}

// Bei Verlassen der Seite oder Tab-Wechsel den noch anstehenden Write sofort ausführen
if (typeof window !== "undefined") {
  const flushPendingCache = () => {
    if (!_persistTimer) return;
    clearTimeout(_persistTimer);
    _persistTimer = null;
    if (_cacheStorage && _cacheStorage.size > 0) {
      try {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(_cacheStorage.entries())));
      } catch {
        // Speicherversuche ignorieren
      }
    }
  };
  window.addEventListener("pagehide", flushPendingCache);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPendingCache();
  });
}

// Sichert den Cache-Eintrag und fügt ihn hinzu, wenn er noch nicht vorhanden ist
function ensureCache(key, data) {
  const now = Date.now();
  const stored = apiCache.get(key);
  if (stored && now - stored.timestamp <= CACHE_TTL) {
    return;
  }
  const entry = { data, timestamp: now };
  apiCache.set(key, entry);
  const storage = _getCacheStorage();
  storage.set(key, entry);
  persistCache();
  // Wenn der Cache zu groß wird, verwende LRU-Eviction
  if (apiCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(apiCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // Älteste zuerst
    const toRemove = entries.slice(0, apiCache.size - Math.floor(MAX_CACHE_SIZE * 0.8)); // Entferne 20%
    toRemove.forEach(([k]) => {
      apiCache.delete(k);
      _getCacheStorage().delete(k);
    });
    persistCache();
  }
}

// Verbesserter cachedFetch mit Speicher und localStorage-Backup
function cachedFetch(key, fetchFn) {
  const now = Date.now();
  const memory = apiCache.get(key);
  if (memory && now - memory.timestamp <= CACHE_TTL && !(memory.data && memory.data.error)) {
    console.log('INFO', 'Using cached API data for key', key);
    return Promise.resolve(memory.data);
  }
  const storage = _getCacheStorage();
  const stored = storage.get(key);
  if (stored && now - stored.timestamp <= CACHE_TTL && !(stored.data && stored.data.error)) {
    // Cache aus localStorage in den Memory-Cache laden
    apiCache.set(key, stored);
    console.log('INFO', 'Using cached API data from storage for key', key);
    return Promise.resolve(stored.data);
  }
  return fetchFn().then(result => {
    ensureCache(key, result);
    return result;
  });
}


function clearApiCache() {
  apiCache.clear();
  const storage = _getCacheStorage();
  storage.clear();
  persistCache();
  console.log('INFO', 'API cache cleared');
}

export { cachedFetch, clearApiCache };
