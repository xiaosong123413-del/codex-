/**
 * Source-owned automation flow for the flash-diary page.
 *
 * This seed describes the page-level real content lineage: diary content lands
 * in the day file, then fans out into Memory, recent-status generation,
 * personal-timeline refresh state, the 23:30 image path, and compile
 * candidate selection. The unified graph is intentionally business-facing and
 * keeps non-real links out of the main diagram.
 */

// fallow-ignore-file duplicate-export
// fallow-ignore-next-line unresolved-import
import type { CodeDerivedAutomationSeed, CodeDerivedSourceInsightGraphEdge, CodeDerivedSourceInsightGraphNode, CodeDerivedSourceInsightNodeInsight } from "../../../server/services/code-derived-automation-types.js";
import { FLASH_DIARY_PAGE_HOTSPOT_VIEW } from "./automation-hotspot-view.js";

const FLASH_DIARY_PAGE_MERMAID = `
flowchart TD
    saveTrigger{{"触发：用户保存闪念日记"}} -->|写入| diaryFile(["结果：当日日记文件<br/>raw/闪念日记/YYYY-MM-DD.md"])

    openMemory{{"触发：用户打开 / 刷新 Memory"}} -->|先显示当前版本| memoryFile(["结果：Memory 文件<br/>wiki/journal-memory.md"])
    systemMemory{{"触发：系统启动 / 每日午夜到点"}} --> memoryDecision{"判断：这次是否需要刷新 Memory"}
    openMemory --> memoryDecision
    memoryFile -->|渲染| memoryView(["结果：Memory 页面显示"])
    diaryWindow["输入：最近几天的闪念日记"] --> memoryProcess("处理：汇总近日日记，生成新的 Memory")
    diaryFile -->|作为近日日记输入| diaryWindow
    memoryDecision -->|需要刷新| memoryProcess
    memoryDecision -->|不需要刷新| memoryFile
    memoryProcess -->|写回| memoryFile

    refreshStatus{{"触发：用户刷新近日状态"}} --> recentContext["输入：最新日记上下文<br/>+ 工作日志<br/>+ 当前规划输入<br/>+ 任务池"]
    diaryFile -->|提供最新日记上下文| recentContext
    recentContext --> recentStatusProcess("处理：生成近日状态摘要")
    recentStatusProcess -->|写回| recentStatusFile(["结果：statusSummary"])
    recentStatusFile -->|渲染| recentStatusView(["结果：工作台“近日状态”"])

    refreshTimeline{{"触发：用户执行个人时间线来源刷新"}} --> timelineSource["输入：闪念日记目录"]
    diaryFile -->|属于闪念日记来源目录| timelineSource
    timelineSource --> timelineProcess("处理：扫描来源并计算增量")
    timelineProcess -->|写入| timelineState(["结果：personal-timeline-source-state.json"])
    timelineState --> timelineIncrements(["结果：personal-timeline-source-increments.json"])
    timelineIncrements -->|显示结果| timelineView(["结果：时间线来源刷新结果"])

    imageSchedule{{"触发：每日 23:30"}} --> imageInput["输入：当日日记正文"]
    diaryFile -->|提供当日日记内容| imageInput
    imageInput --> imageProcess("处理：生成日记配图")
    imageProcess -->|写入| imageAsset(["结果：raw/闪念日记/assets/YYYY-MM-DD/daily-summary.png"])
    imageAsset --> imageBackfill("处理：回写图片引用到当日日记")
    imageBackfill --> imageView(["结果：日记内图片呈现"])

    compileTrigger{{"触发：同步窗口命中"}} --> compileDecision{"判断：是否满足闪念日记 auto compile 条件"}
    diaryFile -->|作为候选输入| compileDecision
    compileDecision -->|满足| compileResult(["结果：同步/编译候选"])
`.trim();

const FLASH_DIARY_PAGE_GRAPH_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "saveTrigger", kind: "trigger", label: "触发：用户保存闪念日记" },
  { id: "diaryFile", kind: "result", label: "结果：当日日记文件 raw/闪念日记/YYYY-MM-DD.md" },
  { id: "openMemory", kind: "trigger", label: "触发：用户打开 / 刷新 Memory" },
  { id: "systemMemory", kind: "trigger", label: "触发：系统启动 / 每日午夜到点" },
  { id: "memoryDecision", kind: "decision", label: "判断：这次是否需要刷新 Memory" },
  { id: "diaryWindow", kind: "input", label: "输入：最近几天的闪念日记" },
  { id: "memoryProcess", kind: "process", label: "处理：汇总近日日记，生成新的 Memory" },
  { id: "memoryFile", kind: "result", label: "结果：Memory 文件 wiki/journal-memory.md" },
  { id: "memoryView", kind: "result", label: "结果：Memory 页面显示" },
  { id: "refreshStatus", kind: "trigger", label: "触发：用户刷新近日状态" },
  { id: "recentContext", kind: "input", label: "输入：最新日记上下文 + 工作日志 + 当前规划输入 + 任务池" },
  { id: "recentStatusProcess", kind: "process", label: "处理：生成近日状态摘要" },
  { id: "recentStatusFile", kind: "result", label: "结果：statusSummary" },
  { id: "recentStatusView", kind: "result", label: "结果：工作台“近日状态”" },
  { id: "refreshTimeline", kind: "trigger", label: "触发：用户执行个人时间线来源刷新" },
  { id: "timelineSource", kind: "input", label: "输入：闪念日记目录" },
  { id: "timelineProcess", kind: "process", label: "处理：扫描来源并计算增量" },
  { id: "timelineState", kind: "result", label: "结果：personal-timeline-source-state.json" },
  { id: "timelineIncrements", kind: "result", label: "结果：personal-timeline-source-increments.json" },
  { id: "timelineView", kind: "result", label: "结果：时间线来源刷新结果" },
  { id: "imageSchedule", kind: "trigger", label: "触发：每日 23:30" },
  { id: "imageInput", kind: "input", label: "输入：当日日记正文" },
  { id: "imageProcess", kind: "process", label: "处理：生成日记配图" },
  { id: "imageAsset", kind: "result", label: "结果：daily-summary.png" },
  { id: "imageBackfill", kind: "process", label: "处理：回写图片引用到当日日记" },
  { id: "imageView", kind: "result", label: "结果：日记内图片呈现" },
  { id: "compileTrigger", kind: "trigger", label: "触发：同步窗口命中" },
  { id: "compileDecision", kind: "decision", label: "判断：是否满足闪念日记 auto compile 条件" },
  { id: "compileResult", kind: "result", label: "结果：同步/编译候选" },
  { id: "questionsView", kind: "result", label: "结果：右侧显示十二个问题" },
  { id: "openDiaryCard", kind: "trigger", label: "按钮：点击某篇日记" },
  { id: "editorView", kind: "result", label: "结果：可视化混排编辑区" },
];

const FLASH_DIARY_PAGE_GRAPH_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "saveTrigger", target: "diaryFile", label: "写入" },
  { source: "openMemory", target: "memoryFile", label: "先显示当前版本" },
  { source: "systemMemory", target: "memoryDecision" },
  { source: "openMemory", target: "memoryDecision" },
  { source: "diaryFile", target: "diaryWindow", label: "作为近日日记输入" },
  { source: "diaryWindow", target: "memoryProcess", label: "提供近日日记内容" },
  { source: "memoryDecision", target: "memoryProcess", label: "需要刷新" },
  { source: "memoryDecision", target: "memoryFile", label: "不需要刷新" },
  { source: "memoryProcess", target: "memoryFile", label: "写回" },
  { source: "memoryFile", target: "memoryView", label: "渲染" },
  { source: "refreshStatus", target: "recentContext" },
  { source: "diaryFile", target: "recentContext", label: "提供最新日记上下文" },
  { source: "recentContext", target: "recentStatusProcess" },
  { source: "recentStatusProcess", target: "recentStatusFile", label: "写回" },
  { source: "recentStatusFile", target: "recentStatusView", label: "渲染" },
  { source: "refreshTimeline", target: "timelineSource" },
  { source: "diaryFile", target: "timelineSource", label: "属于来源目录" },
  { source: "timelineSource", target: "timelineProcess" },
  { source: "timelineProcess", target: "timelineState", label: "写入" },
  { source: "timelineState", target: "timelineIncrements" },
  { source: "timelineIncrements", target: "timelineView", label: "显示结果" },
  { source: "imageSchedule", target: "imageInput" },
  { source: "diaryFile", target: "imageInput", label: "提供当日日记内容" },
  { source: "imageInput", target: "imageProcess" },
  { source: "imageProcess", target: "imageAsset", label: "写入" },
  { source: "imageAsset", target: "imageBackfill" },
  { source: "imageBackfill", target: "imageView" },
  { source: "compileTrigger", target: "compileDecision" },
  { source: "diaryFile", target: "compileDecision", label: "作为候选输入" },
  { source: "compileDecision", target: "compileResult", label: "满足" },
];

const FLASH_DIARY_PAGE_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  saveTrigger: createInsight("用户在闪念日记页保存当前编辑内容。", [], ["结果：当日日记文件"], [], ["web/client/src/pages/flash-diary/index.ts", "web/server/routes/flash-diary.ts", "web/server/services/flash-diary.ts"]),
  diaryFile: createInsight(
    "这是真正承载当天日记正文的落盘文件，也是后续多条分支的共同上游。",
    ["触发：用户保存闪念日记"],
    ["输入：最近几天的闪念日记", "输入：最新日记上下文 + 工作日志 + 当前规划输入 + 任务池", "输入：闪念日记目录", "输入：当日日记正文", "判断：是否满足闪念日记 auto compile 条件"],
    ["闪念日记页编辑区", "近日日记汇总链路", "同步/编译候选判断"],
    ["web/server/services/flash-diary.ts"],
  ),
  openMemory: createInsight("用户进入 Memory 页面或主动刷新 Memory。", [], ["结果：Memory 文件 wiki/journal-memory.md", "判断：这次是否需要刷新 Memory"], ["闪念日记页 Memory 视图"], ["web/client/src/pages/flash-diary/index.ts", "web/server/routes/flash-diary.ts"]),
  systemMemory: createInsight("服务端启动后补跑一次，再在每个本地午夜重新检查是否需要刷新 Memory。", [], ["判断：这次是否需要刷新 Memory"], [], ["web/server/services/flash-diary-memory-scheduler.ts"]),
  memoryDecision: createInsight("流程已经开始后，判断这次是否真的需要刷新 Memory。", ["触发：用户打开 / 刷新 Memory", "触发：系统启动 / 每日午夜到点"], ["处理：汇总近日日记，生成新的 Memory", "结果：Memory 文件 wiki/journal-memory.md"], [], ["web/server/routes/flash-diary.ts", "web/server/services/flash-diary-memory.ts"]),
  diaryWindow: createInsight("Memory 汇总时真正读取的近日日记窗口。", ["结果：当日日记文件"], ["处理：汇总近日日记，生成新的 Memory"], [], ["web/server/services/flash-diary-memory.ts"]),
  memoryProcess: createInsight("把近日日记压缩成短期/长期记忆文档结构。", ["判断：这次是否需要刷新 Memory", "输入：最近几天的闪念日记"], ["结果：Memory 文件 wiki/journal-memory.md"], [], ["web/server/services/flash-diary-memory.ts", "web/server/services/flash-diary-short-term-memory.ts"]),
  memoryFile: createInsight(
    "Memory 的真实持久化文件。用户打开 Memory 时会先显示当前版本，不等刷新完成。",
    ["触发：用户打开 / 刷新 Memory", "判断：这次是否需要刷新 Memory", "处理：汇总近日日记，生成新的 Memory"],
    ["结果：Memory 页面显示"],
    ["闪念日记页 Memory 视图"],
    ["web/server/services/flash-diary-memory-files.ts", "web/server/routes/flash-diary.ts"],
    [{ to: "结果：工作台“近日状态”", statusNote: "当前真实源码里，近日状态直接读取最新日记上下文、工作日志、当前规划输入和任务池，不读取 wiki/journal-memory.md。" }],
  ),
  memoryView: createInsight("用户在闪念日记页里真正看到的 Memory 呈现结果。", ["结果：Memory 文件 wiki/journal-memory.md"], [], ["闪念日记页 Memory 视图"], ["web/client/src/pages/flash-diary/index.ts", "web/server/routes/flash-diary.ts"]),
  refreshStatus: createInsight("用户在工作台里执行“近日状态”刷新。", [], ["输入：最新日记上下文 + 工作日志 + 当前规划输入 + 任务池"], ["工作台近日状态"], ["web/client/src/pages/workspace/index.ts", "web/server/services/task-plan-service.ts"]),
  recentContext: createInsight("近日状态不是读 Memory，而是直接组合最新日记上下文、工作日志、当前规划输入和任务池。", ["触发：用户刷新近日状态", "结果：当日日记文件"], ["处理：生成近日状态摘要"], [], ["web/server/services/task-plan-service.ts"]),
  recentStatusProcess: createInsight("调用 task-plan assistant 生成近日状态摘要文本。", ["输入：最新日记上下文 + 工作日志 + 当前规划输入 + 任务池"], ["结果：statusSummary"], [], ["web/server/services/task-plan-service.ts"]),
  recentStatusFile: createInsight("工作台状态摘要的真实存储结果。", ["处理：生成近日状态摘要"], ["结果：工作台“近日状态”"], ["工作台近日状态"], ["web/server/services/task-plan-service.ts", "web/server/services/task-plan-store.ts"]),
  recentStatusView: createInsight("工作台里用户最终看到的近日状态。", ["结果：statusSummary"], [], ["工作台“近日状态”区域"], ["web/client/src/pages/workspace/index.ts"]),
  refreshTimeline: createInsight("用户执行个人时间线来源刷新。", [], ["输入：闪念日记目录"], ["个人时间线来源刷新结果"], ["desktop-webui/src/main.ts", "web/server/services/personal-timeline-source-refresh.ts"]),
  timelineSource: createInsight("时间线刷新把闪念日记目录本身当作输入来源，而不是读 Memory。", ["触发：用户执行个人时间线来源刷新", "结果：当日日记文件"], ["处理：扫描来源并计算增量"], [], ["web/server/services/personal-timeline-source-refresh.ts"]),
  timelineProcess: createInsight("对来源目录做哈希快照，判断有没有新增内容。", ["输入：闪念日记目录"], ["结果：personal-timeline-source-state.json", "结果：personal-timeline-source-increments.json"], [], ["web/server/services/personal-timeline-source-refresh.ts"]),
  timelineState: createInsight("记录每个来源当前 digest 的状态文件。", ["处理：扫描来源并计算增量"], ["结果：personal-timeline-source-increments.json"], [], ["web/server/services/personal-timeline-source-refresh.ts"]),
  timelineIncrements: createInsight("记录本次检测出的增量结果。", ["结果：personal-timeline-source-state.json"], ["结果：时间线来源刷新结果"], ["时间线来源刷新结果"], ["web/server/services/personal-timeline-source-refresh.ts"]),
  timelineView: createInsight("用户能看到的时间线来源刷新结果。", ["结果：personal-timeline-source-increments.json"], [], ["个人时间线来源刷新结果"], ["web/server/services/personal-timeline-source-refresh.ts"]),
  imageSchedule: createInsight("每天 23:30 的自动配图调度触发。", [], ["输入：当日日记正文"], [], ["web/server/services/flash-diary-image-scheduler.ts"]),
  imageInput: createInsight("自动配图使用当日日记正文作为输入原料。", ["触发：每日 23:30", "结果：当日日记文件"], ["处理：生成日记配图"], [], ["web/server/services/flash-diary-auto-image.ts"]),
  imageProcess: createInsight("把日记正文变成当天配图 PNG。", ["输入：当日日记正文"], ["结果：daily-summary.png"], [], ["web/server/services/flash-diary-auto-image.ts"]),
  imageAsset: createInsight("自动配图生成后的真实媒体文件。", ["处理：生成日记配图"], ["处理：回写图片引用到当日日记"], ["日记里的自动配图"], ["web/server/services/flash-diary-auto-image.ts"]),
  imageBackfill: createInsight("把新生成的图片引用写回当天日记 Markdown。", ["结果：daily-summary.png"], ["结果：日记内图片呈现"], [], ["web/server/services/flash-diary-auto-image.ts"]),
  imageView: createInsight("用户在当天日记正文里看到的最终图片结果。", ["处理：回写图片引用到当日日记"], [], ["闪念日记页预览 / 编辑内容"], ["web/client/src/pages/flash-diary/index.ts"]),
  compileTrigger: createInsight("同步窗口命中后，开始判断这篇日记能不能进入 auto compile。", [], ["判断：是否满足闪念日记 auto compile 条件"], [], ["scripts/sync-compile.mjs", "scripts/sync-compile/flash-diary-auto-compile.mjs"]),
  compileDecision: createInsight("只在满足时间窗和规则时才把闪念日记放进同步/编译候选。", ["触发：同步窗口命中", "结果：当日日记文件"], ["结果：同步/编译候选"], [], ["scripts/sync-compile.mjs", "scripts/sync-compile/flash-diary-auto-compile.mjs"]),
  compileResult: createInsight("这篇日记已经进入同步/编译候选集合，等待后续 compile 链继续消费。", ["判断：是否满足闪念日记 auto compile 条件"], [], ["同步/编译链路"], ["scripts/sync-compile.mjs"]),
  questionsView: createInsight(
    "左侧“十二个问题”卡点开后，右侧会切到固定追问文档。",
    ["按钮：点击“十二个问题”"],
    [],
    ["闪念日记页右侧正文区"],
    ["web/client/src/pages/flash-diary/index.ts", "wiki/journal-twelve-questions.md"],
  ),
  openDiaryCard: createInsight(
    "左侧时间轴点某一天后，右侧正文区会切到这一天的 Markdown 和图片引用。",
    [],
    ["结果：当日日记文件 raw/闪念日记/YYYY-MM-DD.md", "结果：可视化混排编辑区"],
    ["闪念日记页左侧时间轴"],
    ["web/client/src/pages/flash-diary/index.ts", "web/server/services/flash-diary.ts"],
  ),
  editorView: createInsight(
    "右侧正文区不是假数据，而是把当天 Markdown 正文和图片引用真实读进可视化混排编辑器里。",
    ["结果：当日日记文件 raw/闪念日记/YYYY-MM-DD.md"],
    [],
    ["闪念日记页右侧正文编辑区"],
    ["web/client/src/pages/flash-diary/index.ts", "web/server/services/flash-diary.ts"],
  ),
};

function createInsight(
  summary: string,
  upstream: string[],
  downstream: string[],
  shownIn: string[],
  sourcePaths: string[],
  missingLinks: CodeDerivedSourceInsightNodeInsight["missingLinks"] = [],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn,
    sourcePaths,
    missingLinks,
  };
}

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "flash-diary-page",
    name: "闪念日记页",
    summary: "把闪念日记正文如何分流到 Memory、近日状态、时间线来源增量、23:30 自动配图和 compile 候选的真实链路放到同一张图里。",
    icon: "notebook-text",
    sourcePaths: [
      "web/client/src/pages/flash-diary/index.ts",
      "web/server/routes/flash-diary.ts",
      "web/server/services/flash-diary.ts",
      "web/server/services/flash-diary-memory.ts",
      "web/server/services/flash-diary-memory-scheduler.ts",
      "web/server/services/task-plan-service.ts",
      "web/server/services/personal-timeline-source-refresh.ts",
      "web/server/services/flash-diary-auto-image.ts",
      "web/server/services/flash-diary-image-scheduler.ts",
      "scripts/sync-compile.mjs",
      "scripts/sync-compile/flash-diary-auto-compile.mjs",
    ],
    mermaid: FLASH_DIARY_PAGE_MERMAID,
    flow: {
      nodes: [
        { id: "flash-diary-page-trigger", type: "trigger", title: "打开闪念日记页", description: "查看闪念日记统一链路图。", modelMode: "default" },
        { id: "flash-diary-page-view", type: "action", title: "渲染统一链路图", description: "详情页直接按 source insight 渲染。", modelMode: "default" },
      ],
      edges: [
        { id: "edge-flash-diary-page", source: "flash-diary-page-trigger", target: "flash-diary-page-view" },
      ],
      branches: [],
    },
    sourceInsight: {
      scope: "page",
      page: {
        id: "flash-diary",
        title: "闪念日记页",
        routeLabel: "#/flash-diary",
      },
      graph: {
        mermaid: FLASH_DIARY_PAGE_MERMAID,
        nodes: FLASH_DIARY_PAGE_GRAPH_NODES,
        edges: FLASH_DIARY_PAGE_GRAPH_EDGES,
      },
      pageHotspotView: FLASH_DIARY_PAGE_HOTSPOT_VIEW,
      nodeInsights: FLASH_DIARY_PAGE_NODE_INSIGHTS,
    },
  },
];
