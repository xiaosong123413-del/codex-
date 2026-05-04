// fallow-ignore-file duplicate-export

/**
 * Source-owned automation flow for the compile chain.
 *
 * The workflow spans the sync-compile entry script, the CLI compile command,
 * and the compiler orchestrator so in-app diagrams can point at the real
 * executable units that own compile behavior.
 */

import type { CodeDerivedAutomationSeed } from "./code-derived-automation-types.js";
import {
  flowBranch,
  flowEdge,
  flowNode,
} from "./code-derived-automation-builders.js";
import {
  compileChainSourceInsight,
  syncCompileOverviewSourceInsight,
} from "./compile-source-insights.js";

const SYNC_COMPILE_OVERVIEW_MERMAID = `
flowchart TD
    A["用户点击同步<br/>bindRunPage() startButton.click"] --> B["系统扫描原始资料<br/>raw / intake / 手机同步输入"]
    B --> C["把原始资料同步到本地工作区<br/>Markdown / 附件分开落盘"]
    C --> D["判断哪些文件需要进入本轮编译<br/>readAutoCompileFiles() + selectNextBatch()"]
    D --> E{"有待编译文件吗"}
    E -->|没有| F["写最终结果并发布当前 wiki<br/>writeFinalCompileResult() + publishWikiToCloudflare()"]
    E -->|有| G["按批次执行 llmwiki compile<br/>prepareActiveSources() + runCompile()"]
    G --> H["抽取概念<br/>compile() -> runCompilePipeline()"]
    H --> I["更新 claims / procedures<br/>updateTieredMemory()"]
    I --> J["生成或更新 wiki 页面<br/>generateMergedPage()"]
    J --> K["修复页面间链接并重建导航<br/>resolveLinks() + rebuildNavigation()"]
    K --> L["发布 staging 结果<br/>publishStagingRun() + writeBatchState()"]
    L --> M["发布 Cloudflare wiki 并输出结果<br/>publishWikiToCloudflare() + refreshEntityIndexSnapshot()"]
`.trim();

const COMPILE_CHAIN_MERMAID = `
flowchart TD
    A["启动 sync compile<br/>scripts/sync-compile.mjs main()"] --> B["读取配置和运行根目录<br/>loadSyncCompileConfig() + resolveCompileRootsFromConfig()"]
    B --> C["同步 Cloudflare 手机输入<br/>syncMobileEntriesFromCloudflare()"]
    C --> D["确定 source_folders<br/>loadOrPromptSourceFolders()"]
    D --> E["检查源目录并获取 live lock<br/>inspectSourceFolders() + acquireLiveLock()"]
    E --> F["同步 Markdown 原料镜像<br/>syncMarkdownSources()"]
    F --> G["同步附件副本镜像<br/>syncNonMarkdownAssets()"]
    G --> H["读取待编译文件并生成批次<br/>readAutoCompileFiles() + consumeFlashDiaryAutoCompileAttempt() + selectNextBatch()"]
    H --> I{"batches.length 是否为 0"}
    I -->|是| J["写最终结果并发布当前 wiki<br/>writeFinalCompileResult() + publishWikiToCloudflare() + refreshEntityIndexSnapshot()"]
    I -->|否| K["创建 staging run<br/>clearExistingStagingRuns() + createStagingRun()"]
    K --> L["准备当前批次 sources<br/>prepareActiveSources()"]
    L --> M["执行 llmwiki compile<br/>runCompile() -> compileCommand()"]
    M --> N["检查 sources 并申请编译锁<br/>compile(process.cwd())"]
    N --> O["检测变更并扩充受影响源<br/>detectChanges() + findAffectedSources()"]
    O --> P{"toCompile / deleted 是否为空"}
    P -->|是| Q["只重建导航并记录 compile<br/>rebuildNavigation() + logCompile()"]
    P -->|否| R["提取概念并补 late affected sources<br/>extractForSource() + findLateAffectedSources() + freezeFailedExtractions()"]
    R --> S["更新 tiered memory<br/>updateTieredMemory()"]
    S --> T["生成概念页并解析互链<br/>mergeExtractions() + generateMergedPage() + resolveLinks()"]
    T --> U["重建导航并记录 compile<br/>rebuildNavigation() + logCompile()"]
    Q --> V["当前 batch compile 返回<br/>for (const batch of batches)"]
    U --> V
    V --> W["发布 staging 结果并更新 batch state<br/>publishStagingRun() + writeBatchState() + writeFinalCompileResult()"]
    W --> X["发布 Cloudflare wiki 并刷新实体快照<br/>publishWikiToCloudflare() + refreshEntityIndexSnapshot()"]
`.trim();

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "sync-compile-overview",
    name: "同步编译总览",
    summary: "从用户点击同步、检查 intake、启动 sync run，到批次 compile 和最终发布的端到端总览流程。",
    icon: "rocket",
    sourcePaths: [
      "web/client/src/pages/runs/index.ts",
      "scripts/sync-compile.mjs",
      "src/commands/compile.ts",
      "src/compiler/index.ts",
    ],
    mermaid: SYNC_COMPILE_OVERVIEW_MERMAID,
    sourceInsight: syncCompileOverviewSourceInsight,
    flow: {
      nodes: [
        flowNode("overview-trigger", "trigger", "点击同步按钮", "运行页进入同步前置检查。", "bindRunPage() startButton.click"),
        flowNode("overview-plan", "action", "confirmSyncPlan()", "先统一决定是 none、inbox 还是 confirm。", "confirmSyncPlan()"),
        flowNode("overview-scan", "action", "GET /api/intake/scan", "读取 raw / inbox 的待处理情况。", "loadIntakeScan()"),
        flowNode("overview-branch-items", "branch", "scan.items.length 是否为 0", "没有新原料时直接结束。", "if (scan.items.length === 0)"),
        flowNode("overview-none", "action", "提示未检测到新源料并结束", "不启动后端同步编译。", "return \"none\""),
        flowNode("overview-branch-plan", "branch", "scan.plan.length 是否为 0", "无批量计划时要求先处理 inbox。", "if (scan.plan.length === 0)"),
        flowNode("overview-inbox", "action", "提示先去审查页处理 inbox", "等待用户先做人审或批量录入。", "return \"inbox\""),
        flowNode("overview-dialog", "action", "showIntakePlanDialog()", "把同步编译方案展示给用户确认。", "showIntakePlanDialog(root, scan.plan)"),
        flowNode("overview-branch-confirm", "branch", "用户是否确认同步编译方案", "取消则结束，确认则启动 sync run。", "showIntakePlanDialog() result"),
        flowNode("overview-cancel", "action", "关闭弹窗并结束", "不启动 sync run。", "return \"none\""),
        flowNode("overview-run", "action", "POST /api/runs/sync", "创建 sync run 并进入 sync-compile 脚本。", "startRun(\"sync\")"),
        flowNode("overview-sync-files", "action", "同步原始资料到本地工作区", "同步 Markdown 原料和附件副本镜像。", "syncMarkdownSources() + syncNonMarkdownAssets()"),
        flowNode("overview-select-batches", "action", "判断哪些文件进入本轮编译", "结合 batch state 和自动编译规则生成批次。", "readAutoCompileFiles() + selectNextBatch()"),
        flowNode("overview-branch-batches", "branch", "batches.length 是否为 0", "没有待编译文件时直接发布当前结果。", "if (batches.length === 0)"),
        flowNode("overview-no-batches", "action", "写最终结果并发布当前 wiki", "零批次时直接写结果、发布只读 wiki、刷新实体快照。", "writeFinalCompileResult() + publishWikiToCloudflare()"),
        flowNode("overview-batch-compile", "action", "按批次执行 llmwiki compile", "每个 batch 都先准备 staging sources，再执行 compile。", "prepareActiveSources() + runCompile()"),
        flowNode("overview-extract", "action", "抽取概念并检测真实变化", "进入 compile orchestrator，做变更检测和概念提取。", "compile() -> runCompilePipeline()"),
        flowNode("overview-memory", "action", "更新 claims / procedures", "把 tiered memory 写回到 .llmwiki 和对应页面。", "updateTieredMemory()"),
        flowNode("overview-pages", "action", "生成或更新 wiki 页面并修复互链", "生成概念页、解析互链并重建导航页。", "generateMergedPage() + resolveLinks() + rebuildNavigation()"),
        flowNode("overview-publish", "action", "发布 staging 结果", "全部批次成功后发布 staging、更新 batch state 和 final result。", "publishStagingRun() + writeBatchState() + writeFinalCompileResult()"),
        flowNode("overview-cloudflare", "action", "发布 Cloudflare wiki 并输出结果", "发布只读 wiki、刷新实体索引并写最终摘要。", "publishWikiToCloudflare() + refreshEntityIndexSnapshot()"),
      ],
      edges: [
        flowEdge("overview-trigger", "overview-plan"),
        flowEdge("overview-plan", "overview-scan"),
        flowEdge("overview-scan", "overview-branch-items"),
        flowEdge("overview-branch-items", "overview-none"),
        flowEdge("overview-branch-items", "overview-branch-plan"),
        flowEdge("overview-branch-plan", "overview-inbox"),
        flowEdge("overview-branch-plan", "overview-dialog"),
        flowEdge("overview-dialog", "overview-branch-confirm"),
        flowEdge("overview-branch-confirm", "overview-cancel"),
        flowEdge("overview-branch-confirm", "overview-run"),
        flowEdge("overview-run", "overview-sync-files"),
        flowEdge("overview-sync-files", "overview-select-batches"),
        flowEdge("overview-select-batches", "overview-branch-batches"),
        flowEdge("overview-branch-batches", "overview-no-batches"),
        flowEdge("overview-branch-batches", "overview-batch-compile"),
        flowEdge("overview-batch-compile", "overview-extract"),
        flowEdge("overview-extract", "overview-memory"),
        flowEdge("overview-memory", "overview-pages"),
        flowEdge("overview-pages", "overview-publish"),
        flowEdge("overview-publish", "overview-cloudflare"),
      ],
      branches: [
        flowBranch("overview-items", "是否存在待处理项", "overview-branch-items", ["overview-none", "overview-branch-plan"]),
        flowBranch("overview-plan-branch", "是否需要先去 inbox", "overview-branch-plan", ["overview-inbox", "overview-dialog"]),
        flowBranch("overview-confirm", "用户确认方案", "overview-branch-confirm", ["overview-cancel", "overview-run"]),
        flowBranch("overview-batches", "是否存在待编译批次", "overview-branch-batches", ["overview-no-batches", "overview-batch-compile"]),
      ],
    },
  },
  {
    slug: "compile-chain",
    name: "编译链路",
    summary: "从 sync-compile 同步原料、生成批次，到 llmwiki compile 更新页面、tiered memory 和发布结果的真实链路。",
    icon: "cpu",
    sourcePaths: [
      "scripts/sync-compile.mjs",
      "src/commands/compile.ts",
      "src/compiler/index.ts",
    ],
    mermaid: COMPILE_CHAIN_MERMAID,
    sourceInsight: compileChainSourceInsight,
    flow: {
      nodes: [
        flowNode("compile-trigger", "trigger", "启动 sync compile", "运行同步编译脚本并进入 compile 主链路。", "scripts/sync-compile.mjs main()"),
        flowNode("compile-config", "action", "读取配置和运行根目录", "先取 sync-compile 配置并解析 source/runtime/wiki 根目录。", "loadSyncCompileConfig() + resolveCompileRootsFromConfig()"),
        flowNode("compile-mobile-sync", "action", "同步 Cloudflare 手机输入", "先把远端手机录入拉回本地 vault。", "syncMobileEntriesFromCloudflare()"),
        flowNode("compile-source-folders", "action", "确定 source_folders", "合并 intake 来源目录，必要时提示用户选择源目录。", "loadOrPromptSourceFolders()"),
        flowNode("compile-inventory", "action", "检查源目录并获取 live lock", "确认库存非空并锁住 runtime 编译会话。", "inspectSourceFolders() + acquireLiveLock()"),
        flowNode("compile-sync-markdown", "action", "同步 Markdown 原料镜像", "把 source_folders 里的 Markdown 同步到 runtime 镜像仓。", "syncMarkdownSources()"),
        flowNode("compile-sync-assets", "action", "同步附件副本镜像", "把图片、PDF、音视频等非 Markdown 附件同步到镜像仓。", "syncNonMarkdownAssets()"),
        flowNode("compile-plan-files", "action", "读取待编译文件并生成批次", "结合 batch state、flash diary 自动编译状态和 batch 规则挑出文件。", "readAutoCompileFiles() + consumeFlashDiaryAutoCompileAttempt() + selectNextBatch()"),
        flowNode("compile-branch-batches", "branch", "batches.length 是否为 0", "没有待编译批次时直接写最终结果并发布当前 wiki。", "if (batches.length === 0)"),
        flowNode("compile-no-batches", "action", "写最终结果并发布当前 wiki", "零批次时直接写 compile 结果、发布 Cloudflare 并刷新实体快照。", "writeFinalCompileResult() + publishWikiToCloudflare() + refreshEntityIndexSnapshot()"),
        flowNode("compile-staging", "action", "创建 staging run", "有批次时清理旧 staging 并创建本轮 staging 工作区。", "clearExistingStagingRuns() + createStagingRun()"),
        flowNode("compile-prepare-batch", "action", "准备当前批次 sources", "对每个 batch 把当前文件投影到 staging/sources。", "prepareActiveSources()"),
        flowNode("compile-command", "action", "执行 llmwiki compile", "在 staging 根目录启动 CLI compile 命令。", "runCompile() -> compileCommand()"),
        flowNode("compile-command-check", "action", "检查 sources 并申请编译锁", "CLI 先确认 sources 存在，再进入编译 orchestrator。", "src/commands/compile.ts -> compile(process.cwd())"),
        flowNode("compile-detect", "action", "检测变更并扩充受影响源", "读取 state、diff sources，并把共享概念受影响源补进来。", "runCompilePipeline() -> detectChanges() + findAffectedSources()"),
        flowNode("compile-branch-changes", "branch", "toCompile / deleted 是否为空", "无变化时只重建导航；有变化时继续提取和生成页面。", "if (toCompile.length === 0 && deleted.length === 0)"),
        flowNode("compile-no-changes", "action", "只重建导航并记录 compile", "无增删改时仅更新 index/MOC 和 maintenance log。", "rebuildNavigation() + logCompile()"),
        flowNode("compile-extract", "action", "提取概念并补 late affected sources", "逐个 source 抽取概念，并把新共享概念导致的 late affected source 再补进来。", "extractForSource() + findLateAffectedSources() + freezeFailedExtractions()"),
        flowNode("compile-memory", "action", "更新 tiered memory", "合并 claims / procedures 并写出对应页面。", "updateTieredMemory()"),
        flowNode("compile-pages", "action", "生成概念页并解析互链", "按 merged concept 生成页面，随后 resolve interlinks。", "mergeExtractions() + generateMergedPage() + resolveLinks()"),
        flowNode("compile-finish-batch", "action", "重建导航并记录 compile", "批次编译完成后重建导航、写 maintenance log 并返回外层循环。", "rebuildNavigation() + logCompile()"),
        flowNode("compile-batch-complete", "merge", "当前 batch compile 返回", "每个 batch 的 compile 返回后继续下一个 batch，全部完成后再发布 staging。", "for (const batch of batches)"),
        flowNode("compile-publish", "action", "发布 staging 结果并更新 batch state", "把 staging 发布到 runtime wiki，并累计 completed_files / final result。", "publishStagingRun() + writeBatchState() + writeFinalCompileResult()"),
        flowNode("compile-cloudflare", "action", "发布 Cloudflare wiki 并刷新实体快照", "写出最终 publishedAt，发布只读 wiki，刷新实体索引并输出摘要。", "publishWikiToCloudflare() + refreshEntityIndexSnapshot()"),
      ],
      edges: [
        flowEdge("compile-trigger", "compile-config"),
        flowEdge("compile-config", "compile-mobile-sync"),
        flowEdge("compile-mobile-sync", "compile-source-folders"),
        flowEdge("compile-source-folders", "compile-inventory"),
        flowEdge("compile-inventory", "compile-sync-markdown"),
        flowEdge("compile-sync-markdown", "compile-sync-assets"),
        flowEdge("compile-sync-assets", "compile-plan-files"),
        flowEdge("compile-plan-files", "compile-branch-batches"),
        flowEdge("compile-branch-batches", "compile-no-batches"),
        flowEdge("compile-branch-batches", "compile-staging"),
        flowEdge("compile-staging", "compile-prepare-batch"),
        flowEdge("compile-prepare-batch", "compile-command"),
        flowEdge("compile-command", "compile-command-check"),
        flowEdge("compile-command-check", "compile-detect"),
        flowEdge("compile-detect", "compile-branch-changes"),
        flowEdge("compile-branch-changes", "compile-no-changes"),
        flowEdge("compile-branch-changes", "compile-extract"),
        flowEdge("compile-no-changes", "compile-batch-complete"),
        flowEdge("compile-extract", "compile-memory"),
        flowEdge("compile-memory", "compile-pages"),
        flowEdge("compile-pages", "compile-finish-batch"),
        flowEdge("compile-finish-batch", "compile-batch-complete"),
        flowEdge("compile-batch-complete", "compile-publish"),
        flowEdge("compile-publish", "compile-cloudflare"),
      ],
      branches: [
        flowBranch("compile-has-batches", "是否还有待编译批次", "compile-branch-batches", ["compile-no-batches", "compile-staging"]),
        flowBranch(
          "compile-has-changes",
          "当前 batch 是否检测到变化",
          "compile-branch-changes",
          ["compile-no-changes", "compile-extract", "compile-memory", "compile-pages", "compile-finish-batch"],
          "compile-batch-complete",
        ),
      ],
    },
  },
];
