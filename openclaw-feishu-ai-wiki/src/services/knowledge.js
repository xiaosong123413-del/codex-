import {
  DEFAULT_KNOWLEDGE_ROOTS,
  JOURNAL_INPUT_RULE,
  KNOWLEDGE_TABLE_DEFINITIONS,
  buildKnowledgeRoots,
} from '../knowledge/config.js';
import {
  buildAiKnowledgePageMarkdown,
  buildKnowledgeArtifacts,
} from '../knowledge/graph.js';

function extractNode(response) {
  return response?.data?.node ?? response?.node ?? response;
}

function extractItems(response) {
  return response?.data?.items ?? response?.items ?? [];
}

function extractHasMore(response) {
  return response?.data?.has_more ?? response?.has_more ?? false;
}

function extractPageToken(response) {
  return response?.data?.page_token ?? response?.page_token ?? '';
}

function coerceListOptions(options = {}) {
  return {
    pageSize: options.pageSize ?? options.page_size ?? 200,
    pageToken: options.pageToken ?? options.page_token ?? '',
  };
}

function extractAppToken(response) {
  return response?.data?.app?.app_token
    ?? response?.data?.app_token
    ?? response?.app_token
    ?? '';
}

function extractTable(response) {
  return response?.data?.table ?? response?.table ?? response;
}

function extractFieldItems(response) {
  return response?.data?.items ?? response?.items ?? [];
}

function mapBitableFieldType(type) {
  const mapping = {
    text: 1,
    long_text: 1,
    number: 2,
    single_select: 3,
    datetime: 5,
    checkbox: 7,
    url: 15,
  };

  return mapping[type] ?? 1;
}

function serializeRecordFields(record) {
  const fields = {};

  for (const [key, value] of Object.entries(record)) {
    const fieldKey = key
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      .replace(/^_/, '');

    fields[fieldKey] = value ?? '';
  }

  return fields;
}

function buildJournalMetadata(root, nodeToken, ancestorNodeTokens = []) {
  if (root.key !== JOURNAL_INPUT_RULE.resourceRootKey) {
    return {
      journalPathDepth: -1,
      isJournalMemoryRoot: false,
      isJournalDatePage: false,
      isJournalEntry: false,
    };
  }

  const memoryRootToken = JOURNAL_INPUT_RULE.journalMemoryRootToken;
  if (nodeToken === memoryRootToken) {
    return {
      journalPathDepth: 0,
      isJournalMemoryRoot: true,
      isJournalDatePage: false,
      isJournalEntry: false,
    };
  }

  const memoryRootIndex = ancestorNodeTokens.indexOf(memoryRootToken);
  if (memoryRootIndex < 0) {
    return {
      journalPathDepth: -1,
      isJournalMemoryRoot: false,
      isJournalDatePage: false,
      isJournalEntry: false,
    };
  }

  const journalPathDepth = ancestorNodeTokens.length - memoryRootIndex;
  return {
    journalPathDepth,
    isJournalMemoryRoot: false,
    isJournalDatePage: journalPathDepth === 1,
    isJournalEntry: journalPathDepth === JOURNAL_INPUT_RULE.journalEntryDepthFromMemoryRoot,
  };
}

export class KnowledgeService {
  constructor(client, options = {}) {
    this.client = client;
    this.roots = Array.isArray(options.roots)
      ? options.roots.map((item) => ({ ...item }))
      : buildKnowledgeRoots(options.roots ?? {});
  }

  getConfiguredRoots() {
    return this.roots.map((item) => ({ ...item }));
  }

  buildSchemaPlan() {
    return KNOWLEDGE_TABLE_DEFINITIONS.map((table) => ({
      ...table,
      fields: table.fields.map((field) => ({ ...field })),
    }));
  }

  async scanRoots(customRoots) {
    const roots = Array.isArray(customRoots)
      ? customRoots
      : (customRoots ? buildKnowledgeRoots(customRoots) : this.getConfiguredRoots());
    const results = [];

    for (const root of roots) {
      results.push(await this.scanRoot(root));
    }

    return results;
  }

  async scanRoot(root) {
    const rawRootNode = extractNode(await this.getWikiNode(root.wikiToken));
    const normalizedRootNode = this.normalizeWikiNode(rawRootNode, root, {
      depthFromRoot: 0,
      ancestorNodeTokens: [],
    });

    if (!root.recursive) {
      return {
        root: { ...root },
        nodes: [normalizedRootNode],
      };
    }

    const descendants = await this.walkChildNodes(
      normalizedRootNode.spaceId,
      normalizedRootNode.nodeToken,
      root,
      {
        depthFromRoot: 1,
        ancestorNodeTokens: [normalizedRootNode.nodeToken],
      }
    );
    return {
      root: { ...root },
      nodes: [normalizedRootNode, ...descendants],
    };
  }

  normalizeWikiNode(node, root, options = {}) {
    const nodeToken = node.node_token ?? node.nodeToken;
    const depthFromRoot = options.depthFromRoot ?? 0;
    const ancestorNodeTokens = Array.isArray(options.ancestorNodeTokens)
      ? [...options.ancestorNodeTokens]
      : [];
    const journalMetadata = buildJournalMetadata(root, nodeToken, ancestorNodeTokens);

    return {
      rootKey: root.key,
      role: root.role,
      recursive: root.recursive,
      depthFromRoot,
      ancestorNodeTokens,
      spaceId: node.space_id ?? node.spaceId,
      nodeToken,
      parentNodeToken: node.parent_node_token ?? node.parentNodeToken ?? '',
      objToken: node.obj_token ?? node.objToken ?? '',
      objType: node.obj_type ?? node.objType ?? '',
      title: node.title ?? '',
      hasChild: node.has_child ?? node.hasChild ?? false,
      sourceUrl: node.url ?? '',
      ...journalMetadata,
    };
  }

  async walkChildNodes(spaceId, parentNodeToken, root, options = {}) {
    const descendants = [];
    const directChildren = await this.listAllChildNodes(spaceId, parentNodeToken);
    const depthFromRoot = options.depthFromRoot ?? 1;
    const ancestorNodeTokens = Array.isArray(options.ancestorNodeTokens)
      ? options.ancestorNodeTokens
      : [];

    for (const child of directChildren) {
      const normalizedChild = this.normalizeWikiNode(child, root, {
        depthFromRoot,
        ancestorNodeTokens,
      });
      descendants.push(normalizedChild);
      if (normalizedChild.hasChild) {
        descendants.push(...await this.walkChildNodes(spaceId, normalizedChild.nodeToken, root, {
          depthFromRoot: depthFromRoot + 1,
          ancestorNodeTokens: [...ancestorNodeTokens, normalizedChild.nodeToken],
        }));
      }
    }

    return descendants;
  }

  async listAllChildNodes(spaceId, parentNodeToken) {
    const items = [];
    let pageToken = '';

    do {
      const response = await this.listWikiNodes(spaceId, parentNodeToken, {
        pageToken,
      });
      items.push(...extractItems(response));
      pageToken = extractHasMore(response) ? extractPageToken(response) : '';
    } while (pageToken);

    return items;
  }

  async getWikiNode(token) {
    if (this.client.wiki?.getNode) {
      return this.client.wiki.getNode(token);
    }

    return this.client.get('/open-apis/wiki/v2/spaces/get_node', {
      params: { token },
    });
  }

  async listWikiNodes(spaceId, parentNodeToken, options = {}) {
    if (this.client.wiki?.listNodes) {
      return this.client.wiki.listNodes(spaceId, parentNodeToken, options);
    }

    const query = coerceListOptions(options);
    return this.client.get(`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      params: {
        parent_node_token: parentNodeToken,
        page_size: query.pageSize,
        page_token: query.pageToken || undefined,
      },
    });
  }

  buildKnowledgeArtifacts(payload) {
    return buildKnowledgeArtifacts(payload);
  }

  buildAiKnowledgePageMarkdown(payload) {
    return buildAiKnowledgePageMarkdown(payload);
  }

  async collectNodeContent(nodeToken, options = {}) {
    const rawNode = extractNode(await this.getWikiNode(nodeToken));
    const matchedRoot = this.matchRootByToken(rawNode.node_token ?? rawNode.nodeToken);
    const node = this.normalizeWikiNode(
      rawNode,
      matchedRoot ?? { key: 'external', role: 'ingest', recursive: false }
    );

    const rawContent = node.objType === 'docx'
      ? await this.getDocumentRawContent(node.objToken)
      : null;

    const blocks = options.includeBlocks && node.objType === 'docx'
      ? await this.listDocumentDescendants(node.objToken, options.blockId ?? '0')
      : [];

    return {
      node,
      rawContent,
      blocks,
    };
  }

  async getDocumentRawContent(documentId) {
    if (this.client.doc?.getRawContent) {
      return this.client.doc.getRawContent(documentId);
    }

    return this.client.get(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`);
  }

  async listDocumentDescendants(documentId, blockId = '0', pageSize = 200) {
    const items = [];
    let pageToken = '';

    do {
      const response = await this.client.get(
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
        {
          params: {
            page_size: pageSize,
            page_token: pageToken || undefined,
          },
        },
      );
      items.push(...extractItems(response));
      pageToken = extractHasMore(response) ? extractPageToken(response) : '';
    } while (pageToken);

    return items;
  }

  matchRootByToken(nodeToken) {
    return this.roots.find((item) => item.wikiToken === nodeToken) ?? null;
  }

  getJournalInputNodes(scanResults = []) {
    return scanResults
      .flatMap((item) => item?.nodes ?? [])
      .filter((node) => node?.isJournalEntry === true);
  }

  async bootstrapGraphStore({ appToken, title = '飞书双库知识图谱', folderToken } = {}) {
    const resolvedAppToken = appToken || await this.createGraphStoreApp(title, folderToken);
    const existingTables = appToken ? await this.listBitableTables(resolvedAppToken) : [];
    const createdTables = [];

    for (const tableDef of KNOWLEDGE_TABLE_DEFINITIONS) {
      let table = existingTables.find((item) => item.name === tableDef.name);

      if (!table) {
        table = await this.createBitableTable(resolvedAppToken, tableDef.name);
      }

      const existingFields = await this.listBitableFields(resolvedAppToken, table.table_id);

      for (const field of tableDef.fields) {
        if (existingFields.some((item) => item.field_name === field.name)) {
          continue;
        }

        await this.createBitableField(resolvedAppToken, table.table_id, field);
      }

      createdTables.push({
        name: tableDef.name,
        tableId: table.table_id,
      });
    }

    return {
      appToken: resolvedAppToken,
      tables: createdTables,
    };
  }

  async createGraphStoreApp(title, folderToken) {
    const response = await this.client.post('/open-apis/bitable/v1/apps', {
      name: title,
      folder_token: folderToken,
    });

    return extractAppToken(response);
  }

  async listBitableTables(appToken) {
    return extractItems(
      await this.client.get(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`)
    );
  }

  async createBitableTable(appToken, name) {
    const response = await this.client.post(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
      {
        table: {
          name,
        },
      }
    );

    return extractTable(response);
  }

  async listBitableFields(appToken, tableId) {
    return extractFieldItems(
      await this.client.get(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`
      )
    );
  }

  async createBitableField(appToken, tableId, field) {
    return this.client.post(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      {
        field_name: field.name,
        type: mapBitableFieldType(field.type),
      }
    );
  }

  async syncArtifactsToGraphStore({ appToken, tableMap, artifacts }) {
    const summary = {
      Nodes: 0,
      Edges: 0,
      Sources: 0,
      Mappings: 0,
    };

    for (const [tableName, records] of Object.entries({
      Nodes: artifacts.nodes ?? [],
      Edges: artifacts.edges ?? [],
      Sources: artifacts.sources ?? [],
      Mappings: artifacts.mappings ?? [],
    })) {
      const tableId = tableMap?.[tableName];
      if (!tableId) {
        continue;
      }

      for (const record of records) {
        await this.client.post(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
          {
            fields: serializeRecordFields(record),
          }
        );
        summary[tableName] += 1;
      }
    }

    return summary;
  }
}

export { DEFAULT_KNOWLEDGE_ROOTS, KNOWLEDGE_TABLE_DEFINITIONS };
