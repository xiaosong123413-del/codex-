/**
 * Deterministic lint autofix orchestrator.
 *
 * The individual repairers live under `src/linter/autofix/`. This module
 * wires them into the main lint flow, rerunning diagnostics after each repairer
 * that applies a change so later repairers see the current file state.
 */

import path from "node:path";
import { aliasBackfillRepairer } from "./autofix/alias-backfill.js";
import { bridgePageRepairer } from "./autofix/bridge-pages.js";
import { exampleEscapingRepairer } from "./autofix/example-escaping.js";
import { queryConceptSeedRepairer } from "./autofix/query-concept-seeds.js";
import {
  EMPTY_AUTOFIX_SUMMARY,
  summarizeAutofix,
} from "./autofix/types.js";
import type { LintAutofixDetail, LintAutofixSummary, LintResult } from "./types.js";

export async function applyDeterministicLintAutofixes(
  root: string,
  diagnostics: readonly LintResult[],
  rerunRules: () => Promise<LintResult[]>,
): Promise<LintAutofixSummary> {
  if (diagnostics.length === 0) {
    return EMPTY_AUTOFIX_SUMMARY;
  }
  const details = await runAutofixPipeline(root, [...diagnostics], rerunRules);
  return details.length > 0 ? summarizeAutofix(details) : EMPTY_AUTOFIX_SUMMARY;
}

async function runAutofixPipeline(
  root: string,
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
): Promise<LintAutofixDetail[]> {
  const details: LintAutofixDetail[] = [];
  diagnostics = await runExampleRepairer(root, diagnostics, rerunRules, details);
  diagnostics = await runAliasRepairer(root, diagnostics, rerunRules, details);
  diagnostics = await runBridgeRepairer(root, diagnostics, rerunRules, details);
  await runQueryConceptSeedRepairer(root, diagnostics, rerunRules, details);
  return details;
}

async function runExampleRepairer(
  root: string,
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
  details: LintAutofixDetail[],
): Promise<LintResult[]> {
  const nextDetails = await exampleEscapingRepairer.run({ root, diagnostics });
  const afterDiagnostics = await rerunAfterApplied(nextDetails, diagnostics, rerunRules);
  details.push(...filterVisibleExampleDetails(
    verifyExampleRepairDetails(root, nextDetails, afterDiagnostics),
  ));
  return afterDiagnostics;
}

async function runAliasRepairer(
  root: string,
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
  details: LintAutofixDetail[],
): Promise<LintResult[]> {
  const aliasDiagnostics = diagnostics.filter((diagnostic) => diagnostic.rule === "broken-wikilink");
  const nextDetails = await aliasBackfillRepairer.run({ root, diagnostics: aliasDiagnostics });
  const nextDiagnostics = await rerunAfterApplied(nextDetails, diagnostics, rerunRules);
  const verifiedDetails = verifyBrokenWikilinkRepairDetails(nextDetails, aliasDiagnostics, nextDiagnostics);
  details.push(...filterVisibleAliasDetails(verifiedDetails));
  const blockedTargets = collectBlockedBrokenTargets(aliasDiagnostics, verifiedDetails);
  return blockedTargets.size > 0
    ? nextDiagnostics.filter((diagnostic) => !blockedTargets.has(readBrokenWikilinkKey(diagnostic)))
    : nextDiagnostics;
}

async function runBridgeRepairer(
  root: string,
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
  details: LintAutofixDetail[],
): Promise<LintResult[]> {
  const bridgeDiagnostics = diagnostics.filter((diagnostic) => diagnostic.rule === "broken-wikilink");
  const nextDetails = await bridgePageRepairer.run({ root, diagnostics: bridgeDiagnostics });
  const afterDiagnostics = await rerunAfterApplied(nextDetails, diagnostics, rerunRules);
  details.push(...verifyBrokenWikilinkRepairDetails(nextDetails, bridgeDiagnostics, afterDiagnostics));
  return afterDiagnostics;
}

async function runQueryConceptSeedRepairer(
  root: string,
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
  details: LintAutofixDetail[],
): Promise<void> {
  const seedDiagnostics = diagnostics.filter((diagnostic) => diagnostic.rule === "broken-wikilink");
  const nextDetails = await queryConceptSeedRepairer.run({ root, diagnostics: seedDiagnostics });
  const afterDiagnostics = await rerunAfterApplied(nextDetails, diagnostics, rerunRules);
  details.push(...filterVisibleQueryConceptSeedDetails(
    verifyBrokenWikilinkRepairDetails(nextDetails, seedDiagnostics, afterDiagnostics),
  ));
}

async function rerunAfterApplied(
  details: readonly LintAutofixDetail[],
  diagnostics: LintResult[],
  rerunRules: () => Promise<LintResult[]>,
): Promise<LintResult[]> {
  return details.some((detail) => detail.status === "applied") ? await rerunRules() : diagnostics;
}

function filterVisibleExampleDetails(details: readonly LintAutofixDetail[]): LintAutofixDetail[] {
  return details.filter((detail) => detail.status !== "skipped" || detail.reason !== "not-example-line");
}

function filterVisibleAliasDetails(details: readonly LintAutofixDetail[]): LintAutofixDetail[] {
  return details.filter((detail) => detail.status !== "skipped" || detail.reason !== "missing-target");
}

function filterVisibleQueryConceptSeedDetails(details: readonly LintAutofixDetail[]): LintAutofixDetail[] {
  return details.filter((detail) => detail.status !== "skipped" || detail.reason !== "not-query-draft");
}

function verifyExampleRepairDetails(
  root: string,
  details: readonly LintAutofixDetail[],
  diagnostics: readonly LintResult[],
): LintAutofixDetail[] {
  return details.map((detail) => {
    if (detail.status !== "applied") {
      return detail;
    }
    return hasMatchingExampleDiagnostic(root, detail, diagnostics)
      ? failAppliedDetail(detail)
      : detail;
  });
}

function verifyBrokenWikilinkRepairDetails(
  details: readonly LintAutofixDetail[],
  sourceDiagnostics: readonly LintResult[],
  diagnostics: readonly LintResult[],
): LintAutofixDetail[] {
  return details.map((detail, index) => {
    if (detail.status !== "applied") {
      return detail;
    }
    const sourceDiagnostic = sourceDiagnostics[index];
    return sourceDiagnostic && hasMatchingBrokenWikilink(sourceDiagnostic, diagnostics)
      ? failAppliedDetail(detail)
      : detail;
  });
}

function hasMatchingExampleDiagnostic(
  root: string,
  detail: LintAutofixDetail,
  diagnostics: readonly LintResult[],
): boolean {
  return diagnostics.some((diagnostic) => (
    diagnostic.rule === detail.kind
    && readExampleLocationKey(root, diagnostic) === detail.target
  ));
}

function hasMatchingBrokenWikilink(
  sourceDiagnostic: LintResult,
  diagnostics: readonly LintResult[],
): boolean {
  const sourceKey = readBrokenWikilinkKey(sourceDiagnostic);
  return diagnostics.some((diagnostic) => readBrokenWikilinkKey(diagnostic) === sourceKey);
}

function failAppliedDetail(detail: LintAutofixDetail): LintAutofixDetail {
  return { ...detail, status: "failed", reason: "did-not-clear-diagnostic" };
}

function collectBlockedBrokenTargets(
  diagnostics: readonly LintResult[],
  details: readonly LintAutofixDetail[],
): Set<string> {
  const blocked = new Set<string>();
  for (const [index, diagnostic] of diagnostics.entries()) {
    const detail = details[index];
    if (detail && detail.reason !== "missing-target") {
      blocked.add(readBrokenWikilinkKey(diagnostic));
    }
  }
  return blocked;
}

function readBrokenWikilinkKey(diagnostic: LintResult): string {
  const captured = diagnostic.message.match(/\[\[(.+?)\]\]/)?.[1] ?? "";
  const target = captured.split("|")[0].split("#")[0].trim().toLowerCase();
  return `${diagnostic.file}:${diagnostic.line ?? 0}:${target}`;
}

function readExampleLocationKey(root: string, diagnostic: LintResult): string {
  return `${path.relative(root, diagnostic.file).replace(/\\/g, "/")}:${diagnostic.line ?? 0}`;
}
