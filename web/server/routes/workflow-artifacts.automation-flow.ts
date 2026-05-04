// fallow-ignore-file duplicate-export

/**
 * Source-owned automation flow for workflow artifact management.
 *
 * This flow documents the page and file/folder side of execution distillation:
 * the management page calls the artifact API, which creates long-term wiki
 * folders separately from runtime queue JSON files before returning the view.
 */
import type {
  CodeDerivedAutomationSeed,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "../services/code-derived-automation-types.js";
import { flowEdge, flowNode } from "../services/code-derived-automation-builders.js";

const SOURCE_PATHS = [
  "web/client/src/pages/workflow-artifacts/index.ts",
  "web/server/routes/workflow-artifacts.ts",
  "web/server/services/workflow-artifacts.ts",
  "web/client/src/pages/workspace/index.ts",
] as const;

const MERMAID = `
flowchart TD
  A["输入来源"] --> B{"入口类型"}

  B --> C["案例库首页：刷新案例库"]
  B --> D["执行记录器：提交过程记录"]

  C --> C1["读取来源路径"]
  C1 --> C2["日记 raw/闪念日记"]
  C1 --> C3["历史回忆.md"]
  C1 --> C4["个人时间线.md"]

  C2 --> E["读取 Markdown 标题和预览"]
  C3 --> E
  C4 --> E

  E --> F["计算来源 digest"]
  F --> G{"是否有增量"}
  G -->|否| H["返回：暂无更多增量"]
  G -->|是| I["检测问题解决信号"]

  D --> D1["匹配任务卡"]
  D1 --> D2{"置信度"}
  D2 -->|中/低| D3["进入待确认/待归档队列"]
  D2 -->|高| D4["写入任务卡 workflowLog"]
  D4 --> I

  I --> J{"是否包含失败/卡住/报错/解决/换工具等信号"}
  J -->|否| K["记录来源变更，不生成案例"]
  J -->|是| L["生成案例候选 Markdown"]

    L --> M["写入 wiki/专题/01-案例库/<标题>案例.md"]
  M --> N["重建 案例库/index.md"]
  N --> O["案例详情页可标记状态"]

  O --> P["已沉淀"]
  O --> Q["已写入规则"]
  O --> R["已转能力证据"]
`.trim();

const STANDARDS = {
  entry: "标准：入口属于页面导航，只负责打开执行沉淀页，不创建任务或沉淀内容。",
  page: "标准：页面必须区分长期文件夹和运行时队列，不能把文件夹当成队列页面。",
  api: "标准：接口只返回执行沉淀快照，并负责触发缺失资源的 scaffold。",
  snapshot: "标准：快照必须同时包含 folders、runtimeFiles、events、pendingConfirm、pendingArchive 和各类候选。",
  scaffold: "标准：scaffold 必须分别创建 wiki 长期文件夹和 .llmwiki 运行时 JSON 文件。",
  runtime: "标准：运行时文件只承载待处理事件和候选，不作为最终知识库目录。",
  folders: "标准：长期文件夹是最终沉淀去处，必须有 index.md，且和运行时 JSON 分离。",
  render: "标准：页面展示时必须让用户看见哪些是文件夹，哪些是运行时队列。",
} as const;

const SOURCE_INSIGHT_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "input", kind: "trigger", label: "输入来源" },
  { id: "refresh", kind: "process", label: "案例库首页刷新" },
  { id: "recorder", kind: "process", label: "执行记录器提交" },
  { id: "readMarkdown", kind: "process", label: "读取 Markdown 标题和预览" },
  { id: "digest", kind: "process", label: "计算来源 digest" },
  { id: "matchTask", kind: "process", label: "匹配任务卡" },
  { id: "workflowLog", kind: "process", label: "写入任务卡 workflowLog" },
  { id: "signal", kind: "process", label: "检测问题解决信号" },
  { id: "caseFile", kind: "result", label: "写入案例库文件" },
  { id: "caseIndex", kind: "result", label: "重建案例库 index" },
  { id: "caseStatus", kind: "result", label: "案例状态动作" },
];

const SOURCE_INSIGHT_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "input", target: "refresh" },
  { source: "input", target: "recorder" },
  { source: "refresh", target: "readMarkdown" },
  { source: "readMarkdown", target: "digest" },
  { source: "recorder", target: "matchTask" },
  { source: "matchTask", target: "workflowLog" },
  { source: "digest", target: "signal" },
  { source: "workflowLog", target: "signal" },
  { source: "signal", target: "caseFile" },
  { source: "caseFile", target: "caseIndex" },
  { source: "caseIndex", target: "caseStatus" },
];

function createInsight(
  summary: string,
  upstream: string[],
  downstream: string[],
  shownIn: string[],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn,
    sourcePaths: [...SOURCE_PATHS],
    missingLinks: [],
  };
}

const SOURCE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  input: createInsight("执行沉淀的入口来自日记、历史回忆、个人时间线和执行记录器。", [], ["案例库首页刷新", "执行记录器提交"], ["案例库刷新", "执行记录器"]),
  refresh: createInsight("案例库首页刷新会检查日记、历史回忆和个人时间线这些长期来源。", ["输入来源"], ["读取 Markdown 标题和预览"], ["wiki/个人信息档案/案例库/index.md"]),
  recorder: createInsight("执行记录器提交后先形成 Workflow Event，再按任务匹配结果决定是否写入任务卡。", ["输入来源"], ["匹配任务卡"], ["POST /api/workflow-recorder/record"]),
  readMarkdown: createInsight("刷新来源时读取 Markdown 标题和正文预览，作为案例标题和事实层的候选材料。", ["案例库首页刷新"], ["计算来源 digest"], ["raw/闪念日记", "wiki/个人信息档案/历史回忆.md", "wiki/个人信息档案/个人时间线.md"]),
  digest: createInsight("digest 用来判断来源是否有增量，避免重复写同一批案例。", ["读取 Markdown 标题和预览"], ["检测问题解决信号"], [".llmwiki/case-library-source-state.json"]),
  matchTask: createInsight("执行记录器会按任务标题、领域和项目匹配任务卡；置信度不足时进入待确认或待归档。", ["执行记录器提交"], ["写入任务卡 workflowLog"], [".llmwiki/workflow-recorder-inbox.json"]),
  workflowLog: createInsight("高置信度记录会写入任务卡 workflowLog，并继续参与案例和资源候选判断。", ["匹配任务卡"], ["检测问题解决信号"], ["task plan/*"]),
  signal: createInsight("只有出现失败、卡住、报错、解决、换工具等信号时，才进入案例库候选。", ["计算来源 digest", "写入任务卡 workflowLog"], ["写入案例库文件"], ["web/server/services/case-library.ts"]),
  caseFile: createInsight("案例库文件只写事实层，判断层保持待沉淀，避免过早生成方法或规则结论。", ["检测问题解决信号"], ["重建案例库 index"], ["wiki/专题/01-案例库/*案例.md"]),
  caseIndex: createInsight("每次新增或修改案例后重建案例库 index，让状态和来源在列表里可见。", ["写入案例库文件"], ["案例状态动作"], ["wiki/专题/01-案例库/index.md"]),
  caseStatus: createInsight("案例详情页可以把案例标记为已沉淀、已写入规则或已转能力证据。", ["重建案例库 index"], [], ["案例详情页"]),
};

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "workflow-artifacts",
    name: "执行沉淀文件流转",
    summary: "展示执行沉淀页如何读取 Workflow Event、候选队列，并补齐执行记录、案例库、任务卡、资源库这些长期文件夹。",
    icon: "folder-git-2",
    sourceKind: "information",
    sourcePaths: [...SOURCE_PATHS],
    mermaid: MERMAID,
    flow: {
      nodes: [
        flowNode("input", "trigger", "输入来源", "日记、历史回忆、个人时间线和执行记录器都能进入执行沉淀。", "case library / workflow recorder", STANDARDS.entry),
        flowNode("refresh", "action", "案例库首页刷新", "检查日记、历史回忆和个人时间线。", "POST /api/wiki/case-library/source-refresh", STANDARDS.page),
        flowNode("recorder", "action", "执行记录器提交", "把执行现场记录交给 Workflow Event 归档链路。", "POST /api/workflow-recorder/record", STANDARDS.api),
        flowNode("readMarkdown", "action", "读取 Markdown 标题和预览", "抽取标题、正文预览和来源路径。", "extractMarkdownHeadingAnchors()", STANDARDS.snapshot),
        flowNode("digest", "action", "计算来源 digest", "判断来源是否有增量。", ".llmwiki/case-library-source-state.json", STANDARDS.runtime),
        flowNode("matchTask", "action", "匹配任务卡", "按任务标题、领域和项目判断归属。", "rankTaskCandidates()", STANDARDS.runtime),
        flowNode("workflowLog", "action", "写入任务卡 workflowLog", "高置信度执行记录进入正式任务卡。", "appendWorkflowLogToTask()", STANDARDS.runtime),
        flowNode("signal", "action", "检测问题解决信号", "只让失败、卡住、报错、解决、换工具等记录进入案例候选。", "hasProblemSignal()", STANDARDS.folders),
        flowNode("caseFile", "action", "写入案例库文件", "生成只含事实层的案例 Markdown。", "wiki/专题/01-案例库/*案例.md", STANDARDS.folders),
        flowNode("caseIndex", "action", "重建案例库 index", "把案例、状态、来源写回案例库列表。", "wiki/专题/01-案例库/index.md", STANDARDS.folders),
        flowNode("caseStatus", "action", "案例详情页标记状态", "标记已沉淀、已写入规则或已转能力证据。", "POST /api/wiki/case-library/case-action", STANDARDS.render),
      ],
      edges: [
        flowEdge("input", "refresh"),
        flowEdge("input", "recorder"),
        flowEdge("refresh", "readMarkdown"),
        flowEdge("readMarkdown", "digest"),
        flowEdge("recorder", "matchTask"),
        flowEdge("matchTask", "workflowLog"),
        flowEdge("digest", "signal"),
        flowEdge("workflowLog", "signal"),
        flowEdge("signal", "caseFile"),
        flowEdge("caseFile", "caseIndex"),
        flowEdge("caseIndex", "caseStatus"),
      ],
      branches: [],
    },
    sourceInsight: {
      scope: "cross-page",
      page: {
        id: "workflow-artifacts",
        title: "执行沉淀文件流转",
        routeLabel: "#/workflow-artifacts",
      },
      graph: {
        mermaid: MERMAID,
        preserveMermaid: true,
        nodes: SOURCE_INSIGHT_NODES,
        edges: SOURCE_INSIGHT_EDGES,
      },
      nodeInsights: SOURCE_INSIGHTS,
    },
  },
];
