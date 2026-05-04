import "dotenv/config";
import "global-agent/bootstrap.js";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  loadSyncCompileConfig,
  saveSyncCompileConfig,
} from "./sync-compile/config.mjs";
import { readBatchState, writeBatchState } from "./sync-compile/batch-state.mjs";
import { selectNextBatch } from "./sync-compile/batch-plan.mjs";
import {
  markFlashDiaryAutoCompile,
  readAutoCompileFiles,
  shouldRunFlashDiaryAutoCompile,
} from "./sync-compile/flash-diary-auto-compile.mjs";
import { prepareActiveSources } from "./sync-compile/prepare-active-sources.mjs";
import {
  clearExistingStagingRuns,
  createStagingRun,
  publishStagingRun,
  writeFinalCompileResult,
} from "./sync-compile/staging.mjs";
import {
  ASSET_MIRROR_DIR_NAME,
  inspectSourceFolders,
  syncMarkdownSources,
  syncNonMarkdownAssets,
} from "./sync-compile/sync-files.mjs";
import {
  CLEANED_DIR_NAME,
  IMPORT_MANIFEST_JSON,
  ensureIntakeFolders,
  getIntakeRoots,
  scanIntakeItems,
} from "./sync-compile/intake.mjs";
import {
  canClearStaleLock,
  createLockFileContent,
  formatLockOwner,
} from "./sync-compile/lock.mjs";
import {
  publishWikiToCloudflare,
  syncMobileEntriesFromCloudflare,
} from "./sync-compile/cloudflare-mobile-sync.mjs";
import { resolveSyncRoots } from "./sync-compile/roots.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compilerRoot = path.resolve(__dirname, "..");
const LIVE_LOCK_PATH = path.join(".llmwiki", "lock");
const MIN_RUNNING_PROGRESS = 1;
const MAX_RUNNING_PROGRESS = 99;
let activeCompileChild = null;
let activeLiveLockPath = "";
let lockSignalHandlersInstalled = false;

function reportSyncProgress(percent, message) {
  const normalized = Math.min(
    MAX_RUNNING_PROGRESS,
    Math.max(MIN_RUNNING_PROGRESS, Math.round(percent)),
  );
  console.log(`进度 ${normalized}%：${message}`);
}

function calculateProgressInRange(completed, total, startPercent, endPercent) {
  if (total <= 0) return startPercent;
  const ratio = Math.min(1, Math.max(0, completed / total));
  return startPercent + Math.round((endPercent - startPercent) * ratio);
}

export function summarizeBatchProgress({
  importedCount,
  assetCount,
  completedCount,
  activeBatchCount,
}) {
  return [
    `\u5df2\u540c\u6b65 Markdown \u539f\u6599\uff1a${importedCount}`,
    `\u5df2\u540c\u6b65\u9644\u4ef6\u526f\u672c\uff1a${assetCount}`,
    `\u5df2\u5b8c\u6210\u6587\u4ef6\uff1a${completedCount}`,
    `\u5f53\u524d\u6279\u6b21\u5927\u5c0f\uff1a${activeBatchCount}`,
    "sources_full\uff08\u5168\u91cf Markdown \u539f\u6599\u4ed3\uff09\u4fdd\u5b58\u5168\u90e8\u5df2\u540c\u6b65 raw \u6587\u4ef6",
    `sources_full\\\\${ASSET_MIRROR_DIR_NAME}\uff08\u9644\u4ef6\u526f\u672c\uff09\u4fdd\u5b58\u56fe\u7247\u3001PDF\u3001\u97f3\u89c6\u9891\u7b49\u975e Markdown \u6587\u4ef6`,
    "sources\uff08\u5f53\u524d\u6279\u6b21\u5de5\u4f5c\u533a\uff09\u53ea\u4fdd\u5b58\u672c\u8f6e\u53c2\u4e0e\u7f16\u8bd1\u7684 Markdown \u6587\u4ef6",
  ].join("\n");
}

export async function clearStaleLockIfSafe(vaultRoot) {
  const lockPath = path.join(vaultRoot, ".llmwiki", "lock");
  if (!existsSync(lockPath)) return;

  const lockText = readFileSync(lockPath, "utf8").trim();
  if (await canClearStaleLock(lockText)) {
    rmSync(lockPath, { force: true });
    return;
  }

  throw new Error(`Compilation is already running with ${formatLockOwner(lockText)}.`);
}

export function assertSourceInventoryHasContent({ markdownCount, assetCount }) {
  if (markdownCount === 0 && assetCount === 0) {
    throw new Error(
      "Configured source folders are empty. Refusing to overwrite the local mirror in ai \u7684\u4ed3\u5e93.",
    );
  }
}

export async function consumeFlashDiaryAutoCompileAttempt({
  runtimeRoot,
  state,
  now = new Date(),
  shouldConsume,
}) {
  if (!shouldConsume) return state;
  const nextState = markFlashDiaryAutoCompile(state, now);
  await writeBatchState(runtimeRoot, nextState);
  return nextState;
}

export async function hasSelectedFlashDiaryImport(runtimeRoot, selectedFiles) {
  if (selectedFiles.length === 0) return false;
  const manifestPath = path.join(runtimeRoot, IMPORT_MANIFEST_JSON);
  if (!existsSync(manifestPath)) return false;

  const selected = new Set(selectedFiles);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return (manifest.imports ?? []).some(
    (item) => selected.has(item.imported_filename) && item.source_kind === "flash",
  );
}

async function pickSourceFolders() {
  const scriptPath = path.join(compilerRoot, "scripts", "pick-source-folders.ps1");
  const { stdout } = await execFileAsync("powershell", [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ]);

  const parsed = JSON.parse(stdout || "[]");
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "string" && parsed) return [parsed];
  return [];
}

async function loadOrPromptSourceFolders(config) {
  const roots = resolveCompileRootsFromConfig(config, compilerRoot);
  const intakeSourceFolders = await getConfiguredIntakeSourceFolders(roots.sourceVaultRoot);
  if (config.source_folders.length > 0 || intakeSourceFolders.length > 0) {
    return {
      ...config,
      source_folders: mergeSourceFolders([...config.source_folders, ...intakeSourceFolders]),
      exclude_dirs: mergeExcludeDirs(config.exclude_dirs),
    };
  }

  const folders = await pickSourceFolders();
  if (folders.length === 0) {
    throw new Error("No source folders selected.");
  }

  const nextConfig = {
    ...config,
    source_folders: folders,
    exclude_dirs: mergeExcludeDirs(config.exclude_dirs),
  };
  await saveSyncCompileConfig(compilerRoot, nextConfig);
  return nextConfig;
}

function mergeExcludeDirs(excludeDirs) {
  return [...new Set([...excludeDirs, CLEANED_DIR_NAME])];
}

async function getConfiguredIntakeSourceFolders(vaultRoot) {
  await ensureIntakeFolders(vaultRoot);
  const items = await scanIntakeItems(vaultRoot);
  if (items.length === 0) return [];
  return getIntakeRoots(vaultRoot)
    .filter((root) => root.kind !== "inbox")
    .map((root) => root.root);
}

function mergeSourceFolders(sourceFolders) {
  const selected = [];
  return sourceFolders.filter((folder) => {
    const key = path.resolve(folder).toLowerCase();
    if (selected.some((existing) => key === existing || key.startsWith(`${existing}${path.sep}`))) {
      return false;
    }
    selected.push(key);
    return true;
  });
}

async function runCompile(root, compilerRootPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [path.join(compilerRootPath, "dist", "cli.js"), "compile"],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    activeCompileChild = child;
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on("exit", (code) => {
      if (activeCompileChild === child) activeCompileChild = null;
      if (code === 0) {
        resolve();
        return;
      }
      const details = `${stdout}\n${stderr}`.trim();
      reject(new Error(details || `Compile exited with code ${code ?? "unknown"}.`));
    });

    child.on("error", (error) => {
      if (activeCompileChild === child) activeCompileChild = null;
      reject(error);
    });
  });
}

async function acquireLiveLock(vaultRoot) {
  const lockPath = path.join(vaultRoot, LIVE_LOCK_PATH);
  await mkdir(path.dirname(lockPath), { recursive: true });

  try {
    await writeFile(lockPath, createLockFileContent(), { encoding: "utf8", flag: "wx" });
  } catch {
    const lockText = existsSync(lockPath) ? readFileSync(lockPath, "utf8").trim() : "";
    if (!(await canClearStaleLock(lockText))) {
      throw new Error(`Compilation is already running with ${formatLockOwner(lockText)}.`);
    }
    await rm(lockPath, { force: true });
    await writeFile(lockPath, createLockFileContent(), { encoding: "utf8", flag: "wx" });
  }

  activeLiveLockPath = lockPath;
  installLockSignalHandlers();
  return lockPath;
}

async function releaseLiveLock(lockPath) {
  if (activeLiveLockPath === lockPath) activeLiveLockPath = "";
  await unlink(lockPath).catch(() => {});
}

function installLockSignalHandlers() {
  if (lockSignalHandlersInstalled) return;
  lockSignalHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => cleanupLiveLockAfterSignal(signal));
  }
}

function cleanupLiveLockAfterSignal(signal) {
  activeCompileChild?.kill();
  if (activeLiveLockPath) {
    rmSync(activeLiveLockPath, { force: true });
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}

async function readTieredCounts(root) {
  const [claims, procedures] = await Promise.all([
    readJsonArray(path.join(root, ".llmwiki", "claims.json")),
    readJsonArray(path.join(root, ".llmwiki", "procedures.json")),
  ]);
  return {
    claimsUpdated: claims.length,
    proceduresUpdated: procedures.length,
  };
}

export function normalizeEntityIndexSnapshot(entityIndex, now = new Date()) {
  const normalized = {
    version: 1,
    entities: {},
  };

  for (const [entityId, record] of Object.entries(entityIndex?.entities ?? {})) {
    const sourcePaths = uniqueSnapshotSourcePaths(record?.sourcePaths ?? []);
    const mentionCount = toSnapshotCount(record?.mentionCount);
    const sourceDiversity = sourcePaths.length;
    const lastConfirmedAt = normalizeSnapshotIso(record?.lastConfirmedAt);

    normalized.entities[entityId] = {
      id: record?.id || entityId,
      title: record?.title || entityId,
      mentionCount,
      sourceDiversity,
      sourcePaths,
      lastConfirmedAt,
      tier: suggestSnapshotEntityTier({
        mentionCount,
        sourceDiversity,
        lastConfirmedAt,
        now,
      }),
    };
  }

  return normalized;
}

async function refreshEntityIndexSnapshot(vaultRoot) {
  const filePath = path.join(vaultRoot, ".llmwiki", "entity-index.json");
  if (!existsSync(filePath)) return { changed: false, entityCount: 0 };

  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return { changed: false, entityCount: 0 };

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeEntityIndexSnapshot(parsed);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return { changed: true, entityCount: Object.keys(normalized.entities).length };
  } catch {
    return { changed: false, entityCount: 0 };
  }
}

function suggestSnapshotEntityTier({ mentionCount, sourceDiversity, lastConfirmedAt, now }) {
  const recent = isSnapshotRecentlyConfirmed(lastConfirmedAt, now);
  if (mentionCount >= 5 || sourceDiversity >= 3 || (recent && mentionCount >= 3)) {
    return 3;
  }
  if (mentionCount >= 2 || sourceDiversity >= 2) {
    return 2;
  }
  return 1;
}

function isSnapshotRecentlyConfirmed(lastConfirmedAt, now) {
  if (!lastConfirmedAt) return false;
  const confirmedAt = new Date(lastConfirmedAt);
  if (Number.isNaN(confirmedAt.getTime())) return false;
  const referenceTime = now ?? new Date();
  const ageInDays = (referenceTime.getTime() - confirmedAt.getTime()) / (24 * 60 * 60 * 1000);
  return ageInDays <= 30;
}

function uniqueSnapshotSourcePaths(paths) {
  const unique = new Set();
  for (const sourcePath of paths ?? []) {
    const normalized = normalizeSnapshotSourcePath(sourcePath);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

function normalizeSnapshotSourcePath(sourcePath) {
  if (typeof sourcePath !== "string") return "";
  return sourcePath.trim().replaceAll("\\", "/").toLowerCase();
}

function toSnapshotCount(value) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
}

function normalizeSnapshotIso(value) {
  if (!value) return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

async function readJsonArray(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveCompileRootsFromConfig(config, compilerRootPath = compilerRoot) {
  return resolveSyncRoots(config, compilerRootPath);
}

async function archiveCompiledClippings({
  runtimeRoot,
  sourceVaultRoot,
  compiledFiles,
}) {
  const manifestPath = path.join(runtimeRoot, IMPORT_MANIFEST_JSON);
  if (!existsSync(manifestPath)) return 0;

  const clippingRoot = getIntakeRoots(sourceVaultRoot).find((root) => root.kind === "clipping")?.root;
  if (!clippingRoot) return 0;

  const compiled = new Set(compiledFiles);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let moved = 0;

  for (const item of manifest.imports ?? []) {
    if (!compiled.has(item.imported_filename) || item.source_kind !== "clipping") continue;
    if (await moveCompiledClippingToCleaned(item.source_path, clippingRoot)) moved += 1;
  }

  return moved;
}

async function moveCompiledClippingToCleaned(sourcePath, clippingRoot) {
  if (!existsSync(sourcePath)) return false;

  const relative = path.relative(clippingRoot, sourcePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;

  const target = path.join(clippingRoot, CLEANED_DIR_NAME, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(sourcePath, target);
  return true;
}

// fallow-ignore-next-line complexity
async function main() {
  reportSyncProgress(2, "正在读取同步配置");
  const initialConfig = await loadSyncCompileConfig(compilerRoot);
  const initialRoots = resolveCompileRootsFromConfig(initialConfig, compilerRoot);
  reportSyncProgress(5, "正在同步手机输入");
  const mobileSync = await syncMobileEntriesFromCloudflare({
    projectRoot: compilerRoot,
    vaultRoot: initialRoots.sourceVaultRoot,
  });
  if (!mobileSync.skipped) {
    console.log(`Cloudflare \u624b\u673a\u8f93\u5165\u5df2\u540c\u6b65\uff1a${mobileSync.pulledCount}`);
    if (mobileSync.failedCount > 0) {
      console.log(`Cloudflare \u624b\u673a\u8f93\u5165\u540c\u6b65\u5931\u8d25\uff1a${mobileSync.failedCount}`);
    }
    if (mobileSync.error) {
      console.log(`Cloudflare \u624b\u673a\u8f93\u5165\u540c\u6b65\u9519\u8bef\uff1a${mobileSync.error}`);
    }
  }
  const config = await loadOrPromptSourceFolders(initialConfig);
  const roots = resolveCompileRootsFromConfig(config, compilerRoot);
  reportSyncProgress(10, "正在检查源文件夹");
  const inventory = await inspectSourceFolders(config.source_folders, config.exclude_dirs);
  const lockPath = await acquireLiveLock(roots.runtimeRoot);

  try {
    assertSourceInventoryHasContent(inventory);

    reportSyncProgress(16, "正在同步 Markdown 原料");
    const importedCount = await syncMarkdownSources(
      config.source_folders,
      roots.runtimeRoot,
      config.exclude_dirs,
    );
    reportSyncProgress(24, "正在同步附件副本");
    const assetCount = await syncNonMarkdownAssets(
      config.source_folders,
      roots.runtimeRoot,
      config.exclude_dirs,
    );

    reportSyncProgress(32, "正在规划编译批次");
    const now = new Date();
    const initialState = await readBatchState(roots.runtimeRoot);
    const completedFiles = new Set(initialState.completed_files);
    const files = await readAutoCompileFiles(
      roots.runtimeRoot,
      completedFiles,
      now,
      initialState,
    );
    const shouldConsumeFlashDiaryAttempt = shouldRunFlashDiaryAutoCompile(now, initialState)
      && await hasSelectedFlashDiaryImport(roots.runtimeRoot, files);
    const runState = await consumeFlashDiaryAutoCompileAttempt({
      runtimeRoot: roots.runtimeRoot,
      state: initialState,
      now,
      shouldConsume: shouldConsumeFlashDiaryAttempt,
    });
    const batches = [];

    while (true) {
      const batch = selectNextBatch(files, {
        completedFiles,
        batchLimit: config.batch_limit,
        patternOrder: config.batch_pattern_order,
      });
      if (batch.length === 0) break;
      batches.push(batch);
      for (const file of batch) completedFiles.add(file);
    }

    if (batches.length === 0) {
      reportSyncProgress(86, "没有剩余待编译文件，正在写入结果");
      await writeFinalCompileResult(roots.runtimeRoot, {
        status: "succeeded",
        syncedMarkdownCount: importedCount,
        syncedAssetCount: assetCount,
        completedFilesCount: runState.completed_files.length,
        internalBatchCount: 0,
        batchLimit: config.batch_limit,
        claimsUpdated: 0,
        proceduresUpdated: 0,
        wikiOutputDir: roots.runtimeWikiDir,
        publishedAt: new Date().toISOString(),
      });
      reportSyncProgress(92, "正在发布 wiki");
      const cloudflarePublish = await publishWikiToCloudflare({
        projectRoot: compilerRoot,
        vaultRoot: roots.runtimeRoot,
        mobileDiaryRoot: roots.sourceVaultRoot,
      });
      if (!cloudflarePublish.skipped) {
        console.log(`Cloudflare wiki \u53ea\u8bfb\u9875\u5df2\u53d1\u5e03\uff1a${cloudflarePublish.publishedCount}`);
        if (cloudflarePublish.error) {
          console.log(`Cloudflare wiki \u53d1\u5e03\u9519\u8bef\uff1a${cloudflarePublish.error}`);
        }
      }
      const entitySnapshot = await refreshEntityIndexSnapshot(roots.runtimeRoot);
      if (entitySnapshot.changed) {
        console.log(`\u5b9e\u4f53\u7d22\u5f15\u5df2\u5f52\u4e00\u5316\uff1a${entitySnapshot.entityCount}`);
      }
      reportSyncProgress(98, "正在整理同步结果");
      console.log(
        summarizeBatchProgress({
          importedCount,
          assetCount,
          completedCount: runState.completed_files.length,
          activeBatchCount: 0,
        }),
      );
      console.log("\u6ca1\u6709\u5269\u4f59\u5f85\u7f16\u8bd1\u6587\u4ef6\u3002");
      return;
    }

    await clearExistingStagingRuns(roots.runtimeRoot);
    const staging = await createStagingRun(roots.sourceVaultRoot, roots.runtimeRoot);
    const compiledFiles = [];

    try {
      for (const [batchIndex, batch] of batches.entries()) {
        const batchNumber = batchIndex + 1;
        reportSyncProgress(
          calculateProgressInRange(batchIndex, batches.length, 36, 82),
          `正在编译第 ${batchNumber}/${batches.length} 批`,
        );
        await prepareActiveSources(staging.root, batch, roots.runtimeRoot);
        await runCompile(staging.root, config.compiler_root);
        compiledFiles.push(...batch);
        reportSyncProgress(
          calculateProgressInRange(batchNumber, batches.length, 36, 82),
          `已完成第 ${batchNumber}/${batches.length} 批`,
        );
      }

      reportSyncProgress(86, "正在发布编译结果");
      await publishStagingRun(roots.sourceVaultRoot, roots.runtimeRoot, staging);
      await writeBatchState(roots.runtimeRoot, {
        completed_files: [...runState.completed_files, ...compiledFiles],
        flash_diary_auto_compile: runState.flash_diary_auto_compile,
      });

      const cleanedCount = await archiveCompiledClippings({
        runtimeRoot: roots.runtimeRoot,
        sourceVaultRoot: roots.sourceVaultRoot,
        compiledFiles,
      });
      const tieredCounts = await readTieredCounts(roots.runtimeRoot);

      const publishedAt = new Date().toISOString();
      await writeFinalCompileResult(roots.runtimeRoot, {
        status: "succeeded",
        syncedMarkdownCount: importedCount,
        syncedAssetCount: assetCount,
        completedFilesCount: runState.completed_files.length + compiledFiles.length,
        internalBatchCount: batches.length,
        batchLimit: config.batch_limit,
        claimsUpdated: tieredCounts.claimsUpdated,
        proceduresUpdated: tieredCounts.proceduresUpdated,
        wikiOutputDir: roots.runtimeWikiDir,
        publishedAt,
      });
      reportSyncProgress(92, "正在发布 wiki");
      const cloudflarePublish = await publishWikiToCloudflare({
        projectRoot: compilerRoot,
        vaultRoot: roots.runtimeRoot,
        mobileDiaryRoot: roots.sourceVaultRoot,
        version: publishedAt,
      });
      if (!cloudflarePublish.skipped) {
        console.log(`Cloudflare wiki \u53ea\u8bfb\u9875\u5df2\u53d1\u5e03\uff1a${cloudflarePublish.publishedCount}`);
        if (cloudflarePublish.error) {
          console.log(`Cloudflare wiki \u53d1\u5e03\u9519\u8bef\uff1a${cloudflarePublish.error}`);
        }
      }
      const entitySnapshot = await refreshEntityIndexSnapshot(roots.runtimeRoot);
      if (entitySnapshot.changed) {
        console.log(`\u5b9e\u4f53\u7d22\u5f15\u5df2\u5f52\u4e00\u5316\uff1a${entitySnapshot.entityCount}`);
      }
      reportSyncProgress(98, "正在整理同步结果");

      console.log(
        summarizeBatchProgress({
          importedCount,
          assetCount,
          completedCount: runState.completed_files.length + compiledFiles.length,
          activeBatchCount: compiledFiles.length,
        }),
      );
      console.log(`\u5185\u90e8\u6279\u6b21\u6570\uff1a${batches.length}`);
      if (cleanedCount > 0) {
        console.log(`\u5df2\u5c06\u5b8c\u6210\u7f16\u8bd1\u7684\u526a\u85cf\u539f\u6587\u79fb\u52a8\u5230 _\u5df2\u6e05\u7406\uff1a${cleanedCount}`);
      }
      console.log(`wiki \u8f93\u51fa\uff1a${roots.runtimeWikiDir}`);
    } catch (error) {
      await writeFinalCompileResult(roots.runtimeRoot, {
        status: "failed",
        syncedMarkdownCount: importedCount,
        syncedAssetCount: assetCount,
        completedFilesCount: runState.completed_files.length,
        internalBatchCount: batches.length,
        batchLimit: config.batch_limit,
        claimsUpdated: 0,
        proceduresUpdated: 0,
        wikiOutputDir: roots.runtimeWikiDir,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await rm(staging.root, { recursive: true, force: true });
    }
  } finally {
    await releaseLiveLock(lockPath);
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
