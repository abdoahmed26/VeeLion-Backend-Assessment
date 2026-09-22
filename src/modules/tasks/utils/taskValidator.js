const HttpError = require('../../../utils/httpError');
const { TASK_STATUSES } = require('./taskStatus');

const ALLOWED_FIELDS = ['title', 'completed', 'status'];

function validatePayloadShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Body must be a JSON object.');
  }
}

function ensureNoUnknownFields(payload) {
  const unknownFields = Object.keys(payload).filter((field) => !ALLOWED_FIELDS.includes(field));

  if (unknownFields.length > 0) {
    throw new HttpError(400, 'Body contains unsupported fields.', {
      unsupportedFields: unknownFields,
    });
  }
}

function normalizeTitleIfPresent(payload, normalized) {
  if (!Object.hasOwn(payload, 'title')) {
    return;
  }

  if (typeof payload.title !== 'string') {
    throw new HttpError(400, '"title" must be a string.');
  }

  const trimmedTitle = payload.title.trim();
  if (!trimmedTitle) {
    throw new HttpError(400, '"title" cannot be empty.');
  }

  normalized.title = trimmedTitle;
}

function normalizeStatusIfPresent(payload, normalized) {
  const hasCompleted = Object.hasOwn(payload, 'completed');
  const hasStatus = Object.hasOwn(payload, 'status');
  if (hasCompleted && typeof payload.completed !== 'boolean') {
    throw new HttpError(400, '"completed" must be a boolean.');
  }
  if (hasStatus && !TASK_STATUSES.includes(payload.status)) {
    throw new HttpError(400, '"status" must be pending, in-progress, or completed.');
  }
  if (hasCompleted && hasStatus && payload.completed !== (payload.status === 'completed')) {
    throw new HttpError(400, '"status" and "completed" must agree.');
  }
  if (hasStatus || hasCompleted) {
    normalized.status = hasStatus ? payload.status : payload.completed ? 'completed' : 'pending';
    normalized.completed = normalized.status === 'completed';
  }
}

function validateCreateTask(payload) {
  validatePayloadShape(payload);
  ensureNoUnknownFields(payload);

  const normalized = {};
  normalizeTitleIfPresent(payload, normalized);
  normalizeStatusIfPresent(payload, normalized);

  if (!Object.hasOwn(normalized, 'title')) {
    throw new HttpError(400, '"title" is required.');
  }

  if (!Object.hasOwn(normalized, 'completed')) {
    normalized.completed = false;
    normalized.status = 'pending';
  }

  return normalized;
}

function validateUpdateTask(payload) {
  validatePayloadShape(payload);
  ensureNoUnknownFields(payload);

  const normalized = {};
  normalizeTitleIfPresent(payload, normalized);
  normalizeStatusIfPresent(payload, normalized);

  if (Object.keys(normalized).length === 0) {
    throw new HttpError(400, 'Provide at least one updatable field.');
  }

  return normalized;
}

module.exports = {
  validateCreateTask,
  validateUpdateTask,
};
