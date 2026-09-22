const activityService = require('../services/activity.service');
async function listActivity(req, res) {
  res.json(await activityService.getAllActivity());
}
async function addActivity(req, res) {
  res.status(201).json(await activityService.createNewActivity(req.body));
}
module.exports = { listActivity, addActivity };
