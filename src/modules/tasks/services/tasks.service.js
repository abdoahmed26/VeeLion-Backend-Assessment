const { TASKS_FILE_PATH, ACTIVITY_FILE_PATH } = require('../../../config');
const { createId } = require('../../../utils/id');
const { readJsonArray, updateJsonArrays } = require('../../../utils/jsonStore');
const { validateStoredTasks, validateStoredActivity } = require('../../../utils/storedRecords');
const HttpError = require('../../../utils/httpError');
const { validateCreateTask, validateUpdateTask } = require('../utils/taskValidator');
const { withTaskStatus } = require('../utils/taskStatus');

function recordActivity(activities, task, action, info) {
  activities.push({
    id: createId(),
    taskId: task.id,
    action,
    info,
    when: new Date().toISOString(),
  });
}
function mutateTasks(mutate) {
  return updateJsonArrays(
    [TASKS_FILE_PATH, ACTIVITY_FILE_PATH],
    ([tasks, activities]) => mutate(tasks, activities),
    [validateStoredTasks, validateStoredActivity],
  );
}
async function getAllTasks() {
  const tasks = await readJsonArray(TASKS_FILE_PATH, validateStoredTasks);
  return tasks
    .map(withTaskStatus)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
async function getTaskById(taskId) {
  const task = (await getAllTasks()).find((item) => item.id === taskId);
  if (!task) throw new HttpError(404, 'Task not found.');
  return task;
}
async function createTask(payload) {
  const normalized = validateCreateTask(payload);
  return mutateTasks((tasks, activities) => {
    const now = new Date().toISOString();
    const task = { id: createId(), ...normalized, createdAt: now, updatedAt: now };
    tasks.push(task);
    recordActivity(
      activities,
      task,
      'Task created',
      'Created "' +
        task.title +
        '".' +
        (task.status === 'pending' ? '' : ' Status: ' + task.status.replace('-', ' ') + '.'),
    );
    return task;
  });
}
async function updateTask(taskId, payload) {
  const normalized = validateUpdateTask(payload);
  return mutateTasks((tasks, activities) => {
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index === -1) throw new HttpError(404, 'Task not found.');
    const previous = withTaskStatus(tasks[index]);
    const renamed = normalized.title !== undefined && normalized.title !== previous.title;
    const statusChanged = normalized.status !== undefined && normalized.status !== previous.status;
    if (!renamed && !statusChanged) return previous;
    const task = { ...previous, ...normalized, updatedAt: new Date().toISOString() };
    tasks[index] = task;
    const details = [];
    if (renamed) details.push('Renamed "' + previous.title + '" to "' + task.title + '".');
    if (statusChanged)
      details.push('Marked "' + task.title + '" as ' + task.status.replace('-', ' ') + '.');
    const action =
      renamed && statusChanged
        ? 'Task updated'
        : renamed
          ? 'Task renamed'
          : task.status === 'completed'
            ? 'Task completed'
            : task.status === 'in-progress'
              ? 'Task started'
              : 'Task reopened';
    recordActivity(activities, task, action, details.join(' '));
    return task;
  });
}
async function deleteTask(taskId) {
  return mutateTasks((tasks, activities) => {
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index === -1) throw new HttpError(404, 'Task not found.');
    const [task] = tasks.splice(index, 1);
    recordActivity(activities, task, 'Task deleted', 'Deleted "' + task.title + '".');
    return task;
  });
}
module.exports = { getAllTasks, getTaskById, createTask, updateTask, deleteTask };
