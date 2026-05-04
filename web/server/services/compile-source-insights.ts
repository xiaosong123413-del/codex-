/**
 * Unified source-insight graphs for compile-owned code flows.
 *
 * The automation workspace now renders code-derived entries as one business
 * lineage graph instead of splitting flow and outcome. This file keeps the
 * cross-page compile insights small and reusable so the seed module can stay
 * under the project size limits.
 */

import type {
  CodeDerivedSourceInsight,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "./code-derived-automation-types.js";

const OVERVIEW_PATHS = [
  "web/client/src/pages/runs/index.ts",
  "scripts/sync-compile.mjs",
  "src/commands/compile.ts",
  "src/compiler/index.ts",
] as const;

const CHAIN_PATHS = [
  "scripts/sync-compile.mjs",
  "src/commands/compile.ts",
  "src/compiler/index.ts",
] as const;

const SYNC_COMPILE_OVERVIEW_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    syncTrigger{{"触发：用户点击同步"}} --> intakeInput["输入：raw / intake / 手机同步输入"]
    intakeInput --> hasItems{"判断：当前是否存在待处理原料"}
    hasItems -->|没有| noItems(["结果：提示未检测到新源料"])
    hasItems -->|有| batchPlan["输入：新源料扫描方案"]
    batchPlan --> confirmPlan("处理：确认本轮同步编译方案")
    confirmPlan --> syncRun(["结果：sync run 已启动"])
    syncRun --> compileCandidates["输入：待编译批次候选"]
    compileCandidates --> hasBatches{"判断：本轮是否存在待编译批次"}
    hasBatches -->|没有| publishCurrent(["结果：当前 wiki 已发布"])
    hasBatches -->|有| batchCompile("处理：按批次执行同步编译")
    batchCompile --> stagedWiki(["结果：staging / wiki 页面更新"])
    stagedWiki --> publishCurrent
`.trim();

const COMPILE_CHAIN_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    compileTrigger{{"触发：sync compile run 启动"}} --> compileConfig["输入：配置 / source_folders / 运行目录"]
    compileConfig --> syncMirror("处理：同步 Markdown 与附件镜像")
    syncMirror --> batchInput["输入：待编译文件与 batch state"]
    batchInput --> batchDecision{"判断：本轮是否还有待编译批次"}
    batchDecision -->|没有| publishLive(["结果：当前 wiki 发布结果"])
    batchDecision -->|有| stagingProcess("处理：创建 staging 并准备当前 batch")
    stagingProcess --> changeDecision{"判断：当前 batch 是否检测到真实变化"}
    changeDecision -->|没有| navOnly(["结果：仅重建导航并记录 compile"])
    changeDecision -->|有| compileInput["输入：active sources / affected sources"]
    compileInput --> compileProcess("处理：提取概念、更新记忆、生成页面")
    compileProcess --> stagingResult(["结果：staging wiki / batch state"])
    navOnly --> stagingResult
    stagingResult --> publishLive
`.trim();

const SYNC_COMPILE_OVERVIEW_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "syncTrigger", kind: "trigger", label: "触发：用户点击同步" },
  { id: "intakeInput", kind: "input", label: "输入：raw / intake / 手机同步输入" },
  { id: "hasItems", kind: "decision", label: "判断：当前是否存在待处理原料" },
  { id: "noItems", kind: "result", label: "结果：提示未检测到新源料" },
  { id: "batchPlan", kind: "input", label: "输入：新源料扫描方案" },
  { id: "confirmPlan", kind: "process", label: "处理：确认本轮同步编译方案" },
  { id: "syncRun", kind: "result", label: "结果：sync run 已启动" },
  { id: "compileCandidates", kind: "input", label: "输入：待编译批次候选" },
  { id: "hasBatches", kind: "decision", label: "判断：本轮是否存在待编译批次" },
  { id: "publishCurrent", kind: "result", label: "结果：当前 wiki 已发布" },
  { id: "batchCompile", kind: "process", label: "处理：按批次执行同步编译" },
  { id: "stagedWiki", kind: "result", label: "结果：staging / wiki 页面更新" },
];

const SYNC_COMPILE_OVERVIEW_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "syncTrigger", target: "intakeInput" },
  { source: "intakeInput", target: "hasItems" },
  { source: "hasItems", target: "noItems", label: "没有" },
  { source: "hasItems", target: "batchPlan", label: "有" },
  { source: "batchPlan", target: "confirmPlan" },
  { source: "confirmPlan", target: "syncRun" },
  { source: "syncRun", target: "compileCandidates" },
  { source: "compileCandidates", target: "hasBatches" },
  { source: "hasBatches", target: "publishCurrent", label: "没有" },
  { source: "hasBatches", target: "batchCompile", label: "有" },
  { source: "batchCompile", target: "stagedWiki" },
  { source: "stagedWiki", target: "publishCurrent" },
];

const COMPILE_CHAIN_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "compileTrigger", kind: "trigger", label: "触发：sync compile run 启动" },
  { id: "compileConfig", kind: "input", label: "输入：配置 / source_folders / 运行目录" },
  { id: "syncMirror", kind: "process", label: "处理：同步 Markdown 与附件镜像" },
  { id: "batchInput", kind: "input", label: "输入：待编译文件与 batch state" },
  { id: "batchDecision", kind: "decision", label: "判断：本轮是否还有待编译批次" },
  { id: "publishLive", kind: "result", label: "结果：当前 wiki 发布结果" },
  { id: "stagingProcess", kind: "process", label: "处理：创建 staging 并准备当前 batch" },
  { id: "changeDecision", kind: "decision", label: "判断：当前 batch 是否检测到真实变化" },
  { id: "navOnly", kind: "result", label: "结果：仅重建导航并记录 compile" },
  { id: "compileInput", kind: "input", label: "输入：active sources / affected sources" },
  { id: "compileProcess", kind: "process", label: "处理：提取概念、更新记忆、生成页面" },
  { id: "stagingResult", kind: "result", label: "结果：staging wiki / batch state" },
];

const COMPILE_CHAIN_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "compileTrigger", target: "compileConfig" },
  { source: "compileConfig", target: "syncMirror" },
  { source: "syncMirror", target: "batchInput" },
  { source: "batchInput", target: "batchDecision" },
  { source: "batchDecision", target: "publishLive", label: "没有" },
  { source: "batchDecision", target: "stagingProcess", label: "有" },
  { source: "stagingProcess", target: "changeDecision" },
  { source: "changeDecision", target: "navOnly", label: "没有" },
  { source: "changeDecision", target: "compileInput", label: "有" },
  { source: "compileInput", target: "compileProcess" },
  { source: "compileProcess", target: "stagingResult" },
  { source: "navOnly", target: "stagingResult" },
  { source: "stagingResult", target: "publishLive" },
];

const SYNC_COMPILE_OVERVIEW_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  syncTrigger: createInsight("用户在运行页点击同步按钮。", [], ["输入：raw / intake / 手机同步输入"], ["运行页同步按钮"], OVERVIEW_PATHS),
  intakeInput: createInsight("这里汇总桌面 raw、inbox 和手机端回拉输入。", ["触发：用户点击同步"], ["判断：当前是否存在待处理原料"], [], OVERVIEW_PATHS),
  hasItems: createInsight("同步入口先判断有没有值得启动本轮同步编译的新原料。", ["输入：raw / intake / 手机同步输入"], ["结果：提示未检测到新源料", "输入：新源料扫描方案"], [], OVERVIEW_PATHS),
  noItems: createInsight("没有新原料时，运行页只提示并终止本轮同步。", ["判断：当前是否存在待处理原料"], [], ["运行页提示"], OVERVIEW_PATHS),
  batchPlan: createInsight("扫描结果整理成用户可确认的同步编译方案。", ["判断：当前是否存在待处理原料"], ["处理：确认本轮同步编译方案"], ["运行页新源料检测弹窗"], OVERVIEW_PATHS),
  confirmPlan: createInsight("用户确认后，真正创建本轮 sync run。", ["输入：新源料扫描方案"], ["结果：sync run 已启动"], ["运行页弹窗确认"], OVERVIEW_PATHS),
  syncRun: createInsight("后台 sync run 已经建立，后续会继续跑同步与 compile。", ["处理：确认本轮同步编译方案"], ["输入：待编译批次候选"], ["运行页运行日志"], OVERVIEW_PATHS),
  compileCandidates: createInsight("同步脚本读 batch state 和自动编译规则，得到本轮候选。", ["结果：sync run 已启动"], ["判断：本轮是否存在待编译批次"], [], OVERVIEW_PATHS),
  hasBatches: createInsight("如果没有候选批次，就直接发布当前 wiki；有的话才进入 compile。", ["输入：待编译批次候选"], ["结果：当前 wiki 已发布", "处理：按批次执行同步编译"], [], OVERVIEW_PATHS),
  publishCurrent: createInsight("最终对外可见的发布结果，包括 Cloudflare wiki 与最终摘要。", ["判断：本轮是否存在待编译批次", "结果：staging / wiki 页面更新"], [], ["运行页结果摘要 / 远端只读 wiki"], OVERVIEW_PATHS),
  batchCompile: createInsight("按 batch 进入 compile 内核，生成 staging 结果。", ["判断：本轮是否存在待编译批次"], ["结果：staging / wiki 页面更新"], [], OVERVIEW_PATHS),
  stagedWiki: createInsight("compile 已经把 staging wiki、batch state 和结果摘要写出来。", ["处理：按批次执行同步编译"], ["结果：当前 wiki 已发布"], ["staging wiki / 运行页结果"], OVERVIEW_PATHS),
};

const COMPILE_CHAIN_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  compileTrigger: createInsight("sync-compile 脚本真正启动本轮 compile 内核。", [], ["输入：配置 / source_folders / 运行目录"], [], CHAIN_PATHS),
  compileConfig: createInsight("先把运行根目录、source_folders、手机同步与 runtime 配置整理好。", ["触发：sync compile run 启动"], ["处理：同步 Markdown 与附件镜像"], [], CHAIN_PATHS),
  syncMirror: createInsight("把 Markdown 和附件同步到 compile 使用的本地镜像仓。", ["输入：配置 / source_folders / 运行目录"], ["输入：待编译文件与 batch state"], [], CHAIN_PATHS),
  batchInput: createInsight("这里汇总 readAutoCompileFiles、batch state 和 flash diary 自动编译状态。", ["处理：同步 Markdown 与附件镜像"], ["判断：本轮是否还有待编译批次"], [], CHAIN_PATHS),
  batchDecision: createInsight("没有待编译批次时直接发布；有批次时才创建 staging。", ["输入：待编译文件与 batch state"], ["结果：当前 wiki 发布结果", "处理：创建 staging 并准备当前 batch"], [], CHAIN_PATHS),
  publishLive: createInsight("这是 compile 链最终对外可见的 live wiki 发布结果。", ["判断：本轮是否还有待编译批次", "结果：staging wiki / batch state"], [], ["live wiki / Cloudflare 发布结果"], CHAIN_PATHS),
  stagingProcess: createInsight("为当前 batch 建 staging run，并把 active sources 投影进去。", ["判断：本轮是否还有待编译批次"], ["判断：当前 batch 是否检测到真实变化"], ["staging run"], CHAIN_PATHS),
  changeDecision: createInsight("如果 batch 没有真实变化，就不会再跑抽取和生成页面。", ["处理：创建 staging 并准备当前 batch"], ["结果：仅重建导航并记录 compile", "输入：active sources / affected sources"], [], CHAIN_PATHS),
  navOnly: createInsight("无变化批次只会重建导航并写 compile 记录。", ["判断：当前 batch 是否检测到真实变化"], ["结果：staging wiki / batch state"], ["compile maintenance log"], CHAIN_PATHS),
  compileInput: createInsight("真正进入 compile pipeline 的是 active sources 和受影响源集合。", ["判断：当前 batch 是否检测到真实变化"], ["处理：提取概念、更新记忆、生成页面"], [], CHAIN_PATHS),
  compileProcess: createInsight("在这里完成概念提取、tiered memory 更新、页面合并和互链修复。", ["输入：active sources / affected sources"], ["结果：staging wiki / batch state"], ["staging wiki"], CHAIN_PATHS),
  stagingResult: createInsight("每个 batch 的 staging 结果、batch state 和 final result 在这里汇总。", ["处理：提取概念、更新记忆、生成页面", "结果：仅重建导航并记录 compile"], ["结果：当前 wiki 发布结果"], ["staging wiki / final result"], CHAIN_PATHS),
};

function createInsight(
  summary: string,
  upstream: string[],
  downstream: string[],
  shownIn: string[],
  sourcePaths: readonly string[],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn,
    sourcePaths: [...sourcePaths],
    missingLinks: [],
  };
}

export const syncCompileOverviewSourceInsight: CodeDerivedSourceInsight = {
  scope: "cross-page",
  page: {
    id: "sync-compile-overview",
    title: "同步编译总览",
    routeLabel: "跨页总览",
  },
  graph: {
    mermaid: SYNC_COMPILE_OVERVIEW_SOURCE_INSIGHT_MERMAID,
    nodes: SYNC_COMPILE_OVERVIEW_NODES,
    edges: SYNC_COMPILE_OVERVIEW_EDGES,
  },
  nodeInsights: SYNC_COMPILE_OVERVIEW_NODE_INSIGHTS,
};

export const compileChainSourceInsight: CodeDerivedSourceInsight = {
  scope: "cross-page",
  page: {
    id: "compile-chain",
    title: "编译链路",
    routeLabel: "跨页总览",
  },
  graph: {
    mermaid: COMPILE_CHAIN_SOURCE_INSIGHT_MERMAID,
    nodes: COMPILE_CHAIN_NODES,
    edges: COMPILE_CHAIN_EDGES,
  },
  nodeInsights: COMPILE_CHAIN_NODE_INSIGHTS,
};
