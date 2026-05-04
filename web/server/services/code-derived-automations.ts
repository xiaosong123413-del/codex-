/**
 * Runtime loader for source-owned automation flow modules.
 *
 * Real automation DAGs are defined in small sidecar modules that live next to
 * the code they describe. The workspace server imports those modules at
 * runtime, so a source-owned flow change can be pushed to the UI without
 * editing one central registry.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeDerivedAutomationSeeds as automationWorkspaceSeeds } from "../../client/src/pages/automation/automation-flow.js";
import { codeDerivedAutomationSeeds as flashDiaryPageSeeds } from "../../client/src/pages/flash-diary/automation-flow.js";
import { codeDerivedAutomationSeeds as reviewBoardSeeds } from "../../client/src/pages/review/automation-flow.js";
import { codeDerivedAutomationSeeds as syncEntrySeeds } from "../../client/src/pages/runs/automation-flow.js";
import { codeDerivedAutomationSeeds as sourceGallerySeeds } from "../../client/src/pages/sources/automation-flow.js";
import { codeDerivedAutomationSeeds as compileFlowSeeds } from "./compile.automation-flow.js";
import { codeDerivedAutomationSeeds as globalKnowledgeOverviewSeeds } from "./global-knowledge-overview.automation-flow.js";
import { informationTransferAutomationSeeds } from "./information-transfer.automation-flow.js";
import { codeDerivedAutomationSeeds as flashDiarySeeds } from "../routes/flash-diary.automation-flow.js";
import { codeDerivedAutomationSeeds as workflowRecorderSeeds } from "../routes/workflow-recorder.automation-flow.js";
import { codeDerivedAutomationSeeds as workflowArtifactsSeeds } from "../routes/workflow-artifacts.automation-flow.js";
import type { AutomationDefinition } from "./automation-config.js";
import type {
  CodeDerivedAutomationModule,
  CodeDerivedAutomationSeed,
  CodeDerivedAutomationSourceKind,
} from "./code-derived-automation-types.js";

const CODE_FLOW_PREFIX = "code-flow-";
const CONFIG_WATCH_PATHS = [
  ".env",
  "agents/agents.json",
  "automations/automations.json",
] as const;
const FLOW_MODULE_PATHS = [
  "web/client/src/pages/automation/automation-flow.ts",
  "web/client/src/pages/flash-diary/automation-flow.ts",
  "web/client/src/pages/review/automation-flow.ts",
  "web/client/src/pages/runs/automation-flow.ts",
  "web/client/src/pages/sources/automation-flow.ts",
  "web/server/services/compile.automation-flow.ts",
  "web/server/services/global-knowledge-overview.automation-flow.ts",
  "web/server/routes/flash-diary.automation-flow.ts",
  "web/server/routes/workflow-recorder.automation-flow.ts",
  "web/server/routes/workflow-artifacts.automation-flow.ts",
] as const;
const CODEBASE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const INFORMATION_TRANSFER_MODULE_PATH = resolveCodePath("web/server/services/information-transfer.automation-flow.ts");
const STATIC_SEEDS_BY_MODULE_PATH = new Map<string, readonly CodeDerivedAutomationSeed[]>([
  [resolveCodePath("web/client/src/pages/automation/automation-flow.ts"), automationWorkspaceSeeds],
  [resolveCodePath("web/client/src/pages/flash-diary/automation-flow.ts"), flashDiaryPageSeeds],
  [resolveCodePath("web/client/src/pages/review/automation-flow.ts"), reviewBoardSeeds],
  [resolveCodePath("web/client/src/pages/runs/automation-flow.ts"), syncEntrySeeds],
  [resolveCodePath("web/client/src/pages/sources/automation-flow.ts"), sourceGallerySeeds],
  [resolveCodePath("web/server/services/compile.automation-flow.ts"), compileFlowSeeds],
  [resolveCodePath("web/server/services/global-knowledge-overview.automation-flow.ts"), globalKnowledgeOverviewSeeds],
  [resolveCodePath("web/server/routes/flash-diary.automation-flow.ts"), flashDiarySeeds],
  [resolveCodePath("web/server/routes/workflow-recorder.automation-flow.ts"), workflowRecorderSeeds],
  [resolveCodePath("web/server/routes/workflow-artifacts.automation-flow.ts"), workflowArtifactsSeeds],
]);

interface LoadedAutomationSeeds {
  modulePath: string;
  seeds: readonly CodeDerivedAutomationSeed[];
}

export interface CodeDerivedAutomationDefinition extends AutomationDefinition {
  sourceKind?: CodeDerivedAutomationSourceKind;
  mermaid?: string;
  sourceInsight?: CodeDerivedAutomationSeed["sourceInsight"];
}

export async function listCodeDerivedAutomations(projectRoot: string): Promise<CodeDerivedAutomationDefinition[]> {
  const loadedModules = await loadAllAutomationSeeds();
  return loadedModules.flatMap(({ modulePath, seeds }) => seeds.map((seed) => (
    createAutomationDefinition(projectRoot, modulePath, seed)
  )));
}

export async function listCodeDerivedAutomationWatchPaths(projectRoot: string): Promise<string[]> {
  const loadedModules = await loadAllAutomationSeeds();
  const paths = [
    ...CONFIG_WATCH_PATHS.map((relativePath) => path.join(projectRoot, relativePath)),
    ...loadedModules.map(({ modulePath }) => modulePath),
    ...loadedModules.flatMap(({ seeds }) => seeds.flatMap((seed) => seed.sourcePaths.map(resolveCodePath))),
  ];
  return uniqueExistingPaths(paths);
}

async function loadAllAutomationSeeds(): Promise<LoadedAutomationSeeds[]> {
  return [
    ...(await loadCodeDerivedAutomationSeeds()),
    {
      modulePath: INFORMATION_TRANSFER_MODULE_PATH,
      seeds: informationTransferAutomationSeeds,
    },
  ];
}

function createAutomationDefinition(
  projectRoot: string,
  modulePath: string,
  seed: CodeDerivedAutomationSeed,
) : CodeDerivedAutomationDefinition {
  return {
    id: `${CODE_FLOW_PREFIX}${seed.slug}`,
    name: seed.name,
    summary: seed.summary,
    icon: seed.icon,
    trigger: "message",
    appId: `system:${seed.slug}`,
    enabled: true,
    schedule: "",
    webhookPath: "",
    updatedAt: resolveUpdatedAt(projectRoot, modulePath, seed.sourcePaths),
    flow: seed.flow,
    ...(seed.sourceKind ? { sourceKind: seed.sourceKind } : {}),
    ...(seed.mermaid ? { mermaid: seed.mermaid } : {}),
    ...(seed.sourceInsight ? { sourceInsight: seed.sourceInsight } : {}),
  };
}

async function loadCodeDerivedAutomationSeeds(): Promise<LoadedAutomationSeeds[]> {
  const modulePaths = FLOW_MODULE_PATHS.map(resolveCodePath);
  return Promise.all(modulePaths.map(async (modulePath) => ({
    modulePath,
    seeds: await importCodeDerivedAutomationSeeds(modulePath),
  })));
}

async function importCodeDerivedAutomationSeeds(modulePath: string): Promise<readonly CodeDerivedAutomationSeed[]> {
  if (process.env.VITEST) {
    return STATIC_SEEDS_BY_MODULE_PATH.get(modulePath) ?? [];
  }
  const version = fs.existsSync(modulePath) ? fs.statSync(modulePath).mtimeMs : Date.now();
  const specifier = `${pathToFileURL(modulePath).href}?v=${version}`;
  try {
    const moduleExports = await import(specifier) as Partial<CodeDerivedAutomationModule>;
    const seeds = moduleExports.codeDerivedAutomationSeeds;
    if (!Array.isArray(seeds)) {
      throw new Error(`Code-derived automation module is missing codeDerivedAutomationSeeds: ${modulePath}`);
    }
    return seeds;
  } catch (error) {
    const fallbackSeeds = STATIC_SEEDS_BY_MODULE_PATH.get(modulePath);
    if (fallbackSeeds) {
      return fallbackSeeds;
    }
    throw error;
  }
}

function resolveUpdatedAt(projectRoot: string, modulePath: string, relativeSourcePaths: string[]): string {
  const candidatePaths = [
    modulePath,
    ...relativeSourcePaths.map(resolveCodePath),
    ...CONFIG_WATCH_PATHS.map((relativePath) => path.join(projectRoot, relativePath)),
  ];
  const latestMtime = candidatePaths.reduce((latest, candidatePath) => {
    if (!fs.existsSync(candidatePath)) {
      return latest;
    }
    return Math.max(latest, fs.statSync(candidatePath).mtimeMs);
  }, 0);
  return new Date(latestMtime || Date.now()).toISOString();
}

function resolveCodePath(relativePath: string): string {
  return path.join(CODEBASE_ROOT, relativePath);
}

function uniqueExistingPaths(paths: string[]): string[] {
  const uniquePaths = new Set<string>();
  for (const candidatePath of paths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    uniquePaths.add(candidatePath);
  }
  return [...uniquePaths];
}
