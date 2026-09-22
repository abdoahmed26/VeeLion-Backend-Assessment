const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');

router.get('/tasks-summary', reportsController.getTasksSummary);

module.exports = router;
