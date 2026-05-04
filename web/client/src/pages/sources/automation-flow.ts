/**
 * Source-owned automation flow for the source gallery page.
 *
 * This page-level seed explains how selected source items move through inbox,
 * priority ingest, compile input generation, and the final sync-run handoff.
 */

import type {
  CodeDerivedAutomationSeed,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "../../../../server/services/code-derived-automation-types.js";
import {
  flowBranch,
  flowEdge,
  flowNode,
} from "../../../../server/services/code-derived-automation-builders.js";

const SOURCE_GALLERY_MERMAID = `
flowchart TD
    A["打开 #/sources<br/>renderSourcesPage()"] --> B["GET /api/source-gallery<br/>handleSourceGalleryList()"]
    B --> C["汇总源料卡片<br/>listSourceGalleryItems()"]
    C --> D["渲染源料库列表<br/>renderSourceGallery()"]
    D --> E{"用户选择哪种源料动作"}
    E -->|送入 inbox| F["POST /api/source-gallery/selection/inbox<br/>handleSourceGalleryMoveToInbox()"]
    F --> G["复制到 inbox/source-gallery<br/>moveSourceGalleryItemsToInbox()"]
    E -->|加入优先录入| H["POST /api/source-gallery/selection/ingest<br/>handleSourceGalleryIngestQueue()"]
    H --> I["写入优先录入队列<br/>queueSourceGalleryBatchIngest()"]
    E -->|单条发起 compile| J["POST /api/source-gallery/:id/compile<br/>handleSourceGalleryCompile()"]
    J --> K["生成 compile 输入 Markdown<br/>createSourceGalleryCompileInput()"]
    K --> L["启动 sync run<br/>runManager.start(\\"sync\\")"]
`.trim();

const SOURCE_GALLERY_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    openSources{{"触发：用户打开源料库页"}} --> readGallery("处理：读取源料库列表")
    readGallery --> galleryCards(["结果：源料库卡片列表"])
    galleryCards --> userAction{"判断：用户要对选中源料做什么"}
    userAction -->|送入 inbox| selectedSource["输入：选中的源料条目"]
    selectedSource --> moveInbox("处理：复制源料到 inbox/source-gallery")
    moveInbox --> inboxFiles(["结果：inbox/source-gallery 待录入文件"])
    userAction -->|加入优先录入| queueInput["输入：选中的源料条目"]
    queueInput --> queueIngest("处理：写入优先批量录入队列")
    queueIngest --> ingestQueue(["结果：source-gallery-batch-ingest.json"])
    userAction -->|发起 compile| compileInput["输入：选中的源料条目 + guided ingest 对话"]
    compileInput --> buildCompile("处理：生成 compile 输入 Markdown")
    buildCompile --> compileFile(["结果：compiled-source-item.md"])
    compileFile --> startSync("处理：启动 sync run")
    startSync --> syncLog(["结果：运行页 sync 日志"])
`.trim();

const SOURCE_GALLERY_SOURCE_INSIGHT_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "openSources", kind: "trigger", label: "触发：用户打开源料库页" },
  { id: "readGallery", kind: "process", label: "处理：读取源料库列表" },
  { id: "galleryCards", kind: "result", label: "结果：源料库卡片列表" },
  { id: "userAction", kind: "decision", label: "判断：用户要对选中源料做什么" },
  { id: "selectedSource", kind: "input", label: "输入：选中的源料条目" },
  { id: "moveInbox", kind: "process", label: "处理：复制源料到 inbox/source-gallery" },
  { id: "inboxFiles", kind: "result", label: "结果：inbox/source-gallery 待录入文件" },
  { id: "queueInput", kind: "input", label: "输入：选中的源料条目" },
  { id: "queueIngest", kind: "process", label: "处理：写入优先批量录入队列" },
  { id: "ingestQueue", kind: "result", label: "结果：source-gallery-batch-ingest.json" },
  { id: "compileInput", kind: "input", label: "输入：选中的源料条目 + guided ingest 对话" },
  { id: "buildCompile", kind: "process", label: "处理：生成 compile 输入 Markdown" },
  { id: "compileFile", kind: "result", label: "结果：compiled-source-item.md" },
  { id: "startSync", kind: "process", label: "处理：启动 sync run" },
  { id: "syncLog", kind: "result", label: "结果：运行页 sync 日志" },
];

const SOURCE_GALLERY_SOURCE_INSIGHT_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "openSources", target: "readGallery" },
  { source: "readGallery", target: "galleryCards", label: "渲染" },
  { source: "galleryCards", target: "userAction" },
  { source: "userAction", target: "selectedSource", label: "送入 inbox" },
  { source: "selectedSource", target: "moveInbox" },
  { source: "moveInbox", target: "inboxFiles", label: "写入" },
  { source: "userAction", target: "queueInput", label: "加入优先录入" },
  { source: "queueInput", target: "queueIngest" },
  { source: "queueIngest", target: "ingestQueue", label: "写入" },
  { source: "userAction", target: "compileInput", label: "发起 compile" },
  { source: "compileInput", target: "buildCompile" },
  { source: "buildCompile", target: "compileFile", label: "生成" },
  { source: "compileFile", target: "startSync", label: "消费" },
  { source: "startSync", target: "syncLog", label: "呈现" },
];

const SOURCE_GALLERY_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  openSources: createInsight(
    "用户进入源料库页时，页面先从后端读取当前可见的源料列表。",
    [],
    ["处理：读取源料库列表"],
    ["源料库页"],
    ["web/client/src/pages/sources/index.ts"],
  ),
  readGallery: createInsight(
    "这里把 raw 和 sources_full 的条目聚合成统一列表，再交给页面渲染。",
    ["触发：用户打开源料库页"],
    ["结果：源料库卡片列表"],
    [],
    ["web/client/src/pages/sources/index.ts", "web/server/routes/source-gallery.ts", "web/server/services/source-gallery.ts"],
  ),
  galleryCards: createInsight(
    "这是用户在源料库页里真正看到的卡片列表，也是后续所有批量动作的操作面。",
    ["处理：读取源料库列表"],
    ["判断：用户要对选中源料做什么"],
    ["源料库卡片网格"],
    ["web/client/src/pages/sources/index.ts"],
  ),
  userAction: createInsight(
    "同一批选中源料可以走 inbox、优先录入或 compile 三条不同分支。",
    ["结果：源料库卡片列表"],
    ["输入：选中的源料条目", "结果：source-gallery-batch-ingest.json", "输入：选中的源料条目 + guided ingest 对话"],
    [],
    ["web/client/src/pages/sources/index.ts"],
  ),
  selectedSource: createInsight(
    "送入 inbox 分支使用的是用户当前选中的源料条目。",
    ["判断：用户要对选中源料做什么"],
    ["处理：复制源料到 inbox/source-gallery"],
    [],
    ["web/client/src/pages/sources/index.ts"],
  ),
  moveInbox: createInsight(
    "这一步会把选中源料复制到 inbox/source-gallery，交给后续人工或批量录入链继续消费。",
    ["输入：选中的源料条目"],
    ["结果：inbox/source-gallery 待录入文件"],
    [],
    ["web/server/routes/source-gallery.ts", "web/server/services/source-gallery.ts"],
  ),
  inboxFiles: createInsight(
    "这是源料库“送入 inbox”之后真正落下来的待录入文件结果。",
    ["处理：复制源料到 inbox/source-gallery"],
    [],
    ["inbox/source-gallery"],
    ["web/server/services/source-gallery.ts"],
  ),
  queueInput: createInsight(
    "优先批量录入分支同样消费当前选中的源料条目。",
    ["判断：用户要对选中源料做什么"],
    ["处理：写入优先批量录入队列"],
    [],
    ["web/client/src/pages/sources/index.ts"],
  ),
  queueIngest: createInsight(
    "这一步把选中源料写进优先批量录入队列文件，等待审查/录入链继续消费。",
    ["输入：选中的源料条目"],
    ["结果：source-gallery-batch-ingest.json"],
    [],
    ["web/server/routes/source-gallery.ts", "web/server/services/source-gallery.ts"],
  ),
  ingestQueue: createInsight(
    "这是优先批量录入队列的真实落盘结果。",
    ["处理：写入优先批量录入队列"],
    [],
    ["审查页 / 批量录入链路"],
    ["web/server/services/source-gallery.ts"],
  ),
  compileInput: createInsight(
    "单条 compile 分支会同时消费选中的源料条目和这条源料的 guided ingest 对话。",
    ["判断：用户要对选中源料做什么"],
    ["处理：生成 compile 输入 Markdown"],
    [],
    ["web/client/src/pages/sources/index.ts", "web/server/routes/source-gallery.ts"],
  ),
  buildCompile: createInsight(
    "这一步把源料条目和对话结果整理成 compile 能直接消费的 Markdown 输入文件。",
    ["输入：选中的源料条目 + guided ingest 对话"],
    ["结果：compiled-source-item.md"],
    [],
    ["web/server/routes/source-gallery.ts", "web/server/services/source-gallery.ts"],
  ),
  compileFile: createInsight(
    "这是源料库单条 compile 分支生成出来的真实输入文件。",
    ["处理：生成 compile 输入 Markdown"],
    ["处理：启动 sync run"],
    ["同步/编译链路输入"],
    ["web/server/services/source-gallery.ts"],
  ),
  startSync: createInsight(
    "生成 compile 输入后，会立刻创建 sync run，把这份输入交给同步编译链继续处理。",
    ["结果：compiled-source-item.md"],
    ["结果：运行页 sync 日志"],
    [],
    ["web/server/routes/source-gallery.ts"],
  ),
  syncLog: createInsight(
    "源料库里的单条 compile 最终会回到运行页，显示成 sync run 的实时日志。",
    ["处理：启动 sync run"],
    [],
    ["运行页日志区域"],
    ["web/client/src/pages/sources/index.ts"],
  ),
};

function createInsight(
  summary: string,
  upstream: string[],
  downstream: string[],
  shownIn: string[],
  sourcePaths: string[],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn,
    sourcePaths,
    missingLinks: [],
  };
}

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "source-gallery",
    name: "源料库",
    summary: "从源料库列表加载，到送入 inbox 或生成 compile 输入并启动 sync run 的真实流程。",
    icon: "book-open",
    sourcePaths: [
      "web/client/src/pages/sources/index.ts",
      "web/server/routes/source-gallery.ts",
      "web/server/services/source-gallery.ts",
    ],
    mermaid: SOURCE_GALLERY_MERMAID,
    flow: {
      nodes: [
        flowNode("source-trigger", "trigger", "打开 #/sources", "源料库页面挂载后先刷新列表。", "renderSourcesPage()"),
        flowNode("source-list-api", "action", "GET /api/source-gallery", "按 query / sort / filter 读取源料列表。", "handleSourceGalleryList()"),
        flowNode("source-list-service", "action", "listSourceGalleryItems()", "从 runtime 索引和源目录汇总列表项。", "listSourceGalleryItems()"),
        flowNode("source-render", "action", "renderSourceGallery()", "把筛选后的源料卡片渲染到网格里。", "refreshSourceGallery()"),
        flowNode("source-branch", "branch", "用户选择哪种源料动作", "源料库支持送入 inbox、加入优先录入和发起 compile。", "bindSourcesPage()"),
        flowNode("source-inbox-api", "action", "POST /api/source-gallery/selection/inbox", "批量把选中源料复制到 inbox/source-gallery。", "handleSourceGalleryMoveToInbox()"),
        flowNode("source-inbox-service", "action", "moveSourceGalleryItemsToInbox()", "按 layer / bucket 生成唯一 inbox 目标路径。", "moveSourceGalleryItemsToInbox()"),
        flowNode("source-ingest-api", "action", "POST /api/source-gallery/selection/ingest", "把选中源料加入优先批量录入队列。", "handleSourceGalleryIngestQueue()"),
        flowNode("source-ingest-service", "action", "queueSourceGalleryBatchIngest()", "把源料条目写进 .llmwiki/source-gallery-batch-ingest.json。", "queueSourceGalleryBatchIngest()"),
        flowNode("source-compile-api", "action", "POST /api/source-gallery/:id/compile", "携带 conversationId 为单条源料发起 compile。", "handleSourceGalleryCompile()"),
        flowNode("source-input", "action", "createSourceGalleryCompileInput()", "把 guided ingest 对话整理成 compile 输入 Markdown。", "createSourceGalleryCompileInput()"),
        flowNode("source-run", "action", "runManager.start(\"sync\")", "启动 sync run 并返回 runId。", "runManager.start(\"sync\")"),
      ],
      edges: [
        flowEdge("source-trigger", "source-list-api"),
        flowEdge("source-list-api", "source-list-service"),
        flowEdge("source-list-service", "source-render"),
        flowEdge("source-render", "source-branch"),
        flowEdge("source-branch", "source-inbox-api"),
        flowEdge("source-inbox-api", "source-inbox-service"),
        flowEdge("source-branch", "source-ingest-api"),
        flowEdge("source-ingest-api", "source-ingest-service"),
        flowEdge("source-branch", "source-compile-api"),
        flowEdge("source-compile-api", "source-input"),
        flowEdge("source-input", "source-run"),
      ],
      branches: [
        flowBranch(
          "source-actions",
          "源料库操作分支",
          "source-branch",
          ["source-inbox-api", "source-inbox-service", "source-ingest-api", "source-ingest-service", "source-compile-api", "source-input", "source-run"],
        ),
      ],
    },
    sourceInsight: {
      scope: "page",
      page: {
        id: "sources",
        title: "源料库页",
        routeLabel: "#/sources",
      },
      graph: {
        mermaid: SOURCE_GALLERY_SOURCE_INSIGHT_MERMAID,
        nodes: SOURCE_GALLERY_SOURCE_INSIGHT_NODES,
        edges: SOURCE_GALLERY_SOURCE_INSIGHT_EDGES,
      },
      nodeInsights: SOURCE_GALLERY_NODE_INSIGHTS,
    },
  },
];
