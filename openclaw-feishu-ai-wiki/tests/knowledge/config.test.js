import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { getDeploymentConfigSummary } from '../../src/knowledge/config.js';

test('默认配置路径跟随独立包目录，而不是当前 shell 目录', () => {
  const summary = getDeploymentConfigSummary();

  assert.equal(path.basename(summary.configPath), 'wiki.config.json');
  assert.equal(path.basename(path.dirname(summary.configPath)), 'config');
  assert.equal(path.basename(summary.packageRoot), 'openclaw-feishu-ai-wiki');
  assert.equal(
    path.normalize(summary.configPath),
    path.normalize(path.join(summary.packageRoot, 'config', 'wiki.config.json'))
  );
});
