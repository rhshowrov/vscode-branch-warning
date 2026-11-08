'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { present } = require('../src/presentation');

test('the extra indicator is visible only for view-only, forbidden and permanently flagged branches', () => {
  assert.equal(present({ kind: 'normal', branch: 'feature' }).visible, false);
  assert.equal(present({ kind: 'detached' }).visible, false);
  assert.equal(present({ kind: 'viewOnly', branch: 'dev' }).visible, true);
  assert.equal(present({ kind: 'forbidden', branch: 'staging' }).visible, true);
  assert.equal(present({ kind: 'flagged', branch: 'bad', reason: 'Created from a forbidden branch', source: 'staging' }).visible, true);
  assert.equal(present({ kind: 'normal', branch: 'feature' }).background, undefined);
  assert.equal(present({ kind: 'flagged', branch: 'bad', reason: 'Created from a forbidden branch', source: 'staging' }).background, 'statusBarItem.errorBackground');
  assert.equal(present({ kind: 'viewOnly', branch: 'dev' }).background, 'statusBarItem.warningBackground');
});

test('view-only and permanent warning tooltips explain intent without implying enforcement', () => {
  assert.match(present({ kind: 'viewOnly', branch: 'main' }).tooltip, /Git actions remain available/);
  const bad = present({ kind: 'flagged', branch: 'bad', reason: 'Created from a forbidden branch', source: 'staging' });
  assert.match(bad.tooltip, /stays flagged permanently/);
  assert.match(bad.tooltip, /staging/);
  assert.match(bad.label, /permanently flagged/);
});
