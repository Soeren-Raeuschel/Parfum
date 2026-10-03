/**
 * Error Handling Module - Tree-shaking-fähige Basis-Exporte
 * Enthält Error-Klassen und grundlegende Performance-Metrinen
 */

class AppError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.type = code;
    this.fatal = false;
  }
}

class NetworkError extends AppError {
  constructor(message, details = {}) {
    super(message, 'NETWORK_ERROR', details);
  }
}

class RateLimitError extends AppError {
  constructor(message, details = {}) {
    super(message, 'RATE_LIMIT_ERROR', details);
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

class ApiError extends AppError {
  constructor(message, details = {}) {
    super(message, 'API_ERROR', details);
  }
}

class InvalidResponseError extends AppError {
  constructor(message, details = {}) {
    super(message, 'INVALID_RESPONSE_ERROR', details);
  }
}

// Performance metrics
const perfMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  prefetchRequests: 0,
  errorsByScope: {},
};

function recordCacheHit() { perfMetrics.cacheHits += 1; }
function recordCacheMiss() { perfMetrics.cacheMisses += 1; }
function recordPrefetchRequest() { perfMetrics.prefetchRequests += 1; }
function recordError(scope) {
  perfMetrics.errorsByScope[scope] = (perfMetrics.errorsByScope[scope] || 0) + 1;
}

function getCacheHitRate() {
  const total = perfMetrics.cacheHits + perfMetrics.cacheMisses;
  return total > 0 ? (perfMetrics.cacheHits / total) * 100 : 0;
}

// ES Module exports
export {
  AppError,
  NetworkError,
  RateLimitError,
  ValidationError,
  ApiError,
  InvalidResponseError,
  perfMetrics,
  recordCacheHit,
  recordCacheMiss,
  recordPrefetchRequest,
  recordError,
  getCacheHitRate,
};
