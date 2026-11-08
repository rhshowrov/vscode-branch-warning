'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { FlagStore } = require('../src/storage');

test('durable flags survive a fresh store instance and stay isolated by repository', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-warning-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FlagStore(path.join(directory, 'extension-data'));
  assert.deepEqual(await store.load('repo-a'), {});
  const flags = { feature: { reason: 'Created from a forbidden branch', source: 'staging' } };
  await store.save('repo-a', flags);
  const restarted = new FlagStore(path.join(directory, 'extension-data'));
  assert.deepEqual(await restarted.load('repo-a'), flags);
  assert.deepEqual(await restarted.load('repo-b'), {});
  await restarted.save('repo-a', flags);
  assert.deepEqual(await fs.readdir(path.join(directory, 'extension-data')), ['repo-a.json']);
});

test('invalid saved state is reported instead of silently discarding permanent warnings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-warning-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'repo.json'), '{broken');
  await assert.rejects(new FlagStore(directory).load('repo'), SyntaxError);
  assert.equal(await fs.readFile(path.join(directory, 'repo.json'), 'utf8'), '{broken');
});

test('a publisher rename imports existing warnings without changing the old profile', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-warning-upgrade-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const old = new FlagStore(path.join(directory, 'previous-publisher.branch-warning'));
  const flags = { feature: { reason: 'Created from a forbidden branch', source: 'staging' } };
  await old.save('repo-a', flags);
  const unrelated = new FlagStore(path.join(directory, 'unrelated.extension'));
  await unrelated.save('repo-b', flags);
  const current = new FlagStore(path.join(directory, 'branch-warning-local.branch-warning'));
  assert.deepEqual(await current.load('repo-a'), flags);
  assert.deepEqual(await old.load('repo-a'), flags);
  assert.deepEqual(await current.load('repo-b'), {});
  await current.save('repo-a', {});
  assert.deepEqual(await current.load('repo-a'), {}, 'An existing current record is never replaced by stale legacy warnings');
});
