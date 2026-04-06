import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import {
  AI_WIKI_PAGE_TOKENS,
  FIXED_ROOT_PAGE_SPECS,
  JOURNAL_INPUT_RULE,
  KNOWLEDGE_SYSTEM_ROOT,
} from '../knowledge/config.js';
import {
  buildAiAllPagesIndexMarkdown,
  buildDailyAdviceBlock,
  buildGenericKnowledgeMarkdown,
  buildPersonalKnowledgeMarkdown,
  classifyKnowledgeContent,
  inferPersonalThemeCandidates,
  normalizeDatePageTitle,
  resolveKnowledgeTopics,
  segmentKnowledgeBlocks,
  shouldPromoteGenericTopic,
  shouldPromotePersonalTopic,
  splitMixedKnowledge,
} from '../knowledge/aiWiki.js';
import { buildAiKnowledgePageMarkdown, buildKnowledgeArtifacts } from '../knowledge/graph.js';
import { FeishuError, ValidationError } from '../core/errors.js';

const execFileAsync = promisify(execFile);

function ensureSuccess(response, context) {
  if (response?.ok === false) {
    throw new FeishuError(
      response?.error?.message || `${context} failed`,
      response?.error?.code || 'CLI_ERROR',
      response?.error || {}
    );
  }

  if (typeof response?.code === 'number' && response.code !== 0) {
    throw new FeishuError(
      response?.msg || `${context} failed`,
      response.code,
      response?.data || {}
    );
  }

  return response;
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeValue(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }

  return value;
}

function serializeRecordFields(record) {
  const result = {};

  for (const [key, value] of Object.entries(record)) {
    result[toSnakeCase(key)] = normalizeValue(value);
  }

  return result;
}

function rowsToRecords(payload) {
  const fields = payload?.data?.fields ?? [];
  const rows = payload?.data?.data ?? [];
  const recordIds = payload?.data?.record_id_list ?? [];

  return rows.map((row, index) => {
    const values = {};

    fields.forEach((field, fieldIndex) => {
      values[field] = row[fieldIndex];
    });

    return {
      recordId: recordIds[index] ?? null,
      fields: values,
    };
  });
}

function buildAiTitle(title, prefix = 'AI/') {
  if (!title) {
    return `${prefix}Untitled`;
  }

  return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

function normalizeWikiNode(node) {
  if (!node) {
    return null;
  }

  return {
    ...node,
    nodeToken: node.nodeToken ?? node.node_token ?? '',
    node_token: node.node_token ?? node.nodeToken ?? '',
    spaceId: node.spaceId ?? node.space_id ?? '',
    space_id: node.space_id ?? node.spaceId ?? '',
    objToken: node.objToken ?? node.obj_token ?? '',
    obj_token: node.obj_token ?? node.objToken ?? '',
    title: node.title ?? '',
  };
}

function normalizeDocMarkdown(response) {
  return response?.data?.content
    ?? response?.data?.markdown
    ?? response?.data?.text
    ?? response?.data
    ?? '';
}

function pageEntryFromMaintainedPage(page) {
  if (!page) {
    return null;
  }

  return {
    topic: page.primaryTopic ?? '',
    title: page.title ?? '',
    url: page.docUrl ?? '',
    summary: page.summary ?? '',
    isShortcut: false,
  };
}

function parseIndexEntryLine(line) {
  const text = String(line ?? '').trim();
  if (!text || text === '- 暂无') {
    return null;
  }

  const entryText = text.replace(/^- /u, '').trim();
  const linkMatch = entryText.match(/^\[(.+)\]\((.+)\)(.*)$/u);
  if (!linkMatch) {
    return null;
  }

  const title = linkMatch[1];
  const url = linkMatch[2];
  let tail = String(linkMatch[3] ?? '').trim();
  if (!tail.startsWith('|')) {
    return null;
  }

  tail = tail.replace(/^\|\s*/u, '');
  const kindSeparatorIndex = tail.lastIndexOf(' | ');
  if (kindSeparatorIndex < 0) {
    return null;
  }

  const summaryAndTopic = tail.slice(0, kindSeparatorIndex).trim();
  const kind = tail.slice(kindSeparatorIndex + 3).trim();
  const topicSeparatorIndex = summaryAndTopic.indexOf(' | ');
  if (topicSeparatorIndex < 0) {
    return null;
  }

  return {
    title,
    url,
    topic: summaryAndTopic.slice(0, topicSeparatorIndex).trim(),
    summary: summaryAndTopic.slice(topicSeparatorIndex + 3).trim(),
    isShortcut: /^(?:快捷方式|shortcut)$/iu.test(kind),
  };
}

function parseAiAllPagesIndexMarkdown(markdown) {
  const text = String(markdown ?? '');
  const parseSection = (label) => {
    const sectionMatch = text.match(new RegExp(`## ${label}\\s*\\n+([\\s\\S]*?)(?:\\n## |$)`, 'u'));
    if (!sectionMatch) {
      return [];
    }

    return sectionMatch[1]
      .split(/\r?\n/)
      .map((line) => parseIndexEntryLine(line))
      .filter(Boolean);
  };

  return {
    personalEntries: parseSection('包含个人信息'),
    genericEntries: parseSection('不包含个人信息'),
  };
}

function mergeIndexEntries(existingEntries = [], nextEntries = []) {
  const merged = [];
  const indexByUrl = new Map();
  const indexByFallback = new Map();

  const buildFallbackKey = (entry) => {
    const title = String(entry?.title ?? '').trim();
    const topic = String(entry?.topic ?? '').trim();
    const isShortcut = entry?.isShortcut ? '1' : '0';
    return `fallback:${title}|${topic}|${isShortcut}`;
  };

  const upsert = (entry) => {
    if (!entry) {
      return;
    }

    const url = String(entry.url ?? '').trim();
    const fallbackKey = buildFallbackKey(entry);
    const index = url && indexByUrl.has(url)
      ? indexByUrl.get(url)
      : indexByFallback.has(fallbackKey)
        ? indexByFallback.get(fallbackKey)
        : -1;

    if (index >= 0) {
      merged[index] = entry;
    } else {
      merged.push(entry);
      const nextIndex = merged.length - 1;
      if (url) {
        indexByUrl.set(url, nextIndex);
      }
      indexByFallback.set(fallbackKey, nextIndex);
      return;
    }

    if (url) {
      indexByUrl.set(url, index);
    }
    indexByFallback.set(fallbackKey, index);
  };

  for (const entry of existingEntries) {
    upsert(entry);
  }

  for (const entry of nextEntries) {
    upsert(entry);
  }

  return merged;
}

function parseIndexEntryLineNormalized(line) {
  const text = String(line ?? '').trim();
  if (!text || text === '- 暂无') {
    return null;
  }

  const entryText = text.replace(/^- /u, '').trim();
  const linkMatch = entryText.match(/^\[(.+)\]\((.+)\)(.*)$/u);
  if (!linkMatch) {
    return null;
  }

  const title = linkMatch[1];
  const url = linkMatch[2];
  let tail = String(linkMatch[3] ?? '').trim();
  if (!tail.startsWith('|')) {
    return null;
  }

  tail = tail.replace(/^\|\s*/u, '');
  const kindSeparatorIndex = tail.lastIndexOf(' | ');
  if (kindSeparatorIndex < 0) {
    return null;
  }

  const summaryAndTopic = tail.slice(0, kindSeparatorIndex).trim();
  const topicSeparatorIndex = summaryAndTopic.indexOf(' | ');
  if (topicSeparatorIndex < 0) {
    return null;
  }

  return {
    title,
    url,
    topic: summaryAndTopic.slice(0, topicSeparatorIndex).trim(),
    summary: summaryAndTopic.slice(topicSeparatorIndex + 3).trim(),
    isShortcut: /(?:快捷方式|shortcut)$/iu.test(tail.slice(kindSeparatorIndex + 3).trim()),
  };
}

function parseAiAllPagesIndexMarkdownNormalized(markdown) {
  const text = String(markdown ?? '');
  const parseSection = (label) => {
    const sectionMatch = text.match(new RegExp(`## ${label}\\s*\\n+([\\s\\S]*?)(?:\\n## |$)`, 'u'));
    if (!sectionMatch) {
      return [];
    }

    return sectionMatch[1]
      .split(/\r?\n/)
      .map((line) => parseIndexEntryLineNormalized(line))
      .filter(Boolean);
  };

  return {
    personalEntries: parseSection('包含个人信息'),
    genericEntries: parseSection('不包含个人信息'),
  };
}

function removeMarkdownSectionByHeading(markdown, heading) {
  const text = String(markdown ?? '');
  if (!text.trim()) {
    return '';
  }

  const escapedHeading = String(heading ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = text.replace(
    new RegExp(`(?:^|\\n)## ${escapedHeading}\\n[\\s\\S]*?(?=\\n## |$)`, 'gu'),
    '\n'
  );

  return cleaned.replace(/\n{3,}/gu, '\n\n').trim();
}

function pickMaintenanceNode(context, key) {
  return context?.[key]?.node ?? null;
}

function isGenericRoutingTopic(topic) {
  const value = String(topic ?? '').trim();
  return /^(?:通用做法|通用知识|通用方案|方法|知识整理|总结)$/u.test(value)
    || /^(?:关于)?[^/]+的通用做法$/u.test(value);
}

function normalizeTopicValue(topic) {
  return String(topic ?? '').trim();
}

function sameTitle(left, right) {
  return normalizeTopicValue(left) === normalizeTopicValue(right);
}

function matchesAnyTitle(title, candidates = []) {
  return candidates.some((candidate) => sameTitle(title, candidate));
}

function buildFixedRootPageMarkdown(spec) {
  switch (spec?.key) {
    case 'maintenanceGuide':
      return [
        '# AI维基百科运行维护指南',
        '',
        '## 页面定位',
        '',
        '- 这里只记录系统规则、命名规范、页面写作规范、双链规则、巡检治理规则。',
        '',
        '## 固定顶层结构',
        '',
        '- AI维基百科运行维护指南',
        '- AI维基百科维护历史记录',
        '- AI维基百科所有页面索引',
        '- AI维基百科',
        '- 个人信息汇集',
        '- output',
        '- 归档',
      ].join('\n');
    case 'timelinePage':
      return [
        '# AI维基百科维护历史记录',
        '',
        '## 使用说明',
        '',
        '- 这是 append-only 的系统维护日志页。',
      ].join('\n');
    case 'allPagesIndex':
      return buildAiAllPagesIndexMarkdown({
        personalEntries: [],
        genericEntries: [],
      });
    case 'genericInfoRoot':
      return [
        '# AI维基百科',
        '',
        '## 页面定位',
        '',
        '- 公共知识主容器，承载概念、模型、论文、公司、产品、方法等结构化知识页。',
      ].join('\n');
    case 'personalInfoRoot':
      return [
        '# 个人信息汇集',
        '',
        '## 页面定位',
        '',
        '- 个人知识主容器，承载按日期排列与按主题分类两条长期结构。',
      ].join('\n');
    case 'outputRoot':
      return [
        '# output',
        '',
        '## 页面定位',
        '',
        '- 高价值 query-output 的沉淀层，用于综合分析、对比分析、阶段总结和决策依据。',
      ].join('\n');
    case 'archiveRoot':
      return [
        '# 归档',
        '',
        '## 页面定位',
        '',
        '- 用于保存已结束但仍有历史价值的页面、旧版结论、已归档 output 与历史专题。',
      ].join('\n');
    default:
      return `# ${spec?.title ?? '未命名页面'}`;
  }
}

function mergeRoutingTopics(...groups) {
  const seen = new Set();
  const merged = [];

  for (const group of groups) {
    for (const topic of Array.isArray(group) ? group : []) {
      const value = normalizeTopicValue(topic);
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

function extractWikiTokenFromDocUrl(docUrl) {
  const match = String(docUrl ?? '').match(/\/wiki\/([^/?#]+)/i);
  return match?.[1] ?? '';
}

function buildWikiUrlFromNodeToken(nodeToken) {
  const token = String(nodeToken ?? '').trim();
  return token ? `https://www.feishu.cn/wiki/${token}` : '';
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function dedupeCitations(citations = []) {
  const result = [];
  const seen = new Set();

  for (const citation of citations) {
    if (!citation) {
      continue;
    }

    const key = [
      citation.blockUrl ?? citation.block_url ?? '',
      citation.docUrl ?? citation.doc_url ?? citation.url ?? '',
      citation.title ?? citation.text ?? '',
      citation.blockId ?? citation.block_id ?? '',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(citation);
  }

  return result;
}

function dedupePageLinks(pages = []) {
  const result = [];
  const seen = new Set();

  for (const page of pages) {
    if (!page) {
      continue;
    }

    const key = [cleanText(page.docUrl ?? page.url ?? ''), cleanText(page.title ?? '')].join('|');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(page);
  }

  return result;
}

function extractDocBlockText(block) {
  if (!block || typeof block !== 'object') {
    return '';
  }

  if (cleanText(block.text)) {
    return cleanText(block.text);
  }

  const richContainers = [
    block.paragraph,
    block.heading1,
    block.heading2,
    block.heading3,
    block.bullet,
    block.ordered,
    block.callout,
    block.quote,
  ].filter(Boolean);

  for (const container of richContainers) {
    const elements = Array.isArray(container.elements) ? container.elements : [];
    const text = elements
      .map((element) => cleanText(
        element?.text_run?.content
        ?? element?.mention_doc?.title
        ?? element?.mention_user?.name
        ?? element?.text
      ))
      .filter(Boolean)
      .join('');
    if (text) {
      return text;
    }
  }

  return '';
}

function parseIsoDate(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : '';
}

function extractLeadingIsoDate(value) {
  const match = String(value ?? '').match(/\b(\d{4}-\d{2}-\d{2})\b/u);
  return match?.[1] ?? '';
}

function ensureDatePrefixedTitle(title, date) {
  const normalizedTitle = String(title ?? '').trim();
  const normalizedDate = parseIsoDate(date);
  if (!normalizedDate || !normalizedTitle) {
    return normalizedTitle;
  }

  return normalizedTitle.startsWith(`${normalizedDate} `)
    ? normalizedTitle
    : `${normalizedDate} ${normalizedTitle}`;
}

function stripLeadingHeading(rawContent, title) {
  const normalizedTitle = String(title ?? '').trim();
  const lines = String(rawContent ?? '')
    .replace(/\r\n/gu, '\n')
    .split('\n');

  if (!lines.length) {
    return '';
  }

  const firstLine = lines[0].replace(/^#+\s*/u, '').trim();
  if (normalizedTitle && firstLine === normalizedTitle) {
    return lines.slice(1).join('\n').trim();
  }

  return String(rawContent ?? '').trim();
}

function extractJournalSummary(content) {
  const paragraph = String(content ?? '')
    .split(/\r?\n\r?\n/gu)
    .map((item) => item.replace(/\r?\n/gu, ' ').trim())
    .find(Boolean);

  return paragraph ?? '';
}

const JOURNAL_TOPIC_RULES = [
  { topic: '睡眠', patterns: [/睡眠/u, /作息/u, /熬夜/u, /失眠/u, /起床/u, /入睡/u] },
  { topic: '学习', patterns: [/学习/u, /考研/u, /背书/u, /复习/u, /专注/u, /效率/u] },
  { topic: '运动', patterns: [/运动/u, /锻炼/u, /训练/u, /恢复/u] },
  { topic: '健康', patterns: [/健康/u, /身体/u, /饮食/u, /疲劳/u, /精力/u] },
  { topic: '工作方法', patterns: [/工作流/u, /方法/u, /系统/u, /工具/u, /版本/u, /prompt/u, /可视化/u] },
  { topic: '情绪', patterns: [/焦虑/u, /情绪/u, /压力/u, /挫败/u, /无奈/u, /反思/u] },
  { topic: '信息管理', patterns: [/信息/u, /筛选/u, /抓取/u, /推送/u, /RSS/u, /抖音/u, /小红书/u] },
];

const JOURNAL_SECTION_HEADINGS = new Set([
  '今日摘要',
  '事件记录',
  '情绪与感受',
  '想法与反思',
  '可沉淀信息',
  '待跟进',
  '原始输入（按时间顺序完整保留）',
]);

function resolveJournalTopics({ title = '', content = '' }) {
  const text = `${title}\n${content}`;
  const matches = JOURNAL_TOPIC_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.topic);

  if (!matches.length) {
    return {
      primaryTopic: '工作方法',
      secondaryTopics: [],
    };
  }

  return {
    primaryTopic: matches[0],
    secondaryTopics: matches.slice(1, 4),
  };
}

function buildCompactJournalSummary(content, maxLength = 240) {
  const lines = String(content ?? '')
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !JOURNAL_SECTION_HEADINGS.has(line))
    .filter((line) => !/^记录\d+/u.test(line));

  const summary = lines.slice(0, 4).join(' ');
  if (!summary) {
    return '';
  }

  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, maxLength - 1).trimEnd()}…`;
}

export class LarkCliRunner {
  constructor(options = {}) {
    this.executable = options.executable || 'lark-cli';
    this.cwd = options.cwd || process.cwd();
  }

  buildInvocation(args) {
    if (process.platform !== 'win32') {
      return {
        file: this.executable,
        args,
      };
    }

    const directInvocation = this.buildWindowsDirectInvocation(args);
    if (directInvocation) {
      return directInvocation;
    }

    return {
      file: 'cmd.exe',
      args: ['/c', this.executable, ...args],
    };
  }

  buildWindowsDirectInvocation(args) {
    const executablePath = this.resolveWindowsExecutablePath();
    if (!executablePath) {
      return null;
    }

    const cliDirectory = dirname(executablePath);
    const cliScript = join(cliDirectory, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
    if (!existsSync(cliScript)) {
      return null;
    }

    const bundledNode = join(cliDirectory, 'node.exe');
    const nodeExecutable = existsSync(bundledNode) ? bundledNode : process.execPath;

    return {
      file: nodeExecutable,
      args: [cliScript, ...args],
    };
  }

  resolveWindowsExecutablePath() {
    if (isAbsolute(this.executable) || /[\\/]/.test(this.executable)) {
      return this.executable;
    }

    const candidates = /\.(cmd|bat|ps1|exe)$/i.test(this.executable)
      ? [this.executable]
      : [`${this.executable}.cmd`, this.executable];

    for (const candidate of candidates) {
      try {
        const output = execFileSync('where.exe', [candidate], {
          cwd: this.cwd,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        const resolved = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);

        if (resolved) {
          return resolved;
        }
      } catch {
        // Try the next candidate and fall back to cmd.exe if nothing resolves.
      }
    }

    return null;
  }

  async runJson(args) {
    const invocation = this.buildInvocation(args);
    const { stdout, stderr } = await execFileAsync(invocation.file, invocation.args, {
      cwd: this.cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (stdout || stderr || '').trim();
    if (!output) {
      return {};
    }

    try {
      return JSON.parse(output);
    } catch (error) {
      throw new FeishuError(
        `Failed to parse lark-cli output: ${error.message}`,
        'CLI_PARSE_ERROR',
        { output }
      );
    }
  }
}

export class CliBaseStore {
  constructor(options = {}) {
    this.runner = options.runner || new LarkCliRunner();
    this.baseToken = options.baseToken;
    this.identity = options.identity || 'user';
  }

  requireBaseToken(overrideToken) {
    const baseToken = overrideToken || this.baseToken;
    if (!baseToken) {
      throw new ValidationError('baseToken is required');
    }

    return baseToken;
  }

  async listRecords({ tableName, offset = 0, limit = 200, baseToken }) {
    const resolvedBaseToken = this.requireBaseToken(baseToken);
    const response = ensureSuccess(await this.runner.runJson([
      'base',
      '+record-list',
      '--as',
      this.identity,
      '--base-token',
      resolvedBaseToken,
      '--table-id',
      tableName,
      '--offset',
      String(offset),
      '--limit',
      String(limit),
    ]), `list records for ${tableName}`);

    return {
      records: rowsToRecords(response),
      hasMore: response?.data?.has_more ?? false,
    };
  }

  async listAllRecords({ tableName, baseToken }) {
    const records = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const page = await this.listRecords({ tableName, offset, limit, baseToken });
      records.push(...page.records);
      if (!page.hasMore || page.records.length === 0) {
        break;
      }
      offset += page.records.length;
    }

    return records;
  }

  async findRecordByField({ tableName, fieldName, value, baseToken }) {
    const records = await this.listAllRecords({ tableName, baseToken });
    return records.find((record) => record.fields[fieldName] === value) ?? null;
  }

  async upsertRecord({ tableName, uniqueField, fields, baseToken }) {
    const resolvedBaseToken = this.requireBaseToken(baseToken);
    const existing = await this.findRecordByField({
      tableName,
      fieldName: uniqueField,
      value: fields[uniqueField],
      baseToken: resolvedBaseToken,
    });

    const args = [
      'base',
      '+record-upsert',
      '--as',
      this.identity,
      '--base-token',
      resolvedBaseToken,
      '--table-id',
      tableName,
      '--json',
      JSON.stringify(fields),
    ];

    if (existing?.recordId) {
      args.push('--record-id', existing.recordId);
    }

    const response = ensureSuccess(await this.runner.runJson(args), `upsert record for ${tableName}`);
    const recordId = response?.data?.record?.record_id ?? existing?.recordId ?? null;

    return {
      operation: existing ? 'update' : 'create',
      recordId,
      response,
    };
  }

  async upsertArtifacts({ artifacts, jobs = [], baseToken }) {
    const summary = {
      nodes: 0,
      edges: 0,
      sources: 0,
      mappings: 0,
      jobs: 0,
    };

    const plans = [
      {
        tableName: 'Nodes',
        uniqueField: 'node_id',
        records: (artifacts?.nodes ?? []).map(serializeRecordFields),
        summaryKey: 'nodes',
      },
      {
        tableName: 'Edges',
        uniqueField: 'edge_id',
        records: (artifacts?.edges ?? []).map(serializeRecordFields),
        summaryKey: 'edges',
      },
      {
        tableName: 'Sources',
        uniqueField: 'source_id',
        records: (artifacts?.sources ?? []).map(serializeRecordFields),
        summaryKey: 'sources',
      },
      {
        tableName: 'Mappings',
        uniqueField: 'mapping_id',
        records: (artifacts?.mappings ?? []).map(serializeRecordFields),
        summaryKey: 'mappings',
      },
      {
        tableName: 'IngestionJobs',
        uniqueField: 'job_id',
        records: jobs,
        summaryKey: 'jobs',
      },
    ];

    for (const plan of plans) {
      for (const record of plan.records) {
        await this.upsertRecord({
          tableName: plan.tableName,
          uniqueField: plan.uniqueField,
          fields: record,
          baseToken,
        });
        summary[plan.summaryKey] += 1;
      }
    }

    return summary;
  }
}

export class KnowledgeCliService {
  constructor(options = {}) {
    this.runner = options.runner || new LarkCliRunner();
    this.identity = options.identity || 'user';
    this.baseToken = options.baseToken || null;
    this.rateLimitMaxRetries = options.rateLimitMaxRetries ?? 3;
    this.rateLimitRetryDelayMs = options.rateLimitRetryDelayMs ?? 1000;
    this.wikiChildrenCache = new Map();
  }

  getStore(baseToken) {
    return new CliBaseStore({
      runner: this.runner,
      identity: this.identity,
      baseToken: baseToken || this.baseToken,
    });
  }

  isRateLimitError(error) {
    return String(error?.code ?? '') === '99991400';
  }

  getWikiChildrenCacheKey(spaceId, parentNodeToken) {
    return `${spaceId}:${parentNodeToken}`;
  }

  async isLarkCliAvailable() {
    try {
      await this.runner.runJson([
        'auth',
        'status',
        '--as',
        this.identity,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async runJsonWithRetry(args, context) {
    let attempt = 0;
    let delayMs = this.rateLimitRetryDelayMs;

    while (true) {
      try {
        return ensureSuccess(await this.runner.runJson(args), context);
      } catch (error) {
        if (!this.isRateLimitError(error) || attempt >= this.rateLimitMaxRetries) {
          throw error;
        }

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        attempt += 1;
        delayMs = delayMs > 0 ? delayMs * 2 : 0;
      }
    }
  }

  async fetchWikiNode(nodeToken) {
    const response = await this.runJsonWithRetry([
      'wiki',
      'spaces',
      'get_node',
      '--as',
      this.identity,
      '--params',
      JSON.stringify({ token: nodeToken }),
    ], `fetch wiki node ${nodeToken}`);

    return response.data.node;
  }

  async fetchDocumentRawContent(documentId) {
    const response = await this.runJsonWithRetry([
      'api',
      'GET',
      `/open-apis/docx/v1/documents/${documentId}/raw_content`,
      '--params',
      '{}',
    ], `fetch doc raw content ${documentId}`);

    return response.data.content ?? '';
  }

  async fetchDocumentDescendants(documentId, blockId = '0', pageSize = 200) {
    const items = [];
    let pageToken = '';

    do {
      const response = await this.runJsonWithRetry([
        'api',
        'GET',
        `/open-apis/docx/v1/documents/${documentId}/blocks`,
        '--params',
        JSON.stringify({
          page_size: pageSize,
          page_token: pageToken || undefined,
        }),
      ], `fetch doc descendants ${documentId}:${blockId}`);

      items.push(...(response?.data?.items ?? []));
      pageToken = response?.data?.has_more ? (response?.data?.page_token ?? '') : '';
    } while (pageToken);

    return items;
  }

  async fetchDocumentMarkdown(documentId) {
    const response = await this.runJsonWithRetry([
      'docs',
      '+fetch',
      '--as',
      this.identity,
      '--doc',
      documentId,
    ], `fetch doc markdown ${documentId}`);

    return normalizeDocMarkdown(response);
  }

  async listWikiChildrenPage({ spaceId, parentNodeToken, pageSize = 50, pageToken = '' }) {
    return this.runJsonWithRetry([
      'wiki',
      'nodes',
      'list',
      '--as',
      this.identity,
      '--params',
      JSON.stringify({
        space_id: spaceId,
        parent_node_token: parentNodeToken,
        page_size: pageSize,
        page_token: pageToken || undefined,
      }),
    ], `list wiki children for ${parentNodeToken}`);
  }

  async ensureKnowledgeBaseRootStructure() {
    const rootNode = normalizeWikiNode(await this.fetchWikiNode(KNOWLEDGE_SYSTEM_ROOT.wikiToken));
    if (!rootNode?.space_id || !rootNode?.node_token) {
      throw new ValidationError('Knowledge system root is not available');
    }

    const children = await this.fetchWikiChildren({
      spaceId: rootNode.space_id,
      parentNodeToken: rootNode.node_token,
    });

    const context = {
      systemRoot: {
        token: rootNode.node_token,
        node: rootNode,
        markdown: rootNode?.obj_token ? await this.fetchDocumentMarkdown(rootNode.obj_token) : '',
      },
    };

    for (const spec of FIXED_ROOT_PAGE_SPECS) {
      let node = children.find((item) => sameTitle(item.title, spec.title) && (item.node_type ?? item.nodeType ?? 'origin') === 'origin') ?? null;
      let reusedAlias = false;

      if (!node && Array.isArray(spec.aliases) && spec.aliases.length > 0) {
        node = children.find((item) => matchesAnyTitle(item.title, spec.aliases) && (item.node_type ?? item.nodeType ?? 'origin') === 'origin') ?? null;
        reusedAlias = Boolean(node);
      }

      if (!node) {
        node = await this.createWikiNode({
          spaceId: rootNode.space_id,
          parentNodeToken: rootNode.node_token,
          title: spec.title,
          nodeType: 'origin',
          objType: 'docx',
        });
      }

      let markdown = node?.obj_token ? await this.fetchDocumentMarkdown(node.obj_token) : '';
      const shouldSeedMarkdown = !cleanText(markdown);
      const shouldRename = reusedAlias || !sameTitle(node?.title, spec.title);

      if (node?.obj_token && (shouldSeedMarkdown || shouldRename)) {
        const publishResult = await this.publishAiPage({
          title: spec.title,
          markdown: shouldSeedMarkdown ? buildFixedRootPageMarkdown(spec) : markdown,
          existingDocId: node.obj_token,
          aiWikiNode: node.node_token,
        });

        markdown = shouldSeedMarkdown ? buildFixedRootPageMarkdown(spec) : markdown;
        node = normalizeWikiNode({
          ...node,
          title: spec.title,
          obj_token: publishResult.docId || node.obj_token,
        });
      }

      context[spec.key] = {
        token: node?.node_token ?? '',
        node,
        markdown,
      };
    }

    return context;
  }

  async fetchAiMaintenanceContext() {
    const context = await this.ensureKnowledgeBaseRootStructure();

    for (const [key, token] of Object.entries(AI_WIKI_PAGE_TOKENS)) {
      if (context[key]) {
        continue;
      }

      const node = normalizeWikiNode(await this.fetchWikiNode(token));
      const markdown = node?.obj_token ? await this.fetchDocumentMarkdown(node.obj_token) : '';
      context[key] = {
        token,
        node,
        markdown,
      };
    }

    return context;
  }

  async fetchWikiChildren({ spaceId, parentNodeToken, pageSize = 50 }) {
    const cacheKey = this.getWikiChildrenCacheKey(spaceId, parentNodeToken);
    if (this.wikiChildrenCache.has(cacheKey)) {
      return this.wikiChildrenCache.get(cacheKey).map((item) => ({ ...item }));
    }

    const items = [];
    let pageToken = '';

    do {
      const response = await this.listWikiChildrenPage({
        spaceId,
        parentNodeToken,
        pageSize,
        pageToken,
      });
      items.push(...(response?.data?.items ?? []));
      pageToken = response?.data?.has_more ? (response?.data?.page_token ?? '') : '';
    } while (pageToken);

    const normalized = items.map((item) => normalizeWikiNode(item));
    this.wikiChildrenCache.set(cacheKey, normalized.map((item) => ({ ...item })));
    return normalized;
  }

  async listJournalEntryNodes() {
    const memoryRoot = normalizeWikiNode(await this.fetchWikiNode(JOURNAL_INPUT_RULE.journalMemoryRootToken));
    if (!memoryRoot?.space_id || !memoryRoot?.node_token) {
      throw new ValidationError('Journal memory root is not available');
    }

    const journalEntries = (await this.fetchWikiChildren({
      spaceId: memoryRoot.space_id,
      parentNodeToken: memoryRoot.node_token,
    }))
      .filter((node) => node?.obj_type === 'docx')
      .map((entry) => ({
        ...entry,
        journalDate: extractLeadingIsoDate(entry?.title),
        journalDatePageToken: memoryRoot.node_token,
        journalDatePageTitle: memoryRoot.title ?? '',
        journalMemoryRootToken: memoryRoot.node_token,
        journalMemoryRootTitle: memoryRoot.title ?? '',
      }));

    journalEntries.sort((left, right) => {
      const leftDate = extractLeadingIsoDate(left.journalDate ?? left.title);
      const rightDate = extractLeadingIsoDate(right.journalDate ?? right.title);
      if (leftDate && rightDate && leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
      return String(left.title ?? '').localeCompare(String(right.title ?? ''), 'zh-CN');
    });

    return {
      memoryRoot,
      datePages: [],
      journalEntries,
    };
  }

  buildJournalSourceBlocks({ entryNode, docUrl, descendants = [] }) {
    return descendants
      .map((item) => {
        const text = extractDocBlockText(item);
        if (!text) {
          return null;
        }

        const blockId = cleanText(item.block_id ?? item.blockId ?? '');
        return {
          blockId: blockId || '',
          text,
          title: `${entryNode?.title ?? '今日日记'} / ${blockId || text.slice(0, 12)}`,
          blockUrl: blockId && docUrl ? `${docUrl}#${blockId}` : '',
          docUrl,
        };
      })
      .filter(Boolean);
  }

  buildJournalMaintenanceInput({ entryNode, rawContent, sourceBlocks = [] }) {
    const content = stripLeadingHeading(rawContent, entryNode?.title);
    const summary = buildCompactJournalSummary(content) || extractJournalSummary(content);
    const date = extractLeadingIsoDate(entryNode?.journalDate ?? entryNode?.title ?? '');
    const topics = resolveJournalTopics({
      title: entryNode?.title ?? '',
      content,
    });

    return {
      title: ensureDatePrefixedTitle(entryNode?.title ?? '', date),
      content,
      summary: summary || content,
      primaryTopic: topics.primaryTopic,
      secondaryTopics: topics.secondaryTopics,
      date,
      sourceLabel: `Journal/${entryNode?.journalMemoryRootTitle ?? 'Memory'}`,
      sourceNodeToken: entryNode?.node_token ?? entryNode?.nodeToken ?? '',
      sourceUrl: buildWikiUrlFromNodeToken(entryNode?.node_token ?? entryNode?.nodeToken ?? ''),
      sourceDatePageToken: entryNode?.journalDatePageToken ?? '',
      sourceDatePageTitle: entryNode?.journalDatePageTitle ?? '',
      sourceTitle: entryNode?.title ?? '',
      sourceBlocks,
      isJournalSource: true,
    };
  }

  async maintainAiWikiFromJournals(options = {}) {
    const scan = await this.listJournalEntryNodes();
    const since = parseIsoDate(options.since);
    const until = parseIsoDate(options.until);
    const requestedNodeTokens = Array.isArray(options.nodeTokens)
      ? new Set(options.nodeTokens.map((item) => String(item ?? '').trim()).filter(Boolean))
      : null;
    const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
      ? Math.floor(Number(options.limit))
      : null;

    let selectedEntries = scan.journalEntries.filter((entry) => {
      const entryDate = extractLeadingIsoDate(entry.journalDate ?? entry.title);
      if (since && entryDate && entryDate < since) {
        return false;
      }
      if (until && entryDate && entryDate > until) {
        return false;
      }
      if (requestedNodeTokens && !requestedNodeTokens.has(entry.node_token ?? entry.nodeToken ?? '')) {
        return false;
      }
      return true;
    });

    if (limit) {
      selectedEntries = selectedEntries.slice(0, limit);
    }

    const entries = [];
    const failures = [];

    for (const entryNode of selectedEntries) {
      try {
        const rawContent = await this.fetchDocumentRawContent(entryNode.obj_token ?? entryNode.objToken ?? '');
        const descendants = await this.fetchDocumentDescendants(entryNode.obj_token ?? entryNode.objToken ?? '');
        const sourceBlocks = this.buildJournalSourceBlocks({
          entryNode,
          docUrl: buildWikiUrlFromNodeToken(entryNode.node_token ?? entryNode.nodeToken ?? ''),
          descendants,
        });
        const input = this.buildJournalMaintenanceInput({
          entryNode,
          rawContent,
          sourceBlocks,
        });
        const result = await this.maintainAiWikiEntry(input);

        entries.push({
          nodeToken: entryNode.node_token ?? entryNode.nodeToken ?? '',
          date: input.date,
          title: input.title,
          classification: result.classification,
          pages: result.pages,
          maintenance: result.maintenance,
        });
      } catch (error) {
        failures.push({
          nodeToken: entryNode.node_token ?? entryNode.nodeToken ?? '',
          title: entryNode.title ?? '',
          message: error.message,
        });

        if (options.continueOnError === false) {
          throw error;
        }
      }
    }

    return {
      source: {
        memoryRootToken: scan.memoryRoot.node_token ?? scan.memoryRoot.nodeToken ?? '',
        memoryRootTitle: scan.memoryRoot.title ?? '',
      },
      summary: {
        journalEntryCount: scan.journalEntries.length,
        selectedCount: selectedEntries.length,
        processedCount: entries.length,
        failedCount: failures.length,
      },
      entries,
      failures,
    };
  }

  async createWikiNode({
    spaceId,
    parentNodeToken,
    title,
    nodeType = 'origin',
    objType = 'docx',
    originNodeToken,
  }) {
    const payload = {
      space_id: spaceId,
      parent_node_token: parentNodeToken,
      title,
      node_type: nodeType,
      obj_type: objType,
    };

    if (originNodeToken) {
      payload.origin_node_token = originNodeToken;
    }

    const response = await this.runJsonWithRetry([
      'wiki',
      'nodes',
      'create',
      '--as',
      this.identity,
      '--params',
      JSON.stringify({ space_id: spaceId }),
      '--data',
      JSON.stringify(payload),
    ], `create wiki node ${title}`);

    const createdNode = normalizeWikiNode(response?.data?.node ?? response?.data?.item ?? response?.data ?? null);
    const cacheKey = this.getWikiChildrenCacheKey(spaceId, parentNodeToken);
    if (this.wikiChildrenCache.has(cacheKey) && createdNode) {
      const cached = this.wikiChildrenCache.get(cacheKey).map((item) => ({ ...item }));
      cached.push({ ...createdNode });
      this.wikiChildrenCache.set(cacheKey, cached);
    }

    return createdNode;
  }

  async resolveCanonicalDocNodeToken({ docId, docUrl }) {
    const tokenFromUrl = extractWikiTokenFromDocUrl(docUrl);
    if (tokenFromUrl) {
      return tokenFromUrl;
    }

    const response = await this.runJsonWithRetry([
      'wiki',
      'spaces',
      'get_node',
      '--as',
      this.identity,
      '--params',
      JSON.stringify({ token: docId, obj_type: 'docx' }),
    ], `resolve wiki node for doc ${docId}`);

    const node = normalizeWikiNode(response?.data?.node ?? null);
    return node?.node_token ?? node?.nodeToken ?? '';
  }

  async ensureTopicPage({ spaceId, parentNodeToken, title }) {
    const children = await this.fetchWikiChildren({ spaceId, parentNodeToken });
    const existing = children.find((item) => item.title === title && (item.node_type ?? item.nodeType ?? 'origin') === 'origin');

    if (existing) {
      return normalizeWikiNode(existing);
    }

    return this.createWikiNode({
      spaceId,
      parentNodeToken,
      title,
      nodeType: 'origin',
      objType: 'docx',
    });
  }

  async ensureTopicShortcut({ spaceId, parentNodeToken, title, canonicalNodeToken }) {
    const children = await this.fetchWikiChildren({ spaceId, parentNodeToken });
    const existing = children.find((item) => item.title === title && (item.node_type ?? item.nodeType ?? '') === 'shortcut');

    if (existing) {
      return normalizeWikiNode(existing);
    }

    return this.createWikiNode({
      spaceId,
      parentNodeToken,
      title,
      nodeType: 'shortcut',
      objType: 'docx',
      originNodeToken: canonicalNodeToken,
    });
  }

  async findCanonicalChildPage({ spaceId, topicNodeToken, title }) {
    const children = await this.fetchWikiChildren({ spaceId, parentNodeToken: topicNodeToken });
    return normalizeWikiNode(children.find((item) => item.title === title && (item.node_type ?? item.nodeType ?? 'origin') === 'origin') ?? null);
  }

  async ensureCanonicalChildPage({ spaceId, topicNodeToken, title, markdown }) {
    const existing = await this.findCanonicalChildPage({ spaceId, topicNodeToken, title });
    const existingDocId = existing?.obj_token ?? existing?.objToken ?? '';

    if (existingDocId) {
      const doc = await this.publishAiPage({
        title,
        markdown,
        existingDocId,
        aiWikiNode: topicNodeToken,
      });

      return {
        node: existing,
        doc,
      };
    }

    const doc = await this.publishAiPage({
      title,
      markdown,
      aiWikiNode: topicNodeToken,
    });

    const canonicalNodeToken = await this.resolveCanonicalDocNodeToken({
      docId: doc.docId,
      docUrl: doc.docUrl,
    });

    return {
      node: normalizeWikiNode({
        space_id: spaceId,
        node_token: canonicalNodeToken,
        obj_token: doc.docId,
        obj_type: 'docx',
        title,
        node_type: 'origin',
      }),
      doc,
    };
  }

  buildRoutedKnowledgeMarkdown({ privacyScope, draft }) {
    if (privacyScope === 'personal') {
      return buildPersonalKnowledgeMarkdown(draft);
    }

    return buildGenericKnowledgeMarkdown(draft);
  }

  resolveRoutingTopics({ draft, privacyScope }) {
    const resolved = resolveKnowledgeTopics({
      title: draft?.title ?? '',
      content: draft?.summary ?? draft?.conclusion ?? draft?.content ?? '',
    });
    const title = String(draft?.title ?? '').trim();
    const explicitPrimaryTopic = normalizeTopicValue(draft?.topics?.primaryTopic);
    const explicitSecondaryTopics = Array.isArray(draft?.topics?.secondaryTopics)
      ? draft.topics.secondaryTopics
      : [];
    const primaryTopic = explicitPrimaryTopic && explicitPrimaryTopic !== title
      ? explicitPrimaryTopic
      : resolved.primaryTopic;

    if (privacyScope === 'generic') {
      return {
        primaryTopic,
        secondaryTopics: [],
      };
    }

    if (draft?.pageType === 'personal-date' || /^\d{4}-\d{2}-\d{2}$/u.test(title)) {
      return {
        primaryTopic: '按日期排列',
        secondaryTopics: [],
      };
    }

    return {
      primaryTopic: '按主题分类',
      secondaryTopics: mergeRoutingTopics(explicitSecondaryTopics, resolved.secondaryTopics)
        .filter((topic) => topic !== primaryTopic && !isGenericRoutingTopic(topic)),
    };
  }

  async publishRoutedKnowledgePage({ privacyScope, draft, context }) {
    const rootKey = privacyScope === 'personal' ? 'personalInfoRoot' : 'genericInfoRoot';
    const rootNode = pickMaintenanceNode(context, rootKey);
    if (!rootNode) {
      throw new ValidationError(`Missing AI wiki maintenance context for ${rootKey}`);
    }

    const spaceId = rootNode.space_id ?? rootNode.spaceId;
    const rootNodeToken = rootNode.node_token ?? rootNode.nodeToken;
    const { primaryTopic, secondaryTopics } = this.resolveRoutingTopics({ draft, privacyScope });
    const topicNode = await this.ensureTopicPage({
      spaceId,
      parentNodeToken: rootNodeToken,
      title: primaryTopic,
    });

    const markdown = this.buildRoutedKnowledgeMarkdown({ privacyScope, draft });
    const canonicalPage = await this.ensureCanonicalChildPage({
      spaceId,
      topicNodeToken: topicNode.node_token ?? topicNode.nodeToken,
      title: draft.title,
      markdown,
    });
    const canonicalNodeToken = canonicalPage.node.node_token ?? canonicalPage.node.nodeToken;
    const doc = canonicalPage.doc;

    const shortcutNodeTokens = [];
    if (draft?.allowShortcuts === true) {
      for (const secondaryTopic of secondaryTopics) {
        const shortcutNode = await this.ensureTopicShortcut({
          spaceId,
          parentNodeToken: rootNodeToken,
          title: secondaryTopic,
          canonicalNodeToken,
        });
        shortcutNodeTokens.push(shortcutNode.node_token ?? shortcutNode.nodeToken);
      }
    }

    return {
      privacyScope,
      title: draft.title ?? '',
      summary: privacyScope === 'generic'
        ? cleanText(draft.summary ?? draft.entries?.[0]?.text ?? draft.conclusion ?? draft.content ?? '')
        : cleanText(draft.summary ?? draft.entries?.[0]?.text ?? draft.content ?? ''),
      primaryTopic,
      secondaryTopics,
      topicNodeToken: topicNode.node_token ?? topicNode.nodeToken,
      canonicalNodeToken,
      docId: doc.docId,
      docUrl: doc.docUrl || buildWikiUrlFromNodeToken(canonicalNodeToken),
      shortcutNodeTokens,
    };
  }

  buildJournalSourceCitation({ input, block, label = '引自' }) {
    const blockId = cleanText(block?.source?.blockId ?? '');
    const title = cleanText(
      block?.source?.title
      ?? input?.sourceTitle
      ?? input?.title
      ?? '今日日记'
    ) || '今日日记';
    const blockUrl = cleanText(block?.source?.blockUrl ?? '');
    const docUrl = cleanText(block?.source?.docUrl ?? input?.sourceUrl ?? '');

    return {
      label,
      title: blockId ? `${title} / ${blockId}` : title,
      blockId,
      blockUrl,
      docUrl,
      url: blockUrl || docUrl,
    };
  }

  normalizeInheritedCitations(block) {
    return dedupeCitations([
      ...(Array.isArray(block?.citations) ? block.citations : []),
      ...(Array.isArray(block?.source?.citations) ? block.source.citations : []),
    ]);
  }

  inferKnowledgeTarget({ text, contextText = '', input, topics }) {
    const normalizedText = cleanText(text);
    const contextualText = `${input?.title ?? ''} ${contextText} ${normalizedText}`;
    if (cleanText(input?.genericTitle)) {
      return {
        title: cleanText(input.genericTitle),
        topic: topics.primaryTopic,
      };
    }

    if (/小王/u.test(contextualText)) {
      return {
        title: '小王',
        topic: '人物',
      };
    }

    if (/飞书记录系统/u.test(contextualText)) {
      return {
        title: '飞书记录系统',
        topic: '项目',
      };
    }

    if (/规则|SOP|原则/u.test(normalizedText)) {
      return {
        title: `${topics.primaryTopic}规则文档`,
        topic: topics.primaryTopic,
      };
    }

    return {
      title: `${topics.primaryTopic}主题文档`,
      topic: topics.primaryTopic,
    };
  }

  deriveOverallClassification({ sawPersonal, sawGeneric }) {
    if (sawPersonal && sawGeneric) {
      return { type: 'mixed' };
    }
    if (sawGeneric) {
      return { type: 'generic' };
    }
    return { type: 'personal' };
  }

  buildBlockRoutingPlan(input = {}) {
    const blocks = segmentKnowledgeBlocks({
      title: input?.sourceTitle ?? input?.title ?? '',
      content: input?.content ?? '',
      sourceUrl: input?.sourceUrl ?? '',
      sourceBlocks: input?.sourceBlocks ?? [],
    });

    const journalEntries = [];
    const targetDrafts = new Map();
    const personalThemeDrafts = new Map();
    let sawPersonal = false;
    let sawGeneric = false;

    const ensureTargetDraft = ({ title, topic }) => {
      const key = `${topic}|${title}`;
      if (!targetDrafts.has(key)) {
        targetDrafts.set(key, {
          title,
          entries: [],
          topics: {
            primaryTopic: topic,
            secondaryTopics: [],
          },
          sources: [],
          relatedPersonalPages: [],
        });
      }
      return targetDrafts.get(key);
    };

    const ensurePersonalThemeDraft = ({ title, pageType, topic }) => {
      const key = `${pageType}|${title}`;
      if (!personalThemeDrafts.has(key)) {
        personalThemeDrafts.set(key, {
          title,
          pageType,
          entries: [],
          topics: {
            primaryTopic: topic,
            secondaryTopics: [],
          },
          sources: [],
        });
      }
      return personalThemeDrafts.get(key);
    };

    for (const block of blocks) {
      const blockClassification = classifyKnowledgeContent({
        title: input?.title ?? '',
        content: block.text,
      });
      const inheritedCitations = this.normalizeInheritedCitations(block);
      const sourceCitation = this.buildJournalSourceCitation({ input, block });
      const sourceCitations = dedupeCitations([sourceCitation, ...inheritedCitations]);

      if (blockClassification.type === 'personal') {
        const personalEntry = {
          text: block.text,
          citations: inheritedCitations,
          citationLabel: inheritedCitations.length ? '来源' : '',
        };
        journalEntries.push(personalEntry);

        const personalThemeCandidates = inferPersonalThemeCandidates([{
          text: block.text,
          citations: sourceCitations,
        }]);

        for (const candidate of personalThemeCandidates) {
          const themeDraft = ensurePersonalThemeDraft(candidate);
          themeDraft.entries.push({
            text: candidate.text,
            citations: candidate.citations,
            citationLabel: '引自',
          });
        }
        sawPersonal = true;
        continue;
      }

      if (blockClassification.type === 'generic') {
        const topics = resolveKnowledgeTopics({
          title: input?.title ?? '',
          content: block.text,
        });
        const targetInfo = this.inferKnowledgeTarget({
          text: block.text,
          contextText: block.text,
          input,
          topics,
        });
        const target = ensureTargetDraft(targetInfo);
        target.entries.push({
          text: block.text,
          citations: sourceCitations,
          citationLabel: '引自',
        });

        if (!shouldPromoteGenericTopic({ title: target.title, entries: target.entries })) {
          continue;
        }

        sawGeneric = true;
        if (input?.isJournalSource) {
          journalEntries.push({
            text: block.text,
            citations: inheritedCitations,
            citationLabel: inheritedCitations.length ? '来源' : '',
          });
        }
        continue;
      }

      const split = splitMixedKnowledge({
        title: input?.title ?? '',
        content: block.text,
        date: input?.date ?? '',
        genericTitle: input?.genericTitle ?? '',
      });

      if (split.personalSegments.length) {
        sawPersonal = true;
      }
      if (split.knowledgeSegments.length) {
        sawGeneric = true;
      }

      for (const text of split.personalSegments) {
        const personalEntry = {
          text,
          citations: inheritedCitations,
          citationLabel: inheritedCitations.length ? '来源' : '',
        };
        journalEntries.push(personalEntry);

        const personalThemeCandidates = inferPersonalThemeCandidates([{
          text,
          citations: sourceCitations,
        }]);

        for (const candidate of personalThemeCandidates) {
          const themeDraft = ensurePersonalThemeDraft(candidate);
          themeDraft.entries.push({
            text: candidate.text,
            citations: candidate.citations,
            citationLabel: '引自',
          });
        }
      }

      for (const text of split.knowledgeSegments) {
        if (input?.isJournalSource) {
          journalEntries.push({
            text,
            citations: inheritedCitations,
            citationLabel: inheritedCitations.length ? '来源' : '',
          });
        }

        const topics = resolveKnowledgeTopics({
          title: input?.title ?? '',
          content: text,
        });
        const targetInfo = this.inferKnowledgeTarget({
          text,
          contextText: block.text,
          input,
          topics,
        });
        const target = ensureTargetDraft(targetInfo);
        target.entries.push({
          text,
          citations: sourceCitations,
          citationLabel: '引自',
        });
      }
    }

    const classification = this.deriveOverallClassification({ sawPersonal, sawGeneric });
    const promotedTargetDrafts = Array.from(targetDrafts.values())
      .filter((draft) => shouldPromoteGenericTopic({ title: draft.title, entries: draft.entries }));
    const promotedPersonalThemeDrafts = Array.from(personalThemeDrafts.values())
      .filter((draft) => shouldPromotePersonalTopic({
        topic: draft.topics?.primaryTopic ?? draft.title,
        entries: draft.entries,
      }));

    return {
      classification,
      blocks,
      journalEntries,
      targetDrafts: promotedTargetDrafts,
      personalThemeDrafts: promotedPersonalThemeDrafts,
    };
  }

  async updateAiAllPagesIndex({ context, pages }) {
    const root = pickMaintenanceNode(context, 'allPagesIndex');
    if (!root) {
      return false;
    }

    const existing = parseAiAllPagesIndexMarkdownNormalized(context?.allPagesIndex?.markdown ?? '');
    const nextPersonalEntries = mergeIndexEntries(
      existing.personalEntries,
      [
        ...(pages.personal ? [pageEntryFromMaintainedPage(pages.personal)] : []),
        ...((Array.isArray(pages.personalThemes) ? pages.personalThemes : [])
          .map((page) => pageEntryFromMaintainedPage(page))
          .filter(Boolean)),
      ]
    );
    const nextGenericEntries = mergeIndexEntries(
      existing.genericEntries,
      [
        ...(pages.generic ? [pageEntryFromMaintainedPage(pages.generic)] : []),
        ...((Array.isArray(pages.targets) ? pages.targets : [])
          .map((page) => pageEntryFromMaintainedPage(page))
          .filter(Boolean)),
      ]
    );

    const markdown = buildAiAllPagesIndexMarkdown({
      personalEntries: nextPersonalEntries,
      genericEntries: nextGenericEntries,
    });

    await this.publishAiPage({
      title: root.title,
      markdown,
      existingDocId: root.obj_token ?? root.objToken ?? '',
      aiWikiNode: root.node_token ?? root.nodeToken,
    });

    return true;
  }

  async appendAiTimelineEntry({ context, input, pages }) {
    const root = pickMaintenanceNode(context, 'timelinePage');
    if (!root) {
      return false;
    }

    const currentMarkdown = context?.timelinePage?.markdown ?? '';
    const date = String(input?.date ?? new Date().toISOString().slice(0, 10));
    const body = removeMarkdownSectionByHeading(currentMarkdown, date);
    const genericTitles = dedupePageLinks([
      ...(pages.generic ? [pages.generic] : []),
      ...(Array.isArray(pages.targets) ? pages.targets : []),
    ])
      .map((page) => page?.title)
      .filter(Boolean);
    const rebuiltMarkdown = [
      body,
      `## ${date}`,
      '',
      `- personal: ${pages.personal?.title ?? 'none'}`,
      `- generic: ${genericTitles.length ? genericTitles.join('；') : 'none'}`,
    ].filter(Boolean).join('\n');

    await this.publishAiPage({
      title: root.title,
      markdown: rebuiltMarkdown,
      existingDocId: root.obj_token ?? root.objToken ?? '',
      aiWikiNode: root.node_token ?? root.nodeToken,
    });

    return true;
  }

  async prependDailyAdviceEntry({ context, personalPage, input, pages }) {
    const root = pickMaintenanceNode(context, 'personalInfoRoot');
    if (!root) {
      return false;
    }

    const pageLinks = dedupePageLinks([
      pages.personal,
      ...(Array.isArray(pages.personalThemes) ? pages.personalThemes : []),
      pages.generic,
      ...(Array.isArray(pages.targets) ? pages.targets : []),
    ])
      .filter(Boolean)
      .map((page) => ({
        title: page.title,
        url: page.docUrl,
      }));

    const block = buildDailyAdviceBlock({
      date: input?.date ?? new Date().toISOString().slice(0, 10),
      highlights: [personalPage?.title ?? ''],
      adviceItems: input?.adviceItems ?? {
        personal: [personalPage?.title ?? ''],
        主题同步: (Array.isArray(pages.personalThemes) ? pages.personalThemes : []).map((page) => page.title),
      },
      pageLinks,
    });

    const dateHeading = String(input?.date ?? new Date().toISOString().slice(0, 10));
    const priorMarkdown = removeMarkdownSectionByHeading(
      context?.personalInfoRoot?.markdown ?? '',
      dateHeading
    );
    const nextMarkdown = [
      block.trim(),
      priorMarkdown,
    ].filter(Boolean).join('\n\n');

    await this.publishAiPage({
      title: root.title,
      markdown: nextMarkdown,
      existingDocId: root.obj_token ?? root.objToken ?? '',
      aiWikiNode: root.node_token ?? root.nodeToken,
    });

    return true;
  }

  async maintainAiWikiEntry(input = {}) {
    const context = await this.fetchAiMaintenanceContext();
    const plan = this.buildBlockRoutingPlan(input);
    const pages = {
      personal: null,
      personalThemes: [],
      generic: null,
      targets: [],
    };

    const shouldPublishJournal = plan.journalEntries.length > 0 || input?.isJournalSource === true;

    if (shouldPublishJournal) {
      pages.personal = await this.publishRoutedKnowledgePage({
        privacyScope: 'personal',
        draft: {
          title: normalizeDatePageTitle(input?.date, input?.title),
          entries: plan.journalEntries,
          sources: [input?.sourceLabel ?? 'Journal'],
          pageType: 'personal-date',
          topics: {
            primaryTopic: '按日期排列',
            secondaryTopics: [],
          },
        },
        context,
      });
    }

    for (const themeDraft of plan.personalThemeDrafts ?? []) {
      const published = await this.publishRoutedKnowledgePage({
        privacyScope: 'personal',
        draft: {
          ...themeDraft,
          sources: [input?.sourceLabel ?? 'Journal'],
        },
        context,
      });
      pages.personalThemes.push(published);
    }

    for (const targetDraft of plan.targetDrafts) {
      const published = await this.publishRoutedKnowledgePage({
        privacyScope: 'generic',
        draft: {
          ...targetDraft,
          sources: [input?.sourceLabel ?? 'Journal'],
        },
        context,
      });
      pages.targets.push(published);
    }

    pages.generic = pages.targets[0] ?? null;

    if (pages.personal && pages.targets.length > 0) {
      pages.personal = await this.publishRoutedKnowledgePage({
        privacyScope: 'personal',
        draft: {
          title: normalizeDatePageTitle(input?.date, input?.title),
          entries: plan.journalEntries,
          sources: [input?.sourceLabel ?? 'Journal'],
          pageType: 'personal-date',
          topics: {
            primaryTopic: '按日期排列',
            secondaryTopics: [],
          },
        },
        context,
      });
    }

    const maintenance = {
      indexUpdated: await this.updateAiAllPagesIndex({ context, pages }),
      timelineUpdated: await this.appendAiTimelineEntry({ context, input, pages }),
      dailyAdviceUpdated: pages.personal
        ? await this.prependDailyAdviceEntry({ context, personalPage: pages.personal, input, pages })
        : false,
    };

    return {
      classification: plan.classification,
      routing: {
        blockCount: plan.blocks.length,
        journalEntryCount: plan.journalEntries.length,
        personalThemeCount: plan.personalThemeDrafts?.length ?? 0,
        targetCount: plan.targetDrafts.length,
      },
      pages,
      maintenance,
    };
  }

  extractSourceBlocks({ rawContent, title, maxSourceBlocks = 2 }) {
    const lines = rawContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== title && !/^image\.(png|jpg|jpeg|gif)$/i.test(line));

    return lines.slice(0, maxSourceBlocks).map((line, index) => ({
      blockId: `raw-${index + 1}`,
      text: line,
    }));
  }

  async publishAiPage({ title, markdown, existingDocId, aiWikiSpace = 'my_library', aiWikiNode, folderToken }) {
    if (existingDocId) {
      const response = await this.runJsonWithRetry([
        'docs',
        '+update',
        '--as',
        this.identity,
        '--doc',
        existingDocId,
        '--mode',
        'overwrite',
        '--markdown',
        markdown,
        '--new-title',
        title,
      ], `update ai page ${existingDocId}`);
      const resolvedNodeToken = await this.resolveCanonicalDocNodeToken({
        docId: existingDocId,
        docUrl: response?.data?.doc_url ?? '',
      });

      return {
        docId: existingDocId,
        docUrl: response?.data?.doc_url ?? buildWikiUrlFromNodeToken(resolvedNodeToken),
        operation: 'update',
        response,
      };
    }

    const args = [
      'docs',
      '+create',
      '--as',
      this.identity,
      '--title',
      title,
      '--markdown',
      markdown,
    ];

    if (aiWikiNode) {
      args.push('--wiki-node', aiWikiNode);
    } else if (aiWikiSpace) {
      args.push('--wiki-space', aiWikiSpace);
    } else if (folderToken) {
      args.push('--folder-token', folderToken);
    }

    const response = await this.runJsonWithRetry(args, `create ai page ${title}`);

    return {
      docId: response?.data?.doc_id ?? '',
      docUrl: response?.data?.doc_url ?? '',
      operation: 'create',
      response,
    };
  }

  async importNodeWithPublish(options = {}) {
    const {
      nodeToken,
      baseToken = this.baseToken,
      rootKey = 'resource',
      aiWikiSpace = 'my_library',
      aiWikiNode,
      folderToken,
      maxSourceBlocks = 2,
      aiTitlePrefix = 'AI/',
    } = options;

    if (!nodeToken) {
      throw new ValidationError('nodeToken is required');
    }

    if (!baseToken) {
      throw new ValidationError('baseToken is required');
    }

    const store = this.getStore(baseToken);
    const node = await this.fetchWikiNode(nodeToken);
    const rawContent = await this.fetchDocumentRawContent(node.obj_token);
    const sourceBlocks = this.extractSourceBlocks({
      rawContent,
      title: node.title,
      maxSourceBlocks,
    });

    const aiTitle = buildAiTitle(node.title, aiTitlePrefix);
    const aiNodeId = `ai:${node.node_token}`;
    const existingAiNode = await store.findRecordByField({
      tableName: 'Nodes',
      fieldName: 'node_id',
      value: aiNodeId,
    });

    const markdown = buildAiKnowledgePageMarkdown({
      title: aiTitle,
      summary: `这是一页由 AI 自动整理的知识卡片，来源于 ${rootKey} 节点「${node.title}」。`,
      sourcePage: {
        title: node.title,
        url: `https://dcnpd7i1mmp0.feishu.cn/wiki/${node.node_token}`,
      },
      sourceBlocks,
      backlinks: [],
      contextNodes: [],
      messageSources: [],
    });

    const aiPage = await this.publishAiPage({
      title: aiTitle,
      markdown,
      existingDocId: existingAiNode?.fields?.obj_token || '',
      aiWikiSpace,
      aiWikiNode,
      folderToken,
    });

    const now = formatDateTime();
    const artifacts = buildKnowledgeArtifacts({
      personalNode: {
        nodeId: `personal:${node.node_token}`,
        nodeToken: node.node_token,
        title: node.title,
        library: 'personal',
        kind: 'personal_page',
        rootKey,
        objToken: node.obj_token,
        objType: node.obj_type,
        sourceUrl: `https://dcnpd7i1mmp0.feishu.cn/wiki/${node.node_token}`,
        rawText: rawContent,
        updatedAt: now,
      },
      aiNode: {
        nodeId: aiNodeId,
        nodeToken: `ai-${node.node_token}`,
        title: aiTitle,
        library: 'ai',
        kind: 'ai_page',
        rootKey,
        objToken: aiPage.docId,
        objType: 'docx',
        sourceUrl: aiPage.docUrl,
        rawText: `AI整理：${node.title}`,
        updatedAt: now,
      },
      sourceBlocks,
      contextNodes: [],
      messageSources: [],
    });

    const imported = await store.upsertArtifacts({
      artifacts,
      jobs: [
        {
          job_id: `job:import:${node.node_token}`,
          job_type: `${rootKey}_seed`,
          status: 'completed',
          root_key: rootKey,
          target_node_token: node.node_token,
          message: `已导入 ${rootKey} 节点：${node.title}`,
          started_at: now,
          finished_at: now,
        },
      ],
    });

    return {
      node: {
        title: node.title,
        nodeToken: node.node_token,
        documentId: node.obj_token,
      },
      aiPage,
      imported,
      markdown,
    };
  }
}
