function normalizeInput(input) {
  if (typeof input === 'string') {
    return { content: input };
  }

  return input && typeof input === 'object' ? input : {};
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const item = cleanText(value);
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }

  return result;
}

function stripMarkdownHeadings(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function stripLeadingDate(text) {
  return cleanText(String(text ?? '').replace(/^\d{4}-\d{2}-\d{2}\s+/u, ''));
}

function toText(input) {
  const payload = normalizeInput(input);
  return [
    stripLeadingDate(payload.title),
    payload.summary,
    payload.content,
    payload.body,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function splitParagraphs(text) {
  return stripMarkdownHeadings(text)
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean).join(' '))
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
}

function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[。！？!?])/u)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);
}

function splitClauses(text) {
  return String(text ?? '')
    .split(/[，；;]/u)
    .map((clause) => cleanText(clause))
    .filter(Boolean);
}

function countMatches(text, patterns) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

const PERSONAL_PATTERNS = [
  /我/u,
  /我的/u,
  /今天/u,
  /今晚/u,
  /下午/u,
  /晚上/u,
  /最近/u,
  /这周/u,
  /本周/u,
  /有点/u,
  /头疼/u,
  /心情/u,
  /焦虑/u,
  /累/u,
  /早点睡/u,
  /准备/u,
  /朋友/u,
  /聊完/u,
  /生活/u,
  /感受/u,
  /身体/u,
  /情绪/u,
];

const KNOWLEDGE_PATTERNS = [
  /项目/u,
  /系统/u,
  /规则/u,
  /分类/u,
  /引用机制/u,
  /机制/u,
  /方法/u,
  /原则/u,
  /SOP/u,
  /流程/u,
  /任务/u,
  /文档/u,
  /人物/u,
  /分工/u,
  /适合/u,
  /负责/u,
  /应该/u,
  /需要/u,
  /必须/u,
  /结论/u,
  /客观记录/u,
  /可复用/u,
  /沉淀/u,
  /设计/u,
  /模板/u,
];

const PERSONAL_ONLY_PATTERNS = [
  /头疼/u,
  /心情好了很多/u,
  /早点睡/u,
  /有点累/u,
  /心情/u,
  /身体/u,
  /日常/u,
];

const TOPIC_RULES = [
  { topic: '睡眠', patterns: [/睡眠/u, /早睡/u, /失眠/u, /作息/u, /早点睡/u, /熬夜/u] },
  { topic: '学习', patterns: [/学习/u, /背书/u, /复习/u, /专注/u, /效率/u, /考研/u] },
  { topic: '健康', patterns: [/健康/u, /身体/u, /头疼/u, /疲劳/u, /精力/u] },
  { topic: '运动', patterns: [/运动/u, /锻炼/u, /训练/u, /恢复/u] },
  { topic: '工作方法', patterns: [/工作方法/u, /系统/u, /流程/u, /方法/u, /规则/u, /SOP/u] },
  { topic: '人物', patterns: [/小王/u, /人物/u, /分工/u, /协作/u] },
  { topic: '项目', patterns: [/项目/u, /推进/u, /记录系统/u, /飞书记录系统/u] },
];

function classifySentenceType(text) {
  const sentence = cleanText(text);
  const personalScore = countMatches(sentence, PERSONAL_PATTERNS);
  const knowledgeScore = countMatches(sentence, KNOWLEDGE_PATTERNS);

  if (knowledgeScore > 0 && personalScore === 0) {
    return 'generic';
  }

  if (personalScore > 0 && knowledgeScore === 0) {
    return 'personal';
  }

  if (personalScore > 0 && knowledgeScore > 0) {
    return 'mixed';
  }

  return 'personal';
}

function stripLeadingPersonalContext(text) {
  return cleanText(String(text ?? '')
    .replace(/^(?:今天|后来|我后来|后来我|我意识到|我发现|我后来想明白了|我想明白了|后来想明白一个问题)[:：，,\s]*/u, '')
    .replace(/^(?:关于|对于)/u, ''));
}

function rewriteKnowledgeText(text) {
  return cleanText(stripLeadingPersonalContext(text));
}

function isTransitionClause(text) {
  return /^(?:但|不过|然而)?(?:我)?(?:后来)?(?:想明白了|意识到|发现了?|发现)$/.test(cleanText(text))
    || /^(?:但|不过|然而)?(?:我)?(?:后来)?(?:想明白了|意识到|发现了?|发现)[:：]?$/.test(cleanText(text));
}

function normalizeCitation(ref) {
  if (!ref) {
    return null;
  }

  if (typeof ref === 'string') {
    return {
      label: '来源',
      title: ref,
      url: '',
      blockId: '',
      blockUrl: '',
    };
  }

  const blockUrl = cleanText(ref.blockUrl ?? ref.block_url ?? ref.url ?? '');
  const docUrl = cleanText(ref.docUrl ?? ref.doc_url ?? ref.url ?? '');

  return {
    label: cleanText(ref.label ?? '来源') || '来源',
    title: cleanText(ref.title ?? ref.text ?? ref.docTitle ?? ref.doc_title ?? '未命名来源') || '未命名来源',
    url: blockUrl || docUrl,
    blockId: cleanText(ref.blockId ?? ref.block_id ?? ''),
    blockUrl,
  };
}

function renderLink(ref) {
  const citation = normalizeCitation(ref);
  if (!citation) {
    return '';
  }

  return citation.url ? `[${citation.title}](${citation.url})` : citation.title;
}

export function buildCitationMarkdown(citations = [], label = '') {
  const normalized = citations
    .map((item) => normalizeCitation(item))
    .filter(Boolean);

  if (normalized.length === 0) {
    return '';
  }

  const resolvedLabel = cleanText(label) || normalized[0].label || '来源';
  if (normalized.length === 1) {
    return `${resolvedLabel}：${renderLink(normalized[0])}`;
  }

  return [
    `${resolvedLabel}：`,
    ...normalized.map((item) => `- ${renderLink(item)}`),
  ].join('\n');
}

export function segmentKnowledgeBlocks(input = {}) {
  const payload = normalizeInput(input);
  const paragraphs = splitParagraphs(payload.content ?? payload.body ?? '');
  const sourceBlocks = Array.isArray(payload.sourceBlocks) ? payload.sourceBlocks : [];
  const sourceTitle = cleanText(payload.sourceTitle ?? payload.title ?? '今日日记') || '今日日记';
  const sourceDocUrl = cleanText(payload.sourceUrl ?? payload.docUrl ?? '');

  return paragraphs.map((text, index) => {
    const sourceBlock = sourceBlocks[index] ?? {};
    const blockId = cleanText(sourceBlock.blockId ?? sourceBlock.block_id ?? `raw-${index + 1}`) || `raw-${index + 1}`;
    const blockUrl = cleanText(sourceBlock.blockUrl ?? sourceBlock.block_url ?? '');
    return {
      id: `block-${index + 1}`,
      index,
      text,
      source: {
        title: sourceTitle,
        docUrl: sourceDocUrl,
        blockId,
        blockUrl,
      },
      citations: Array.isArray(sourceBlock.citations) ? sourceBlock.citations : [],
    };
  });
}

export function classifyKnowledgeContent(input) {
  const text = toText(input);
  const personalScore = countMatches(text, PERSONAL_PATTERNS);
  const knowledgeScore = countMatches(text, KNOWLEDGE_PATTERNS);
  const onlyPersonalScore = countMatches(text, PERSONAL_ONLY_PATTERNS);

  let type = 'personal';
  if (knowledgeScore > 0 && personalScore > 0) {
    type = 'mixed';
  } else if (knowledgeScore > 0) {
    type = 'generic';
  }

  if (onlyPersonalScore > 0 && knowledgeScore === 0) {
    type = 'personal';
  }

  return {
    type,
    personalScore,
    knowledgeScore,
  };
}

export function resolveKnowledgeTopics(input) {
  const text = toText(input);
  const topics = TOPIC_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.topic);

  const uniqueTopics = uniqueInOrder(topics);
  const orderedTopics = [
    ...uniqueTopics.filter((topic) => topic === '项目'),
    ...uniqueTopics.filter((topic) => topic !== '项目'),
  ];

  return {
    primaryTopic: orderedTopics[0] ?? '未分类',
    secondaryTopics: orderedTopics.slice(1),
  };
}

export function splitMixedKnowledge(input) {
  const payload = normalizeInput(input);
  const content = cleanText(payload.content ?? payload.summary ?? '');
  const sentences = splitSentences(content);
  const clauses = sentences.length > 1 ? sentences : splitClauses(content);
  const personalSegments = [];
  const knowledgeSegments = [];

  for (const clause of clauses) {
    if (isTransitionClause(clause)) {
      continue;
    }

    const type = classifySentenceType(clause);
    if (type === 'personal') {
      personalSegments.push(cleanText(clause));
      continue;
    }

    if (type === 'generic') {
      knowledgeSegments.push(rewriteKnowledgeText(clause));
      continue;
    }

    const trimmed = cleanText(clause);
    if (/问题不在|需要|应该|必须|更适合|适合负责|分类|引用机制|规则|方法/u.test(trimmed)) {
      knowledgeSegments.push(rewriteKnowledgeText(trimmed));
    } else {
      personalSegments.push(trimmed);
    }
  }

  if (knowledgeSegments.length === 0) {
    const fallback = rewriteKnowledgeText(content);
    if (fallback) {
      knowledgeSegments.push(fallback);
    }
  }

  const topics = resolveKnowledgeTopics(payload);
  const datePrefix = cleanText(payload.date ?? '');
  const baseTitle = cleanText(payload.title ?? '') || '今日日记';
  const personalTitle = datePrefix && !baseTitle.startsWith(`${datePrefix} `)
    ? `${datePrefix} ${baseTitle}`
    : baseTitle;
  const genericTitle = cleanText(payload.genericTitle ?? (
    topics.primaryTopic === '项目'
      ? `${topics.primaryTopic}文档`
      : `${topics.primaryTopic}主题文档`
  )) || '主题文档';

  return {
    classification: { type: 'mixed' },
    topics,
    personalSegments: uniqueInOrder(personalSegments),
    knowledgeSegments: uniqueInOrder(knowledgeSegments),
    personal: {
      title: personalTitle,
      entries: uniqueInOrder(personalSegments).map((text) => ({ text })),
    },
    generic: {
      title: genericTitle,
      entries: uniqueInOrder(knowledgeSegments).map((text) => ({ text })),
    },
  };
}

function renderEntry(entry) {
  const text = cleanText(entry?.text ?? entry?.content ?? '');
  if (!text) {
    return '';
  }

  const lines = [text];
  const citationMarkdown = buildCitationMarkdown(entry?.citations ?? [], entry?.citationLabel ?? '');
  if (citationMarkdown) {
    lines.push(citationMarkdown);
  }

  return lines.join('\n');
}

function renderEntryList(entries = []) {
  const rendered = entries
    .map((entry) => renderEntry(entry))
    .filter(Boolean);

  return rendered.length ? rendered.join('\n\n') : '暂无';
}

function renderLinkList(entries = []) {
  const rendered = entries
    .map((item) => renderLink(item))
    .filter(Boolean);

  return rendered.length ? rendered.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

function renderList(items = []) {
  const values = items
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map((item) => cleanText(item))
    .filter(Boolean);

  return values.length ? values.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

export function buildPersonalKnowledgeMarkdown({
  title = '',
  entries = [],
  sources = [],
} = {}) {
  return [
    `# ${cleanText(title) || '今日日记'}`,
    '',
    '## 今日日记',
    '',
    renderEntryList(entries),
    '',
    '## 来源',
    '',
    renderList(sources),
  ].join('\n');
}

export function buildGenericKnowledgeMarkdown({
  title = '',
  entries = [],
  sources = [],
} = {}) {
  return [
    `# ${cleanText(title) || '主题文档'}`,
    '',
    '## 知识结论',
    '',
    renderEntryList(entries),
    '',
    '## 来源',
    '',
    renderList(sources),
  ].join('\n');
}

export function buildDailyAdviceBlock({
  date = '',
  highlights = [],
  adviceItems = {},
  pageLinks = [],
} = {}) {
  const adviceLines = [];
  const entries = Object.entries(adviceItems ?? {});
  if (entries.length === 0) {
    adviceLines.push('- 暂无');
  } else {
    for (const [topic, items] of entries) {
      adviceLines.push(`#### ${topic}`);
      adviceLines.push('');
      adviceLines.push(renderList(items));
      adviceLines.push('');
    }
    if (adviceLines.at(-1) === '') {
      adviceLines.pop();
    }
  }

  return [
    `## ${cleanText(date)}`,
    '',
    '### 今日重点观察',
    '',
    renderList(highlights),
    '',
    '### 今日建议',
    '',
    adviceLines.join('\n'),
    '',
    '### 对应页面',
    '',
    renderLinkList(pageLinks),
  ].join('\n');
}

function renderIndexEntries(entries = []) {
  if (entries.length === 0) {
    return '- 暂无';
  }

  return entries.map((entry) => {
    const title = cleanText(entry?.title ?? '未命名页面') || '未命名页面';
    const url = cleanText(entry?.url ?? '');
    const topic = cleanText(entry?.topic ?? '');
    const summary = cleanText(entry?.summary ?? '');
    const kind = entry?.isShortcut ? '快捷方式' : '正文';
    const link = url ? `[${title}](${url})` : title;
    return `- ${link} | ${topic} | ${summary} | ${kind}`;
  }).join('\n');
}

export function buildAiAllPagesIndexMarkdown({
  personalEntries = [],
  genericEntries = [],
} = {}) {
  return [
    '# AI维基百科所有页面链接',
    '',
    '## 包含个人信息',
    '',
    renderIndexEntries(personalEntries),
    '',
    '## 不包含个人信息',
    '',
    renderIndexEntries(genericEntries),
  ].join('\n');
}
