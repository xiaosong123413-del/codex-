function nowIso() {
  return new Date().toISOString();
}

function buildBlockNode(personalNode, block) {
  const blockNodeId = `${personalNode.nodeId}#${block.blockId}`;
  return {
    nodeId: blockNodeId,
    nodeToken: personalNode.nodeToken,
    blockId: block.blockId,
    title: `${personalNode.title} / ${block.blockId}`,
    kind: 'personal_block',
    library: 'personal',
    parentNodeId: personalNode.nodeId,
    rawText: block.text ?? '',
    updatedAt: nowIso(),
  };
}

function buildSourceRecord(source) {
  return {
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceKey: source.sourceKey,
    evidence: source.evidence,
    nodeId: source.nodeId,
    blockId: source.blockId ?? '',
    url: source.url ?? '',
    createdAt: nowIso(),
  };
}

export function buildKnowledgeArtifacts({
  personalNode,
  aiNode,
  sourceBlocks = [],
  contextNodes = [],
  messageSources = [],
}) {
  const nodes = [
    {
      ...personalNode,
      updatedAt: personalNode.updatedAt ?? nowIso(),
    },
    {
      ...aiNode,
      updatedAt: aiNode.updatedAt ?? nowIso(),
    },
  ];

  const edges = [
    {
      edgeId: `edge:${aiNode.nodeId}->${personalNode.nodeId}:derived_from`,
      sourceNodeId: aiNode.nodeId,
      targetNodeId: personalNode.nodeId,
      type: 'derived_from',
      sourceLibrary: aiNode.library,
      targetLibrary: personalNode.library,
      createdBy: 'ai',
      confidence: 1,
      evidence: personalNode.title,
      createdAt: nowIso(),
    },
  ];

  const sources = [
    buildSourceRecord({
      sourceId: `source:${personalNode.nodeId}`,
      sourceType: 'wiki_page',
      sourceKey: personalNode.nodeToken,
      evidence: personalNode.title,
      nodeId: personalNode.nodeId,
      url: personalNode.url,
    }),
  ];

  for (const block of sourceBlocks) {
    const blockNode = buildBlockNode(personalNode, block);
    nodes.push(blockNode);
    edges.push({
      edgeId: `edge:${aiNode.nodeId}->${blockNode.nodeId}:quotes_block`,
      sourceNodeId: aiNode.nodeId,
      targetNodeId: blockNode.nodeId,
      type: 'quotes_block',
      sourceLibrary: aiNode.library,
      targetLibrary: blockNode.library,
      createdBy: 'ai',
      confidence: 1,
      evidence: block.text ?? '',
      createdAt: nowIso(),
    });
    sources.push(buildSourceRecord({
      sourceId: `source:${blockNode.nodeId}`,
      sourceType: 'doc_block',
      sourceKey: `${personalNode.nodeToken}:${block.blockId}`,
      evidence: block.text ?? '',
      nodeId: personalNode.nodeId,
      blockId: block.blockId,
      url: block.url,
    }));
  }

  for (const contextNode of contextNodes) {
    edges.push({
      edgeId: `edge:${aiNode.nodeId}->${contextNode.nodeId}:${contextNode.relationType}`,
      sourceNodeId: aiNode.nodeId,
      targetNodeId: contextNode.nodeId,
      type: contextNode.relationType,
      sourceLibrary: aiNode.library,
      targetLibrary: 'personal',
      createdBy: 'ai',
      confidence: 0.8,
      evidence: contextNode.title,
      createdAt: nowIso(),
    });
  }

  for (const messageSource of messageSources) {
    nodes.push({
      nodeId: `message:${messageSource.messageId}`,
      nodeToken: messageSource.messageId,
      title: messageSource.text?.slice(0, 60) || messageSource.messageId,
      kind: 'message',
      library: 'external',
      parentNodeId: '',
      rawText: messageSource.text ?? '',
      updatedAt: nowIso(),
    });
  }

  return {
    nodes,
    edges,
    sources,
    mappings: [
      {
        mappingId: `mapping:${personalNode.nodeId}->${aiNode.nodeId}`,
        personalNodeId: personalNode.nodeId,
        aiNodeId: aiNode.nodeId,
        direction: 'personal_to_ai',
      },
    ],
  };
}

export function buildAiKnowledgePageMarkdown({
  title,
  summary,
  sourcePage,
  sourceBlocks = [],
  backlinks = [],
  contextNodes = [],
  messageSources = [],
}) {
  const lines = [`# ${title}`, '', '## 摘要', '', summary ?? '', ''];

  lines.push('## 来源页面', '');
  if (sourcePage?.url) {
    lines.push(`- [${sourcePage.title}](${sourcePage.url})`);
  } else if (sourcePage?.title) {
    lines.push(`- ${sourcePage.title}`);
  } else {
    lines.push('- 暂无');
  }
  lines.push('');

  lines.push('## 来源块', '');
  if (sourceBlocks.length) {
    for (const block of sourceBlocks) {
      lines.push(`- ${block.text}`);
    }
  } else {
    lines.push('- 暂无');
  }
  lines.push('');

  lines.push('## 关联上下文', '');
  if (contextNodes.length) {
    for (const contextNode of contextNodes) {
      lines.push(`- ${contextNode.relationLabel}：${contextNode.title}`);
    }
  } else {
    lines.push('- 暂无');
  }
  lines.push('');

  lines.push('## 反向链接', '');
  if (backlinks.length) {
    for (const backlink of backlinks) {
      lines.push(`- [${backlink.title}](${backlink.url})`);
    }
  } else {
    lines.push('- 暂无');
  }
  lines.push('');

  lines.push('## 消息证据', '');
  if (messageSources.length) {
    for (const messageSource of messageSources) {
      lines.push(`- ${messageSource.text}`);
    }
  } else {
    lines.push('- 暂无');
  }

  return lines.join('\n');
}
