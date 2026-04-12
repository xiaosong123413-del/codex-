/**
 * @typedef {{
 *   path?: string;
 *   title?: string;
 *   category?: string;
 *   abstract?: string;
 *   tags?: string[];
 *   headings?: string[];
 *   sources?: string[];
 *   text?: string;
 *   searchableTags?: string[];
 * }} KnowledgePage
 */

/**
 * @typedef {{
 *   pages?: KnowledgePage[];
 * }} PageMetaArtifact
 */

/**
 * @typedef {{
 *   path?: string;
 *   title?: string;
 *   category?: string;
 *   text?: string;
 *   tags?: string[];
 *   score?: number;
 * }} SearchDocument
 */

/**
 * @typedef {{
 *   documents?: SearchDocument[];
 * }} SearchIndexArtifact
 */

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function getSearchDocument(searchIndex, path) {
  return searchIndex?.documents?.find((document) => document.path === path) ?? null;
}

/**
 * @param {{
 *   pageMeta?: PageMetaArtifact;
 *   searchIndex?: SearchIndexArtifact;
 *   requestedPath?: string;
 *   preferredCategory?: string;
 * }} [options]
 * @returns {KnowledgePage | null}
 */
export function resolveActivePage({ pageMeta, searchIndex, requestedPath, preferredCategory } = {}) {
  const pages = pageMeta?.pages ?? [];
  const selectedPage =
    pages.find((page) => page.path === requestedPath) ??
    pages.find((page) => page.category === preferredCategory) ??
    pages[0] ??
    null;

  if (!selectedPage) {
    return null;
  }

  const searchDocument = getSearchDocument(searchIndex, selectedPage.path);
  return {
    ...selectedPage,
    text: searchDocument?.text ?? '',
    searchableTags: searchDocument?.tags ?? selectedPage.tags ?? [],
  };
}

/**
 * @param {{
 *   searchIndex?: SearchIndexArtifact;
 *   query?: string;
 *   limit?: number;
 * }} [options]
 * @returns {SearchDocument[]}
 */
export function searchKnowledge({ searchIndex, query, limit = 8 } = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return (searchIndex?.documents ?? []).slice(0, limit).map((document) => ({
      ...document,
      score: 0,
    }));
  }

  return (searchIndex?.documents ?? [])
    .map((document) => {
      const title = normalizeText(document.title);
      const path = normalizeText(document.path);
      const text = normalizeText(document.text);
      const tags = (document.tags ?? []).map(normalizeText);

      const score =
        countOccurrences(title, normalizedQuery) * 5 +
        countOccurrences(path, normalizedQuery) * 3 +
        tags.reduce((total, tag) => total + countOccurrences(tag, normalizedQuery) * 2, 0) +
        countOccurrences(text, normalizedQuery);

      return {
        ...document,
        score,
      };
    })
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, limit);
}

/**
 * @param {{
 *   lint?: { brokenLinks?: Array<{ from?: string; target?: string }>; orphanPages?: string[] };
 *   absorbLog?: { entries?: Record<string, { status?: string; notes?: string }> };
 *   persistedItems?: Array<{ id: string; sourcePath: string; status?: string; payloadJson?: string }>;
 * }} [options]
 */
export function buildReviewFeed({ lint, absorbLog, persistedItems = [] } = {}) {
  const persisted = persistedItems
    .filter((item) => item.status !== 'resolved')
    .map((item) => ({
      id: item.id,
      kind: 'persisted',
      sourcePath: item.sourcePath,
      status: item.status,
      payloadJson: item.payloadJson,
    }));

  const brokenLinks = (lint?.brokenLinks ?? []).map((entry, index) => ({
    id: `broken-${index}`,
    kind: 'broken-link',
    sourcePath: entry.from,
    target: entry.target,
    status: 'open',
  }));

  const orphanPages = (lint?.orphanPages ?? []).map((pagePath, index) => ({
    id: `orphan-${index}`,
    kind: 'orphan-page',
    sourcePath: pagePath,
    status: 'open',
  }));

  const absorbPending = Object.entries(absorbLog?.entries ?? {})
    .filter(([, entry]) => entry?.status === 'pending')
    .map(([sourcePath, entry]) => ({
      id: `absorb-${sourcePath}`,
      kind: 'absorb-pending',
      sourcePath,
      status: 'open',
      notes: entry.notes ?? '',
    }));

  return [...persisted, ...brokenLinks, ...orphanPages, ...absorbPending];
}

/**
 * @param {{
 *   prompt?: string;
 *   activePage?: KnowledgePage | null;
 *   matches?: SearchDocument[];
 * }} [options]
 */
export function buildFallbackReply({ prompt, activePage, matches = [] } = {}) {
  const lines = [];
  lines.push(`问题：${String(prompt ?? '').trim() || '未提供问题'}`);

  if (activePage) {
    lines.push(`当前页面：${activePage.title}（${activePage.path}）`);
    if (activePage.abstract) {
      lines.push(`页面摘要：${activePage.abstract}`);
    }
  }

  if (matches.length > 0) {
    lines.push('相关页面：');
    for (const match of matches.slice(0, 3)) {
      lines.push(`- ${match.title}（${match.path}）`);
    }
  } else {
    lines.push('相关页面：没有找到足够匹配的知识页。');
  }

  if (activePage?.sources?.length) {
    lines.push(`来源：${activePage.sources.join('，')}`);
  }

  lines.push('答复：当前工作台已基于知识库匹配出最相关页面，建议优先阅读上述页面与来源，再继续追问细化。');
  return lines.join('\n');
}

/**
 * @param {{
 *   topic?: string;
 *   searchIndex?: SearchIndexArtifact;
 *   pageMeta?: PageMetaArtifact;
 * }} [options]
 */
export function buildResearchBrief({ topic, searchIndex, pageMeta } = {}) {
  const getDocumentWeight = (document) => {
    const path = String(document?.path ?? '');
    const category = String(document?.category ?? '');

    if (/\/20\d{2}-\d{2}-\d{2}/.test(path) || /^20\d{2}-\d{2}-\d{2}/.test(path)) return 1;
    if (path.startsWith('概念/') || category === '概念') return 4;
    if (path.startsWith('项目/') || category === '项目') return 3;
    if (path.startsWith('工具/') || category === '工具') return 3;
    if (path.startsWith('人物/') || category === '人物') return 2;
    if (path.startsWith('想法/') || category === '想法') return 2;
    if (path.startsWith('写作/') || category === '写作') return 2;
    if (path.startsWith('来源/') || category === '来源') return 1;
    if (path.startsWith('归档/') || category === '归档') return 0;
    return 0;
  };
  const candidateSources = searchKnowledge({
    searchIndex,
    query: topic,
    limit: 12,
  })
    .sort(
      (left, right) =>
        getDocumentWeight(right) - getDocumentWeight(left) ||
        right.score - left.score
    )
    .slice(0, 5)
    .map((document) => ({
      path: document.path,
      title: document.title,
      category: document.category,
    }));

  const pageCount = pageMeta?.pages?.length ?? 0;
  return {
    topic: String(topic ?? '').trim(),
    candidateSources,
    questions: [
      `当前知识库中与“${topic}”最接近的现有结论是什么？`,
      `哪些来源页支撑这些结论，哪些仍然缺失？`,
      `如果要补一页正式知识页，标题和结构应该是什么？`,
    ],
    coverage: {
      totalPages: pageCount,
      matchedPages: candidateSources.length,
    },
  };
}
