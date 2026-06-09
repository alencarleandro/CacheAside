import 'dotenv/config';
import { createClient } from 'redis';
import {
  addEvent,
  recordCacheHit,
  recordCacheMiss,
  recordInvalidation
} from './metrics.js';

const DEFAULT_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 45;
const DEFAULT_TTL_MS = DEFAULT_TTL_SECONDS * 1000;
const CACHE_NAMESPACE = process.env.CACHE_NAMESPACE || 'cache-aside:api';
const DIRECT_CACHE_PATTERNS = (process.env.CACHE_DIRECT_PATTERNS || 'students:*,redis:students:*')
  .split(',')
  .map((pattern) => pattern.trim())
  .filter(Boolean);
const REDIS_URL = process.env.REDIS_URL;
const REDIS_USERNAME = process.env.REDIS_USERNAME;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_RETRY_INTERVAL_MS = 10_000;
const memoryStore = new Map();

let enabled = true;
let redisClient = null;
let redisReady = false;
let redisConnectionPromise = null;
let lastRedisError = null;
let lastRedisAttemptAt = 0;

class RedisAccessError extends Error {
  constructor(error) {
    super(error.message);
    this.cause = error;
  }
}

function clone(value) {
  return structuredClone(value);
}

function cacheKey(key) {
  return `${CACHE_NAMESPACE}:${key}`;
}

function redisKeyCandidates(key) {
  return [...new Set([cacheKey(key), key, `redis:${key}`])];
}

function logicalCacheKey(key) {
  const namespacePrefix = `${CACHE_NAMESPACE}:`;
  return key.startsWith(namespacePrefix) ? key.slice(namespacePrefix.length) : key;
}

function cacheKeyPriority(key) {
  return key.startsWith(`${CACHE_NAMESPACE}:`) ? 0 : 1;
}

async function findRedisCacheKeys(client) {
  const patterns = [
    `${CACHE_NAMESPACE}:*`,
    ...DIRECT_CACHE_PATTERNS
  ];
  const groups = await Promise.all(patterns.map((pattern) => client.keys(pattern)));
  return [...new Set(groups.flat())];
}

function publicRedisHost() {
  if (!REDIS_URL) return null;

  try {
    return new URL(REDIS_URL).host;
  } catch {
    return 'configurado';
  }
}

function now() {
  return Date.now();
}

function parseCachedValue(value) {
  if (value === null) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function connectRedis() {
  if (!REDIS_URL) return null;
  if (redisReady && redisClient) return redisClient;
  if (redisConnectionPromise) return redisConnectionPromise;
  if (lastRedisError && now() - lastRedisAttemptAt < REDIS_RETRY_INTERVAL_MS) return null;

  lastRedisAttemptAt = now();
  redisClient = createClient({
    url: REDIS_URL,
    username: REDIS_USERNAME || undefined,
    password: REDIS_PASSWORD || undefined,
    socket: {
      connectTimeout: 2500,
      reconnectStrategy: false
    }
  });

  redisClient.on('error', (error) => {
    redisReady = false;
    lastRedisError = error.message;
  });

  redisConnectionPromise = redisClient
    .connect()
    .then(() => {
      redisReady = true;
      lastRedisError = null;
      addEvent('redis', `Redis conectado: ${publicRedisHost()}`);
      return redisClient;
    })
    .catch((error) => {
      redisReady = false;
      lastRedisError = error.message;
      addEvent('redis-error', 'Redis indisponivel; usando cache em memoria', {
        host: publicRedisHost(),
        message: error.message
      });
      return null;
    })
    .finally(() => {
      redisConnectionPromise = null;
    });

  return redisConnectionPromise;
}

async function getRedisClient() {
  const client = await connectRedis();
  return redisReady ? client : null;
}

function memoryState() {
  const timestamp = now();
  const entries = [];

  for (const [key, cached] of memoryStore.entries()) {
    const ttlMs = cached.expiresAt - timestamp;

    if (ttlMs <= 0) {
      memoryStore.delete(key);
      continue;
    }

    entries.push({
      key,
      value: clone(cached.value),
      ttlMs
    });
  }

  return {
    enabled,
    ttlMs: DEFAULT_TTL_MS,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    backend: 'memory',
    size: entries.length,
    keys: entries.map((entry) => entry.key),
    entries,
    redis: {
      configured: Boolean(REDIS_URL),
      connected: false,
      host: publicRedisHost(),
      lastError: lastRedisError
    }
  };
}

export function isCacheEnabled() {
  return enabled;
}

export function setCacheEnabled(nextEnabled) {
  enabled = Boolean(nextEnabled);
  addEvent('cache-toggle', enabled ? 'Cache ativado' : 'Cache desativado');
}

export async function getCacheState() {
  const client = await getRedisClient();

  if (!client) {
    return memoryState();
  }

  try {
    const keys = await findRedisCacheKeys(client);
    const keysByLogicalName = new Map();

    for (const key of keys.sort((current, next) => cacheKeyPriority(current) - cacheKeyPriority(next))) {
      const logicalKey = logicalCacheKey(key);
      if (!keysByLogicalName.has(logicalKey)) {
        keysByLogicalName.set(logicalKey, key);
      }
    }

    const entries = await Promise.all([...keysByLogicalName.entries()].map(async ([logicalKey, redisKey]) => {
      const [value, ttlMs] = await Promise.all([
        client.get(redisKey),
        client.pTTL(redisKey)
      ]);

      return {
        key: logicalKey,
        redisKey,
        value: parseCachedValue(value),
        ttlMs: ttlMs > 0 ? ttlMs : null
      };
    }));

    return {
      enabled,
      ttlMs: DEFAULT_TTL_MS,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      backend: 'redis',
      size: entries.length,
      keys: entries.map((entry) => entry.key),
      entries,
      redis: {
        configured: true,
        connected: true,
        host: publicRedisHost(),
        lastError: null
      }
    };
  } catch (error) {
    redisReady = false;
    lastRedisError = error.message;
    addEvent('redis-error', 'Falha ao consultar chaves no Redis; usando cache em memoria', {
      message: error.message
    });
    return memoryState();
  }
}

function readMemory(key, loader, label) {
  const cached = memoryStore.get(key);

  if (cached && cached.expiresAt > now()) {
    recordCacheHit(label);
    return {
      data: clone(cached.value),
      source: 'cache',
      cacheBackend: 'memory',
      cacheKey: key,
      cacheEnabled: true
    };
  }

  if (cached) memoryStore.delete(key);
  recordCacheMiss(label);

  return loader().then((data) => {
    memoryStore.set(key, {
      value: clone(data),
      expiresAt: now() + DEFAULT_TTL_MS
    });

    return {
      data,
      source: 'database',
      cacheBackend: 'memory',
      cacheKey: key,
      cacheEnabled: true
    };
  });
}

async function readRedis(client, key, loader, label) {
  const candidates = redisKeyCandidates(key);

  try {
    for (const redisKey of candidates) {
      const cached = await client.get(redisKey);

      if (cached) {
        recordCacheHit(label);
        return {
          data: parseCachedValue(cached),
          source: 'cache',
          cacheBackend: 'redis',
          cacheKey: key,
          physicalCacheKey: redisKey,
          cacheEnabled: true
        };
      }
    }
  } catch (error) {
    throw new RedisAccessError(error);
  }

  recordCacheMiss(label);
  const data = await loader();

  try {
    await client.set(cacheKey(key), JSON.stringify(data), {
      EX: DEFAULT_TTL_SECONDS
    });
  } catch (error) {
    redisReady = false;
    lastRedisError = error.message;
    addEvent('redis-error', 'Falha ao gravar no Redis; resposta veio do banco sem cachear', {
      message: error.message
    });
  }

  return {
    data,
    source: 'database',
    cacheBackend: 'redis',
    cacheKey: key,
    cacheEnabled: true
  };
}

export async function clearCache(reason = 'limpeza manual') {
  const client = await getRedisClient();

  if (client) {
    try {
      const keys = await findRedisCacheKeys(client);
      if (keys.length) {
        await client.del(keys);
        recordInvalidation(keys.map(logicalCacheKey), reason);
      } else {
        addEvent('cache-clear', 'Redis limpo sem chaves armazenadas', { reason });
      }

      memoryStore.clear();
      return getCacheState();
    } catch (error) {
      redisReady = false;
      lastRedisError = error.message;
      addEvent('redis-error', 'Falha ao limpar Redis; limpando fallback em memoria', {
        message: error.message
      });
    }
  }

  const keys = [...memoryStore.keys()];
  memoryStore.clear();

  if (keys.length) {
    recordInvalidation(keys, reason);
  } else {
    addEvent('cache-clear', 'Cache limpo sem chaves armazenadas', { reason });
  }

  return getCacheState();
}

export async function invalidateKeys(keys, reason = 'escrita') {
  const removed = [];
  const client = await getRedisClient();

  if (client) {
    try {
      const fullKeys = [...new Set(keys.flatMap(redisKeyCandidates))];
      const deleted = await client.del(fullKeys);
      if (deleted) {
        recordInvalidation(keys, reason);
      } else {
        addEvent('cache-invalidation', 'Nenhuma chave do Redis precisava ser invalidada', { reason });
      }
    } catch (error) {
      redisReady = false;
      lastRedisError = error.message;
      addEvent('redis-error', 'Falha ao invalidar Redis; invalidando fallback em memoria', {
        message: error.message
      });
    }
  }

  for (const key of keys) {
    if (memoryStore.delete(key)) removed.push(key);
  }

  if (removed.length) {
    if (!client) recordInvalidation(removed, reason);
  } else if (!client) {
    addEvent('cache-invalidation', 'Nenhuma chave de cache precisava ser invalidada', { reason });
  }
}

export async function readThroughCache(key, loader, options = {}) {
  const label = options.label ?? key;

  if (!enabled) {
    const data = await loader();
    return {
      data,
      source: 'database',
      cacheBackend: 'disabled',
      cacheKey: key,
      cacheEnabled: false
    };
  }

  const client = await getRedisClient();

  if (!client) return readMemory(key, loader, label);

  try {
    return await readRedis(client, key, loader, label);
  } catch (error) {
    if (!(error instanceof RedisAccessError)) {
      throw error;
    }

    redisReady = false;
    lastRedisError = error.message;
    addEvent('redis-error', 'Falha ao acessar Redis; usando cache em memoria', {
      message: error.message
    });
    return readMemory(key, loader, label);
  }
}
