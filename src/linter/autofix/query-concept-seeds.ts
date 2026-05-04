/**
 * Query concept seed repairer for generated Deep Research/query pages.
 *
 * Query pages are produced by the app from existing wiki context plus research
 * material. If such a page contains a new wikilink, preserving the graph edge
 * is usually more useful than removing the link. This repairer creates a small
 * concept seed page with provenance back to the query page, while leaving
 * concept-page broken links untouched for human review.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicWrite,
  buildFrontmatter,
  parseFrontmatter,
  slugify,
} from "../../utils/markdown.js";
import type { LintAutofixDetail, LintResult } from "../types.js";
import { buildPageSlugSet, collectAllPages, normalizeWikilinkTarget } from "../wiki-page-index.js";
import type { AutofixContext, AutofixRepairer } from "./types.js";

const BROKEN_WIKILINK_CAPTURE = /\[\[(.+?)\]\]/;

/** Create concept seed pages for unresolved links in generated query drafts. */
export const queryConceptSeedRepairer: AutofixRepairer = {
  name: "query-concept-seed",
  async run(context): Promise<LintAutofixDetail[]> {
    const existingSlugs = buildPageSlugSet(await collectAllPages(context.root));
    const details: LintAutofixDetail[] = [];

    for (const diagnostic of context.diagnostics.filter(isBrokenWikilinkDiagnostic)) {
      details.push(await repairQueryConceptSeed(context.root, diagnostic, existingSlugs));
    }

    return details;
  },
};

async function repairQueryConceptSeed(
  root: string,
  diagnostic: LintResult,
  existingSlugs: Set<string>,
): Promise<LintAutofixDetail> {
  const captured = readCapturedWikilink(diagnostic);
  if (!captured) {
    return makeDetail(root, "failed", diagnostic.file, "unparseable-target");
  }

  const queryPage = await readQueryPage(root, diagnostic.file);
  if (!queryPage) {
    return makeDetail(root, "skipped", diagnostic.file, "not-query-draft");
  }

  const targetTitle = normalizeWikilinkTarget(captured);
  const targetSlug = slugify(targetTitle);
  if (existingSlugs.has(targetSlug)) {
    return makeDetail(root, "skipped", diagnostic.file, "target-already-exists");
  }

  const seedPath = path.join(root, "wiki", "concepts", `${targetSlug}.md`);
  if (existsSync(seedPath)) {
    existingSlugs.add(targetSlug);
    return makeDetail(root, "skipped", seedPath, "target-already-exists");
  }

  await atomicWrite(seedPath, buildSeedPageContent(targetTitle, queryPage.title));
  existingSlugs.add(targetSlug);
  return makeDetail(root, "applied", seedPath, "created-query-concept-seed");
}

async function readQueryPage(root: string, filePath: string): Promise<{ title: string } | null> {
  if (!isInsideQueriesDirectory(root, filePath)) {
    return null;
  }
  const content = await readFile(filePath, "utf8");
  const { meta } = parseFrontmatter(content);
  if (meta.type !== "query") {
    return null;
  }
  return { title: typeof meta.title === "string" ? meta.title : path.basename(filePath, ".md") };
}

function buildSeedPageContent(title: string, queryTitle: string): string {
  return [
    buildFrontmatter({
      title,
      summary: `Deep Research 查询草稿引出的待补全概念：${title}。`,
      aliases: [title],
      status: "seed",
      provenance: "query-broken-wikilink-autofix",
    }),
    "",
    `# ${title}`,
    "",
    `本页由 Deep Research 查询草稿 [[${queryTitle}]] 中的坏双链自动创建，用于保留知识图谱连接。`,
    "",
    "请在后续审查中补充定义、来源和相关概念，再将本页从 seed 状态提升为正式知识页。",
  ].join("\n");
}

function isInsideQueriesDirectory(root: string, filePath: string): boolean {
  const queriesRoot = path.resolve(root, "wiki", "queries");
  const resolvedFile = path.resolve(filePath);
  return resolvedFile.startsWith(`${queriesRoot}${path.sep}`);
}

function readCapturedWikilink(diagnostic: LintResult): string | null {
  return diagnostic.message.match(BROKEN_WIKILINK_CAPTURE)?.[1] ?? null;
}

function isBrokenWikilinkDiagnostic(diagnostic: LintResult): boolean {
  return diagnostic.rule === "broken-wikilink";
}

function makeDetail(
  root: string,
  status: LintAutofixDetail["status"],
  target: string,
  reason: string,
): LintAutofixDetail {
  return {
    repairer: "query-concept-seed",
    kind: "broken-wikilink",
    target: path.relative(root, target).replace(/\\/g, "/"),
    reason,
    status,
  };
}
