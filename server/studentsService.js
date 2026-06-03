import {
  createStudent as insertStudent,
  findAllStudents,
  findStudentById,
  patchStudent as updatePartialStudent,
  peekFirstStudentId,
  removeStudent as deleteStudent,
  replaceStudent as updateStudent
} from './database.js';
import { invalidateKeys, isCacheEnabled, readThroughCache, setCacheEnabled } from './cache.js';
import { addEvent } from './metrics.js';
import { badRequest, notFound } from './errors.js';

const LIST_KEY = 'students:list';

function studentKey(id) {
  return `students:${id}`;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStudent(payload, partial = false) {
  const normalized = {};

  if (!partial || payload.name !== undefined) {
    normalized.name = String(payload.name ?? '').trim();
  }

  if (!partial || payload.email !== undefined) {
    normalized.email = String(payload.email ?? '').trim().toLowerCase();
  }

  if (!partial || payload.course !== undefined) {
    normalized.course = String(payload.course ?? '').trim();
  }

  if (!partial || payload.period !== undefined) {
    normalized.period = Math.max(1, Math.min(12, Math.round(toNumber(payload.period, 1))));
  }

  if (!partial || payload.gradeAverage !== undefined) {
    normalized.gradeAverage = Math.max(0, Math.min(10, toNumber(payload.gradeAverage, 0)));
  }

  if (!partial) {
    if (!normalized.name) throw badRequest('Nome e obrigatorio.');
    if (!normalized.email) throw badRequest('E-mail e obrigatorio.');
    if (!normalized.course) throw badRequest('Curso e obrigatorio.');
  }

  if (partial && Object.keys(normalized).length === 0) {
    throw badRequest('Informe ao menos um campo para atualizar.');
  }

  return normalized;
}

function parseId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('ID invalido.');
  }
  return id;
}

function nextDemoGrade(currentGrade) {
  const grade = Number(currentGrade);
  return Number((grade >= 9.8 ? grade - 0.4 : grade + 0.4).toFixed(1));
}

async function invalidateStudentCache(id, reason) {
  await invalidateKeys([LIST_KEY, studentKey(id)], reason);
}

export async function getStudents() {
  return readThroughCache(LIST_KEY, findAllStudents, {
    label: 'lista de alunos'
  });
}

export async function getStudent(rawId) {
  const id = parseId(rawId);
  return readThroughCache(studentKey(id), () => findStudentById(id), {
    label: `aluno ${id}`
  });
}

export async function createStudent(payload) {
  const student = normalizeStudent(payload);
  const created = await insertStudent(student);
  await invalidateKeys([LIST_KEY], 'novo aluno cadastrado');
  return created;
}

export async function replaceStudent(rawId, payload) {
  const id = parseId(rawId);
  const student = normalizeStudent(payload);
  const updated = await updateStudent(id, student);
  await invalidateStudentCache(id, 'aluno substituido');
  return updated;
}

export async function patchStudent(rawId, payload) {
  const id = parseId(rawId);
  const patch = normalizeStudent(payload, true);
  const updated = await updatePartialStudent(id, patch);
  await invalidateStudentCache(id, 'aluno atualizado');
  return updated;
}

export async function removeStudent(rawId) {
  const id = parseId(rawId);
  const removed = await deleteStudent(id);
  await invalidateStudentCache(id, 'aluno removido');
  return removed;
}

export async function primeStaleDemo(rawId) {
  const id = rawId ? parseId(rawId) : await peekFirstStudentId();
  if (!id) throw notFound('Nenhum aluno disponivel para demonstrar inconsistencia.');

  if (!isCacheEnabled()) {
    setCacheEnabled(true);
  }

  await invalidateKeys([studentKey(id)], 'preparar demonstracao de inconsistencia');

  const primedRead = await getStudent(id);
  const oldGrade = Number(primedRead.data.gradeAverage);

  addEvent('cache-stale-prime', `Cache preparado para aluno ${id}: CR ${oldGrade}`);

  return {
    studentId: id,
    cacheKey: studentKey(id),
    student: primedRead.data,
    primedRead: {
      source: primedRead.source,
      cacheBackend: primedRead.cacheBackend,
      gradeAverage: oldGrade
    },
    explanation: 'Primeira leitura: miss no Redis, busca no banco e grava a chave no cache.'
  };
}

export async function editStaleDemoDatabase(rawId, payload = {}) {
  const id = rawId ? parseId(rawId) : await peekFirstStudentId();
  if (!id) throw notFound('Nenhum aluno disponivel para demonstrar inconsistencia.');

  const currentStudent = await findStudentById(id);
  const patch = payload.gradeAverage === undefined
    ? { gradeAverage: nextDemoGrade(currentStudent.gradeAverage) }
    : normalizeStudent({ gradeAverage: payload.gradeAverage }, true);

  const databaseWrite = await updatePartialStudent(id, patch);

  addEvent(
    'cache-stale-write',
    `Banco alterado sem invalidar cache: aluno ${id} CR ${databaseWrite.gradeAverage}`
  );

  return {
    studentId: id,
    cacheKey: studentKey(id),
    databaseStudent: databaseWrite,
    databaseWrite: {
      gradeAverage: databaseWrite.gradeAverage
    },
    explanation: 'O banco mudou, mas a chave do Redis continua com o valor antigo.'
  };
}

export async function readStaleDemoAgain(rawId) {
  const id = rawId ? parseId(rawId) : await peekFirstStudentId();
  if (!id) throw notFound('Nenhum aluno disponivel para demonstrar inconsistencia.');

  const cacheRead = await getStudent(id);
  const databaseRead = await findStudentById(id);
  const stale = Number(cacheRead.data.gradeAverage) !== Number(databaseRead.gradeAverage);

  addEvent(
    'cache-stale',
    stale
      ? `Inconsistencia vista: cache CR ${cacheRead.data.gradeAverage}, banco CR ${databaseRead.gradeAverage}`
      : 'Cache e banco estao consistentes'
  );

  return {
    studentId: id,
    cacheKey: studentKey(id),
    databaseStudent: databaseRead,
    stale,
    cacheRead: {
      source: cacheRead.source,
      cacheBackend: cacheRead.cacheBackend,
      gradeAverage: cacheRead.data.gradeAverage
    },
    databaseRead: {
      source: 'database',
      gradeAverage: databaseRead.gradeAverage
    },
    explanation: stale
      ? 'A nova requisicao encontrou a chave no Redis e devolveu o CR antigo.'
      : 'A nova requisicao esta consistente: o cache expirou, foi limpo ou recebeu o valor atualizado.'
  };
}

export async function simulateCacheInconsistency(rawId) {
  const primed = await primeStaleDemo(rawId);
  const nextGrade = nextDemoGrade(primed.primedRead.gradeAverage);

  return {
    ...primed,
    ...(await editStaleDemoDatabase(primed.studentId, { gradeAverage: nextGrade })),
    ...(await readStaleDemoAgain(primed.studentId))
  };
}
