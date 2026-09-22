const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// One queue also coordinates task + activity commits and report snapshots.
let queue = Promise.resolve();
function serialize(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
async function readSnapshot(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Stored JSON must be an array.');
    return { raw, data };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { raw: null, data: [] };
  }
}
async function stage(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    return temporaryPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}
function readJsonArrays(filePaths, validators = []) {
  return serialize(async () => {
    const snapshots = await Promise.all(filePaths.map(readSnapshot));
    return snapshots.map((snapshot, index) => {
      validators[index]?.(snapshot.data);
      return snapshot.data;
    });
  });
}
async function readJsonArray(filePath, validate) {
  return (await readJsonArrays([filePath], [validate]))[0];
}
function updateJsonArrays(filePaths, mutate, validators = []) {
  return serialize(async () => {
    const snapshots = await Promise.all(filePaths.map(readSnapshot));
    const datasets = snapshots.map((snapshot) => snapshot.data);
    datasets.forEach((data, index) => validators[index]?.(data));
    const result = await mutate(datasets);
    datasets.forEach((data, index) => validators[index]?.(data));
    const staged = [];
    const committed = [];
    try {
      // Prepare every file before replacing any destination.
      for (let index = 0; index < filePaths.length; index += 1) {
        staged.push(await stage(filePaths[index], JSON.stringify(datasets[index], null, 2) + '\n'));
      }
      for (let index = 0; index < filePaths.length; index += 1) {
        await fs.rename(staged[index], filePaths[index]);
        committed.push(index);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const index of committed.reverse()) {
        try {
          if (snapshots[index].raw === null) {
            await fs.rm(filePaths[index], { force: true });
          } else {
            const restore = await stage(filePaths[index], snapshots[index].raw);
            try {
              await fs.rename(restore, filePaths[index]);
            } finally {
              await fs.rm(restore, { force: true });
            }
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          'Write and rollback failed; inspect the data files.',
        );
      }
      throw error;
    } finally {
      await Promise.all(staged.map((temporaryPath) => fs.rm(temporaryPath, { force: true })));
    }
    return result;
  });
}
function updateJsonArray(filePath, mutate, validate) {
  return updateJsonArrays([filePath], ([data]) => mutate(data), [validate]);
}
module.exports = { readJsonArray, readJsonArrays, updateJsonArray, updateJsonArrays };
