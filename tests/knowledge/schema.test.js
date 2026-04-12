import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_KNOWLEDGE_ROOTS,
  KNOWLEDGE_TABLE_DEFINITIONS,
  buildKnowledgeRoots,
} from '../../src/knowledge/config.js';

test('知识系统默认根节点满足 V1 边界', () => {
  assert.equal(DEFAULT_KNOWLEDGE_ROOTS.length, 3);

  const summary = DEFAULT_KNOWLEDGE_ROOTS.map((item) => ({
    key: item.key,
    recursive: item.recursive,
    role: item.role,
  }));

  assert.deepEqual(summary, [
    { key: 'apta', recursive: false, role: 'context' },
    { key: 'resource', recursive: true, role: 'ingest' },
    { key: 'archive', recursive: true, role: 'ingest' },
  ]);
});

test('知识系统 schema 覆盖 Nodes/Edges/Sources/Mappings/IngestionJobs/Rules 六张表', () => {
  const tableNames = KNOWLEDGE_TABLE_DEFINITIONS.map((table) => table.name);

  assert.deepEqual(tableNames, [
    'Nodes',
    'Edges',
    'Sources',
    'Mappings',
    'IngestionJobs',
    'Rules',
  ]);

  const requiredFields = {
    Nodes: ['node_id', 'node_token', 'kind', 'library', 'title'],
    Edges: ['edge_id', 'source_node_id', 'target_node_id', 'type', 'confidence'],
    Sources: ['source_id', 'source_type', 'source_key', 'evidence'],
    Mappings: ['mapping_id', 'personal_node_id', 'ai_node_id', 'direction'],
    IngestionJobs: ['job_id', 'job_type', 'status', 'root_key'],
    Rules: ['rule_id', 'rule_type', 'rule_key', 'enabled'],
  };

  for (const table of KNOWLEDGE_TABLE_DEFINITIONS) {
    const fieldIds = table.fields.map((field) => field.id);
    assert.deepEqual(
      fieldIds.slice(0, requiredFields[table.name].length),
      requiredFields[table.name],
      `${table.name} 缺少 V1 必需字段`
    );
  }
});

test('允许用 override 扩展根节点配置而不破坏默认递归边界', () => {
  const roots = buildKnowledgeRoots({
    apta: { recursive: true },
    archive: { label: 'Archive Root' },
  });

  const apta = roots.find((item) => item.key === 'apta');
  const archive = roots.find((item) => item.key === 'archive');
  const resource = roots.find((item) => item.key === 'resource');

  assert.equal(apta.recursive, true);
  assert.equal(archive.label, 'Archive Root');
  assert.equal(resource.recursive, true);
});
