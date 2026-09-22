const express = require('express');
const activityController = require('../controllers/activity.controller');
const asyncHandler = require('../../../middleware/asyncHandler');
const activityRouter = express.Router();
activityRouter.get('/', asyncHandler(activityController.listActivity));
activityRouter.post('/', asyncHandler(activityController.addActivity));
module.exports = activityRouter;
