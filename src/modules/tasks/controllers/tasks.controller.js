const tasksService = require('../services/tasks.service');
async function listTasks(req, res) {
  res.json({ data: await tasksService.getAllTasks() });
}
async function getTask(req, res) {
  res.json({ data: await tasksService.getTaskById(req.params.id) });
}
async function createTask(req, res) {
  res.status(201).json({ data: await tasksService.createTask(req.body) });
}
async function patchTask(req, res) {
  res.json({ data: await tasksService.updateTask(req.params.id, req.body) });
}
async function removeTask(req, res) {
  await tasksService.deleteTask(req.params.id);
  res.status(204).send();
}
module.exports = { listTasks, getTask, createTask, patchTask, removeTask };
