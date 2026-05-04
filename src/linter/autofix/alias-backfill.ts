/**
 * Deterministic alias-backfill repairer for broken wikilinks.
 *
 * When exactly one page can be proven to match a broken wikilink target,
 * this repairer appends the missing alias to that page's frontmatter.
 * Ambiguous or incomplete cases are reported as skipped instead of guessed.
 */

import path from "node:path";
import {
  atomicWrite,
  buildFrontmatter,
  parseFrontmatter,
  slugify,
} from "../../utils/markdown.js";
import type { LintAutofixDetail, LintResult } from "../types.js";
import {
  buildAutofixCandidateMap,
  collectAllPages,
  normalizeWikilinkTarget,
} from "../wiki-page-index.js";
import type { AutofixContext, AutofixRepairer } from "./types.js";

type CandidateMap = ReturnType<typeof buildAutofixCandidateMap>;
type PageEntry = { filePath: string; content: string };

/** Validate a broken-wikilink diagnostic and resolve its target page. Returns a finished detail if the diagnostic cannot proceed. */
function resolveDiagnosticTarget(
  diagnostic: LintResult,
  context: AutofixContext,
  candidates: CandidateMap,
  pagesByPath: Map<string, PageEntry>,
): { resolved: LintAutofixDetail } | { target: PageEntry; visibleTarget: string } {
  const captured = diagnostic.message.match(/\[\[(.+?)\]\]/)?.[1];
  if (!captured) {
    return { resolved: makeDetail(context.root, "failed", diagnostic.file, "unparseable-target") };
  }

  const visibleTarget = normalizeWikilinkTarget(captured);
  const slug = slugify(visibleTarget);
  const matches = uniqueByPath(candidates.get(slug) ?? []);

  if (matches.length === 0) {
    return { resolved: makeDetail(context.root, "skipped", diagnostic.file, "missing-target") };
  }
  if (matches.length > 1) {
    return { resolved: makeDetail(context.root, "skipped", diagnostic.file, "ambiguous-target") };
  }

  const target = matches[0];
  const page = pagesByPath.get(target.filePath);
  if (!page) {
    return { resolved: makeDetail(context.root, "failed", diagnostic.file, "candidate-not-loaded") };
  }

  return { target: page, visibleTarget };
}

/** Add the missing alias to the target page's frontmatter and write the updated content. */
async function applyAliasToPage(
  diagnostic: LintResult,
  context: AutofixContext,
  page: PageEntry,
  visibleTarget: string,
  pagesByPath: Map<string, PageEntry>,
): Promise<LintAutofixDetail> {
  const { meta, body } = parseFrontmatter(page.content);
  if (Object.keys(meta).length === 0) {
    return makeDetail(context.root, "skipped", diagnostic.file, "missing-frontmatter");
  }

  const aliases = Array.isArray(meta.aliases)
    ? meta.aliases.filter((value): value is string => typeof value === "string")
    : [];
  if (aliases.includes(visibleTarget)) {
    return makeDetail(context.root, "skipped", diagnostic.file, "alias-already-present");
  }

  const nextContent = `${buildFrontmatter({
    ...meta,
    aliases: [...aliases, visibleTarget],
  })}\n\n${body.trimStart()}`;
  await atomicWrite(page.filePath, nextContent);
  pagesByPath.set(page.filePath, { ...page, content: nextContent });
  return {
    repairer: "alias-backfill",
    kind: diagnostic.rule,
    target: path.relative(context.root, page.filePath).replace(/\\/g, "/"),
    reason: "unique-target",
    status: "applied",
  };
}

export const aliasBackfillRepairer: AutofixRepairer = {
  name: "alias-backfill",
  async run(context): Promise<LintAutofixDetail[]> {
    const diagnostics = context.diagnostics.filter((result) => result.rule === "broken-wikilink");
    if (diagnostics.length === 0) return [];

    const pages = await collectAllPages(context.root);
    const candidates = buildAutofixCandidateMap(pages);
    const pagesByPath = new Map(pages.map((page) => [page.filePath, page]));
    const details: LintAutofixDetail[] = [];

    for (const diagnostic of diagnostics) {
      const resolution = resolveDiagnosticTarget(diagnostic, context, candidates, pagesByPath);
      if ("resolved" in resolution) {
        details.push(resolution.resolved);
        continue;
      }
      details.push(await applyAliasToPage(diagnostic, context, resolution.target, resolution.visibleTarget, pagesByPath));
    }

    return details;
  },
};

function uniqueByPath(values: ReadonlyArray<{ filePath: string }>): Array<{ filePath: string }> {
  const seen = new Set<string>();
  const next: Array<{ filePath: string }> = [];

  for (const value of values) {
    if (seen.has(value.filePath)) {
      continue;
    }
    seen.add(value.filePath);
    next.push(value);
  }

  return next;
}

function makeDetail(
  root: string,
  status: "skipped" | "failed",
  target: string,
  reason: string,
): LintAutofixDetail {
  return {
    repairer: "alias-backfill",
    kind: "broken-wikilink",
    target: path.relative(root, target).replace(/\\/g, "/"),
    reason,
    status,
  };
}
