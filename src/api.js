const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api';
const STALE_DEMO_FALLBACK_API_BASE = 'https://cacheaside.onrender.com/api';

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

export async function apiFetch(path, options = {}) {
  let { response, payload } = await request(API_BASE, path, options);

  if (
    import.meta.env.DEV &&
    API_BASE === '/api' &&
    path === '/cache/stale-demo' &&
    response.status === 404
  ) {
    ({ response, payload } = await request(STALE_DEMO_FALLBACK_API_BASE, path, options));
  }

  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Falha ao chamar a API.');
    error.status = response.status;
    throw error;
  }

  return payload;
}
