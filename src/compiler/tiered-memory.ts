/**
 * Tiered-memory persistence helpers.
 *
 * Persists claims and procedures as JSON indices plus markdown pages for
 * procedure browsing inside the wiki.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, buildFrontmatter, slugify } from "../utils/markdown.js";
import { attachGeneratedWikiSideImage, toWikiLogicalPath } from "../utils/wiki-side-image.js";
import {
  CLAIMS_FILE,
  PROCEDURES_DIR,
  PROCEDURES_FILE,
} from "../utils/constants.js";
import type {
  ClaimCandidate,
  ClaimRecord,
  ProcedureRecord,
} from "../utils/types.js";
import type { ExtractionResult } from "./deps.js";
import { normalizeClaimKey } from "./claims.js";

interface SourceMetadata {
  sourceKind: string;
  sourceChannel: string;
  sourceTitle: string;
  sourceUrl?: string;
}

export async function readClaims(root: string): Promise<ClaimRecord[]> {
  return readJsonFile(path.join(root, CLAIMS_FILE), []);
}

export async function writeClaims(root: string, claims: ClaimRecord[]): Promise<void> {
  await writeJsonFile(path.join(root, CLAIMS_FILE), claims);
}

export async function writeProcedures(root: string, procedures: ProcedureRecord[]): Promise<void> {
  await writeJsonFile(path.join(root, PROCEDURES_FILE), procedures);
}

export function buildClaimCandidates(result: ExtractionResult): ClaimCandidate[] {
  const metadata = readSourceMetadata(result.sourceContent, result.sourceFile);
  const observedAt = new Date().toISOString();
  return result.concepts.flatMap((concept) => {
    const conceptSlug = slugify(concept.concept);
    const claims = concept.claims?.length
      ? concept.claims
      : [{
        claim_text: concept.summary,
        claim_type: "fact" as const,
        claim_key: concept.concept,
        observed_at: observedAt,
      }];

    return claims.map((claim, index) => {
      const claimText = String(claim.claim_text ?? concept.summary).trim();
      const claimObservedAt = claim.observed_at ?? observedAt;
      return {
        candidateId: createHash("sha1")
          .update(`${result.sourceFile}:${conceptSlug}:${index}:${claimText}`)
          .digest("hex")
          .slice(0, 16),
        conceptSlug,
        claimKey: normalizeClaimKey(String(claim.claim_key ?? concept.concept)),
        claimText,
        claimType: claim.claim_type ?? "fact",
        source: {
          file: result.sourceFile,
          title: metadata.sourceTitle,
          kind: metadata.sourceKind,
          channel: metadata.sourceChannel,
          ...(metadata.sourceUrl ? { url: metadata.sourceUrl } : {}),
          observedAt: claimObservedAt,
        },
        observedAt: claimObservedAt,
      };
    });
  });
}

export async function writeProcedurePages(root: string, procedures: ProcedureRecord[]): Promise<void> {
  const dir = path.join(root, PROCEDURES_DIR);
  await mkdir(dir, { recursive: true });
  for (const procedure of procedures) {
    const pagePath = path.join(dir, `${procedure.id}.md`);
    const content = await addImageForNewWikiPage(root, pagePath, buildProcedurePage(procedure));
    await atomicWrite(pagePath, content);
  }
}

async function addImageForNewWikiPage(
  root: string,
  pagePath: string,
  content: string,
): Promise<string> {
  if (existsSync(pagePath)) {
    return content;
  }
  return (await attachGeneratedWikiSideImage(root, toWikiLogicalPath(root, pagePath), content)).content;
}

function readSourceMetadata(sourceContent: string, sourceFile: string): SourceMetadata {
  const metadataLine = sourceContent.match(/^> 原料来源：(.+)$/m)?.[1] ?? "";
  const pairs = metadataLine.split("|").map((part) => part.trim());
  const sourceChannel = pickValue(pairs, "渠道") ?? "外部源";
  return {
    sourceKind: sourceChannel === "剪藏" ? "clipping" : sourceChannel === "闪念日记" ? "flash" : "external",
    sourceChannel,
    sourceTitle: pickValue(pairs, "名称") ?? sourceFile,
    sourceUrl: pickValue(pairs, "链接") ?? undefined,
  };
}

function buildProcedurePage(procedure: ProcedureRecord): string {
  const frontmatter = buildFrontmatter({
    title: procedure.title,
    summary: procedure.summary,
    updatedAt: procedure.lastConfirmedAt,
    tags: ["程序记忆"],
  });
  return [
    frontmatter,
    "",
    `# ${procedure.title}`,
    "",
    "## 适用场景",
    "",
    procedure.summary,
    "",
    "## 触发条件",
    "",
    `- concept: ${procedure.conceptSlug}`,
    `- procedureKey: ${procedure.procedureKey}`,
    "",
    "## 标准步骤",
    "",
    `1. ${procedure.summary}`,
    "",
    "## 例外情况",
    "",
    "- 如出现新证据与当前流程冲突，则重新审查 supporting claims。",
    "",
    "## 证据与置信度",
    "",
    `- supporting claims: ${procedure.supportingClaimIds.length}`,
    `- confidence: ${procedure.confidence.toFixed(2)}`,
    `- last confirmed: ${procedure.lastConfirmedAt}`,
    "",
  ].join("\n");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pickValue(parts: string[], label: string): string | null {
  const part = parts.find((item) => item.startsWith(`${label}：`));
  if (!part) return null;
  return part.slice(label.length + 1).trim() || null;
}
