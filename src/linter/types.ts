/**
 * Type definitions for the wiki linter.
 * Defines the shape of lint results, summaries, and rule functions
 * used across all lint rules and the orchestrator.
 */

export interface LintResult {
  rule: string;
  severity: "error" | "warning" | "info";
  file: string;
  message: string;
  line?: number;
}

export interface LintAutofixDetail {
  repairer: "alias-backfill" | "example-escaping" | "bridge-page" | "query-concept-seed";
  kind: string;
  target: string;
  reason: string;
  status: "applied" | "skipped" | "failed";
}

export interface LintAutofixSummary {
  attempted: number;
  applied: number;
  skipped: number;
  failures: number;
  details: LintAutofixDetail[];
}

export interface LintSummary {
  errors: number;
  warnings: number;
  info: number;
  results: LintResult[];
  autofix: LintAutofixSummary;
}

export type LintRule = (root: string) => Promise<LintResult[]>;
