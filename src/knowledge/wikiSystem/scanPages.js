import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWikiSystemConfig } from './config.js';
import { parseMarkdownDocument } from './parseMarkdown.js';

async function walkMarkdownFiles(rootDir) {
  const results = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.wiki-system' || entry.name === '.claude') {
        continue;
      }

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

    if (!allowedCategories.includes(category)) {
      continue;
    }

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
