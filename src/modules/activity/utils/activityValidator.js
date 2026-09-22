const HttpError = require('../../../utils/httpError');
function validateActivity(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new HttpError(400, 'Body must be a JSON object.');
  const fields = ['action', 'info'];
  if (Object.keys(payload).some((field) => !fields.includes(field)))
    throw new HttpError(400, 'Body contains unsupported fields.');
  const normalized = {};
  for (const field of fields) {
    if (!Object.hasOwn(payload, field)) continue;
    if (typeof payload[field] !== 'string') throw new HttpError(400, field + ' must be a string.');
    normalized[field] = payload[field].trim();
  }
  return normalized;
}
module.exports = { validateActivity };
