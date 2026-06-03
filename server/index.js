import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { clearCache, getCacheState, isCacheEnabled, setCacheEnabled } from './cache.js';
import { HttpError } from './errors.js';
import { getMetrics, recordResponse, resetMetrics } from './metrics.js';
import { runBenchmark } from './benchmark.js';
import { getDatabaseState } from './database.js';
import {
  createStudent,
  editStaleDemoDatabase,
  getStudent,
  getStudents,
  patchStudent,
  primeStaleDemo,
  readStaleDemoAgain,
  removeStudent,
  replaceStudent,
  simulateCacheInconsistency
} from './studentsService.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

app.use(cors());
app.use(express.json());

function asyncRoute(handler) {
  return async (request, response, next) => {
    const startedAt = performance.now();

    try {
      const result = await handler(request, response);
      const elapsedMs = Number((performance.now() - startedAt).toFixed(2));

      recordResponse(isCacheEnabled(), request.method, request.route?.path ?? request.path, elapsedMs);

      const status = result?.status ?? 200;
      const payload = {
        ...result,
        status: undefined,
        meta: {
          elapsedMs,
          cacheEnabled: isCacheEnabled(),
          ...(result?.meta ?? {})
        }
      };

      response.status(status).json(payload);
    } catch (error) {
      next(error);
    }
  };
}

app.get('/api/health', asyncRoute(async () => ({
  data: {
    status: 'ok',
    service: 'Cache Aside API',
    database: getDatabaseState(),
    cache: await getCacheState()
  }
})));

app.get('/api/students', asyncRoute(async () => {
  const result = await getStudents();
  return {
    data: result.data,
    meta: {
      source: result.source,
      cacheBackend: result.cacheBackend,
      cacheKey: result.cacheKey
    }
  };
}));

app.get('/api/students/:id', asyncRoute(async (request) => {
  const result = await getStudent(request.params.id);
  return {
    data: result.data,
    meta: {
      source: result.source,
      cacheBackend: result.cacheBackend,
      cacheKey: result.cacheKey
    }
  };
}));

app.post('/api/students', asyncRoute(async (request) => ({
  status: 201,
  data: await createStudent(request.body),
  meta: {
    source: 'database',
    invalidated: true
  }
})));

app.put('/api/students/:id', asyncRoute(async (request) => ({
  data: await replaceStudent(request.params.id, request.body),
  meta: {
    source: 'database',
    invalidated: true
  }
})));

app.patch('/api/students/:id', asyncRoute(async (request) => ({
  data: await patchStudent(request.params.id, request.body),
  meta: {
    source: 'database',
    invalidated: true
  }
})));

app.delete('/api/students/:id', asyncRoute(async (request) => ({
  data: await removeStudent(request.params.id),
  meta: {
    source: 'database',
    invalidated: true
  }
})));

app.get('/api/cache', asyncRoute(async () => ({
  data: await getCacheState()
})));

app.patch('/api/cache', asyncRoute(async (request) => {
  setCacheEnabled(request.body.enabled);
  return {
    data: await getCacheState()
  };
}));

app.post('/api/cache/clear', asyncRoute(async () => ({
  data: await clearCache()
})));

app.post('/api/cache/stale-demo', asyncRoute(async (request) => ({
  data: await simulateCacheInconsistency(request.body?.studentId)
})));

app.post('/api/cache/stale-demo/prime', asyncRoute(async (request) => ({
  data: await primeStaleDemo(request.body?.studentId)
})));

app.post('/api/cache/stale-demo/edit', asyncRoute(async (request) => ({
  data: await editStaleDemoDatabase(request.body?.studentId, request.body)
})));

app.post('/api/cache/stale-demo/read', asyncRoute(async (request) => ({
  data: await readStaleDemoAgain(request.body?.studentId)
})));

app.get('/api/metrics', asyncRoute(async () => ({
  data: {
    ...getMetrics(),
    database: getDatabaseState(),
    cache: await getCacheState()
  }
})));

app.post('/api/metrics/reset', asyncRoute(async () => {
  resetMetrics();
  return {
    data: {
      ...getMetrics(),
      database: getDatabaseState(),
      cache: await getCacheState()
    }
  };
}));

app.post('/api/benchmark', asyncRoute(async (request) => ({
  data: await runBenchmark(request.body?.iterations)
})));

app.use(express.static(distDir));

app.use((request, response, next) => {
  if (request.method === 'GET' && !request.path.startsWith('/api')) {
    response.sendFile(path.join(distDir, 'index.html'));
    return;
  }

  next();
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = error instanceof HttpError ? error.status : 500;
  response.status(status).json({
    error: {
      message: status === 500 ? 'Erro interno no servidor.' : error.message
    }
  });
});

app.listen(port, () => {
  console.log(`API Cache Aside rodando em http://127.0.0.1:${port}/api`);
});
