import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { listMarkdownFilesRecursive } from "./sync-compile/file-listing.mjs";

const HAN_REGEX = /\p{Script=Han}/u;
const TRAILING_PAREN_SUFFIX_REGEX = /\s*[\uFF08(][^()\uFF08\uFF09]*[\uFF09)]\s*$/u;
const TRAILING_OPEN_PAREN_REGEX = /[\s\uFF08(]+$/u;
const H1_REGEX = /^#\s+(.+)$/m;
const SOURCE_STEM_REGEX = /__[^_]+__([^_].*?)__([a-f0-9]{8,32})\.md$/i;
const ENGLISH_TITLE_REGEX = /^[A-Za-z0-9\s&/+:'"-]+(?:\s*[\uFF08(][A-Za-z0-9\s&/+:'"-]+[\uFF09)])?$/;
const MIXED_TITLE_PREFIX_REGEX = /^[A-Za-z0-9][A-Za-z0-9\s&/+:'"-]*/;
const MIXED_TITLE_PAREN_ALIAS_REGEX = /^([A-Za-z0-9][A-Za-z0-9\s&/+:'"-]*?)\s*([\p{Script=Han}]{1,4})\s*[\uFF08(]/u;
const EMBEDDED_MARKDOWN_BLOCK_REGEX = /(?:^|\n)(```|~~~)(?:markdown|md)\s*\n([\s\S]*?)\n\1/g;

// fallow-ignore-next-line complexity
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const parsed = yaml.load(match[1]);
  return {
    meta: parsed && typeof parsed === "object" ? parsed : {},
    body: match[2],
  };
}

// fallow-ignore-next-line complexity
function buildFrontmatter(fields) {
  const dumped = yaml.dump(fields, { lineWidth: -1, quotingType: '"' }).trimEnd();
  return `---\n${dumped}\n---`;
}

// fallow-ignore-next-line complexity
function uniqueAliases(aliases) {
  const seen = new Set();
  const next = [];
  for (const alias of aliases) {
    if (typeof alias !== "string") {
      continue;
    }

    const trimmed = alias.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
}

// fallow-ignore-next-line complexity
function normalizeChineseAlias(value) {
  const trimmed = value.trim();
  if (!trimmed || !HAN_REGEX.test(trimmed)) {
    return null;
  }

  const withoutSuffix = trimmed.replace(TRAILING_PAREN_SUFFIX_REGEX, "").trim();
  if (withoutSuffix && HAN_REGEX.test(withoutSuffix)) {
    return withoutSuffix;
  }

  return trimmed;
}

// fallow-ignore-next-line complexity
function normalizeVisibleAlias(value) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(TRAILING_OPEN_PAREN_REGEX, "").trim() || null;
}

// fallow-ignore-next-line complexity
function extractChineseAliasCandidate(content) {
  const { meta, body } = parseFrontmatter(content);
  const heading = body.match(H1_REGEX)?.[1]?.trim() ?? "";
  const headingAlias = heading ? normalizeChineseAlias(heading) : null;
  if (headingAlias) {
    return headingAlias;
  }

  return typeof meta.title === "string" ? normalizeChineseAlias(meta.title) : null;
}

// fallow-ignore-next-line complexity
function extractSourceAliasCandidates(content) {
  const { meta } = parseFrontmatter(content);
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  const aliases = [];

  for (const source of sources) {
    if (typeof source !== "string") {
      continue;
    }

    const match = source.match(SOURCE_STEM_REGEX);
    if (!match) {
      continue;
    }

    const alias = normalizeChineseAlias(match[1]);
    if (alias) {
      aliases.push(alias);
    }
  }

  return uniqueAliases(aliases);
}

// fallow-ignore-next-line complexity
function normalizeEnglishBaseTitle(title) {
  const trimmed = title.trim();
  if (!trimmed || HAN_REGEX.test(trimmed) || !ENGLISH_TITLE_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed.replace(TRAILING_PAREN_SUFFIX_REGEX, "").replace(/\s+/g, " ").trim() || null;
}

// fallow-ignore-next-line complexity
function extractMixedTitleAliases(title) {
  if (!HAN_REGEX.test(title)) {
    return [];
  }

  const prefixAlias = title.match(MIXED_TITLE_PREFIX_REGEX)?.[0] ?? "";
  const parentheticalAlias = title.match(MIXED_TITLE_PAREN_ALIAS_REGEX);
  return uniqueAliases([
    normalizeVisibleAlias(prefixAlias) ?? "",
    normalizeVisibleAlias(parentheticalAlias ? `${parentheticalAlias[1]} ${parentheticalAlias[2]}` : "") ?? "",
  ]);
}

// fallow-ignore-next-line complexity
function extractEmbeddedMarkdownBlocks(content) {
  return [...content.matchAll(EMBEDDED_MARKDOWN_BLOCK_REGEX)].map((match) => match[2]);
}

// fallow-ignore-next-line complexity
function extractBodyFrontmatterBlock(content) {
  const { body } = parseFrontmatter(content);
  const trimmedBody = body.trimStart();
  const { meta } = parseFrontmatter(trimmedBody);
  return Object.keys(meta).length > 0 ? [trimmedBody] : [];
}

// fallow-ignore-next-line complexity
function extractTitleVariantAliases(content) {
  const { meta } = parseFrontmatter(content);
  if (typeof meta.title !== "string") {
    return [];
  }

  const originalTitle = meta.title.trim();
  const baseTitle = normalizeEnglishBaseTitle(originalTitle);
  const aliases = extractMixedTitleAliases(originalTitle);
  if (baseTitle && baseTitle !== originalTitle) {
    aliases.push(baseTitle, baseTitle.replace(/\s+/g, "-"));
  }

  return uniqueAliases(aliases);
}

// fallow-ignore-next-line complexity
function extractEmbeddedAliasCandidates(content) {
  const aliases = [];
  for (const block of [...extractEmbeddedMarkdownBlocks(content), ...extractBodyFrontmatterBlock(content)]) {
    const { meta } = parseFrontmatter(block);
    aliases.push(
      ...uniqueAliases(Array.isArray(meta.aliases) ? meta.aliases : []),
      extractChineseAliasCandidate(block) ?? "",
      ...extractTitleVariantAliases(block),
    );
  }

  return uniqueAliases(aliases);
}

// fallow-ignore-next-line complexity
function addAliasesToPage(content) {
  const { meta, body } = parseFrontmatter(content);
  if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) {
    return null;
  }

  const existingAliases = Array.isArray(meta.aliases)
    ? meta.aliases.filter((alias) => typeof alias === "string" && alias.trim().length > 0)
    : [];

  const nextAliases = uniqueAliases([
    ...existingAliases,
    extractChineseAliasCandidate(content) ?? "",
    ...extractSourceAliasCandidates(content),
    ...extractTitleVariantAliases(content),
    ...extractEmbeddedAliasCandidates(content),
  ]);

  if (nextAliases.length === existingAliases.length) {
    return null;
  }

  return `${buildFrontmatter({
    ...meta,
    aliases: nextAliases,
  })}\n\n${body.trimStart()}`;
}

// fallow-ignore-next-line complexity
async function main() {
  const vaultRoot = process.argv[2];
  if (!vaultRoot) {
    console.error("Usage: node scripts/fill-chinese-aliases.mjs <vault-root>");
    process.exit(1);
  }

  const wikiRoot = path.join(vaultRoot, "wiki");
  if (!existsSync(wikiRoot)) {
    console.error(`Wiki directory does not exist: ${wikiRoot}`);
    process.exit(1);
  }

  const pageDirs = ["concepts", "queries"].map((name) => path.join(wikiRoot, name));
  let updated = 0;
  let skipped = 0;

  for (const dir of pageDirs) {
    const files = (await listMarkdownFilesRecursive(dir, { ignoreMissing: true }))
      .map((relativePath) => path.join(dir, relativePath));
    for (const file of files) {
      const original = await readFile(file, "utf8");
      const next = addAliasesToPage(original);
      if (!next || next === original) {
        skipped += 1;
        continue;
      }

      await writeFile(file, `${next.trimEnd()}\n`, "utf8");
      updated += 1;
      console.log(`UPDATED ${path.relative(vaultRoot, file).replace(/\\/g, "/")}`);
    }
  }

  console.log(`Updated pages: ${updated}`);
  console.log(`Skipped pages: ${skipped}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
