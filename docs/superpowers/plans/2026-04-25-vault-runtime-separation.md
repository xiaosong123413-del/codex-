# Vault Runtime Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `D:\Desktop\ai的仓库` the only editable source-of-truth while moving all Peiweipedia runtime artifacts into `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault\`.

**Architecture:** Split the system into two explicit roots: a source vault root and a runtime output root. The compile pipeline writes only to the runtime root; the web server and desktop app read source markdown from the vault and indexes/state/generated pages from the runtime root. This keeps Obsidian content authoritative and makes all runtime output disposable.

**Tech Stack:** Node.js ESM scripts, TypeScript Express server, Electron desktop shell, Vitest, PowerShell launcher scripts.

---

## File Structure

### New files

- `scripts/sync-compile/roots.mjs`
  Central runtime/source path resolver for compile scripts.
- `web/server/runtime-paths.ts`
  Server-side root/path helpers for source-backed pages and runtime-backed artifacts.
- `test/sync-compile-runtime-roots.test.ts`
  Focused config + path resolution test for the new source/runtime root model.
- `test/web-runtime-roots.test.ts`
  Focused server-side test that pages/tree/services resolve against the correct root.

### Files to modify

- `sync-compile-config.json`
  Rewrite config shape to explicit `source_vault_root` and `runtime_output_root`.
- `scripts/sync-compile/config.mjs`
  Read/write the new config shape.
- `scripts/sync-compile.mjs`
  Use source/runtime roots instead of a single `target_vault`.
- `scripts/sync-compile/sync-files.mjs`
  Write `sources_full` and import manifests to the runtime root instead of the vault.
- `scripts/sync-compile/prepare-active-sources.mjs`
  Read from runtime `sources_full` and stage into runtime `sources`.
- `scripts/sync-compile/staging.mjs`
  Stage from source-vault wiki and publish to runtime wiki/.llmwiki only.
- `scripts/sync-compile/batch-state.mjs`
  Move batch state from the vault to the runtime root.
- `web/server/config.ts`
  Replace the single `wikiRoot` concept with explicit source/runtime roots.
- `web/server/index.ts`
  Parse and pass the two-root config through all routes/services.
- `web/server/routes/pages.ts`
  Read source-backed pages from the vault and runtime-backed/generated pages from the runtime root.
- `web/server/routes/tree.ts`
  Build mixed trees: source raw/wiki from the vault, runtime `sources`/`sources_full` from runtime output.
- `web/server/services/sync-config.ts`
  Save/read the new config fields.
- `web/server/services/search-index.ts`
  Read the search index from runtime `.llmwiki`.
- `web/server/services/review-aggregator.ts`
  Read runtime `.llmwiki/state.json`, claims/procedures/episodes from runtime.
- `web/server/services/wiki-comments.ts`
  Store comments under runtime `.llmwiki`.
- `web/server/services/source-media-index.ts`
  Read/write runtime `.llmwiki/source-media-index.json`.
- `web/server/services/flash-diary.ts`
  Write runtime failure state under runtime `.llmwiki`.
- `web/server/services/flash-diary-sync.ts`
  Write runtime sync state under runtime `.llmwiki`.
- `web/server/services/clip-pipeline.ts`
  Write clip task ledger under runtime `.llmwiki`.
- `web/server/services/xhs-sync.ts`
  Write sync task/failure state under runtime `.llmwiki`.
- `web/server/services/douyin-sync.ts`
  Read/write runtime cookie/task state under runtime `.llmwiki`.
- `web/server/services/sources-full-store.ts`
  Read runtime `sources_full` and runtime manifests.
- `desktop-webui/src/main.ts`
  Pass source/runtime roots into the local web server and stop assuming one root.
- `scripts/start-desktop-webui.ps1`
  Resolve wiki-clone/wiki root from the runtime output root instead of `target_vault/wiki`.
- `test/sync-config-routes.test.ts`
  Update config route expectations.
- `test/sync-compile-sync.test.ts`
  Assert runtime artifacts are written outside the vault.
- `test/staging-publish.test.ts`
  Assert staging publish copies source wiki into staging but publishes only to runtime root.
- `test/web-page-cache.test.ts`
  Keep page caching working with source/runtime resolution.
- `test/web-tree.test.ts`
  Assert wiki tree comes from source vault wiki.
- `test/web-tree-raw.test.ts`
  Assert raw tree mixes source `raw`/`inbox` with runtime `sources`/`sources_full`.
- `test/web-review-aggregator.test.ts`
  Assert review data comes from runtime `.llmwiki`.
- `test/wiki-comments-routes.test.ts`
  Assert comment store uses runtime `.llmwiki`.
- `test/webui-desktop-integration.test.ts`
  Assert desktop launch code passes separate source/runtime roots.

## Task 1: Split Config Into Source Root And Runtime Root

**Files:**
- Create: `scripts/sync-compile/roots.mjs`
- Modify: `sync-compile-config.json`
- Modify: `scripts/sync-compile/config.mjs`
- Modify: `web/server/services/sync-config.ts`
- Test: `test/sync-config-routes.test.ts`
- Test: `test/sync-compile-runtime-roots.test.ts`

- [ ] **Step 1: Write the failing config/root resolution tests**

```ts
// test/sync-compile-runtime-roots.test.ts
import { describe, expect, it } from "vitest";
import { resolveSyncRoots } from "../scripts/sync-compile/roots.mjs";

describe("sync compile roots", () => {
  it("uses explicit source and runtime roots", () => {
    const roots = resolveSyncRoots({
      source_vault_root: "D:/Desktop/ai的仓库",
      runtime_output_root: "D:/Desktop/llm-wiki-compiler-main/.runtime/ai-vault",
    }, "D:/Desktop/llm-wiki-compiler-main");

    expect(roots.sourceVaultRoot).toBe("D:\\Desktop\\ai的仓库");
    expect(roots.runtimeRoot).toBe("D:\\Desktop\\llm-wiki-compiler-main\\.runtime\\ai-vault");
    expect(roots.runtimeWikiDir).toBe("D:\\Desktop\\llm-wiki-compiler-main\\.runtime\\ai-vault\\wiki");
    expect(roots.runtimeStateDir).toBe("D:\\Desktop\\llm-wiki-compiler-main\\.runtime\\ai-vault\\.llmwiki");
  });
});
```

```ts
// test/sync-config-routes.test.ts (target expectations)
expect(response.body.data).toEqual({
  sourceVaultRoot: "D:/Desktop/ai的仓库",
  runtimeOutputRoot: "D:/Desktop/llm-wiki-compiler-main/.runtime/ai-vault",
  sourceRepoPaths: ["D:/Desktop/source-a", "D:/Desktop/source-b"],
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- test\sync-config-routes.test.ts test\sync-compile-runtime-roots.test.ts
```

Expected:

- `sync-config-routes` still returns `targetRepoPath`
- `sync-compile-runtime-roots` fails because `resolveSyncRoots` does not exist yet

- [ ] **Step 3: Implement the new config shape and root helper**

```json
// sync-compile-config.json
{
  "source_vault_root": "D:\\Desktop\\ai的仓库",
  "runtime_output_root": "D:\\Desktop\\llm-wiki-compiler-main\\.runtime\\ai-vault",
  "compiler_root": "D:\\Desktop\\llm-wiki-compiler-main",
  "source_folders": [
    "D:\\Desktop\\ai的仓库\\raw"
  ],
  "compile_mode": "batch",
  "publish_mode": "final_only",
  "memory_model": "tiered",
  "batch_limit": 20,
  "batch_pattern_order": [
    "ai知识库（第二大脑）__概念__*",
    "ai知识库（第二大脑）__项目__*",
    "02_领域__*",
    "01_项目__*",
    "03_资源__*",
    "*"
  ],
  "exclude_dirs": [
    ".obsidian",
    ".trash",
    ".claude",
    ".claudian",
    "_已清理"
  ]
}
```

```js
// scripts/sync-compile/roots.mjs
import path from "node:path";

export function resolveSyncRoots(config, compilerRoot) {
  const sourceVaultRoot = path.resolve(config.source_vault_root);
  const runtimeRoot = path.resolve(config.runtime_output_root);
  return {
    sourceVaultRoot,
    runtimeRoot,
    runtimeWikiDir: path.join(runtimeRoot, "wiki"),
    runtimeStateDir: path.join(runtimeRoot, ".llmwiki"),
    runtimeSystemDir: path.join(runtimeRoot, ".wiki-system"),
    runtimeAuditDir: path.join(runtimeRoot, "audit"),
    runtimeSourcesDir: path.join(runtimeRoot, "sources"),
    runtimeSourcesFullDir: path.join(runtimeRoot, "sources_full"),
    compilerRoot: path.resolve(config.compiler_root ?? compilerRoot),
  };
}
```

```js
// scripts/sync-compile/config.mjs
return {
  source_vault_root: raw.source_vault_root ?? "",
  runtime_output_root: raw.runtime_output_root ?? "",
  compiler_root: raw.compiler_root ?? compilerRoot,
  source_folders: raw.source_folders ?? [],
  compile_mode: raw.compile_mode ?? "batch",
  batch_limit: raw.batch_limit ?? 20,
  batch_pattern_order: raw.batch_pattern_order ?? DEFAULT_BATCH_PATTERNS,
  exclude_dirs: raw.exclude_dirs ?? DEFAULT_EXCLUDE_DIRS,
};
```

```ts
// web/server/services/sync-config.ts
export interface SyncRepoConfig {
  sourceVaultRoot: string;
  runtimeOutputRoot: string;
  sourceRepoPaths: string[];
}

const next = {
  ...raw,
  source_vault_root: config.sourceVaultRoot,
  runtime_output_root: config.runtimeOutputRoot,
  source_folders: config.sourceRepoPaths,
};
```

- [ ] **Step 4: Run tests to verify the config split passes**

Run:

```bash
rtk npm test -- test\sync-config-routes.test.ts test\sync-compile-runtime-roots.test.ts
```

Expected:

- PASS
- config route now returns `sourceVaultRoot` and `runtimeOutputRoot`

- [ ] **Step 5: Commit**

```bash
rtk git add sync-compile-config.json scripts/sync-compile/config.mjs scripts/sync-compile/roots.mjs web/server/services/sync-config.ts test/sync-config-routes.test.ts test/sync-compile-runtime-roots.test.ts
rtk git commit -m "refactor: split source vault and runtime roots"
```

## Task 2: Redirect Compile Output And Runtime State Out Of The Vault

**Files:**
- Modify: `scripts/sync-compile.mjs`
- Modify: `scripts/sync-compile/sync-files.mjs`
- Modify: `scripts/sync-compile/prepare-active-sources.mjs`
- Modify: `scripts/sync-compile/staging.mjs`
- Modify: `scripts/sync-compile/batch-state.mjs`
- Test: `test/sync-compile-sync.test.ts`
- Test: `test/staging-publish.test.ts`

- [ ] **Step 1: Write the failing pipeline tests**

```ts
// test/sync-compile-sync.test.ts
it("writes sources_full and manifests to the runtime root instead of the source vault", async () => {
  const sourceVault = makeTempDir("source-vault");
  const runtimeRoot = makeTempDir("runtime-root");
  const imported = await syncMarkdownSources(
    [makeImportedMarkdownRoot()],
    runtimeRoot,
    [".obsidian"],
  );

  expect(imported).toBe(1);
  expect(fs.existsSync(path.join(runtimeRoot, "sources_full"))).toBe(true);
  expect(fs.existsSync(path.join(sourceVault, "sources_full"))).toBe(false);
  expect(fs.existsSync(path.join(runtimeRoot, "raw_import_manifest.json"))).toBe(true);
});
```

```ts
// test/staging-publish.test.ts
it("publishes staging wiki and state to the runtime root without overwriting source wiki files", async () => {
  const sourceVault = makeTempDir("source-vault");
  const runtimeRoot = makeTempDir("runtime-root");
  fs.mkdirSync(path.join(sourceVault, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(sourceVault, "wiki", "concepts", "manual.md"), "# Manual\n", "utf8");

  const staging = await createStagingRun(sourceVault, runtimeRoot);
  fs.writeFileSync(path.join(staging.wikiDir, "index.md"), "# Generated home\n", "utf8");
  await publishStagingRun(sourceVault, runtimeRoot, staging);

  expect(fs.existsSync(path.join(runtimeRoot, "wiki", "index.md"))).toBe(true);
  expect(fs.readFileSync(path.join(sourceVault, "wiki", "concepts", "manual.md"), "utf8")).toContain("Manual");
  expect(fs.existsSync(path.join(sourceVault, ".llmwiki"))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- test\sync-compile-sync.test.ts test\staging-publish.test.ts
```

Expected:

- runtime-path assertions fail because the pipeline still writes to the vault
- `createStagingRun(sourceVault, runtimeRoot)` signature does not exist yet

- [ ] **Step 3: Rewire the compile pipeline around `sourceVaultRoot` and `runtimeRoot`**

```js
// scripts/sync-compile.mjs
const config = await loadOrPromptSourceFolders(initialConfig);
const roots = resolveSyncRoots(config, compilerRoot);
const lockPath = await acquireLiveLock(roots.runtimeRoot);

const importedCount = await syncMarkdownSources(
  config.source_folders,
  roots.runtimeRoot,
  config.exclude_dirs,
);
const assetCount = await syncNonMarkdownAssets(
  config.source_folders,
  roots.runtimeRoot,
  config.exclude_dirs,
);

const state = await readBatchState(roots.runtimeRoot);
const staging = await createStagingRun(roots.sourceVaultRoot, roots.runtimeRoot);
await prepareActiveSources(staging.root, batch, roots.runtimeRoot);
await publishStagingRun(roots.sourceVaultRoot, roots.runtimeRoot, staging);
await writeFinalCompileResult(roots.runtimeRoot, {
  wikiOutputDir: path.join(roots.runtimeRoot, "wiki"),
  // other fields unchanged
});
```

```js
// scripts/sync-compile/staging.mjs
export async function createStagingRun(sourceVaultRoot, runtimeRoot) {
  const root = buildStagingRoot(runtimeRoot, runId);
  const wikiDir = path.join(root, "wiki");
  const llmwikiDir = path.join(root, ".llmwiki");

  await copyDirectoryIfPresent(path.join(sourceVaultRoot, "wiki"), wikiDir);
  await copyStateFilesIfPresent(runtimeRoot, llmwikiDir);
  return { runId, root, wikiDir, llmwikiDir };
}

export async function publishStagingRun(sourceVaultRoot, runtimeRoot, staging) {
  const liveWikiDir = path.join(runtimeRoot, "wiki");
  const liveStateDir = path.join(runtimeRoot, ".llmwiki");
  await rm(liveWikiDir, { recursive: true, force: true });
  await mkdir(liveWikiDir, { recursive: true });
  await cp(staging.wikiDir, liveWikiDir, { recursive: true, force: true });
  await mkdir(liveStateDir, { recursive: true });
  // copy STATE_FILES from staging.llmwikiDir into runtimeRoot/.llmwiki
}
```

```js
// scripts/sync-compile/batch-state.mjs
const STATE_FILE = ".llmwiki-batch-state.json";

export async function readBatchState(runtimeRoot) {
  const filePath = path.join(runtimeRoot, STATE_FILE);
  // existing read logic unchanged
}
```

- [ ] **Step 4: Re-run the compile pipeline tests**

Run:

```bash
rtk npm test -- test\sync-compile-sync.test.ts test\staging-publish.test.ts
```

Expected:

- PASS
- source vault `wiki/` files stay untouched
- runtime root owns `wiki/`, `.llmwiki/`, `sources/`, `sources_full/`, and manifests

- [ ] **Step 5: Commit**

```bash
rtk git add scripts/sync-compile.mjs scripts/sync-compile/sync-files.mjs scripts/sync-compile/prepare-active-sources.mjs scripts/sync-compile/staging.mjs scripts/sync-compile/batch-state.mjs test/sync-compile-sync.test.ts test/staging-publish.test.ts
rtk git commit -m "refactor: move compile artifacts to runtime root"
```

## Task 3: Teach The Web Server To Read Source Content And Runtime Artifacts Separately

**Files:**
- Create: `web/server/runtime-paths.ts`
- Modify: `web/server/config.ts`
- Modify: `web/server/index.ts`
- Modify: `web/server/routes/pages.ts`
- Modify: `web/server/routes/tree.ts`
- Modify: `web/server/services/search-index.ts`
- Modify: `web/server/services/review-aggregator.ts`
- Modify: `web/server/services/wiki-comments.ts`
- Modify: `web/server/services/source-media-index.ts`
- Modify: `web/server/services/flash-diary.ts`
- Modify: `web/server/services/flash-diary-sync.ts`
- Modify: `web/server/services/clip-pipeline.ts`
- Modify: `web/server/services/xhs-sync.ts`
- Modify: `web/server/services/douyin-sync.ts`
- Modify: `web/server/services/sources-full-store.ts`
- Test: `test/web-runtime-roots.test.ts`
- Test: `test/web-page-cache.test.ts`
- Test: `test/web-tree.test.ts`
- Test: `test/web-tree-raw.test.ts`
- Test: `test/web-review-aggregator.test.ts`
- Test: `test/wiki-comments-routes.test.ts`

- [ ] **Step 1: Write the failing server root tests**

```ts
// test/web-runtime-roots.test.ts
it("reads source-backed wiki pages from the source vault and generated pages from runtime wiki", () => {
  const sourceVault = makeTempDir("source-vault");
  const runtimeRoot = makeTempDir("runtime-root");
  fs.mkdirSync(path.join(sourceVault, "wiki", "crm"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(sourceVault, "wiki", "crm", "赵宇馨.md"), "# 赵宇馨\n", "utf8");
  fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Generated index\n", "utf8");

  const pageHandler = handlePage(makeServerConfig(sourceVault, runtimeRoot));

  const articleResponse = createResponse();
  pageHandler({ query: { path: "wiki/crm/赵宇馨.md" } } as never, articleResponse as never);
  expect(articleResponse.body.path).toBe("wiki/crm/赵宇馨.md");
  expect(articleResponse.body.raw).toContain("# 赵宇馨");

  const indexResponse = createResponse();
  pageHandler({ query: { path: "wiki/index.md" } } as never, indexResponse as never);
  expect(indexResponse.body.raw).toContain("# Generated index");
});
```

```ts
// test/web-tree-raw.test.ts
it("shows raw and inbox from source vault but sources and sources_full from runtime root", () => {
  const tree = buildTree(makeServerConfig(sourceVault, runtimeRoot), "raw");
  expect(findNode(tree, "raw")).toBeTruthy();
  expect(findNode(tree, "inbox")).toBeTruthy();
  expect(findNode(tree, "sources_full")).toBeTruthy();
  expect(findNode(tree, "sources")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- test\web-runtime-roots.test.ts test\web-page-cache.test.ts test\web-tree.test.ts test\web-tree-raw.test.ts test\web-review-aggregator.test.ts test\wiki-comments-routes.test.ts
```

Expected:

- `ServerConfig` still only accepts `wikiRoot`
- page/tree/services still look in a single root

- [ ] **Step 3: Introduce server-side source/runtime path helpers**

```ts
// web/server/runtime-paths.ts
import path from "node:path";
import type { ServerConfig } from "./config.js";

const GENERATED_RUNTIME_PAGES = new Set([
  "wiki/index.md",
  "wiki/MOC.md",
]);

export function sourcePath(cfg: ServerConfig, ...parts: string[]): string {
  return path.join(cfg.sourceVaultRoot, ...parts);
}

export function runtimePath(cfg: ServerConfig, ...parts: string[]): string {
  return path.join(cfg.runtimeRoot, ...parts);
}

export function resolveArticlePath(cfg: ServerConfig, normalizedPath: string): string {
  if (GENERATED_RUNTIME_PAGES.has(normalizedPath)) {
    return runtimePath(cfg, normalizedPath);
  }
  return sourcePath(cfg, normalizedPath);
}
```

```ts
// web/server/config.ts
export interface ServerConfig {
  sourceVaultRoot: string;
  runtimeRoot: string;
  port: number;
  host: string;
  author: string;
  projectRoot: string;
}
```

```ts
// web/server/routes/pages.ts
const full = resolveArticlePath(cfg, rel);
const claimsPath = runtimePath(cfg, ".llmwiki", "claims.json");
const proceduresPath = runtimePath(cfg, ".llmwiki", "procedures.json");
const episodesPath = runtimePath(cfg, ".llmwiki", "episodes.json");
```

```ts
// web/server/routes/tree.ts
const roots = layer === "raw"
  ? [
      { rel: "raw", dir: sourcePath(cfg, "raw") },
      { rel: "inbox", dir: sourcePath(cfg, "inbox") },
      { rel: "sources", dir: runtimePath(cfg, "sources") },
      { rel: "sources_full", dir: runtimePath(cfg, "sources_full") },
    ]
  : [
      { rel: "wiki", dir: sourcePath(cfg, "wiki") },
    ];
```

```ts
// web/server/services/wiki-comments.ts
const STORE_DIR = ".llmwiki";
const storeRoot = runtimePath(cfg, STORE_DIR);
```

- [ ] **Step 4: Run the targeted server tests**

Run:

```bash
rtk npm test -- test\web-runtime-roots.test.ts test\web-page-cache.test.ts test\web-tree.test.ts test\web-tree-raw.test.ts test\web-review-aggregator.test.ts test\wiki-comments-routes.test.ts
```

Expected:

- PASS
- page cache still works
- source pages read from vault `wiki/`
- generated pages and runtime artifacts read from `.runtime\ai-vault`

- [ ] **Step 5: Commit**

```bash
rtk git add web/server/runtime-paths.ts web/server/config.ts web/server/index.ts web/server/routes/pages.ts web/server/routes/tree.ts web/server/services/search-index.ts web/server/services/review-aggregator.ts web/server/services/wiki-comments.ts web/server/services/source-media-index.ts web/server/services/flash-diary.ts web/server/services/flash-diary-sync.ts web/server/services/clip-pipeline.ts web/server/services/xhs-sync.ts web/server/services/douyin-sync.ts web/server/services/sources-full-store.ts test/web-runtime-roots.test.ts test/web-page-cache.test.ts test/web-tree.test.ts test/web-tree-raw.test.ts test/web-review-aggregator.test.ts test/wiki-comments-routes.test.ts
rtk git commit -m "refactor: split server source and runtime roots"
```

## Task 4: Update Desktop Launch And Electron Startup To Pass Both Roots

**Files:**
- Modify: `desktop-webui/src/main.ts`
- Modify: `scripts/start-desktop-webui.ps1`
- Modify: `test/webui-desktop-integration.test.ts`

- [ ] **Step 1: Write the failing desktop integration test**

```ts
// test/webui-desktop-integration.test.ts
expect(desktopMain).toContain("--source-vault");
expect(desktopMain).toContain("--runtime-root");
expect(startScript).toContain("runtime_output_root");
expect(startScript).not.toContain("Join-Path ([string]$config.target_vault) \"wiki\"");
```

- [ ] **Step 2: Run the desktop integration test to verify it fails**

Run:

```bash
rtk npm test -- test\webui-desktop-integration.test.ts
```

Expected:

- FAIL because Electron still passes only `--wiki`
- FAIL because PowerShell still derives wiki root from `target_vault/wiki`

- [ ] **Step 3: Pass explicit source/runtime roots from desktop startup**

```ts
// desktop-webui/src/main.ts
const syncConfig = readSyncCompileConfig(desktopConfig.projectRoot);
const sourceVaultRoot = String(syncConfig.source_vault_root ?? "").trim();
const runtimeRoot = String(syncConfig.runtime_output_root ?? "").trim();

const child = spawn(resolveNodeCommand(), [
  tsxCli,
  "server/index.ts",
  "--source-vault",
  sourceVaultRoot,
  "--runtime-root",
  runtimeRoot,
  "--port",
  String(activeWebPort),
  "--author",
  os.userInfo().username || "me",
], {
  cwd: webRoot,
  windowsHide: true,
  shell: false,
  stdio: "pipe",
});
```

```powershell
# scripts/start-desktop-webui.ps1
function Get-RuntimeWikiRoot {
    $configPath = Join-Path $projectRoot "sync-compile-config.json"
    if (-not (Test-Path $configPath)) { return $null }
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($config.runtime_output_root) {
        return (Join-Path ([string]$config.runtime_output_root) "wiki")
    }
    return $null
}
```

- [ ] **Step 4: Re-run the desktop integration test**

Run:

```bash
rtk npm test -- test\webui-desktop-integration.test.ts
```

Expected:

- PASS
- launcher/startup docs now point at runtime wiki instead of vault wiki

- [ ] **Step 5: Commit**

```bash
rtk git add desktop-webui/src/main.ts scripts/start-desktop-webui.ps1 test/webui-desktop-integration.test.ts
rtk git commit -m "refactor: pass source and runtime roots into desktop webui"
```

## Task 5: Full Verification And Conservative Vault Cleanup

**Files:**
- Modify: `docs/project-log.md`
- Test: `test/web-runtime-roots.test.ts`
- Test: `test/sync-compile-runtime-roots.test.ts`
- Test: `test/sync-compile-sync.test.ts`
- Test: `test/staging-publish.test.ts`
- Test: `test/web-page-cache.test.ts`
- Test: `test/web-tree.test.ts`
- Test: `test/web-tree-raw.test.ts`
- Test: `test/web-review-aggregator.test.ts`
- Test: `test/wiki-comments-routes.test.ts`
- Test: `test/webui-desktop-integration.test.ts`

- [ ] **Step 1: Add a short migration note to the project log**

```md
## [2026-04-25] vault-runtime-separation

- source of truth remains `D:\Desktop\ai的仓库`
- runtime output moved to `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault`
- Peiweipedia now reads source markdown from the vault and generated indexes/state from runtime output
- old vault runtime directories should be treated as stale and removed only after verification
```

- [ ] **Step 2: Run the full targeted verification suite**

Run:

```bash
rtk npm test -- test\sync-config-routes.test.ts test\sync-compile-runtime-roots.test.ts test\sync-compile-sync.test.ts test\staging-publish.test.ts test\web-runtime-roots.test.ts test\web-page-cache.test.ts test\web-tree.test.ts test\web-tree-raw.test.ts test\web-review-aggregator.test.ts test\wiki-comments-routes.test.ts test\webui-desktop-integration.test.ts
```

Expected:

- PASS for all targeted tests

- [ ] **Step 3: Rebuild the web bundle and desktop shell**

Run:

```bash
rtk npm run web:build
rtk npm run desktop:webui:build
rtk npm run desktop:webui:launcher:build
```

Expected:

- web client bundle rebuilt
- desktop webui build succeeds
- `LLM-Wiki-WebUI-Launcher.exe` rebuild succeeds

- [ ] **Step 4: Manual smoke test on the desktop app**

Run:

```bash
rtk proxy powershell -NoProfile -Command "Start-Process 'C:\Users\Administrator\Desktop\LLM-Wiki-WebUI-Launcher.exe'"
```

Expected:

- launcher closes after startup
- Electron window title is `LLM Wiki`
- Peiweipedia opens source-backed pages from `D:\Desktop\ai的仓库\wiki\...`
- generated home/MOC/search/review still function via runtime root

- [ ] **Step 5: Commit**

```bash
rtk git add docs/project-log.md
rtk git commit -m "docs: record vault runtime separation rollout"
```

## Spec Coverage Check

- Source of truth stays in `D:\Desktop\ai的仓库`: covered by Tasks 1-4.
- `wiki/` remains editable source content: covered by Tasks 2-3.
- Runtime artifacts move to `.runtime\ai-vault`: covered by Tasks 1-2.
- Peiweipedia reads source markdown plus runtime indexes: covered by Tasks 3-4.
- Desktop launcher/exe pathing stays correct: covered by Task 4.
- Conservative rollout and verification: covered by Task 5.
