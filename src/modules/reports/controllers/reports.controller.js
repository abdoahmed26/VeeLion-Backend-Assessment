const reportsService = require('../services/reports.service');
const asyncHandler = require('../../../middleware/asyncHandler');

const getTasksSummary = asyncHandler(async (req, res) => {
  const summary = await reportsService.getTasksSummary();
  res.status(200).json(summary);
});

module.exports = {
  getTasksSummary,
};
