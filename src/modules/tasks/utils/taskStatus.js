const TASK_STATUSES = ['pending', 'in-progress', 'completed'];
function taskStatus(task) {
  return task.status ?? (task.completed ? 'completed' : 'pending');
}
function withTaskStatus(task) {
  const status = taskStatus(task);
  return { ...task, status, completed: status === 'completed' };
}
module.exports = { TASK_STATUSES, taskStatus, withTaskStatus };
