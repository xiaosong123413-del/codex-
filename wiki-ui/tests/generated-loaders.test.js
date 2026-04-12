import test from 'node:test';
import assert from 'node:assert/strict';

import { loadTaxonomy } from '../lib/generated/loaders.js';

test('generated loaders read taxonomy from generated directory', async () => {
  const taxonomy = await loadTaxonomy();
  assert.ok(Array.isArray(taxonomy.roots));
});
