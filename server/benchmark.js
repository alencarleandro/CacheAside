import { performance } from 'node:perf_hooks';
import { clearCache, isCacheEnabled, setCacheEnabled } from './cache.js';
import { peekFirstStudentId } from './database.js';
import { addEvent, resetMetrics } from './metrics.js';
import { getStudent, getStudents } from './studentsService.js';

function round(value) {
  return Number(value.toFixed(2));
}

async function timeCall(callback) {
  const start = performance.now();
  await callback();
  return performance.now() - start;
}

async function runPhase(iterations, studentId) {
  const times = [];
  let studentRequests = 0;
  let listRequests = 0;

  for (let index = 0; index < iterations; index += 1) {
    const readOne = await timeCall(() => getStudent(studentId));
    times.push(readOne);
    studentRequests += 1;

    if (index % 3 === 0) {
      const readList = await timeCall(() => getStudents());
      times.push(readList);
      listRequests += 1;
    }
  }

  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    requests: times.length,
    studentRequests,
    listRequests,
    avgMs: round(total / times.length),
    minMs: round(Math.min(...times)),
    maxMs: round(Math.max(...times))
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
  const withoutCache = await runPhase(safeIterations, studentId);

  await clearCache('troca para fase com cache');

  setCacheEnabled(true);
  const withCache = await runPhase(safeIterations, studentId);

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
    improvementMs: round(improvementMs),
    speedupFactor
  };

  addEvent('benchmark', `Benchmark concluido: cache ${speedupFactor}x mais rapido`, result);

  return result;
}
