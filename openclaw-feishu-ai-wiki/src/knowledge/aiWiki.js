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

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isDateTitle(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(cleanText(value));
}

export function normalizeDatePageTitle(date, fallbackTitle = '') {
  const normalizedDate = cleanText(date);
  if (isDateTitle(normalizedDate)) {
    return normalizedDate;
  }

  const normalizedFallback = cleanText(fallbackTitle);
  if (isDateTitle(normalizedFallback)) {
    return normalizedFallback;
  }

  return normalizedDate || normalizedFallback || new Date().toISOString().slice(0, 10);
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
  /准备/u,
  /朋友/u,
  /聊完/u,
  /生活/u,
  /感受/u,
  /身体/u,
  /情绪/u,
  /睡觉/u,
  /早点睡/u,
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
  /概念/u,
  /模型/u,
  /论文/u,
  /产品/u,
  /公司/u,
  /术语/u,
];

const PERSONAL_ONLY_PATTERNS = [
  /头疼/u,
  /心情好了很多/u,
  /早点睡/u,
  /有点累/u,
  /情绪/u,
  /身体/u,
  /日常/u,
];

const TOPIC_RULES = [
  { topic: '项目', patterns: [/项目/u, /系统/u, /飞书记录系统/u, /OpenClaw/u, /自动化/u] },
  { topic: '健康', patterns: [/健康/u, /身体/u, /头疼/u, /疲劳/u, /精力/u, /病痛/u, /恢复/u] },
  { topic: '睡眠', patterns: [/睡眠/u, /作息/u, /熬夜/u, /失眠/u, /早睡/u, /起床/u, /入睡/u] },
  { topic: '学习', patterns: [/学习/u, /复习/u, /背书/u, /专注/u, /效率/u, /考研/u] },
  { topic: '运动', patterns: [/运动/u, /锻炼/u, /训练/u, /恢复/u] },
  { topic: 'CRM', patterns: [/小王/u, /老师/u, /同学/u, /朋友/u, /聊天/u, /关系/u, /分工/u, /协作/u] },
  { topic: '工作方法', patterns: [/工作方法/u, /流程/u, /方法/u, /规则/u, /知识库/u, /治理/u] },
  { topic: '概念', patterns: [/RAG/u, /Agent Workflow/u, /Function Calling/u, /ReAct/u, /Chain-of-Thought/u, /Prompt Chaining/u] },
  { topic: '模型', patterns: [/GPT-4/u, /Claude/u, /Gemini/u] },
  { topic: '论文', patterns: [/paper/iu, /论文/u, /Knowledge-Intensive/u] },
];

const HEALTH_PATTERNS = [/睡眠/u, /作息/u, /头疼/u, /不适/u, /精力/u, /疲劳/u, /运动/u, /恢复/u, /饮食/u, /病痛/u];
const HEALTH_STRONG_PATTERNS = [/连续/u, /反复/u, /明显影响/u, /异常/u, /很疼/u, /严重/u, /失眠/u, /恢复效果/u];

const CRM_PATTERNS = [/小王/u, /张三/u, /李老师/u, /老师/u, /同学/u, /朋友/u, /合作/u, /关系/u, /聊天/u, /分工/u];
const CRM_STRONG_PATTERNS = [/反复出现/u, /重新分工/u, /关系判断/u, /持续影响/u, /理解出现变化/u, /长期维护/u, /重要/u];

const PROJECT_PATTERNS = [/项目/u, /系统/u, /记录系统/u, /OpenClaw/u, /双轨记录系统/u, /飞书记录系统/u];
const PROJECT_STRONG_PATTERNS = [/目标变化/u, /结构变化/u, /阶段变化/u, /关键任务/u, /关键方法/u, /反复出现/u, /长期性结论/u, /核心问题/u];

const AI_TOPIC_PATTERNS = [/概念/u, /模型/u, /方法/u, /论文/u, /术语/u, /定义/u, /产品/u, /公司/u, /RAG/u, /ReAct/u, /Prompt/u];
const AI_STRONG_PATTERNS = [/更清楚定义/u, /反复提及/u, /成熟稳定/u, /尚无主页面/u, /标准/u, /正式/u];

const CHINESE_NAME_PATTERN = /(?:小王|张三|李老师|李明|王老师|A|B)\b/u;

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
  return /^(?:但是|不过|然而)$/u.test(cleanText(text))
    || /^(?:但|但是|不过|然而)?(?:后来|我后来|后来我|我后来想明白了|我后来想明白|我想明白了|我意识到|我发现)[:：]?$/u.test(cleanText(text));
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
    return `${resolvedLabel}：[${normalized[0].title}](${normalized[0].url || ''})`.replace(/\(\)$/u, '');
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

function inferGenericPageTitle({ payload, topics, content }) {
  const explicitTitle = cleanText(payload.genericTitle ?? '');
  if (explicitTitle) {
    return explicitTitle;
  }

  const strippedTitle = stripLeadingDate(payload.title ?? '');
  if (topics.primaryTopic === '项目' && strippedTitle && !isDateTitle(strippedTitle)) {
    return strippedTitle;
  }

  if (topics.primaryTopic === '人物') {
    const matched = content.match(CHINESE_NAME_PATTERN);
    return matched?.[0] ?? '人物';
  }

  if (topics.primaryTopic === '健康') {
    return '健康';
  }

  return topics.primaryTopic || '未分类';
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
  const personalTitle = normalizeDatePageTitle(payload.date, payload.title);
  const genericTitle = inferGenericPageTitle({ payload, topics, content });

  return {
    classification: { type: 'mixed' },
    topics,
    personalSegments: uniqueInOrder(personalSegments),
    knowledgeSegments: uniqueInOrder(knowledgeSegments),
    personal: {
      title: personalTitle,
      pageType: 'personal-date',
      entries: uniqueInOrder(personalSegments).map((text) => ({ text })),
    },
    generic: {
      title: genericTitle,
      pageType: 'ai-concept',
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

function formatMetadataSection(metadata = {}) {
  const fields = [
    ['页面类型', metadata.pageType ?? '未分类页面'],
    ['所属容器', metadata.container ?? '待确认'],
    ['页面状态', metadata.status ?? '活跃'],
    ['创建时间', metadata.createdAt ?? ''],
    ['最近更新时间', metadata.updatedAt ?? ''],
    ['证据等级', metadata.evidenceLevel ?? '待补证'],
    ['风险等级', metadata.riskLevel ?? '中'],
    ['关键关联页面', metadata.relatedPagesText ?? ''],
    ['是否已纳入总索引', metadata.inIndex ?? '否'],
    ['是否已建立反向链接', metadata.hasBacklinks ?? '否'],
  ];

  if (metadata.staleRisk != null) {
    fields.push(['是否存在陈旧说法风险', metadata.staleRisk ? '是' : '否']);
  }
  if (metadata.conflictPending != null) {
    fields.push(['是否存在冲突待确认', metadata.conflictPending ? '是' : '否']);
  }

  return [
    '## 页面元数据',
    ...fields.map(([key, value]) => `- ${key}：${value}`),
  ].join('\n');
}

function buildDatePageMarkdown({ title, entries = [], sources = [], metadata = {} }) {
  return [
    `# ${title}`,
    '',
    formatMetadataSection({
      pageType: '个人-日期页',
      container: '个人信息汇集 / 按日期排列',
      evidenceLevel: 'P1',
      riskLevel: '中',
      ...metadata,
    }),
    '',
    '## 今日概览',
    '',
    renderList(entries.slice(0, 8).map((entry) => entry.text ?? entry.content ?? '')),
    '',
    '## 事项与进展',
    '',
    renderEntryList(entries),
    '',
    '## 状态变化',
    '',
    '- 待补充',
    '',
    '## 人物与关系动态',
    '',
    '- 待补充',
    '',
    '## 项目与知识动态',
    '',
    '- 待补充',
    '',
    '## 待跟进',
    '',
    '- 待补充',
    '',
    '## 相关页面',
    '',
    renderList(sources),
  ].join('\n');
}

function buildHealthPageMarkdown({ title, entries = [], sources = [], metadata = {} }) {
  return [
    `# ${title || '健康'}`,
    '',
    formatMetadataSection({
      pageType: '个人-健康页',
      container: '个人信息汇集 / 按主题分类',
      ...metadata,
      staleRisk: metadata.staleRisk ?? false,
      conflictPending: metadata.conflictPending ?? false,
    }),
    '',
    '## 页面定位',
    '',
    '- 长期追踪睡眠、精力、病痛、运动与恢复模式。',
    '',
    '## 核心摘要',
    '',
    renderEntryList(entries.slice(0, 3)),
    '',
    '## 睡眠',
    '',
    renderEntryList(entries.filter((entry) => /睡眠|作息|熬夜|早睡|起床|入睡/u.test(entry.text ?? ''))),
    '',
    '## 饮食',
    '',
    renderEntryList(entries.filter((entry) => /饮食|吃饭|咖啡|食物/u.test(entry.text ?? ''))),
    '',
    '## 精力',
    '',
    renderEntryList(entries.filter((entry) => /精力|疲劳|状态|专注|效率/u.test(entry.text ?? ''))),
    '',
    '## 病痛 / 不适',
    '',
    renderEntryList(entries.filter((entry) => /头疼|疼|不适|病痛|症状/u.test(entry.text ?? ''))),
    '',
    '## 运动',
    '',
    renderEntryList(entries.filter((entry) => /运动|锻炼|训练/u.test(entry.text ?? ''))),
    '',
    '## 恢复与调节',
    '',
    renderEntryList(entries.filter((entry) => /恢复|调节|休息/u.test(entry.text ?? ''))),
    '',
    '## 时间线 / 更新记录',
    '',
    renderList(entries.map((entry) => entry.text ?? '')),
    '',
    '## 相关页面',
    '',
    renderList(sources),
    '',
    '## 待确认 / 待观察',
    '',
    '- 待补充',
  ].join('\n');
}

function buildCrmPageMarkdown({ title, entries = [], sources = [], metadata = {} }) {
  return [
    `# ${title}`,
    '',
    formatMetadataSection({
      pageType: '个人-CRM页',
      container: '个人信息汇集 / 按主题分类 / CRM',
      ...metadata,
      staleRisk: metadata.staleRisk ?? false,
      conflictPending: metadata.conflictPending ?? false,
    }),
    '',
    '## 页面定位',
    '',
    '- 记录此人与我的关系、互动变化和后续维护方式。',
    '',
    '## 核心摘要',
    '',
    renderEntryList(entries.slice(0, 3)),
    '',
    '## 基本背景',
    '',
    '- 待补充',
    '',
    '## 与我的关系',
    '',
    renderEntryList(entries),
    '',
    '## 重要事件 / 过去发生过什么',
    '',
    renderEntryList(entries),
    '',
    '## 我的主观认知',
    '',
    '- 待补充',
    '',
    '## 后续如何维护或使用这段关系',
    '',
    '- 待补充',
    '',
    '## 时间线 / 更新记录',
    '',
    renderList(entries.map((entry) => entry.text ?? '')),
    '',
    '## 相关页面',
    '',
    renderList(sources),
    '',
    '## 待确认',
    '',
    '- 待补充',
  ].join('\n');
}

function buildAiGenericPageMarkdown({ title, entries = [], sources = [], metadata = {} }) {
  const firstEntry = entries[0]?.text ?? '';
  return [
    `# ${title}`,
    '',
    formatMetadataSection({
      pageType: metadata.pageType ?? 'AI-概念页',
      container: metadata.container ?? 'AI维基百科',
      ...metadata,
      staleRisk: metadata.staleRisk ?? false,
      conflictPending: metadata.conflictPending ?? false,
    }),
    '',
    '## 一句话定义',
    '',
    renderList(firstEntry ? [firstEntry] : []),
    '',
    '## 概述',
    '',
    renderEntryList(entries),
    '',
    '## 背景与发展',
    '',
    '- 待补充',
    '',
    '## 核心内容 / 核心机制',
    '',
    renderEntryList(entries),
    '',
    '## 应用 / 影响',
    '',
    '- 待补充',
    '',
    '## 局限 / 争议',
    '',
    '- 待补充',
    '',
    '## 相关条目',
    '',
    renderList(sources),
    '',
    '## 证据与来源',
    '',
    renderList(sources),
    '',
    '## 维护记录',
    '',
    '- 待补充',
  ].join('\n');
}

export function inferPersonalThemeCandidates(entries = []) {
  const candidates = [];
  for (const entry of entries) {
    const text = cleanText(entry?.text ?? entry?.content ?? '');
    if (!text) {
      continue;
    }

    if (matchesAny(text, HEALTH_PATTERNS)) {
      candidates.push({
        pageType: 'personal-health',
        title: '健康',
        topic: '健康',
        text,
        citations: entry.citations ?? [],
      });
    }

    if (matchesAny(text, CRM_PATTERNS)) {
      const matchedName = text.match(CHINESE_NAME_PATTERN)?.[0] ?? 'CRM';
      candidates.push({
        pageType: 'personal-crm',
        title: matchedName,
        topic: 'CRM',
        text,
        citations: entry.citations ?? [],
      });
    }

    if (matchesAny(text, PROJECT_PATTERNS)) {
      const title = /OpenClaw/u.test(text)
        ? 'OpenClaw 自动化系统'
        : /双轨记录系统/u.test(text)
          ? '双轨记录系统'
          : /飞书记录系统/u.test(text)
            ? '飞书记录系统'
            : '项目';
      candidates.push({
        pageType: 'personal-project',
        title,
        topic: '项目',
        text,
        citations: entry.citations ?? [],
      });
    }
  }

  return candidates;
}

export function shouldPromotePersonalTopic({ topic, entries = [] }) {
  const texts = entries.map((entry) => cleanText(entry?.text ?? entry?.content ?? '')).filter(Boolean);
  if (texts.length === 0) {
    return false;
  }

  const combined = texts.join('\n');
  if (topic === '健康') {
    return texts.length >= 2 || matchesAny(combined, HEALTH_STRONG_PATTERNS) || /影响学习|影响项目|影响生活/u.test(combined);
  }

  if (topic === 'CRM') {
    return texts.length >= 2 || matchesAny(combined, CRM_STRONG_PATTERNS);
  }

  if (topic === '项目') {
    return matchesAny(combined, PROJECT_STRONG_PATTERNS) || texts.length >= 2;
  }

  return false;
}

export function shouldPromoteGenericTopic({ title = '', entries = [] }) {
  const text = `${title}\n${entries.map((entry) => cleanText(entry?.text ?? entry?.content ?? '')).join('\n')}`;
  return matchesAny(text, AI_STRONG_PATTERNS)
    || matchesAny(text, AI_TOPIC_PATTERNS)
    || entries.length >= 2;
}

export function buildPersonalKnowledgeMarkdown({
  title = '',
  entries = [],
  sources = [],
  metadata = {},
  pageType = '',
} = {}) {
  const normalizedTitle = cleanText(title) || '今日日记';
  const resolvedPageType = cleanText(pageType);

  if (resolvedPageType === 'personal-health' || normalizedTitle === '健康') {
    return buildHealthPageMarkdown({ title: normalizedTitle, entries, sources, metadata });
  }

  if (resolvedPageType === 'personal-crm') {
    return buildCrmPageMarkdown({ title: normalizedTitle, entries, sources, metadata });
  }

  if (resolvedPageType === 'personal-date' || isDateTitle(normalizedTitle)) {
    return buildDatePageMarkdown({ title: normalizeDatePageTitle(normalizedTitle), entries, sources, metadata });
  }

  return [
    `# ${normalizedTitle}`,
    '',
    formatMetadataSection({
      pageType: resolvedPageType || '个人-主题页',
      container: '个人信息汇集 / 按主题分类',
      ...metadata,
      staleRisk: metadata.staleRisk ?? false,
      conflictPending: metadata.conflictPending ?? false,
    }),
    '',
    '## 页面定位',
    '',
    '- 待补充',
    '',
    '## 核心摘要',
    '',
    renderEntryList(entries.slice(0, 3)),
    '',
    '## 主要内容',
    '',
    renderEntryList(entries),
    '',
    '## 时间线 / 更新记录',
    '',
    renderList(entries.map((entry) => entry.text ?? '')),
    '',
    '## 相关页面',
    '',
    renderList(sources),
    '',
    '## 待确认',
    '',
    '- 待补充',
  ].join('\n');
}

export function buildGenericKnowledgeMarkdown({
  title = '',
  entries = [],
  sources = [],
  metadata = {},
  pageType = '',
} = {}) {
  return buildAiGenericPageMarkdown({
    title: cleanText(title) || '未命名条目',
    entries,
    sources,
    metadata: {
      pageType: pageType || metadata.pageType || 'AI-概念页',
      ...metadata,
    },
  });
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
    `## ${cleanText(date) || new Date().toISOString().slice(0, 10)}`,
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
