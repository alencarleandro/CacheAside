import { randomUUID } from 'node:crypto';

const MAX_EVENTS = 120;

function makeResponseBucket() {
  return {
    count: 0,
    totalMs: 0,
    minMs: null,
    maxMs: null
  };
}

function initialState() {
  return {
    startedAt: new Date().toISOString(),
    cacheHits: 0,
    cacheMisses: 0,
    cacheChecks: 0,
    dbReads: 0,
    dbWrites: 0,
    invalidations: 0,
    responses: {
      cacheOn: makeResponseBucket(),
      cacheOff: makeResponseBucket()
    },
    operations: {},
    events: []
  };
}

let state = initialState();

function round(value) {
  return Number(value.toFixed(2));
}

function summarizeBucket(bucket) {
  return {
    count: bucket.count,
    avgMs: bucket.count ? round(bucket.totalMs / bucket.count) : 0,
    minMs: bucket.minMs ?? 0,
    maxMs: bucket.maxMs ?? 0
  };
}

function touchBucket(bucket, elapsedMs) {
  bucket.count += 1;
  bucket.totalMs += elapsedMs;
  bucket.minMs = bucket.minMs === null ? elapsedMs : Math.min(bucket.minMs, elapsedMs);
  bucket.maxMs = bucket.maxMs === null ? elapsedMs : Math.max(bucket.maxMs, elapsedMs);
}

export function resetMetrics() {
  state = initialState();
  addEvent('metrics', 'Metricas reiniciadas');
}

export function addEvent(type, message, details = {}) {
  state.events.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    type,
    message,
    details
  });

  if (state.events.length > MAX_EVENTS) {
    state.events.length = MAX_EVENTS;
  }
}

export function recordCacheHit(key) {
  state.cacheChecks += 1;
  state.cacheHits += 1;
  addEvent('cache-hit', `Cache hit: ${key}`);
}

export function recordCacheMiss(key) {
  state.cacheChecks += 1;
  state.cacheMisses += 1;
  addEvent('cache-miss', `Cache miss: ${key}`);
}

export function recordDbRead(label) {
  state.dbReads += 1;
  addEvent('database-read', `Consulta ao banco: ${label}`);
}

export function recordDbWrite(label) {
  state.dbWrites += 1;
  addEvent('database-write', `Escrita no banco: ${label}`);
}

export function recordInvalidation(keys, reason) {
  const count = Array.isArray(keys) ? keys.length : keys;
  state.invalidations += count;
  addEvent('cache-invalidation', `Cache invalidado: ${count} chave(s)`, { reason });
}

export function recordResponse(cacheEnabled, method, route, elapsedMs) {
  const bucket = cacheEnabled ? state.responses.cacheOn : state.responses.cacheOff;
  touchBucket(bucket, elapsedMs);

  const key = `${method} ${route}`;
  if (!state.operations[key]) {
    state.operations[key] = {
      method,
      route,
      cacheOn: makeResponseBucket(),
      cacheOff: makeResponseBucket()
    };
  }

  touchBucket(cacheEnabled ? state.operations[key].cacheOn : state.operations[key].cacheOff, elapsedMs);
}

export function getMetrics() {
  const cacheHitRate = state.cacheChecks ? round((state.cacheHits / state.cacheChecks) * 100) : 0;

  return {
    startedAt: state.startedAt,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    cacheChecks: state.cacheChecks,
    cacheHitRate,
    dbReads: state.dbReads,
    dbWrites: state.dbWrites,
    invalidations: state.invalidations,
    responses: {
      cacheOn: summarizeBucket(state.responses.cacheOn),
      cacheOff: summarizeBucket(state.responses.cacheOff)
    },
    operations: Object.values(state.operations).map((operation) => ({
      method: operation.method,
      route: operation.route,
      cacheOn: summarizeBucket(operation.cacheOn),
      cacheOff: summarizeBucket(operation.cacheOff)
    })),
    events: state.events
  };
}
