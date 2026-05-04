import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const STATE_FILES = [
  "state.json",
  "claims.json",
  "procedures.json",
  "final-compile-result.json",
];
const RETIRED_WIKI_DIRS = new Set(["episodes"]);

export function buildStagingRoot(runtimeRoot, runId) {
  return path.join(runtimeRoot, ".llmwiki", "staging", runId);
}

export async function createStagingRun(sourceVaultRoot, runtimeRoot) {
  const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const root = buildStagingRoot(runtimeRoot, runId);
  const wikiDir = path.join(root, "wiki");
  const llmwikiDir = path.join(root, ".llmwiki");

  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "sources"), { recursive: true });
  await mkdir(wikiDir, { recursive: true });
  await mkdir(llmwikiDir, { recursive: true });

  await copyDirectoryIfPresent(path.join(sourceVaultRoot, "wiki"), wikiDir, { removeRetiredWikiDirs: true });
  await copyStateFilesIfPresent(runtimeRoot, llmwikiDir);

  return { runId, root, wikiDir, llmwikiDir };
}

export async function publishStagingRun(_sourceVaultRoot, runtimeRoot, staging) {
  const liveWikiDir = path.join(runtimeRoot, "wiki");
  const liveStateDir = path.join(runtimeRoot, ".llmwiki");
  const liveWikiBackupDir = path.join(runtimeRoot, ".llmwiki", "publish-backup", staging.runId, "wiki");
  const liveStateBackupDir = path.join(runtimeRoot, ".llmwiki", "publish-backup", staging.runId, "state");

  await mkdir(path.dirname(liveWikiBackupDir), { recursive: true });
  await copyDirectoryIfPresent(liveWikiDir, liveWikiBackupDir);
  await copyStateFilesIfPresent(runtimeRoot, liveStateBackupDir);

  await rm(liveWikiDir, { recursive: true, force: true });
  await mkdir(liveWikiDir, { recursive: true });
  await cp(staging.wikiDir, liveWikiDir, { recursive: true, force: true });

  await mkdir(liveStateDir, { recursive: true });
  for (const file of STATE_FILES) {
    const source = path.join(staging.llmwikiDir, file);
    if (!existsSync(source)) continue;
    await cp(source, path.join(liveStateDir, file), { force: true });
  }
}

export async function writeFinalCompileResult(vaultRoot, result) {
  const filePath = path.join(vaultRoot, ".llmwiki", "final-compile-result.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function readFinalCompileResult(vaultRoot) {
  const filePath = path.join(vaultRoot, ".llmwiki", "final-compile-result.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function clearExistingStagingRuns(vaultRoot) {
  const stagingRoot = path.join(vaultRoot, ".llmwiki", "staging");
  const entries = await readdir(stagingRoot).catch(() => []);
  await Promise.all(entries.map((entry) => rm(path.join(stagingRoot, entry), { recursive: true, force: true })));
}

async function copyStateFilesIfPresent(vaultRoot, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const liveStateDir = path.join(vaultRoot, ".llmwiki");
  for (const file of STATE_FILES) {
    const source = path.join(liveStateDir, file);
    if (!existsSync(source)) continue;
    await cp(source, path.join(targetDir, file), { force: true });
  }
}

async function copyDirectoryIfPresent(sourceDir, targetDir, options = {}) {
  if (!existsSync(sourceDir)) return;
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
  if (options.removeRetiredWikiDirs) {
    await removeRetiredWikiDirs(targetDir);
  }
}

async function removeRetiredWikiDirs(wikiDir) {
  for (const dirName of RETIRED_WIKI_DIRS) {
    await rm(path.join(wikiDir, dirName), { recursive: true, force: true });
  }
}
