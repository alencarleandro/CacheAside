import {
  createStudent as insertStudent,
  findAllStudents,
  findStudentById,
  patchStudent as updatePartialStudent,
  removeStudent as deleteStudent,
  replaceStudent as updateStudent
} from './database.js';
import { invalidateKeys, readThroughCache } from './cache.js';
import { badRequest } from './errors.js';

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
