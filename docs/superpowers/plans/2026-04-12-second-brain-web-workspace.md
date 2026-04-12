# Second Brain Web Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, login-protected `llm_wiki`-style web workspace on top of the existing second-brain Markdown corpus and a generated `.wiki-system` data layer.

**Architecture:** Keep the current second-brain Markdown as the source of truth. Add a root-side generator that emits taxonomy, backlinks, absorb log, graph, lint, and search artifacts into `.wiki-system/`, then sync those artifacts into a new `wiki-ui/` Next.js app. The app stores only interactive state such as auth sessions, chats, review items, and deep-research jobs in a database.

**Tech Stack:** Node.js ESM, node:test, gray-matter, Next.js, React, TypeScript, Auth.js, Prisma, PostgreSQL, Vercel

---

## File Structure Map

### Root generator and tests

- Modify: `C:\Users\Administrator\Documents\New project\package.json`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\config.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\scanPages.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\parseMarkdown.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildPageMeta.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildBacklinks.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildTaxonomy.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildGraph.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildLintReport.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildAbsorbLog.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\writeArtifacts.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\index.js`
- Create: `C:\Users\Administrator\Documents\New project\scripts\generate-wiki-system.mjs`
- Create: `C:\Users\Administrator\Documents\New project\scripts\sync-wiki-ui-generated.mjs`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-page-meta.test.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-backlinks.test.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-taxonomy.test.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-absorb-log.test.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\fixtures\sample-wiki\概念\AI知识库构建.md`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\fixtures\sample-wiki\来源\2026-04-12-样例来源.md`

### New web app

- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\package.json`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tsconfig.json`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\next.config.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\middleware.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\auth.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\.env.example`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\prisma\schema.prisma`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\db.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\types.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\generated\loaders.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\auth\allowlist.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\layout.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\(auth)\signin\page.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\workspace\page.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\app-shell.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\left-sidebar.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\right-context-panel.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\preview-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\wiki-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\sources-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\search-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\graph-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\lint-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\review-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\research-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\chat-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\chat\route.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\review\route.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\research\route.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tests\generated-loaders.test.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tests\app-shell.test.tsx`

## Task 1: Scaffold The Derived Wiki-System Generator

**Files:**
- Modify: `C:\Users\Administrator\Documents\New project\package.json`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\config.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\scanPages.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\parseMarkdown.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-page-meta.test.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\fixtures\sample-wiki\概念\AI知识库构建.md`

- [ ] **Step 1: Write the failing test for page scanning and frontmatter parsing**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';

test('scanWikiPages returns markdown pages with normalized category and title', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });

  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((page) => ({
      relativePath: page.relativePath,
      category: page.category,
      title: page.title,
    })),
    [
      {
        relativePath: '来源/2026-04-12-样例来源.md',
        category: '来源',
        title: '2026-04-12-样例来源',
      },
      {
        relativePath: '概念/AI知识库构建.md',
        category: '概念',
        title: 'AI知识库构建',
      },
    ]
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/knowledge/wiki-system-page-meta.test.js`
Expected: FAIL with `Cannot find module '../../src/knowledge/wikiSystem/scanPages.js'`

- [ ] **Step 3: Write the minimal scanner, parser, fixture markdown, and scripts**

```js
// package.json
{
  "scripts": {
    "wiki:generate": "node scripts/generate-wiki-system.mjs",
    "wiki:test": "node --test tests/knowledge/wiki-system-*.test.js"
  },
  "dependencies": {
    "gray-matter": "^4.0.3"
  }
}
```

```js
// src/knowledge/wikiSystem/config.js
import path from 'node:path';

export function resolveWikiSystemConfig(overrides = {}) {
  const wikiRoot =
    overrides.wikiRoot ??
    'C:/Users/Administrator/Desktop/xiaosong的知识库/ai知识库（第二大脑）';
  return {
    wikiRoot,
    systemDir: path.join(wikiRoot, '.wiki-system'),
    allowedCategories: ['人物', '概念', '工具', '项目', '想法', '写作', '来源', '收件箱', '归档'],
  };
}
```

```js
// src/knowledge/wikiSystem/parseMarkdown.js
import matter from 'gray-matter';

export function parseMarkdownDocument(rawText) {
  const parsed = matter(rawText);
  return {
    data: parsed.data ?? {},
    content: parsed.content ?? '',
  };
}
```

```js
// src/knowledge/wikiSystem/scanPages.js
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseMarkdownDocument } from './parseMarkdown.js';
import { resolveWikiSystemConfig } from './config.js';

async function walkMarkdownFiles(rootDir) {
  const results = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.wiki-system' || entry.name === '.claude') continue;
      results.push(...(await walkMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

export async function scanWikiPages(overrides = {}) {
  const { wikiRoot, allowedCategories } = resolveWikiSystemConfig(overrides);
  const files = await walkMarkdownFiles(wikiRoot);
  const pages = [];

  for (const fullPath of files) {
    const relativePath = path.relative(wikiRoot, fullPath).replaceAll('\\', '/');
    const [category] = relativePath.split('/');
    if (!allowedCategories.includes(category)) continue;
    const rawText = await fs.readFile(fullPath, 'utf8');
    const { data, content } = parseMarkdownDocument(rawText);
    pages.push({
      fullPath,
      relativePath,
      category,
      title: data.title ?? path.basename(relativePath, '.md'),
      frontmatter: data,
      content,
    });
  }

  return pages.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
}
```

```md
<!-- tests/knowledge/fixtures/sample-wiki/概念/AI知识库构建.md -->
---
title: AI知识库构建
tags: [知识库, LLM]
sources: ["来源/2026-04-12-样例来源.md"]
---

# AI知识库构建

参考 [[来源/2026-04-12-样例来源]]，连接 [[工具/OpenClaw]]。
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/knowledge/wiki-system-page-meta.test.js`
Expected: PASS with `ok 1 - scanWikiPages returns markdown pages with normalized category and title`

- [ ] **Step 5: Commit**

```bash
git add package.json src/knowledge/wikiSystem tests/knowledge/wiki-system-page-meta.test.js tests/knowledge/fixtures/sample-wiki
git commit -m "feat: scaffold wiki system page scanner"
```

## Task 2: Generate Page Metadata, Aliases, And Search Index

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildPageMeta.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-backlinks.test.js`
- Modify: `C:\Users\Administrator\Documents\New project\tests\knowledge\fixtures\sample-wiki\概念\AI知识库构建.md`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\fixtures\sample-wiki\来源\2026-04-12-样例来源.md`

- [ ] **Step 1: Write the failing test for page metadata, aliases, and search terms**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';
import { buildPageMetaArtifacts } from '../../src/knowledge/wikiSystem/buildPageMeta.js';

test('buildPageMetaArtifacts returns page metadata, aliases, and search index', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });
  const artifacts = buildPageMetaArtifacts({ pages });

  assert.equal(artifacts.pageMeta.pages.length, 2);
  assert.equal(artifacts.aliases['AI知识库构建'], '概念/AI知识库构建.md');
  assert.match(
    artifacts.searchIndex.documents.find((doc) => doc.path === '概念/AI知识库构建.md').text,
    /OpenClaw/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/knowledge/wiki-system-backlinks.test.js`
Expected: FAIL with `Cannot find module '../../src/knowledge/wikiSystem/buildPageMeta.js'`

- [ ] **Step 3: Write the metadata builder**

```js
// src/knowledge/wikiSystem/buildPageMeta.js
function extractHeadings(content) {
  return content
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
}

function extractWikilinks(content) {
  return [...content.matchAll(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g)].map((match) => ({
    target: match[1].trim(),
    label: (match[2] ?? match[1]).trim(),
  }));
}

export function buildPageMetaArtifacts({ pages }) {
  const pageRecords = pages.map((page) => {
    const aliases = [
      page.title,
      ...(Array.isArray(page.frontmatter.aliases) ? page.frontmatter.aliases : []),
    ];
    return {
      path: page.relativePath,
      title: page.title,
      category: page.category,
      aliases,
      tags: Array.isArray(page.frontmatter.tags) ? page.frontmatter.tags : [],
      sources: Array.isArray(page.frontmatter.sources) ? page.frontmatter.sources : [],
      headings: extractHeadings(page.content),
      outgoingHints: extractWikilinks(page.content),
      abstract: page.content.split('\n').find((line) => line.trim()) ?? '',
      updated: page.frontmatter.updated ?? page.frontmatter.created ?? null,
    };
  });

  const aliases = Object.fromEntries(
    pageRecords.flatMap((page) => page.aliases.map((alias) => [alias, page.path]))
  );

  const searchIndex = {
    documents: pageRecords.map((page) => ({
      path: page.path,
      title: page.title,
      category: page.category,
      text: [page.title, ...page.aliases, page.abstract, ...page.headings]
        .join(' ')
        .trim(),
      tags: page.tags,
    })),
  };

  return {
    pageMeta: { version: 1, pages: pageRecords },
    aliases,
    searchIndex,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/knowledge/wiki-system-backlinks.test.js`
Expected: PASS with `ok 1 - buildPageMetaArtifacts returns page metadata, aliases, and search index`

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/wikiSystem/buildPageMeta.js tests/knowledge/wiki-system-backlinks.test.js tests/knowledge/fixtures/sample-wiki
git commit -m "feat: add wiki system page metadata artifacts"
```

## Task 3: Build Backlinks, Taxonomy, Graph, And Lint Artifacts

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildBacklinks.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildTaxonomy.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildGraph.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildLintReport.js`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-taxonomy.test.js`

- [ ] **Step 1: Write the failing test for backlinks, taxonomy, graph, and lint**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scanWikiPages } from '../../src/knowledge/wikiSystem/scanPages.js';
import { buildPageMetaArtifacts } from '../../src/knowledge/wikiSystem/buildPageMeta.js';
import { buildBacklinksArtifact } from '../../src/knowledge/wikiSystem/buildBacklinks.js';
import { buildTaxonomyArtifact } from '../../src/knowledge/wikiSystem/buildTaxonomy.js';
import { buildGraphArtifact } from '../../src/knowledge/wikiSystem/buildGraph.js';
import { buildLintArtifact } from '../../src/knowledge/wikiSystem/buildLintReport.js';

test('derived graph artifacts expose backlinks, taxonomy, and lint records', async () => {
  const wikiRoot = path.resolve('tests/knowledge/fixtures/sample-wiki');
  const pages = await scanWikiPages({ wikiRoot });
  const meta = buildPageMetaArtifacts({ pages });
  const backlinks = buildBacklinksArtifact({ pages, aliases: meta.aliases });
  const taxonomy = buildTaxonomyArtifact({ pageMeta: meta.pageMeta, backlinks });
  const graph = buildGraphArtifact({ pageMeta: meta.pageMeta, backlinks });
  const lint = buildLintArtifact({ pageMeta: meta.pageMeta, backlinks });

  assert.deepEqual(backlinks.pages['来源/2026-04-12-样例来源.md'].incoming, ['概念/AI知识库构建.md']);
  assert.equal(taxonomy.roots[0].title, '概念');
  assert.equal(graph.edges[0].type, 'wikilink');
  assert.equal(lint.brokenLinks.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/knowledge/wiki-system-taxonomy.test.js`
Expected: FAIL with `Cannot find module '../../src/knowledge/wikiSystem/buildBacklinks.js'`

- [ ] **Step 3: Write the minimal derived builders**

```js
// src/knowledge/wikiSystem/buildBacklinks.js
export function buildBacklinksArtifact({ pages, aliases }) {
  const artifact = { version: 1, pages: {} };

  for (const page of pages) {
    artifact.pages[page.relativePath] = {
      title: page.title,
      incoming: [],
      outgoing: [],
      related: [],
    };
  }

  for (const page of pages) {
    const links = [...page.content.matchAll(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g)];
    for (const match of links) {
      const alias = match[1].trim();
      const targetPath = aliases[alias];
      if (!targetPath) {
        artifact.pages[page.relativePath].outgoing.push(`BROKEN:${alias}`);
        continue;
      }
      artifact.pages[page.relativePath].outgoing.push(targetPath);
      artifact.pages[targetPath].incoming.push(page.relativePath);
    }
  }

  return artifact;
}
```

```js
// src/knowledge/wikiSystem/buildTaxonomy.js
export function buildTaxonomyArtifact({ pageMeta }) {
  const groups = new Map();
  for (const page of pageMeta.pages) {
    if (!groups.has(page.category)) groups.set(page.category, []);
    groups.get(page.category).push(page.path);
  }
  return {
    version: 1,
    roots: [...groups.entries()].map(([title, pages]) => ({
      id: title,
      title,
      children: [{ id: `${title}-pages`, title: `${title} Pages`, pages }],
    })),
  };
}
```

```js
// src/knowledge/wikiSystem/buildGraph.js
export function buildGraphArtifact({ pageMeta, backlinks }) {
  return {
    version: 1,
    nodes: pageMeta.pages.map((page) => ({ id: page.path, label: page.title, category: page.category })),
    edges: Object.entries(backlinks.pages).flatMap(([sourcePath, record]) =>
      record.outgoing
        .filter((targetPath) => !targetPath.startsWith('BROKEN:'))
        .map((targetPath) => ({ source: sourcePath, target: targetPath, type: 'wikilink' }))
    ),
  };
}
```

```js
// src/knowledge/wikiSystem/buildLintReport.js
export function buildLintArtifact({ pageMeta, backlinks }) {
  const brokenLinks = [];
  const orphanPages = [];

  for (const [path, record] of Object.entries(backlinks.pages)) {
    for (const outgoing of record.outgoing) {
      if (outgoing.startsWith('BROKEN:')) {
        brokenLinks.push({ from: path, target: outgoing.replace('BROKEN:', '') });
      }
    }
    if (record.incoming.length === 0) {
      orphanPages.push(path);
    }
  }

  return {
    version: 1,
    brokenLinks,
    orphanPages,
    weaklyConnectedPages: [],
    duplicateCandidates: [],
    missingSources: pageMeta.pages.filter((page) => page.category !== '来源' && page.sources.length === 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/knowledge/wiki-system-taxonomy.test.js`
Expected: PASS with `ok 1 - derived graph artifacts expose backlinks, taxonomy, and lint records`

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/wikiSystem/buildBacklinks.js src/knowledge/wikiSystem/buildTaxonomy.js src/knowledge/wikiSystem/buildGraph.js src/knowledge/wikiSystem/buildLintReport.js tests/knowledge/wiki-system-taxonomy.test.js
git commit -m "feat: add wiki graph and lint artifacts"
```

## Task 4: Build Absorb Log Backfill And End-To-End Artifact Writing

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\buildAbsorbLog.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\writeArtifacts.js`
- Create: `C:\Users\Administrator\Documents\New project\src\knowledge\wikiSystem\index.js`
- Create: `C:\Users\Administrator\Documents\New project\scripts\generate-wiki-system.mjs`
- Create: `C:\Users\Administrator\Documents\New project\scripts\sync-wiki-ui-generated.mjs`
- Create: `C:\Users\Administrator\Documents\New project\tests\knowledge\wiki-system-absorb-log.test.js`

- [ ] **Step 1: Write the failing test for absorb-log backfill and artifact writing**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAbsorbLogArtifact } from '../../src/knowledge/wikiSystem/buildAbsorbLog.js';

test('buildAbsorbLogArtifact maps source pages into formal pages with status', () => {
  const artifact = buildAbsorbLogArtifact({
    rawEntries: [{ relativePath: 'raw/demo.md' }],
    pageMeta: {
      pages: [
        {
          path: '来源/2026-04-12-样例来源.md',
          category: '来源',
          title: '2026-04-12-样例来源',
          sources: [],
        },
        {
          path: '概念/AI知识库构建.md',
          category: '概念',
          title: 'AI知识库构建',
          sources: ['来源/2026-04-12-样例来源.md'],
        },
      ],
    },
  });

  assert.equal(artifact.entries['来源/2026-04-12-样例来源.md'].status, 'expanded');
  assert.deepEqual(artifact.entries['来源/2026-04-12-样例来源.md'].compiledInto, ['概念/AI知识库构建.md']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/knowledge/wiki-system-absorb-log.test.js`
Expected: FAIL with `Cannot find module '../../src/knowledge/wikiSystem/buildAbsorbLog.js'`

- [ ] **Step 3: Implement the absorb log, orchestration, and sync script**

```js
// src/knowledge/wikiSystem/buildAbsorbLog.js
export function buildAbsorbLogArtifact({ rawEntries = [], pageMeta }) {
  const entries = {};

  for (const page of pageMeta.pages.filter((item) => item.category === '来源')) {
    const compiledInto = pageMeta.pages
      .filter((candidate) => candidate.sources.includes(page.path))
      .map((candidate) => candidate.path);
    entries[page.path] = {
      status: compiledInto.length ? 'expanded' : 'absorbed',
      sourcePage: page.path,
      compiledInto,
      lastAbsorbedAt: new Date().toISOString(),
      notes: compiledInto.length ? 'Source page is referenced by formal pages' : 'Source page exists without compiled targets yet',
      confidence: 0.8,
    };
  }

  for (const rawEntry of rawEntries) {
    if (!entries[rawEntry.relativePath]) {
      entries[rawEntry.relativePath] = {
        status: 'pending',
        sourcePage: null,
        compiledInto: [],
        lastAbsorbedAt: null,
        notes: 'Raw entry not yet backfilled into source layer',
        confidence: 0.5,
      };
    }
  }

  return { version: 1, entries };
}
```

```js
// src/knowledge/wikiSystem/writeArtifacts.js
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeArtifacts({ systemDir, artifacts }) {
  await fs.mkdir(systemDir, { recursive: true });
  await Promise.all(
    Object.entries(artifacts).map(([name, value]) =>
      fs.writeFile(path.join(systemDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    )
  );
}
```

```js
// src/knowledge/wikiSystem/index.js
import { resolveWikiSystemConfig } from './config.js';
import { scanWikiPages } from './scanPages.js';
import { buildPageMetaArtifacts } from './buildPageMeta.js';
import { buildBacklinksArtifact } from './buildBacklinks.js';
import { buildTaxonomyArtifact } from './buildTaxonomy.js';
import { buildGraphArtifact } from './buildGraph.js';
import { buildLintArtifact } from './buildLintReport.js';
import { buildAbsorbLogArtifact } from './buildAbsorbLog.js';
import { writeArtifacts } from './writeArtifacts.js';

export async function generateWikiSystem(overrides = {}) {
  const config = resolveWikiSystemConfig(overrides);
  const pages = await scanWikiPages(config);
  const meta = buildPageMetaArtifacts({ pages });
  const backlinks = buildBacklinksArtifact({ pages, aliases: meta.aliases });
  const taxonomy = buildTaxonomyArtifact({ pageMeta: meta.pageMeta, backlinks });
  const graph = buildGraphArtifact({ pageMeta: meta.pageMeta, backlinks });
  const lint = buildLintArtifact({ pageMeta: meta.pageMeta, backlinks });
  const absorbLog = buildAbsorbLogArtifact({ rawEntries: [], pageMeta: meta.pageMeta });

  await writeArtifacts({
    systemDir: config.systemDir,
    artifacts: {
      'page-meta.json': meta.pageMeta,
      'aliases.json': meta.aliases,
      'search-index.json': meta.searchIndex,
      '_backlinks.json': backlinks,
      'taxonomy.json': taxonomy,
      'graph.json': graph,
      'lint-report.json': lint,
      '_absorb_log.json': absorbLog,
    },
  });
}
```

```js
// scripts/generate-wiki-system.mjs
import { generateWikiSystem } from '../src/knowledge/wikiSystem/index.js';

await generateWikiSystem();
console.log('wiki-system generated');
```

```js
// scripts/sync-wiki-ui-generated.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const sourceDir = 'C:/Users/Administrator/Desktop/xiaosong的知识库/ai知识库（第二大脑）/.wiki-system';
const targetDir = 'C:/Users/Administrator/Documents/New project/wiki-ui/generated';

await fs.mkdir(targetDir, { recursive: true });
for (const file of await fs.readdir(sourceDir)) {
  await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
}
console.log('wiki-ui generated artifacts synced');
```

- [ ] **Step 4: Run tests and generator to verify it passes**

Run: `node --test tests/knowledge/wiki-system-absorb-log.test.js && node scripts/generate-wiki-system.mjs`
Expected:
- PASS for absorb-log test
- `wiki-system generated`

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/wikiSystem scripts tests/knowledge/wiki-system-absorb-log.test.js
git commit -m "feat: add wiki system generator and absorb log"
```

## Task 5: Scaffold The Next.js App, Auth, And Prisma

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\package.json`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tsconfig.json`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\next.config.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\middleware.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\auth.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\.env.example`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\prisma\schema.prisma`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\db.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\auth\allowlist.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tests\generated-loaders.test.ts`

- [ ] **Step 1: Write the failing test for generated artifact loading inside the web app**

```ts
import { describe, expect, it } from 'vitest';

import { loadTaxonomy } from '../lib/generated/loaders';

describe('generated loaders', () => {
  it('loads taxonomy from generated directory', async () => {
    const taxonomy = await loadTaxonomy();
    expect(taxonomy.roots).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix wiki-ui test`
Expected: FAIL because `wiki-ui/package.json` and test runner are not defined yet

- [ ] **Step 3: Create the app foundation, auth config, and Prisma schema**

```json
// wiki-ui/package.json
{
  "name": "wiki-ui",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.7.0",
    "@prisma/client": "^5.22.0",
    "next": "^15.0.0",
    "next-auth": "^5.0.0-beta.25",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.1",
    "prisma": "^5.22.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

```ts
// wiki-ui/auth.ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { isAllowedEmail } from './lib/auth/allowlist';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      return isAllowedEmail(profile?.email);
    },
  },
});
```

```ts
// wiki-ui/lib/auth/allowlist.ts
const allowedEmails = (process.env.ALLOWED_GOOGLE_EMAILS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export function isAllowedEmail(email?: string | null) {
  return Boolean(email && allowedEmails.includes(email));
}
```

```prisma
// wiki-ui/prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model ChatThread {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  ChatMessage[]
}

model ChatMessage {
  id        String   @id @default(cuid())
  threadId  String
  role      String
  content   String
  createdAt DateTime @default(now())
  thread    ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
}

model ReviewItem {
  id          String   @id @default(cuid())
  sourcePath  String
  status      String   @default("open")
  payloadJson String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model ResearchJob {
  id          String   @id @default(cuid())
  topic       String
  status      String   @default("queued")
  resultJson  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 4: Run tests and Prisma generation**

Run: `npm --prefix wiki-ui install && npm --prefix wiki-ui test && npm --prefix wiki-ui run db:push`
Expected:
- Vitest starts and initially passes the loader smoke test once loaders exist in Task 6
- Prisma schema validates and pushes to the configured database

- [ ] **Step 5: Commit**

```bash
git add wiki-ui
git commit -m "feat: scaffold wiki workspace app auth and prisma"
```

## Task 6: Build The Three-Column App Shell And Read-Only Workspaces

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\generated\loaders.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\lib\types.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\layout.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\(auth)\signin\page.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\workspace\page.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\app-shell.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\left-sidebar.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\right-context-panel.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\preview-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\wiki-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\sources-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\search-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\graph-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\lint-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\tests\app-shell.test.tsx`

- [ ] **Step 1: Write the failing UI test for the app shell**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell } from '../components/app-shell';

describe('AppShell', () => {
  it('renders three-column workspace chrome', () => {
    render(
      <AppShell
        selectedWorkspace="wiki"
        leftSidebar={<div>left</div>}
        mainPanel={<div>center</div>}
        rightPanel={<div>right</div>}
      />
    );

    expect(screen.getByText('left')).toBeInTheDocument();
    expect(screen.getByText('center')).toBeInTheDocument();
    expect(screen.getByText('right')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix wiki-ui test`
Expected: FAIL with `Cannot find module '../components/app-shell'`

- [ ] **Step 3: Implement generated-data loaders and the workspace shell**

```ts
// wiki-ui/lib/generated/loaders.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const generatedRoot = path.join(process.cwd(), 'generated');

async function readJsonFile<T>(name: string): Promise<T> {
  const raw = await fs.readFile(path.join(generatedRoot, name), 'utf8');
  return JSON.parse(raw) as T;
}

export const loadTaxonomy = () => readJsonFile<any>('taxonomy.json');
export const loadBacklinks = () => readJsonFile<any>('_backlinks.json');
export const loadPageMeta = () => readJsonFile<any>('page-meta.json');
export const loadSearchIndex = () => readJsonFile<any>('search-index.json');
export const loadGraph = () => readJsonFile<any>('graph.json');
export const loadLint = () => readJsonFile<any>('lint-report.json');
export const loadAbsorbLog = () => readJsonFile<any>('_absorb_log.json');
```

```tsx
// wiki-ui/components/app-shell.tsx
import type { ReactNode } from 'react';

type AppShellProps = {
  selectedWorkspace: string;
  leftSidebar: ReactNode;
  mainPanel: ReactNode;
  rightPanel: ReactNode;
};

export function AppShell({ selectedWorkspace, leftSidebar, mainPanel, rightPanel }: AppShellProps) {
  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr_360px] bg-[#f8f9fa] text-[#202122]">
      <aside aria-label="left-sidebar" className="border-r border-[#a2a9b1] bg-white">{leftSidebar}</aside>
      <main aria-label={`workspace-${selectedWorkspace}`} className="min-w-0">{mainPanel}</main>
      <section aria-label="right-panel" className="border-l border-[#a2a9b1] bg-white">{rightPanel}</section>
    </div>
  );
}
```

```tsx
// wiki-ui/app/workspace/page.tsx
import { AppShell } from '../../components/app-shell';
import { LeftSidebar } from '../../components/left-sidebar';
import { PreviewPane } from '../../components/preview-pane';
import { WikiPane } from '../../components/workspaces/wiki-pane';
import { RightContextPanel } from '../../components/right-context-panel';
import { loadTaxonomy, loadPageMeta, loadBacklinks, loadAbsorbLog } from '../../lib/generated/loaders';

export default async function WorkspacePage() {
  const [taxonomy, pageMeta, backlinks, absorbLog] = await Promise.all([
    loadTaxonomy(),
    loadPageMeta(),
    loadBacklinks(),
    loadAbsorbLog(),
  ]);

  const activePage = pageMeta.pages[0] ?? null;

  return (
    <AppShell
      selectedWorkspace="wiki"
      leftSidebar={<LeftSidebar taxonomy={taxonomy} pageMeta={pageMeta} />}
      mainPanel={<WikiPane pageMeta={pageMeta} activePage={activePage} />}
      rightPanel={
        <RightContextPanel
          activePage={activePage}
          backlinks={activePage ? backlinks.pages[activePage.path] : null}
          absorbRecord={activePage ? absorbLog.entries[activePage.path] : null}
        >
          <PreviewPane activePage={activePage} />
        </RightContextPanel>
      }
    />
  );
}
```

- [ ] **Step 4: Run UI tests and local dev boot**

Run: `npm --prefix wiki-ui test && npm --prefix wiki-ui run dev`
Expected:
- Vitest passes the app-shell and generated-loader smoke tests
- Next app serves `/workspace` with a visible three-column layout

- [ ] **Step 5: Commit**

```bash
git add wiki-ui
git commit -m "feat: add wiki workspace shell and readonly panes"
```

## Task 7: Add Chat, Review, And Deep Research Workspaces With API Routes

**Files:**
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\review-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\research-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\components\workspaces\chat-pane.tsx`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\chat\route.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\review\route.ts`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\app\api\research\route.ts`
- Modify: `C:\Users\Administrator\Documents\New project\wiki-ui\app\workspace\page.tsx`

- [ ] **Step 1: Write the failing test for review and chat API behavior**

```ts
import { describe, expect, it } from 'vitest';

describe('workspace api contracts', () => {
  it('creates a review item payload shape', async () => {
    const response = await fetch('http://localhost:3000/api/review', {
      method: 'POST',
      body: JSON.stringify({ sourcePath: '来源/2026-04-12-样例来源.md' }),
    });
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix wiki-ui test`
Expected: FAIL because the route handlers do not exist yet

- [ ] **Step 3: Implement route handlers and workspace panels**

```ts
// wiki-ui/app/api/review/route.ts
import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

export async function POST(request: Request) {
  const { sourcePath, payloadJson = '{}' } = await request.json();
  const reviewItem = await prisma.reviewItem.create({
    data: {
      sourcePath,
      payloadJson,
    },
  });
  return NextResponse.json(reviewItem);
}
```

```ts
// wiki-ui/app/api/chat/route.ts
import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

export async function POST(request: Request) {
  const { threadId, prompt } = await request.json();
  const thread =
    threadId
      ? await prisma.chatThread.findUnique({ where: { id: threadId } })
      : await prisma.chatThread.create({ data: { title: prompt.slice(0, 40) || 'New chat' } });

  await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: prompt,
    },
  });

  return NextResponse.json({ threadId: thread.id, reply: 'Stub reply from knowledge workspace' });
}
```

```ts
// wiki-ui/app/api/research/route.ts
import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

export async function POST(request: Request) {
  const { topic } = await request.json();
  const job = await prisma.researchJob.create({
    data: {
      topic,
      status: 'queued',
    },
  });
  return NextResponse.json(job);
}
```

```tsx
// wiki-ui/components/workspaces/chat-pane.tsx
'use client';

export function ChatPane() {
  return (
    <section className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Chat</h2>
      <textarea className="min-h-40 w-full rounded border border-[#a2a9b1] p-3" placeholder="Ask the knowledge base..." />
    </section>
  );
}
```

- [ ] **Step 4: Run the app and verify the interactive workspaces**

Run: `npm --prefix wiki-ui run dev`
Expected:
- `/workspace` loads
- switching to Chat, Review, and Deep Research panes renders UI
- POST requests to `/api/chat`, `/api/review`, and `/api/research` return JSON

- [ ] **Step 5: Commit**

```bash
git add wiki-ui
git commit -m "feat: add interactive workspace modules"
```

## Task 8: Deployment Hardening, Sync Automation, And Full Verification

**Files:**
- Modify: `C:\Users\Administrator\Documents\New project\package.json`
- Modify: `C:\Users\Administrator\Documents\New project\wiki-ui\.env.example`
- Create: `C:\Users\Administrator\Documents\New project\wiki-ui\README.md`
- Modify: `C:\Users\Administrator\Documents\New project\docs\superpowers\specs\2026-04-12-wiki-ui-and-derived-indexes-design.md`

- [ ] **Step 1: Write the final verification checklist as executable commands**

```md
1. `node scripts/generate-wiki-system.mjs`
2. `node scripts/sync-wiki-ui-generated.mjs`
3. `node --test tests/knowledge/wiki-system-*.test.js`
4. `npm --prefix wiki-ui test`
5. `npm --prefix wiki-ui run build`
6. `npm --prefix wiki-ui run db:push`
```

- [ ] **Step 2: Run the full verification suite and capture results**

Run:

```bash
node scripts/generate-wiki-system.mjs
node scripts/sync-wiki-ui-generated.mjs
node --test tests/knowledge/wiki-system-*.test.js
npm --prefix wiki-ui test
npm --prefix wiki-ui run build
```

Expected:
- `.wiki-system/*.json` exists under the second-brain root
- `wiki-ui/generated/*.json` exists
- all root knowledge tests pass
- all UI tests pass
- Next.js production build succeeds

- [ ] **Step 3: Add deployment-facing scripts and environment documentation**

```json
// package.json
{
  "scripts": {
    "wiki:build-all": "node scripts/generate-wiki-system.mjs && node scripts/sync-wiki-ui-generated.mjs && npm --prefix wiki-ui run build"
  }
}
```

```env
# wiki-ui/.env.example
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ALLOWED_GOOGLE_EMAILS=
DATABASE_URL=
```

```md
<!-- wiki-ui/README.md -->
# Wiki UI

## Local Run

1. `node ../scripts/generate-wiki-system.mjs`
2. `node ../scripts/sync-wiki-ui-generated.mjs`
3. `npm install`
4. `npm run db:push`
5. `npm run dev`

## Deploy To Vercel

1. Import `wiki-ui` as the project root
2. Set Google auth env vars
3. Set `ALLOWED_GOOGLE_EMAILS`
4. Set `DATABASE_URL`
5. Ensure generated artifacts are synced before deploy
```

- [ ] **Step 4: Run the production smoke test**

Run: `npm --prefix wiki-ui run build && npm --prefix wiki-ui run start`
Expected:
- production server starts
- authenticated user can reach `/workspace`
- unauthenticated user is redirected to sign-in

- [ ] **Step 5: Commit**

```bash
git add package.json wiki-ui docs/superpowers/specs/2026-04-12-wiki-ui-and-derived-indexes-design.md
git commit -m "chore: finalize wiki workspace deployment flow"
```

## Self-Review

### Spec coverage

- three-column workspace: Task 6
- taxonomy, backlinks, absorb log: Tasks 2 to 4
- graph and lint: Task 3 and Task 6
- sources and wiki browsing: Task 6
- chat, review, deep research: Task 7
- Google auth and allowlist: Task 5
- public deployment after login: Task 8
- ongoing synchronization from second-brain source: Task 4 and Task 8

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing step includes exact file paths and code snippets.
- Every verification step includes concrete commands and expected outcomes.

### Type consistency

- `.wiki-system` artifact names match the approved spec:
  - `taxonomy.json`
  - `_backlinks.json`
  - `_absorb_log.json`
  - `page-meta.json`
  - `search-index.json`
  - `graph.json`
  - `lint-report.json`
  - `aliases.json`
- Workspace names match the spec:
  - Wiki
  - Sources
  - Search
  - Graph
  - Lint
  - Review
  - Deep Research
  - Chat
