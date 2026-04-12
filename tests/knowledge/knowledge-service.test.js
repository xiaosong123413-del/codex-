import test from 'node:test';
import assert from 'node:assert/strict';

import { KnowledgeService } from '../../src/services/knowledge.js';

function createFakeClient() {
  const nodesByToken = new Map([
    ['EH0OwCt6YizIjnkpOe1cWPCHnqd', {
      space_id: 'space_1',
      node_token: 'EH0OwCt6YizIjnkpOe1cWPCHnqd',
      obj_token: 'doc_apta',
      obj_type: 'docx',
      title: 'Area/Project/Task/Action',
      has_child: true,
      parent_node_token: '',
    }],
    ['GuuSw88cTi2b5Qkox9kce0bPnoc', {
      space_id: 'space_1',
      node_token: 'GuuSw88cTi2b5Qkox9kce0bPnoc',
      obj_token: 'doc_resource_root',
      obj_type: 'docx',
      title: 'Resource',
      has_child: true,
      parent_node_token: '',
    }],
    ['KVgGwSi37iy75wkxog5ci3QYnmb', {
      space_id: 'space_1',
      node_token: 'KVgGwSi37iy75wkxog5ci3QYnmb',
      obj_token: 'doc_archive_root',
      obj_type: 'docx',
      title: 'Archive',
      has_child: true,
      parent_node_token: '',
    }],
    ['resource-child-1', {
      space_id: 'space_1',
      node_token: 'resource-child-1',
      obj_token: 'doc_resource_1',
      obj_type: 'docx',
      title: '资源 1',
      has_child: true,
      parent_node_token: 'GuuSw88cTi2b5Qkox9kce0bPnoc',
    }],
    ['resource-child-2', {
      space_id: 'space_1',
      node_token: 'resource-child-2',
      obj_token: 'doc_resource_2',
      obj_type: 'docx',
      title: '资源 2',
      has_child: false,
      parent_node_token: 'GuuSw88cTi2b5Qkox9kce0bPnoc',
    }],
    ['resource-grandchild-1', {
      space_id: 'space_1',
      node_token: 'resource-grandchild-1',
      obj_token: 'doc_resource_1_1',
      obj_type: 'docx',
      title: '资源 1-1',
      has_child: false,
      parent_node_token: 'resource-child-1',
    }],
    ['archive-child-1', {
      space_id: 'space_1',
      node_token: 'archive-child-1',
      obj_token: 'doc_archive_1',
      obj_type: 'docx',
      title: '归档 1',
      has_child: false,
      parent_node_token: 'KVgGwSi37iy75wkxog5ci3QYnmb',
    }],
  ]);

  const pagedChildren = new Map([
    ['GuuSw88cTi2b5Qkox9kce0bPnoc|', {
      items: [nodesByToken.get('resource-child-1')],
      has_more: true,
      page_token: 'page-2',
    }],
    ['GuuSw88cTi2b5Qkox9kce0bPnoc|page-2', {
      items: [nodesByToken.get('resource-child-2')],
      has_more: false,
    }],
    ['resource-child-1|', {
      items: [nodesByToken.get('resource-grandchild-1')],
      has_more: false,
    }],
    ['KVgGwSi37iy75wkxog5ci3QYnmb|', {
      items: [nodesByToken.get('archive-child-1')],
      has_more: false,
    }],
    ['EH0OwCt6YizIjnkpOe1cWPCHnqd|', {
      items: [{
        space_id: 'space_1',
        node_token: 'apta-child-1',
        obj_token: 'doc_apta_1',
        obj_type: 'docx',
        title: '项目 Alpha',
        has_child: true,
        parent_node_token: 'EH0OwCt6YizIjnkpOe1cWPCHnqd',
      }],
      has_more: false,
    }],
  ]);

  return {
    wiki: {
      async getNode(token) {
        return { node: nodesByToken.get(token) };
      },
      async listNodes(spaceId, parentNodeToken, options = {}) {
        assert.equal(spaceId, 'space_1');
        return pagedChildren.get(`${parentNodeToken}|${options.pageToken ?? ''}`) ?? {
          items: [],
          has_more: false,
        };
      },
    },
    async get(url) {
      if (url === '/open-apis/docx/v1/documents/doc_resource_1/raw_content') {
        return {
          data: {
            content: '# 资源 1\n\n这里是正文',
          },
        };
      }

      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, data) {
      if (url === '/open-apis/docx/v1/documents/doc_resource_1/blocks/0/descendant') {
        return {
          data: {
            items: [
              { block_id: 'blk_1', type: 'text', text: '段落 1' },
              { block_id: 'blk_2', type: 'text', text: '段落 2' },
            ],
            has_more: false,
          },
        };
      }

      throw new Error(`Unexpected POST ${url} ${JSON.stringify(data)}`);
    },
  };
}

test('scanRoots 只把 Resource/Archive 递归展开，APTA 保持上下文锚点', async () => {
  const service = new KnowledgeService(createFakeClient());

  const result = await service.scanRoots();
  const summary = result.map((item) => ({
    key: item.root.key,
    recursive: item.root.recursive,
    nodeTokens: item.nodes.map((node) => node.nodeToken),
  }));

  assert.deepEqual(summary, [
    {
      key: 'apta',
      recursive: false,
      nodeTokens: ['EH0OwCt6YizIjnkpOe1cWPCHnqd'],
    },
    {
      key: 'resource',
      recursive: true,
      nodeTokens: [
        'GuuSw88cTi2b5Qkox9kce0bPnoc',
        'resource-child-1',
        'resource-grandchild-1',
        'resource-child-2',
      ],
    },
    {
      key: 'archive',
      recursive: true,
      nodeTokens: [
        'KVgGwSi37iy75wkxog5ci3QYnmb',
        'archive-child-1',
      ],
    },
  ]);
});

test('collectNodeContent 会读取 docx 正文和块级后代', async () => {
  const service = new KnowledgeService(createFakeClient());

  const result = await service.collectNodeContent('resource-child-1', {
    includeBlocks: true,
  });

  assert.equal(result.node.nodeToken, 'resource-child-1');
  assert.equal(result.node.objToken, 'doc_resource_1');
  assert.equal(result.rawContent.data.content, '# 资源 1\n\n这里是正文');
  assert.deepEqual(
    result.blocks.map((item) => item.block_id),
    ['blk_1', 'blk_2']
  );
});

test('bootstrapGraphStore 会按 V1 schema 创建多维表底座', async () => {
  const calls = [];
  const fakeClient = {
    async post(url, data) {
      calls.push({ url, data });

      if (url === '/open-apis/bitable/v1/apps') {
        return {
          data: {
            app: {
              app_token: 'app_token_1',
              name: data.name,
            },
          },
        };
      }

      if (url === '/open-apis/bitable/v1/apps/app_token_1/tables') {
        return {
          data: {
            table: {
              table_id: `tbl_${data.table.name}`,
              name: data.table.name,
            },
          },
        };
      }

      if (url.startsWith('/open-apis/bitable/v1/apps/app_token_1/tables/')) {
        return {
          data: {
            field: {
              field_id: `fld_${data.field_name}`,
              field_name: data.field_name,
            },
          },
        };
      }

      throw new Error(`Unexpected POST ${url}`);
    },
    async get(url) {
      calls.push({ url, method: 'GET' });

      if (url === '/open-apis/bitable/v1/apps/app_token_1/tables') {
        return { data: { items: [] } };
      }

      if (url.startsWith('/open-apis/bitable/v1/apps/app_token_1/tables/') && url.endsWith('/fields')) {
        return { data: { items: [] } };
      }

      throw new Error(`Unexpected GET ${url}`);
    },
  };

  const service = new KnowledgeService(fakeClient);
  const result = await service.bootstrapGraphStore({
    title: '飞书双库知识图谱',
  });

  assert.equal(result.appToken, 'app_token_1');
  assert.equal(result.tables.length, 6);
  assert.equal(
    calls.filter((item) => item.url === '/open-apis/bitable/v1/apps/app_token_1/tables').length,
    6
  );
});

test('syncArtifactsToGraphStore 会把图谱产物写入对应数据表', async () => {
  const writes = [];
  const fakeClient = {
    async post(url, data) {
      writes.push({ url, data });
      return { data: { record: { record_id: `rec_${writes.length}` } } };
    },
  };

  const service = new KnowledgeService(fakeClient);
  const result = await service.syncArtifactsToGraphStore({
    appToken: 'app_token_1',
    tableMap: {
      Nodes: 'tbl_nodes',
      Edges: 'tbl_edges',
      Sources: 'tbl_sources',
      Mappings: 'tbl_mappings',
    },
    artifacts: {
      nodes: [
        {
          nodeId: 'personal:1',
          nodeToken: 'node_1',
          kind: 'personal_page',
          library: 'personal',
          title: '资源 1',
          rootKey: 'resource',
        },
      ],
      edges: [
        {
          edgeId: 'edge:1',
          sourceNodeId: 'ai:1',
          targetNodeId: 'personal:1',
          type: 'derived_from',
          confidence: 1,
        },
      ],
      sources: [
        {
          sourceId: 'source:1',
          sourceType: 'wiki_page',
          sourceKey: 'node_1',
          evidence: '资源 1',
        },
      ],
      mappings: [
        {
          mappingId: 'mapping:1',
          personalNodeId: 'personal:1',
          aiNodeId: 'ai:1',
          direction: 'personal_to_ai',
        },
      ],
    },
  });

  assert.deepEqual(result, {
    Nodes: 1,
    Edges: 1,
    Sources: 1,
    Mappings: 1,
  });

  assert.deepEqual(
    writes.map((item) => item.url),
    [
      '/open-apis/bitable/v1/apps/app_token_1/tables/tbl_nodes/records',
      '/open-apis/bitable/v1/apps/app_token_1/tables/tbl_edges/records',
      '/open-apis/bitable/v1/apps/app_token_1/tables/tbl_sources/records',
      '/open-apis/bitable/v1/apps/app_token_1/tables/tbl_mappings/records',
    ]
  );
});
