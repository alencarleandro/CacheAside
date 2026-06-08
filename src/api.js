const RENDER_API_BASE = 'https://cacheaside.onrender.com/api';
const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
  || (import.meta.env.DEV ? RENDER_API_BASE : '/api');
const STALE_DEMO_FALLBACK_API_BASE = RENDER_API_BASE;

export const CACHE_UPDATED_EVENT = 'cache-aside:cache-updated';

async function request(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function pathForCacheKey(key) {
  if (key === 'students:list') return '/students';
  if (key.startsWith('students:')) return `/students/${encodeURIComponent(key.slice('students:'.length))}`;
  return null;
}

async function hydrateCacheState(cacheState) {
  if (!cacheState || cacheState.entries?.length || !cacheState.keys?.length) {
    return cacheState;
  }

  const entries = await Promise.all(cacheState.keys.map(async (key) => {
    const path = pathForCacheKey(key);
    if (!path) return { key, value: undefined, ttlMs: null };

    try {
      const result = await request(API_BASE, path, {});
      return {
        key,
        value: result.response.ok ? result.payload.data : undefined,
        ttlMs: null
      };
    } catch {
      return { key, value: undefined, ttlMs: null };
    }
  }));

  return {
    ...cacheState,
    entries
  };
}

export async function apiFetch(path, options = {}) {
  const { syncCache = true, ...requestOptions } = options;
  let { response, payload } = await request(API_BASE, path, requestOptions);

  if (
    import.meta.env.DEV &&
    API_BASE === '/api' &&
    path === '/cache/stale-demo' &&
    response.status === 404
  ) {
    ({ response, payload } = await request(STALE_DEMO_FALLBACK_API_BASE, path, requestOptions));
  }

  if (response.ok && path === '/cache') {
    payload.data = await hydrateCacheState(payload.data);
  }

  if (syncCache && path !== '/cache') {
    try {
      const cacheResult = await request(API_BASE, '/cache', {});
      const cacheState = await hydrateCacheState(cacheResult.payload.data);

      if (cacheResult.response.ok && cacheState && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CACHE_UPDATED_EVENT, {
          detail: cacheState
        }));
      }
    } catch {
      // A sincronizacao visual do cache nao deve esconder a resposta principal.
    }
  }

  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Falha ao chamar a API.');
    error.status = response.status;
    throw error;
  }

  return payload;
}
