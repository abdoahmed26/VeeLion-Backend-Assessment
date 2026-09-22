const path = require('node:path');
const DATA_DIRECTORY = process.env.DATA_DIRECTORY
  ? path.resolve(process.env.DATA_DIRECTORY)
  : path.join(__dirname, '..', 'data');
module.exports = {
  TASKS_FILE_PATH: path.join(DATA_DIRECTORY, 'tasks.json'),
  ACTIVITY_FILE_PATH: path.join(DATA_DIRECTORY, 'activity.json'),
  RECENT_ACTIVITY_DAYS: 7,
};
