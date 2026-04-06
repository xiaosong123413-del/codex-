import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_WIKI_PAGE_TOKENS,
  DEFAULT_KNOWLEDGE_ROOTS,
  KNOWLEDGE_TABLE_DEFINITIONS,
  buildKnowledgeRoots,
} from '../../src/knowledge/config.js';

test('default knowledge roots keep the V1 boundary', () => {
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

test('knowledge schema covers Nodes/Edges/Sources/Mappings/IngestionJobs/Rules', () => {
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

test('AI wiki fixed page tokens exist and match plan values', () => {
  assert.deepEqual(AI_WIKI_PAGE_TOKENS, {
    personalInfoRoot: 'Ne9wwI7T0ie8xJkeDnvc6RR9nuh',
    genericInfoRoot: 'ZKYew0Ny9imYlYkztATcwJRCnVb',
    allPagesIndex: 'N1lzwE6UciGFOIkMH3Fcf66Gnkf',
    timelinePage: 'Dq9rwWauLiLTxbky1bkch3rPnDb',
    maintenanceGuide: 'KpEawjD4ViIvmlkdXP0cAcmGn1c',
    aiIndexRoot: 'E2GfwBUPQiGKKFkVDRsc8wtsnUj',
  });
});

test('Nodes schema includes AI wiki routing metadata fields', () => {
  const nodesTable = KNOWLEDGE_TABLE_DEFINITIONS.find((table) => table.name === 'Nodes');
  const expectField = (id, type) => {
    const field = nodesTable.fields.find((item) => item.id === id);
    assert.ok(field, `Nodes 缺少 ${id}`);
    assert.equal(field.type, type, `Nodes.${id} 类型应为 ${type}`);
  };

  expectField('privacy_scope', 'single_select');
  expectField('source_kind', 'single_select');
  expectField('parent_root_token', 'text');
  expectField('primary_topic', 'text');
  expectField('secondary_topics', 'long_text');
  expectField('is_shortcut', 'checkbox');
  expectField('canonical_node_id', 'text');
});

test('override can extend root config without breaking default recursion boundaries', () => {
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
