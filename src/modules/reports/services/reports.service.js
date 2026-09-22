const { TASKS_FILE_PATH, ACTIVITY_FILE_PATH, RECENT_ACTIVITY_DAYS } = require('../../../config');
const { readJsonArrays } = require('../../../utils/jsonStore');
const { validateStoredTasks, validateStoredActivity } = require('../../../utils/storedRecords');
const { taskStatus } = require('../../tasks/utils/taskStatus');
function summarizeTasks(tasks, activities, now = Date.now()) {
  validateStoredTasks(tasks);
  validateStoredActivity(activities);
  const byStatus = { todo: 0, 'in-progress': 0, done: 0 };
  const reportStatus = { pending: 'todo', 'in-progress': 'in-progress', completed: 'done' };
  for (const task of tasks) byStatus[reportStatus[taskStatus(task)]] += 1;
  const cutoff = now - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  const recentActivityCount = activities.filter((activity) => {
    const timestamp = Date.parse(activity.when);
    return timestamp >= cutoff && timestamp <= now;
  }).length;
  return { total: tasks.length, byStatus, recentActivityCount };
}
async function getTasksSummary() {
  const [tasks, activities] = await readJsonArrays([TASKS_FILE_PATH, ACTIVITY_FILE_PATH]);
  return summarizeTasks(tasks, activities);
}
module.exports = { getTasksSummary, summarizeTasks };
