const { TASK_STATUSES } = require('../modules/tasks/utils/taskStatus');
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function date(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function validateRecords(records, kind, valid) {
  if (!Array.isArray(records)) throw new Error('Stored ' + kind + ' must be an array.');
  const ids = new Set();
  records.forEach((record, index) => {
    if (!object(record) || !text(record.id) || ids.has(record.id) || !valid(record)) {
      throw new Error('Invalid stored ' + kind + ' record at index ' + index + '.');
    }
    ids.add(record.id);
  });
}
function validateStoredTasks(tasks) {
  validateRecords(
    tasks,
    'task',
    (task) =>
      text(task.title) &&
      typeof task.completed === 'boolean' &&
      (task.status === undefined ||
        (TASK_STATUSES.includes(task.status) &&
          task.completed === (task.status === 'completed'))) &&
      date(task.createdAt) &&
      date(task.updatedAt),
  );
}
function validateStoredActivity(activities) {
  validateRecords(
    activities,
    'activity',
    (activity) =>
      date(activity.when) &&
      (activity.taskId === undefined || text(activity.taskId)) &&
      (activity.action === undefined || typeof activity.action === 'string') &&
      (activity.info === undefined || typeof activity.info === 'string'),
  );
}
module.exports = { validateStoredTasks, validateStoredActivity };
