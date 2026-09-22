const { ACTIVITY_FILE_PATH } = require('../../../config');
const { readJsonArray, updateJsonArray } = require('../../../utils/jsonStore');
const { validateStoredActivity } = require('../../../utils/storedRecords');
const { createId } = require('../../../utils/id');
const { validateActivity } = require('../utils/activityValidator');
async function getAllActivity() {
  return readJsonArray(ACTIVITY_FILE_PATH, validateStoredActivity);
}
async function createNewActivity(payload) {
  const normalized = validateActivity(payload);
  return updateJsonArray(
    ACTIVITY_FILE_PATH,
    (activities) => {
      const activity = { id: createId(), ...normalized, when: new Date().toISOString() };
      activities.push(activity);
      return activity;
    },
    validateStoredActivity,
  );
}
module.exports = { getAllActivity, createNewActivity };
