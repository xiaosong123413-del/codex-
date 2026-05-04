/**
 * Normalizes the desktop sync/compile configuration written by Electron.
 *
 * The editable source vault remains user-selected, while generated runtime
 * output is account/workspace scoped so two desktop users do not share caches,
 * chat state, review state, or compiled wiki artifacts by accident.
 */
import path from "node:path";

export interface SyncCompileConfig {
  source_vault_root?: string;
  runtime_output_root?: string;
  compiler_root?: string;
  source_folders?: string[];
  compile_mode?: string;
  batch_limit?: number;
  batch_pattern_order?: string[];
  exclude_dirs?: string[];
  [key: string]: unknown;
}

interface DesktopRuntimeScope {
  ownerUserId: string;
  workspaceId: string;
}

export function getDefaultDesktopRuntimeRoot(projectRoot: string): string {
  return path.join(projectRoot, ".runtime", "ai-vault");
}

function getScopedDesktopRuntimeRoot(
  projectRoot: string,
  scope: DesktopRuntimeScope,
): string {
  return path.join(
    projectRoot,
    ".runtime",
    "accounts",
    sanitizeRuntimeSegment(scope.ownerUserId),
    sanitizeRuntimeSegment(scope.workspaceId),
  );
}

export function normalizeDesktopSyncCompileConfig(
  projectRoot: string,
  existingConfig: SyncCompileConfig,
  sourceVaultRoot: string,
  runtimeScope?: DesktopRuntimeScope,
): SyncCompileConfig {
  const runtimeOutputRoot = runtimeScope
    ? getScopedDesktopRuntimeRoot(projectRoot, runtimeScope)
    : existingConfig.runtime_output_root?.trim() || getDefaultDesktopRuntimeRoot(projectRoot);

  return {
    ...existingConfig,
    source_vault_root: sourceVaultRoot.trim(),
    runtime_output_root: runtimeOutputRoot,
  };
}

function sanitizeRuntimeSegment(value: string): string {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return segment.replace(/^_+|_+$/g, "") || "default";
}
