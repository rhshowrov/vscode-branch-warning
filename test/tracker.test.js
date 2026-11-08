'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { GitRepository } = require('../src/git');
const { BranchTracker } = require('../src/tracker');

const rules = { forbiddenBranches: ['staging'], viewOnlyBranches: ['dev', 'main'] };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-warning-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
  git('init', '-b', 'dev');
  git('config', 'user.name', 'Branch Warning Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.logAllRefUpdates', 'true');
  await fs.writeFile(path.join(root, 'common.txt'), 'base\n');
  git('add', '.'); git('commit', '-m', 'initial');
  git('branch', 'main'); git('switch', '-c', 'staging');
  await fs.writeFile(path.join(root, 'staging.txt'), 'staging\n');
  git('add', '.'); git('commit', '-m', 'staging changes'); git('switch', 'dev');
  const repo = await GitRepository.open(root);
  let tracker = new BranchTracker();
  let snapshot;
  async function tick(customRules = rules) {
    snapshot = await repo.snapshot();
    tracker.update(snapshot, customRules);
    return tracker.status(snapshot, customRules);
  }
  await tick();
  return {
    root, git, repo, tick,
    flags: () => tracker.serialize(),
    async restart() { tracker = new BranchTracker(tracker.serialize()); return tick(); },
    async offline(action) { const saved = tracker.serialize(); await action(); tracker = new BranchTracker(saved); return tick(); },
    async edit(file, text) { await fs.writeFile(path.join(root, file), text); git('add', file); git('commit', '-m', `edit ${file}`); },
  };
}

test('pre-existing staging-derived branches are not backfilled', async t => {
  const f = await fixture(t);
  const status = await f.offline(() => f.git('switch', '-c', 'existing', 'staging'));
  assert.equal(status.kind, 'normal');
});

test('checkout -b from staging is detected even after multiple operations between polls', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); f.git('switch', '-c', 'feature/bad');
  const status = await f.tick();
  assert.equal(status.kind, 'flagged'); assert.equal(status.source, 'staging');
});

test('an explicitly named forbidden base is detected without checking out the new branch', async t => {
  const f = await fixture(t);
  f.git('branch', 'feature/bad', 'staging'); await f.tick();
  assert.equal(f.flags()['feature/bad'].source, 'staging');
});

test('non-checkout git branch from current staging is detected', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); await f.tick(); f.git('branch', 'feature/bad'); await f.tick();
  assert.equal(f.flags()['feature/bad'].source, 'staging');
});

test('explicit dev base stays normal even while checked out on staging', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); f.git('switch', '-c', 'feature/good', 'dev');
  assert.equal((await f.tick()).kind, 'normal');
});

test('shared commit tips do not falsely classify a dev-created branch', async t => {
  const f = await fixture(t);
  f.git('branch', '-f', 'staging', 'dev'); await f.tick();
  f.git('switch', '-c', 'feature/good');
  assert.equal((await f.tick()).kind, 'normal');
});

test('ordinary feature parents keep their children normal', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'parent'); f.git('switch', '-c', 'child');
  assert.equal((await f.tick()).kind, 'normal'); assert.deepEqual(f.flags(), {});
});

test('multiple generations inherit permanent flags in one polling batch', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'z-parent', 'staging');
  f.git('switch', '-c', 'm-child'); f.git('switch', '-c', 'a-grandchild');
  assert.equal((await f.tick()).kind, 'flagged');
  assert.equal(Object.keys(f.flags()).length, 3);
});

test('fast-forward merge from staging becomes permanent', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature'); await f.tick(); f.git('merge', 'staging');
  assert.equal((await f.tick()).reason, 'Merged a forbidden branch');
  f.git('reset', '--hard', 'dev'); assert.equal((await f.tick()).kind, 'flagged');
});

test('non-fast-forward merge with a custom message is detected', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature'); await f.edit('feature.txt', 'feature\n'); await f.tick();
  f.git('merge', '--no-ff', 'staging', '-m', 'custom title');
  assert.equal((await f.tick()).kind, 'flagged');
});

test('completed rebase onto staging is detected', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature'); await f.edit('feature.txt', 'feature\n'); await f.tick();
  f.git('rebase', 'staging');
  const status = await f.tick();
  assert.equal(status.kind, 'flagged'); assert.equal(status.reason, 'Rebased onto a forbidden branch');
});

test('child created after a rebase in the same polling batch inherits red', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'parent'); await f.edit('feature.txt', 'feature\n'); await f.tick();
  f.git('rebase', 'staging'); f.git('switch', '-c', 'child');
  assert.equal((await f.tick()).kind, 'flagged');
});

test('rebasing onto dev does not flag a branch', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature', 'main'); await f.edit('feature.txt', 'feature\n');
  f.git('switch', 'dev'); await f.edit('dev.txt', 'dev\n'); f.git('switch', 'feature'); await f.tick();
  f.git('rebase', 'dev'); assert.equal((await f.tick()).kind, 'normal');
});

test('a child created before its parent merges staging stays normal', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'parent'); await f.tick();
  f.git('switch', '-c', 'child'); f.git('switch', 'parent'); f.git('merge', 'staging');
  await f.tick(); assert.ok(f.flags().parent); assert.equal(f.flags().child, undefined);
});

test('a child created before its parent rebases onto staging stays normal', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'parent'); await f.edit('feature.txt', 'feature\n'); await f.tick();
  f.git('switch', '-c', 'child'); f.git('switch', 'parent'); f.git('rebase', 'staging');
  await f.tick(); assert.ok(f.flags().parent); assert.equal(f.flags().child, undefined);
});

test('a non-checkout child after a same-interval staging merge inherits red', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'parent'); await f.tick();
  f.git('merge', 'staging'); f.git('branch', 'child');
  await f.tick(); assert.ok(f.flags().parent); assert.ok(f.flags().child);
});

test('non-checkout creation on stable staging is tracked even after a new commit', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); await f.tick();
  await f.edit('another.txt', 'change\n'); f.git('branch', 'child');
  await f.tick(); assert.equal(f.flags().child.source, 'staging');
});

test('cherry-picking staging commits is intentionally ignored', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature'); await f.tick(); f.git('cherry-pick', 'staging');
  assert.equal((await f.tick()).kind, 'normal');
});

test('flags survive branch switching, rebase to dev and an editor restart', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'bad', 'staging'); await f.tick();
  f.git('rebase', '--onto', 'dev', 'staging', 'bad'); await f.tick();
  f.git('switch', 'dev'); assert.equal((await f.tick()).kind, 'viewOnly');
  f.git('switch', 'bad'); assert.equal((await f.restart()).kind, 'flagged');
});

test('new activity while the editor is closed is not replayed', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'feature'); await f.tick();
  const status = await f.offline(() => f.git('merge', 'staging'));
  assert.equal(status.kind, 'normal');
});

test('rename preserves a permanent warning', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'old', 'staging'); await f.tick(); f.git('branch', '-m', 'renamed');
  assert.equal((await f.tick()).kind, 'flagged');
  assert.equal(f.flags().old, undefined); assert.ok(f.flags().renamed);
});

test('offline rename preserves a previously saved permanent warning', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'old', 'staging'); await f.tick();
  assert.equal((await f.offline(() => f.git('branch', '-m', 'renamed'))).kind, 'flagged');
});

test('branch names and rules are configurable per repository', async t => {
  const f = await fixture(t);
  const custom = { forbiddenBranches: ['qa'], viewOnlyBranches: ['release'] };
  f.git('branch', 'qa', 'staging'); f.git('switch', '-c', 'feature', 'qa');
  assert.equal((await f.tick(custom)).kind, 'flagged');
  f.git('switch', '-c', 'release', 'dev'); assert.equal((await f.tick(custom)).kind, 'viewOnly');
});

test('named remote forbidden refs are recognized', async t => {
  const f = await fixture(t);
  f.git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
  f.git('update-ref', 'refs/remotes/origin/staging', f.git('rev-parse', 'staging')); await f.tick();
  f.git('switch', '-c', 'feature', 'origin/staging');
  assert.equal((await f.tick()).source, 'staging');
});

test('view-only defaults have identical states and staging itself is red', async t => {
  const f = await fixture(t);
  assert.equal((await f.tick()).kind, 'viewOnly');
  f.git('switch', 'main'); assert.equal((await f.tick()).kind, 'viewOnly');
  f.git('switch', 'staging'); assert.equal((await f.tick()).kind, 'forbidden');
});

test('aborted conflicting merges do not permanently flag', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); await f.edit('common.txt', 'staging edit\n');
  f.git('switch', '-c', 'feature', 'dev'); await f.edit('common.txt', 'feature edit\n'); await f.tick();
  assert.throws(() => f.git('merge', 'staging')); await f.tick();
  f.git('merge', '--abort'); assert.equal((await f.tick()).kind, 'normal');
});

test('conflicting merge resolved with a custom commit message is detected', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); await f.edit('common.txt', 'staging edit\n');
  f.git('switch', '-c', 'feature', 'dev'); await f.edit('common.txt', 'feature edit\n'); await f.tick();
  assert.throws(() => f.git('merge', 'staging')); await f.tick();
  await f.edit('common.txt', 'resolved\n');
  assert.equal((await f.tick()).kind, 'flagged');
});

test('aborted rebase does not permanently flag', async t => {
  const f = await fixture(t);
  f.git('switch', 'staging'); await f.edit('common.txt', 'staging edit\n');
  f.git('switch', '-c', 'feature', 'dev'); await f.edit('common.txt', 'feature edit\n'); await f.tick();
  assert.throws(() => f.git('rebase', 'staging')); await f.tick();
  f.git('rebase', '--abort'); assert.equal((await f.tick()).kind, 'normal');
});

test('reflog expiry does not replay old history or clear a saved warning', async t => {
  const f = await fixture(t);
  f.git('switch', '-c', 'bad', 'staging'); await f.tick();
  f.git('reflog', 'expire', '--expire=now', '--all');
  assert.equal((await f.tick()).kind, 'flagged');
});
