import { performance } from 'node:perf_hooks';
import { clearCache, isCacheEnabled, setCacheEnabled } from './cache.js';
import { findAllStudents } from './database.js';
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

async function runPhase(iterations, students, phase) {
  const times = [];
  const reads = [];

  for (let index = 0; index < iterations; index += 1) {
    for (const student of students) {
      const readOne = await timeCall(() => getStudent(student.id));
      const elapsedMs = round(readOne.elapsedMs);
      const source = readOne.result.source;

      times.push(readOne.elapsedMs);
      reads.push({
        phase,
        readNumber: index + 1,
        studentId: student.id,
        studentName: student.name,
        elapsedMs,
        source,
        cacheMatch: source === 'cache' ? 'hit' : 'miss',
        cacheBackend: readOne.result.cacheBackend,
        cacheKey: readOne.result.cacheKey
      });
    }
  }

  if (!times.length) {
    return {
      requests: 0,
      avgMs: 0,
      minMs: 0,
      maxMs: 0,
      reads
    };
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
  const parsedIterations = Number(iterations);
  const safeIterations = Number.isFinite(parsedIterations)
    ? Math.max(0, Math.min(60, parsedIterations))
    : 12;
  const measuredIterations = safeIterations + 1;
  const students = await findAllStudents();

  if (!students.length) {
    throw new Error('Nao ha alunos cadastrados para executar o benchmark.');
  }

  const previousCacheState = isCacheEnabled();

  resetMetrics();
  await clearCache('inicio do benchmark');

  setCacheEnabled(false);
  const withoutCache = await runPhase(measuredIterations, students, 'sem cache');

  await clearCache('troca para fase com cache');

  setCacheEnabled(true);
  const withCache = await runPhase(measuredIterations, students, 'com cache');

  setCacheEnabled(previousCacheState);

  const improvementMs = withoutCache.avgMs - withCache.avgMs;
  const speedupFactor = withCache.avgMs
    ? round(withoutCache.avgMs / withCache.avgMs)
    : 0;

  const result = {
    iterations: safeIterations,
    measuredIterations,
    studentCount: students.length,
    studentIds: students.map((student) => student.id),
    withoutCache,
    withCache,
    reads: [...withoutCache.reads, ...withCache.reads],
    improvementMs: round(improvementMs),
    speedupFactor
  };

  addEvent('benchmark', `Benchmark concluido: cache ${speedupFactor}x mais rapido`, result);

  return result;
}
