import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), process.env.AI_WIKI_CONFIG_PATH || 'config/wiki.config.json');

function readJsonConfig(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

const DEPLOYMENT_CONFIG = readJsonConfig(DEFAULT_CONFIG_PATH);

function fromEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function configValue(paths, envName, fallback = '') {
  let current = DEPLOYMENT_CONFIG;
  for (const key of paths) {
    current = current?.[key];
  }
  return fromEnv(envName, typeof current === 'string' && current.trim() ? current.trim() : fallback);
}

function configNumber(paths, envName, fallback = 1) {
  const envValue = process.env[envName];
  if (envValue != null && envValue !== '') {
    const parsed = Number(envValue);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  let current = DEPLOYMENT_CONFIG;
  for (const key of paths) {
    current = current?.[key];
  }
  return Number.isFinite(Number(current)) ? Number(current) : fallback;
}

const ROOT_DEFINITIONS = [
  {
    key: 'apta',
    label: 'Area/Project/Task/Action',
    role: 'context',
    recursive: false,
    wikiToken: configValue(['knowledgeRoots', 'apta', 'wikiToken'], 'AI_WIKI_ROOT_APTA', 'wiki_apta_root'),
  },
  {
    key: 'resource',
    label: 'Resource',
    role: 'ingest',
    recursive: true,
    wikiToken: configValue(['knowledgeRoots', 'resource', 'wikiToken'], 'AI_WIKI_ROOT_RESOURCE', 'wiki_resource_root'),
  },
  {
    key: 'archive',
    label: 'Archive',
    role: 'ingest',
    recursive: true,
    wikiToken: configValue(['knowledgeRoots', 'archive', 'wikiToken'], 'AI_WIKI_ROOT_ARCHIVE', 'wiki_archive_root'),
  },
];

const TEXT_FIELD = 'text';
const SINGLE_SELECT_FIELD = 'single_select';
const NUMBER_FIELD = 'number';
const CHECKBOX_FIELD = 'checkbox';
const URL_FIELD = 'url';
const DATETIME_FIELD = 'datetime';
const LONG_TEXT_FIELD = 'long_text';

function field(id, type) {
  return { id, name: id, type };
}

export const AI_WIKI_PAGE_TOKENS = Object.freeze({
  personalInfoRoot: configValue(['aiWiki', 'personalInfoRoot'], 'AI_WIKI_PAGE_PERSONAL', 'wiki_personal_root'),
  genericInfoRoot: configValue(['aiWiki', 'genericInfoRoot'], 'AI_WIKI_PAGE_GENERIC', 'wiki_generic_root'),
  allPagesIndex: configValue(['aiWiki', 'allPagesIndex'], 'AI_WIKI_PAGE_ALL_PAGES', 'wiki_all_pages_index'),
  timelinePage: configValue(['aiWiki', 'timelinePage'], 'AI_WIKI_PAGE_TIMELINE', 'wiki_timeline_page'),
  maintenanceGuide: configValue(['aiWiki', 'maintenanceGuide'], 'AI_WIKI_PAGE_MAINTENANCE_GUIDE', 'wiki_maintenance_guide'),
  aiIndexRoot: configValue(['aiWiki', 'aiIndexRoot'], 'AI_WIKI_PAGE_INDEX_ROOT', 'wiki_ai_index_root'),
});

export const JOURNAL_INPUT_RULE = Object.freeze({
  resourceRootKey: 'resource',
  journalMemoryRootToken: configValue(['journalInput', 'journalMemoryRootToken'], 'AI_WIKI_JOURNAL_MEMORY_ROOT', 'wiki_journal_memory_root'),
  journalEntryDepthFromMemoryRoot: configNumber(['journalInput', 'journalEntryDepthFromMemoryRoot'], 'AI_WIKI_JOURNAL_ENTRY_DEPTH', 1),
});

export const DEFAULT_KNOWLEDGE_ROOTS = ROOT_DEFINITIONS.map((item) => ({ ...item }));

export const KNOWLEDGE_TABLE_DEFINITIONS = [
  {
    name: 'Nodes',
    fields: [
      field('node_id', TEXT_FIELD),
      field('node_token', TEXT_FIELD),
      field('kind', SINGLE_SELECT_FIELD),
      field('library', SINGLE_SELECT_FIELD),
      field('title', TEXT_FIELD),
      field('root_key', SINGLE_SELECT_FIELD),
      field('privacy_scope', SINGLE_SELECT_FIELD),
      field('source_kind', SINGLE_SELECT_FIELD),
      field('parent_root_token', TEXT_FIELD),
      field('primary_topic', TEXT_FIELD),
      field('secondary_topics', LONG_TEXT_FIELD),
      field('is_shortcut', CHECKBOX_FIELD),
      field('canonical_node_id', TEXT_FIELD),
      field('obj_token', TEXT_FIELD),
      field('obj_type', TEXT_FIELD),
      field('parent_node_id', TEXT_FIELD),
      field('block_id', TEXT_FIELD),
      field('source_url', URL_FIELD),
      field('raw_text', LONG_TEXT_FIELD),
      field('updated_at', DATETIME_FIELD),
    ],
  },
  {
    name: 'Edges',
    fields: [
      field('edge_id', TEXT_FIELD),
      field('source_node_id', TEXT_FIELD),
      field('target_node_id', TEXT_FIELD),
      field('type', SINGLE_SELECT_FIELD),
      field('confidence', NUMBER_FIELD),
      field('source_library', SINGLE_SELECT_FIELD),
      field('target_library', SINGLE_SELECT_FIELD),
      field('created_by', SINGLE_SELECT_FIELD),
      field('evidence', LONG_TEXT_FIELD),
      field('created_at', DATETIME_FIELD),
    ],
  },
  {
    name: 'Sources',
    fields: [
      field('source_id', TEXT_FIELD),
      field('source_type', SINGLE_SELECT_FIELD),
      field('source_key', TEXT_FIELD),
      field('evidence', LONG_TEXT_FIELD),
      field('node_id', TEXT_FIELD),
      field('block_id', TEXT_FIELD),
      field('url', URL_FIELD),
      field('created_at', DATETIME_FIELD),
    ],
  },
  {
    name: 'Mappings',
    fields: [
      field('mapping_id', TEXT_FIELD),
      field('personal_node_id', TEXT_FIELD),
      field('ai_node_id', TEXT_FIELD),
      field('direction', SINGLE_SELECT_FIELD),
      field('status', SINGLE_SELECT_FIELD),
      field('created_at', DATETIME_FIELD),
    ],
  },
  {
    name: 'IngestionJobs',
    fields: [
      field('job_id', TEXT_FIELD),
      field('job_type', SINGLE_SELECT_FIELD),
      field('status', SINGLE_SELECT_FIELD),
      field('root_key', SINGLE_SELECT_FIELD),
      field('target_node_token', TEXT_FIELD),
      field('message', LONG_TEXT_FIELD),
      field('started_at', DATETIME_FIELD),
      field('finished_at', DATETIME_FIELD),
    ],
  },
  {
    name: 'Rules',
    fields: [
      field('rule_id', TEXT_FIELD),
      field('rule_type', SINGLE_SELECT_FIELD),
      field('rule_key', TEXT_FIELD),
      field('enabled', CHECKBOX_FIELD),
      field('scope', LONG_TEXT_FIELD),
      field('notes', LONG_TEXT_FIELD),
      field('updated_at', DATETIME_FIELD),
    ],
  },
];

export function buildKnowledgeRoots(overrides = {}) {
  return DEFAULT_KNOWLEDGE_ROOTS.map((item) => ({
    ...item,
    ...(overrides[item.key] ?? {}),
  }));
}

export function getDeploymentConfigSummary() {
  return {
    configPath: DEFAULT_CONFIG_PATH,
    roots: DEFAULT_KNOWLEDGE_ROOTS,
    aiWikiPages: AI_WIKI_PAGE_TOKENS,
    journalInput: JOURNAL_INPUT_RULE,
  };
}
