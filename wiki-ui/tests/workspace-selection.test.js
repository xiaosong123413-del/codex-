import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWorkspace } from '../lib/workspaces.js';

test('resolveWorkspace falls back to wiki for unknown workspace ids', () => {
  assert.equal(resolveWorkspace('wiki'), 'wiki');
  assert.equal(resolveWorkspace('chat'), 'chat');
  assert.equal(resolveWorkspace('bad-input'), 'wiki');
  assert.equal(resolveWorkspace(undefined), 'wiki');
});
