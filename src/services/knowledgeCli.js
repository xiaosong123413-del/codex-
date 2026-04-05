import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

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
  }

  getStore(baseToken) {
    return new CliBaseStore({
      runner: this.runner,
      identity: this.identity,
      baseToken: baseToken || this.baseToken,
    });
  }

  async fetchWikiNode(nodeToken) {
    const response = ensureSuccess(await this.runner.runJson([
      'wiki',
      'spaces',
      'get_node',
      '--as',
      this.identity,
      '--params',
      JSON.stringify({ token: nodeToken }),
    ]), `fetch wiki node ${nodeToken}`);

    return response.data.node;
  }

  async fetchDocumentRawContent(documentId) {
    const response = ensureSuccess(await this.runner.runJson([
      'api',
      'GET',
      `/open-apis/docx/v1/documents/${documentId}/raw_content`,
      '--params',
      '{}',
    ]), `fetch doc raw content ${documentId}`);

    return response.data.content ?? '';
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
      const response = ensureSuccess(await this.runner.runJson([
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
      ]), `update ai page ${existingDocId}`);

      return {
        docId: existingDocId,
        docUrl: response?.data?.doc_url ?? '',
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

    const response = ensureSuccess(await this.runner.runJson(args), `create ai page ${title}`);

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
