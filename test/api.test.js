const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let directory, server, base;

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veelion-test-'));
  process.env.DATA_DIRECTORY = directory;
  const app = require('../src/app');
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
async function request(url, method = 'GET', body) {
  const response = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

test('task CRUD trims input, supports one-character titles, and protects server fields', async () => {
  const created = await request('/tasks', 'POST', { title: ' A ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.title, 'A');
  const id = created.body.data.id;
  assert.equal((await request('/tasks/' + id)).status, 200);
  assert.equal((await request('/tasks/' + id, 'PATCH', { title: ' B ' })).body.data.title, 'B');
  assert.equal(
    (await request('/tasks/' + id, 'PATCH', { completed: true, id: 'hijacked' })).status,
    400,
  );
  assert.equal((await request('/tasks/' + id)).body.data.id, id);
  assert.equal((await request('/tasks/' + id, 'PATCH', {})).status, 400);
  assert.equal((await request('/tasks', 'POST', { title: ' ' })).status, 400);
  assert.equal((await request('/tasks', 'POST', { title: 'x', completed: 'true' })).status, 400);
  assert.equal((await request('/tasks/' + id, 'DELETE')).status, 204);
  assert.equal((await request('/tasks/' + id)).status, 404);
  assert.equal((await request('/tasks/missing', 'PATCH', { completed: true })).status, 404);
  assert.equal((await request('/tasks', 'POST', { title: 'after failure' })).status, 201);
});

test('concurrent task creates and updates preserve all records', async () => {
  const created = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      request('/tasks', 'POST', { title: 'Concurrent ' + index }),
    ),
  );
  assert.ok(created.every((entry) => entry.status === 201));
  await Promise.all(
    created.map((entry) => request('/tasks/' + entry.body.data.id, 'PATCH', { completed: true })),
  );
  const tasks = (await request('/tasks')).body.data;
  for (const entry of created)
    assert.equal(tasks.find((task) => task.id === entry.body.data.id).completed, true);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
});

test('activity validates optional fields and persists concurrent entries with unique IDs', async () => {
  const previousCount = (await request('/activity')).body.length;
  for (const body of [{ action: 42 }, { info: {} }, [], { id: 'bad' }]) {
    assert.equal((await request('/activity', 'POST', body)).status, 400);
  }
  assert.equal((await request('/activity', 'POST', {})).status, 201);
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      request('/activity', 'POST', { action: ' Updated ', info: ' Task ' }),
    ),
  );
  assert.ok(results.every((entry) => entry.status === 201 && entry.body.action === 'Updated'));
  const logs = (await request('/activity')).body;
  assert.equal(logs.length, previousCount + 16);
  assert.equal(new Set(logs.map((item) => item.id)).size, logs.length);
});

test('malformed JSON and missing routes return useful HTTP errors', async () => {
  const response = await fetch(base + '/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, 'Body must contain valid JSON.');
  assert.equal((await request('/unknown')).status, 404);
});

test('reports aggregate both persisted datasets', async () => {
  const summary = (await request('/reports/tasks-summary')).body;
  const tasks = (await request('/tasks')).body.data;
  assert.equal(summary.total, tasks.length);
  assert.equal(summary.byStatus.done, 20);
  assert.equal(summary.byStatus.todo, 1);
  assert.equal(summary.byStatus['in-progress'], 0);
  assert.equal(summary.recentActivityCount, (await request('/activity')).body.length);
});

test('task lifecycle records meaningful events and keeps report counts in sync', async () => {
  const baseline = (await request('/reports/tasks-summary')).body;
  const created = (await request('/tasks', 'POST', { title: 'Lifecycle task' })).body.data;
  const summary = async () => (await request('/reports/tasks-summary')).body;
  assert.equal((await summary()).total, baseline.total + 1);
  assert.equal((await summary()).recentActivityCount, baseline.recentActivityCount + 1);
  await request('/tasks/' + created.id, 'PATCH', { title: 'Renamed task' });
  await request('/tasks/' + created.id, 'PATCH', { completed: true });
  assert.equal((await summary()).byStatus.done, baseline.byStatus.done + 1);
  await request('/tasks/' + created.id, 'PATCH', { completed: false });
  const beforeNoop = (await request('/tasks/' + created.id)).body.data;
  await request('/tasks/' + created.id, 'PATCH', { completed: false, title: 'Renamed task' });
  assert.equal((await request('/tasks/' + created.id)).body.data.updatedAt, beforeNoop.updatedAt);
  assert.equal((await request('/tasks/' + created.id, 'PATCH', { title: '' })).status, 400);
  await request('/tasks/' + created.id, 'DELETE');
  const logs = (await request('/activity')).body.filter((entry) => entry.taskId === created.id);
  assert.deepEqual(
    logs.map((entry) => entry.action),
    ['Task created', 'Task renamed', 'Task completed', 'Task reopened', 'Task deleted'],
  );
  assert.ok(logs[1].info.includes('Lifecycle task') && logs[1].info.includes('Renamed task'));
  assert.ok(logs[4].info.includes('Renamed task'));
  const final = await summary();
  assert.equal(final.total, baseline.total);
  assert.deepEqual(final.byStatus, baseline.byStatus);
  assert.equal(final.recentActivityCount, baseline.recentActivityCount + 5);
});

test('a failed activity commit rolls back the task and later mutations still succeed', async (context) => {
  const { createTask, deleteTask } = require('../src/modules/tasks/services/tasks.service');
  const taskFile = path.join(directory, 'tasks.json');
  const activityFile = path.join(directory, 'activity.json');
  const beforeTasks = await fs.readFile(taskFile, 'utf8');
  const beforeActivity = await fs.readFile(activityFile, 'utf8');
  const rename = fs.rename;
  const mock = context.mock.method(fs, 'rename', async (from, to) => {
    if (to === activityFile) throw new Error('Simulated activity write failure');
    return rename(from, to);
  });
  try {
    await assert.rejects(
      createTask({ title: 'Must not persist' }),
      /Simulated activity write failure/,
    );
  } finally {
    mock.mock.restore();
  }
  assert.equal(await fs.readFile(taskFile, 'utf8'), beforeTasks);
  assert.equal(await fs.readFile(activityFile, 'utf8'), beforeActivity);
  assert.ok((await fs.readdir(directory)).every((name) => !name.endsWith('.tmp')));
  const task = await createTask({ title: 'Recovered' });
  await deleteTask(task.id);
});

test('report reads wait for the complete task and activity commit', async (context) => {
  const { createTask, deleteTask } = require('../src/modules/tasks/services/tasks.service');
  const { getTasksSummary } = require('../src/modules/reports/services/reports.service');
  const baseline = await getTasksSummary();
  let release, markStaged;
  const staged = new Promise((resolve) => {
    markStaged = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const rename = fs.rename;
  const mock = context.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(directory, 'activity.json')) {
      markStaged();
      await gate;
    }
    return rename(from, to);
  });
  const mutation = createTask({ title: 'Consistent report' });
  await staged;
  let readFinished = false;
  const report = getTasksSummary().then((value) => {
    readFinished = true;
    return value;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readFinished, false);
  } finally {
    release();
    mock.mock.restore();
  }
  const created = await mutation;
  const result = await report;
  assert.equal(result.total, baseline.total + 1);
  assert.equal(result.recentActivityCount, baseline.recentActivityCount + 1);
  await deleteTask(created.id);
});

test('reports include the seven-day boundary and exclude future timestamps', () => {
  const { summarizeTasks } = require('../src/modules/reports/services/reports.service');
  const now = Date.parse('2026-09-21T12:00:00Z');
  const cutoff = now - 7 * 86400000;
  const activities = [now, cutoff, cutoff - 1, now + 1].map((time, index) => ({
    id: String(index),
    when: new Date(time).toISOString(),
  }));
  assert.equal(summarizeTasks([], activities, now).recentActivityCount, 2);
  assert.deepEqual(summarizeTasks([], [], now), {
    total: 0,
    byStatus: { todo: 0, 'in-progress': 0, done: 0 },
    recentActivityCount: 0,
  });
});

test('stored record validation rejects malformed records without changing either dataset', async (context) => {
  const { TASKS_FILE_PATH, ACTIVITY_FILE_PATH } = require('../src/config');
  const { getAllTasks, createTask } = require('../src/modules/tasks/services/tasks.service');
  const {
    getAllActivity,
    createNewActivity,
  } = require('../src/modules/activity/services/activity.service');
  const { getTasksSummary } = require('../src/modules/reports/services/reports.service');
  const taskRaw = await fs.readFile(TASKS_FILE_PATH, 'utf8');
  const activityRaw = await fs.readFile(ACTIVITY_FILE_PATH, 'utf8');
  const task = JSON.parse(taskRaw)[0];
  const activity = JSON.parse(activityRaw)[0];
  context.mock.method(console, 'error', () => {});
  try {
    for (const invalid of [
      null,
      { ...task, completed: 'false' },
      { ...task, title: '' },
      { ...task, createdAt: 'invalid' },
      { ...task, updatedAt: null },
      { ...task, id: '' },
    ]) {
      const raw = JSON.stringify([invalid]);
      await fs.writeFile(TASKS_FILE_PATH, raw);
      await assert.rejects(getAllTasks(), /Invalid stored task/);
      await assert.rejects(getTasksSummary(), /Invalid stored task/);
      await assert.rejects(createTask({ title: 'Must not write' }), /Invalid stored task/);
      assert.equal((await request('/tasks')).status, 500);
      assert.equal(await fs.readFile(TASKS_FILE_PATH, 'utf8'), raw);
      assert.equal(await fs.readFile(ACTIVITY_FILE_PATH, 'utf8'), activityRaw);
    }
    await fs.writeFile(TASKS_FILE_PATH, JSON.stringify([task, task]));
    await assert.rejects(getAllTasks(), /Invalid stored task/);
    await fs.writeFile(TASKS_FILE_PATH, taskRaw);
    for (const invalid of [
      null,
      { ...activity, when: 'invalid' },
      { ...activity, info: {} },
      { ...activity, action: false },
      { ...activity, taskId: 42 },
      { ...activity, id: '' },
    ]) {
      const raw = JSON.stringify([invalid]);
      await fs.writeFile(ACTIVITY_FILE_PATH, raw);
      await assert.rejects(getAllActivity(), /Invalid stored activity/);
      await assert.rejects(getTasksSummary(), /Invalid stored activity/);
      await assert.rejects(createNewActivity({}), /Invalid stored activity/);
      await assert.rejects(createTask({ title: 'Must not write' }), /Invalid stored activity/);
      assert.equal((await request('/reports/tasks-summary')).status, 500);
      assert.equal(await fs.readFile(ACTIVITY_FILE_PATH, 'utf8'), raw);
      assert.equal(await fs.readFile(TASKS_FILE_PATH, 'utf8'), taskRaw);
    }
    await fs.writeFile(ACTIVITY_FILE_PATH, JSON.stringify([activity, activity]));
    await assert.rejects(getAllActivity(), /Invalid stored activity/);
  } finally {
    await fs.writeFile(TASKS_FILE_PATH, taskRaw);
    await fs.writeFile(ACTIVITY_FILE_PATH, activityRaw);
  }
  assert.equal((await request('/reports/tasks-summary')).status, 200);
});

test('task list order is newest first with stable ID ties and is unchanged by renaming', async () => {
  const { TASKS_FILE_PATH, ACTIVITY_FILE_PATH } = require('../src/config');
  const taskRaw = await fs.readFile(TASKS_FILE_PATH, 'utf8');
  const activityRaw = await fs.readFile(ACTIVITY_FILE_PATH, 'utf8');
  const task = (id, createdAt) => ({
    id,
    title: id,
    createdAt,
    updatedAt: createdAt,
    completed: false,
  });
  try {
    await fs.writeFile(
      TASKS_FILE_PATH,
      JSON.stringify([
        task('old', '2020-01-01T00:00:00Z'),
        task('b', '2021-01-01T00:00:00Z'),
        task('a', '2021-01-01T00:00:00Z'),
      ]),
    );
    assert.deepEqual(
      (await request('/tasks')).body.data.map((item) => item.id),
      ['a', 'b', 'old'],
    );
    await request('/tasks/old', 'PATCH', { title: 'Renamed older task' });
    assert.deepEqual(
      (await request('/tasks')).body.data.map((item) => item.id),
      ['a', 'b', 'old'],
    );
  } finally {
    await fs.writeFile(TASKS_FILE_PATH, taskRaw);
    await fs.writeFile(ACTIVITY_FILE_PATH, activityRaw);
  }
});

test('storage rejects invalid mutation output before committing', async () => {
  const { updateJsonArray } = require('../src/utils/jsonStore');
  const { validateStoredTasks } = require('../src/utils/storedRecords');
  const file = path.join(directory, 'validated.json');
  await fs.writeFile(file, '[]');
  await assert.rejects(
    updateJsonArray(file, (items) => items.push(null), validateStoredTasks),
    /Invalid stored task/,
  );
  assert.equal(await fs.readFile(file, 'utf8'), '[]');
});

test('storage rejects corruption, recovers after failures, and leaves no temporary files', async () => {
  const { readJsonArray, updateJsonArray } = require('../src/utils/jsonStore');
  const file = path.join(directory, 'storage.json');
  for (const content of ['', '{}', '{']) {
    await fs.writeFile(file, content);
    await assert.rejects(updateJsonArray(file, (items) => items.push('lost')));
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
  await fs.writeFile(file, '[]');
  await assert.rejects(
    updateJsonArray(file, () => {
      throw new Error('failed mutation');
    }),
  );
  await updateJsonArray(file, (items) => items.push('recovered'));
  assert.deepEqual(await readJsonArray(file), ['recovered']);
  const blocked = path.join(directory, 'blocked.json');
  await fs.mkdir(blocked);
  await assert.rejects(updateJsonArray(blocked, (items) => items.push('x')));
  const replacement = path.join(directory, 'replacement.json');
  await assert.rejects(
    updateJsonArray(replacement, async (items) => {
      items.push('cannot replace a directory');
      await fs.mkdir(replacement);
    }),
  );
  await fs.rmdir(replacement);
  await updateJsonArray(replacement, (items) => items.push('write recovered'));
  assert.deepEqual(await readJsonArray(replacement), ['write recovered']);
  assert.ok((await fs.readdir(directory)).every((name) => !name.endsWith('.tmp')));
});

test('all three task statuses persist, log transitions, and update report groups', async () => {
  const baseline = (await request('/reports/tasks-summary')).body;
  const statuses = ['pending', 'in-progress', 'completed'];
  const keys = { pending: 'todo', 'in-progress': 'in-progress', completed: 'done' };
  const created = [];
  try {
    for (const status of statuses) {
      const result = await request('/tasks', 'POST', { title: 'Status ' + status, status });
      assert.equal(result.status, 201);
      created.push(result.body.data);
      assert.equal(result.body.data.status, status);
      assert.equal(result.body.data.completed, status === 'completed');
    }
    const summary = (await request('/reports/tasks-summary')).body;
    for (const key of Object.values(keys))
      assert.equal(summary.byStatus[key], baseline.byStatus[key] + 1);
    assert.equal(summary.total, baseline.total + 3);
    for (const item of created) {
      let previous = item.status;
      for (const status of statuses) {
        const beforeLogs = (await request('/activity')).body.length;
        const result = await request('/tasks/' + item.id, 'PATCH', { status });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.status, status);
        assert.equal(result.body.data.completed, status === 'completed');
        assert.equal((await request('/tasks/' + item.id)).body.data.status, status);
        const logs = (await request('/activity')).body;
        assert.equal(logs.length, beforeLogs + (previous === status ? 0 : 1));
        if (previous !== status)
          assert.ok(logs.at(-1).info.endsWith('as ' + status.replace('-', ' ') + '.'));
        previous = status;
      }
    }
    const progress = await request('/tasks/' + created[0].id, 'PATCH', { status: 'in-progress' });
    const renamed = await request('/tasks/' + created[0].id, 'PATCH', { title: 'Still underway' });
    assert.equal(renamed.body.data.status, progress.body.data.status);
    assert.equal(renamed.body.data.completed, false);
    const final = (await request('/reports/tasks-summary')).body;
    assert.equal(final.byStatus['in-progress'], baseline.byStatus['in-progress'] + 1);
    assert.equal(final.byStatus.done, baseline.byStatus.done + 2);
    assert.equal(final.byStatus.todo, baseline.byStatus.todo);
  } finally {
    for (const item of created) await request('/tasks/' + item.id, 'DELETE');
  }
});

test('status validation rejects invalid/conflicting input and supports legacy completed requests', async () => {
  const created = (await request('/tasks', 'POST', { title: 'Compatibility' })).body.data;
  assert.equal(created.status, 'pending');
  try {
    for (const status of ['', null, 1, {}, 'done', 'in progress']) {
      assert.equal((await request('/tasks', 'POST', { title: 'Invalid', status })).status, 400);
      assert.equal((await request('/tasks/' + created.id, 'PATCH', { status })).status, 400);
    }
    for (const body of [
      { status: 'pending', completed: true },
      { status: 'in-progress', completed: true },
      { status: 'completed', completed: false },
    ]) {
      assert.equal((await request('/tasks', 'POST', { title: 'Invalid', ...body })).status, 400);
      assert.equal((await request('/tasks/' + created.id, 'PATCH', body)).status, 400);
    }
    assert.equal(
      (await request('/tasks/' + created.id, 'PATCH', { status: 'in-progress', completed: false }))
        .status,
      200,
    );
    assert.equal(
      (await request('/tasks/' + created.id, 'PATCH', { completed: true })).body.data.status,
      'completed',
    );
    assert.equal(
      (await request('/tasks/' + created.id, 'PATCH', { completed: false })).body.data.status,
      'pending',
    );
  } finally {
    await request('/tasks/' + created.id, 'DELETE');
  }
});

test('legacy stored tasks are normalized on read without rewriting files; inconsistent status is rejected', async () => {
  const { TASKS_FILE_PATH } = require('../src/config');
  const { getAllTasks } = require('../src/modules/tasks/services/tasks.service');
  const original = await fs.readFile(TASKS_FILE_PATH, 'utf8');
  const date = '2026-01-01T00:00:00Z';
  const legacy = [false, true].map((completed, index) => ({
    id: String(index),
    title: 'Legacy',
    completed,
    createdAt: date,
    updatedAt: date,
  }));
  try {
    const raw = JSON.stringify(legacy);
    await fs.writeFile(TASKS_FILE_PATH, raw);
    const tasks = await getAllTasks();
    assert.deepEqual(
      tasks.map((task) => task.status),
      ['pending', 'completed'],
    );
    assert.equal(await fs.readFile(TASKS_FILE_PATH, 'utf8'), raw);
    for (const status of ['unknown', 'completed', null]) {
      await fs.writeFile(TASKS_FILE_PATH, JSON.stringify([{ ...legacy[0], status }]));
      await assert.rejects(getAllTasks(), /Invalid stored task/);
    }
  } finally {
    await fs.writeFile(TASKS_FILE_PATH, original);
  }
});
