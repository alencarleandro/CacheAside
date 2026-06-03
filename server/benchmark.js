import { performance } from 'node:perf_hooks';
import { clearCache, isCacheEnabled, setCacheEnabled } from './cache.js';
import { peekFirstStudentId } from './database.js';
import { addEvent, resetMetrics } from './metrics.js';
import { getStudent } from './studentsService.js';

function round(value) {
  return Number(value.toFixed(2));
}

async function timeCall(callback) {
  const start = performance.now();
  const result = await callback();
  return {
    elapsedMs: performance.now() - start,
    result
  };
}

async function runPhase(iterations, studentId, phase) {
  const times = [];
  const reads = [];

  for (let index = 0; index < iterations; index += 1) {
    const readOne = await timeCall(() => getStudent(studentId));
    const elapsedMs = round(readOne.elapsedMs);
    const source = readOne.result.source;

    times.push(readOne.elapsedMs);
    reads.push({
      phase,
      readNumber: index + 1,
      studentId,
      elapsedMs,
      source,
      cacheMatch: source === 'cache' ? 'hit' : 'miss',
      cacheBackend: readOne.result.cacheBackend,
      cacheKey: readOne.result.cacheKey
    });
  }

  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    requests: times.length,
    avgMs: round(total / times.length),
    minMs: round(Math.min(...times)),
    maxMs: round(Math.max(...times)),
    reads
  };
}

export async function runBenchmark(iterations = 12) {
  const safeIterations = Math.max(4, Math.min(60, Number(iterations) || 12));
  const studentId = await peekFirstStudentId();

  if (!studentId) {
    throw new Error('Nao ha alunos cadastrados para executar o benchmark.');
  }

  const previousCacheState = isCacheEnabled();

  resetMetrics();
  await clearCache('inicio do benchmark');

  setCacheEnabled(false);
  const withoutCache = await runPhase(safeIterations, studentId, 'sem cache');

  await clearCache('troca para fase com cache');

  setCacheEnabled(true);
  const withCache = await runPhase(safeIterations, studentId, 'com cache');

  setCacheEnabled(previousCacheState);

  const improvementMs = withoutCache.avgMs - withCache.avgMs;
  const speedupFactor = withCache.avgMs
    ? round(withoutCache.avgMs / withCache.avgMs)
    : 0;

  const result = {
    iterations: safeIterations,
    studentId,
    withoutCache,
    withCache,
    reads: [...withoutCache.reads, ...withCache.reads],
    improvementMs: round(improvementMs),
    speedupFactor
  };

  addEvent('benchmark', `Benchmark concluido: cache ${speedupFactor}x mais rapido`, result);

  return result;
}
