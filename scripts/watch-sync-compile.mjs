import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { watch as chokidarWatch } from "chokidar";
import { loadSyncCompileConfig } from "./sync-compile/config.mjs";
import { resolveSyncRoots } from "./sync-compile/roots.mjs";
import {
  createCloudflareWikiPublishScheduler,
  publishWikiToCloudflare,
} from "./sync-compile/cloudflare-mobile-sync.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compilerRoot = path.resolve(__dirname, "..");
const syncScriptPath = path.join(compilerRoot, "scripts", "sync-compile.mjs");
const DEBOUNCE_MS = 800;

// fallow-ignore-next-line complexity
function shouldIgnorePath(filePath, excludeDirs) {
  const normalized = filePath.replace(/\\/g, "/");
  return excludeDirs.some((dir) => normalized.includes(`/${dir}/`) || normalized.endsWith(`/${dir}`));
}

// fallow-ignore-next-line complexity
async function runSyncCompileOnce() {
  await new Promise((resolve, reject) => {
    const child = spawn("node", [syncScriptPath], {
      cwd: compilerRoot,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Sync compile exited with code ${code ?? "unknown"}.`));
    });

    child.on("error", reject);
  });
}

// fallow-ignore-next-line complexity
async function main() {
  const config = await loadSyncCompileConfig(compilerRoot);
  const roots = resolveSyncRoots(config, compilerRoot);
  if (!Array.isArray(config.source_folders) || config.source_folders.length === 0) {
    throw new Error("No source folders configured. Save the panel config first.");
  }

  console.log("开始监听源文件夹变化并自动同步编译。");
  console.log(`源文件夹数量：${config.source_folders.length}`);
  console.log("检测到 Markdown 或附件变动后，会自动执行一轮同步 + 分批编译。");

  let isRunning = false;
  let hasPendingRun = false;
  let hasPendingWikiPublish = false;
  let debounceTimer = null;
  const wikiPublishScheduler = createCloudflareWikiPublishScheduler({
    publishWiki: async () => {
      const result = await publishWikiToCloudflare({
        projectRoot: compilerRoot,
        vaultRoot: roots.runtimeRoot,
        mobileDiaryRoot: roots.sourceVaultRoot,
      });
      if (result.error) {
        throw new Error(result.error);
      }
      if (!result.skipped) {
        console.log(`Cloudflare wiki 自动发布：${result.publishedCount} 页，版本 ${result.publishVersion}`);
      }
    },
  });

  async function scheduleRun(eventPath, eventName) {
    if (shouldIgnorePath(eventPath, config.exclude_dirs)) {
      return;
    }

    console.log(`${eventName}: ${eventPath}`);
    if (debounceTimer) {
      // fallow-ignore-next-line complexity
      clearTimeout(debounceTimer);
    }

    // fallow-ignore-next-line complexity
    debounceTimer = setTimeout(async () => {
      if (isRunning) {
        hasPendingRun = true;
        return;
      }

      isRunning = true;
      try {
        await runSyncCompileOnce();
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        isRunning = false;
        if (hasPendingWikiPublish) {
          hasPendingWikiPublish = false;
          await wikiPublishScheduler.reconcileNow();
        }
        if (hasPendingRun) {
          hasPendingRun = false;
          await scheduleRun(eventPath, "pending");
        }
      }
    }, DEBOUNCE_MS);
  }

  function scheduleWikiPublish(eventPath, eventName) {
    console.log(`${eventName}: ${eventPath}`);
    if (isRunning) {
      hasPendingWikiPublish = true;
      return;
    }
    wikiPublishScheduler.scheduleChange(eventPath);
  }

  const watcher = chokidarWatch(config.source_folders, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
    ignored: (filePath) => shouldIgnorePath(filePath, config.exclude_dirs),
  });

  watcher
    .on("add", (filePath) => {
      void scheduleRun(filePath, "新增");
    })
    .on("change", (filePath) => {
      void scheduleRun(filePath, "修改");
    })
    .on("unlink", (filePath) => {
      void scheduleRun(filePath, "删除");
    });

  const wikiWatcher = chokidarWatch(roots.runtimeWikiDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  wikiWatcher
    .on("add", (filePath) => {
      scheduleWikiPublish(filePath, "Wiki 新增");
    })
    .on("change", (filePath) => {
      scheduleWikiPublish(filePath, "Wiki 修改");
    })
    .on("unlink", (filePath) => {
      scheduleWikiPublish(filePath, "Wiki 删除");
    });

  await wikiPublishScheduler.reconcileNow();

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
