const ROOT_DEFINITIONS = [
  {
    key: 'apta',
    label: 'Area/Project/Task/Action',
    role: 'context',
    recursive: false,
    wikiToken: 'EH0OwCt6YizIjnkpOe1cWPCHnqd',
  },
  {
    key: 'resource',
    label: 'Resource',
    role: 'ingest',
    recursive: true,
    wikiToken: 'GuuSw88cTi2b5Qkox9kce0bPnoc',
  },
  {
    key: 'archive',
    label: 'Archive',
    role: 'ingest',
    recursive: true,
    wikiToken: 'KVgGwSi37iy75wkxog5ci3QYnmb',
  },
];

const TEXT_FIELD = 'text';
const SINGLE_SELECT_FIELD = 'single_select';
const NUMBER_FIELD = 'number';
const CHECKBOX_FIELD = 'checkbox';
const URL_FIELD = 'url';
const DATETIME_FIELD = 'datetime';
const LONG_TEXT_FIELD = 'long_text';

export const DEFAULT_KNOWLEDGE_ROOTS = ROOT_DEFINITIONS.map((item) => ({ ...item }));

export const KNOWLEDGE_TABLE_DEFINITIONS = [
  {
    name: 'Nodes',
    fields: [
      { id: 'node_id', name: 'node_id', type: TEXT_FIELD },
      { id: 'node_token', name: 'node_token', type: TEXT_FIELD },
      { id: 'kind', name: 'kind', type: SINGLE_SELECT_FIELD },
      { id: 'library', name: 'library', type: SINGLE_SELECT_FIELD },
      { id: 'title', name: 'title', type: TEXT_FIELD },
      { id: 'root_key', name: 'root_key', type: SINGLE_SELECT_FIELD },
      { id: 'obj_token', name: 'obj_token', type: TEXT_FIELD },
      { id: 'obj_type', name: 'obj_type', type: TEXT_FIELD },
      { id: 'parent_node_id', name: 'parent_node_id', type: TEXT_FIELD },
      { id: 'block_id', name: 'block_id', type: TEXT_FIELD },
      { id: 'source_url', name: 'source_url', type: URL_FIELD },
      { id: 'raw_text', name: 'raw_text', type: LONG_TEXT_FIELD },
      { id: 'updated_at', name: 'updated_at', type: DATETIME_FIELD },
    ],
  },
  {
    name: 'Edges',
    fields: [
      { id: 'edge_id', name: 'edge_id', type: TEXT_FIELD },
      { id: 'source_node_id', name: 'source_node_id', type: TEXT_FIELD },
      { id: 'target_node_id', name: 'target_node_id', type: TEXT_FIELD },
      { id: 'type', name: 'type', type: SINGLE_SELECT_FIELD },
      { id: 'confidence', name: 'confidence', type: NUMBER_FIELD },
      { id: 'source_library', name: 'source_library', type: SINGLE_SELECT_FIELD },
      { id: 'target_library', name: 'target_library', type: SINGLE_SELECT_FIELD },
      { id: 'created_by', name: 'created_by', type: SINGLE_SELECT_FIELD },
      { id: 'evidence', name: 'evidence', type: LONG_TEXT_FIELD },
      { id: 'created_at', name: 'created_at', type: DATETIME_FIELD },
    ],
  },
  {
    name: 'Sources',
    fields: [
      { id: 'source_id', name: 'source_id', type: TEXT_FIELD },
      { id: 'source_type', name: 'source_type', type: SINGLE_SELECT_FIELD },
      { id: 'source_key', name: 'source_key', type: TEXT_FIELD },
      { id: 'evidence', name: 'evidence', type: LONG_TEXT_FIELD },
      { id: 'node_id', name: 'node_id', type: TEXT_FIELD },
      { id: 'block_id', name: 'block_id', type: TEXT_FIELD },
      { id: 'url', name: 'url', type: URL_FIELD },
      { id: 'created_at', name: 'created_at', type: DATETIME_FIELD },
    ],
  },
  {
    name: 'Mappings',
    fields: [
      { id: 'mapping_id', name: 'mapping_id', type: TEXT_FIELD },
      { id: 'personal_node_id', name: 'personal_node_id', type: TEXT_FIELD },
      { id: 'ai_node_id', name: 'ai_node_id', type: TEXT_FIELD },
      { id: 'direction', name: 'direction', type: SINGLE_SELECT_FIELD },
      { id: 'status', name: 'status', type: SINGLE_SELECT_FIELD },
      { id: 'created_at', name: 'created_at', type: DATETIME_FIELD },
    ],
  },
  {
    name: 'IngestionJobs',
    fields: [
      { id: 'job_id', name: 'job_id', type: TEXT_FIELD },
      { id: 'job_type', name: 'job_type', type: SINGLE_SELECT_FIELD },
      { id: 'status', name: 'status', type: SINGLE_SELECT_FIELD },
      { id: 'root_key', name: 'root_key', type: SINGLE_SELECT_FIELD },
      { id: 'target_node_token', name: 'target_node_token', type: TEXT_FIELD },
      { id: 'message', name: 'message', type: LONG_TEXT_FIELD },
      { id: 'started_at', name: 'started_at', type: DATETIME_FIELD },
      { id: 'finished_at', name: 'finished_at', type: DATETIME_FIELD },
    ],
  },
  {
    name: 'Rules',
    fields: [
      { id: 'rule_id', name: 'rule_id', type: TEXT_FIELD },
      { id: 'rule_type', name: 'rule_type', type: SINGLE_SELECT_FIELD },
      { id: 'rule_key', name: 'rule_key', type: TEXT_FIELD },
      { id: 'enabled', name: 'enabled', type: CHECKBOX_FIELD },
      { id: 'scope', name: 'scope', type: LONG_TEXT_FIELD },
      { id: 'notes', name: 'notes', type: LONG_TEXT_FIELD },
      { id: 'updated_at', name: 'updated_at', type: DATETIME_FIELD },
    ],
  },
];

export function buildKnowledgeRoots(overrides = {}) {
  return DEFAULT_KNOWLEDGE_ROOTS.map((item) => ({
    ...item,
    ...(overrides[item.key] ?? {}),
  }));
}
