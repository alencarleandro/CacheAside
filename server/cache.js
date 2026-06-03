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
const REDIS_URL = process.env.REDIS_URL;
const REDIS_RETRY_INTERVAL_MS = 10_000;
const memoryStore = new Map();

let enabled = true;
let redisClient = null;
let redisReady = false;
let redisConnectionPromise = null;
let lastRedisError = null;
let lastRedisAttemptAt = 0;

function clone(value) {
  return structuredClone(value);
}

function cacheKey(key) {
  return `${CACHE_NAMESPACE}:${key}`;
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

async function connectRedis() {
  if (!REDIS_URL) return null;
  if (redisReady && redisClient) return redisClient;
  if (redisConnectionPromise) return redisConnectionPromise;
  if (lastRedisError && now() - lastRedisAttemptAt < REDIS_RETRY_INTERVAL_MS) return null;

  lastRedisAttemptAt = now();
  redisClient = createClient({
    url: REDIS_URL,
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
  return {
    enabled,
    ttlMs: DEFAULT_TTL_MS,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    backend: 'memory',
    size: memoryStore.size,
    keys: [...memoryStore.keys()],
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
    const keys = await client.keys(`${CACHE_NAMESPACE}:*`);
    return {
      enabled,
      ttlMs: DEFAULT_TTL_MS,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      backend: 'redis',
      size: keys.length,
      keys: keys.map((key) => key.replace(`${CACHE_NAMESPACE}:`, '')),
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
  const fullKey = cacheKey(key);
  const cached = await client.get(fullKey);

  if (cached) {
    recordCacheHit(label);
    return {
      data: JSON.parse(cached),
      source: 'cache',
      cacheBackend: 'redis',
      cacheKey: key,
      cacheEnabled: true
    };
  }

  recordCacheMiss(label);
  const data = await loader();
  await client.set(fullKey, JSON.stringify(data), {
    EX: DEFAULT_TTL_SECONDS
  });

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
      const keys = await client.keys(`${CACHE_NAMESPACE}:*`);
      if (keys.length) {
        await client.del(keys);
        recordInvalidation(keys.map((key) => key.replace(`${CACHE_NAMESPACE}:`, '')), reason);
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
      const fullKeys = keys.map(cacheKey);
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
    redisReady = false;
    lastRedisError = error.message;
    addEvent('redis-error', 'Falha ao acessar Redis; usando cache em memoria', {
      message: error.message
    });
    return readMemory(key, loader, label);
  }
}
