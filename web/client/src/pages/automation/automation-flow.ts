/**
 * Source-owned automation flow for the automation workspace itself.
 *
 * This page-level seed explains how the workflow list loads, how detail and
 * logs are fetched, and how live refresh keeps the same page updated as source
 * flow modules and automation config change.
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

const AUTOMATION_WORKSPACE_MERMAID = `
flowchart TD
    A["打开 #/automation<br/>renderAutomationWorkspacePage()"] --> B["GET /api/automation-workspace<br/>handleAutomationWorkspaceList()"]
    B --> C["汇总所有 Workflow<br/>listWorkspaceAutomations()"]
    C --> D["渲染 Workflow 列表<br/>renderAutomationList()"]
    D --> E{"用户下一步做什么"}
    E -->|等待变化| F["订阅 /api/automation-workspace/events<br/>bindAutomationWorkspaceLiveRefresh()"]
    E -->|打开详情| G["点击 Workflow 卡片<br/>bindAutomationListActions()"]
    G --> H["GET /api/automation-workspace/:id<br/>handleAutomationWorkspaceDetail()"]
    H --> I["补全节点 app / model 信息<br/>readAutomationWorkspaceDetail() + enrichNode()"]
    I --> J["渲染 Mermaid 详情图<br/>renderAutomationMermaidView()"]
    J --> K{"详情页下一步做什么"}
    K -->|查看日志| L["GET /api/automation-workspace/:id/logs<br/>handleAutomationWorkspaceLogs()"]
    L --> M["渲染运行日志<br/>loadAutomationLogs()"]
    K -->|等待变化| N["订阅 /api/automation-workspace/events<br/>bindAutomationWorkspaceLiveRefresh()"]
`.trim();

const AUTOMATION_WORKSPACE_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    openWorkspace{{"触发：用户打开 Workflow 工作区"}} --> readList("处理：读取 Workflow 列表")
    readList --> workflowCards(["结果：Workflow 卡片列表"])
    workflowCards --> listAction{"判断：列表页下一步要做什么"}

    listAction -->|等待变化| changeEvent{{"触发：源码或配置发生变化"}}
    changeEvent --> refreshList("处理：重新拉取 Workflow 列表")
    refreshList --> refreshedCards(["结果：列表自动更新"])

    listAction -->|打开详情| openDetail{{"触发：用户点击某张 Workflow 卡片"}}
    openDetail --> readDetail("处理：读取 Workflow 详情并补全 app/model 信息")
    readDetail --> detailGraph(["结果：Workflow 统一链路图 / 详情图"])
    detailGraph --> detailAction{"判断：详情页下一步要做什么"}

    detailAction -->|查看日志| openLogs{{"触发：用户查看运行日志"}}
    openLogs --> readLogs("处理：读取 Workflow 运行日志")
    readLogs --> logTimeline(["结果：运行日志时间线"])

    detailAction -->|等待变化| detailChange{{"触发：详情相关源码或配置发生变化"}}
    detailChange --> refreshDetail("处理：重新拉取当前 Workflow 详情")
    refreshDetail --> detailRefresh(["结果：详情自动更新"])
`.trim();

const AUTOMATION_WORKSPACE_SOURCE_INSIGHT_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "openWorkspace", kind: "trigger", label: "触发：用户打开 Workflow 工作区" },
  { id: "readList", kind: "process", label: "处理：读取 Workflow 列表" },
  { id: "workflowCards", kind: "result", label: "结果：Workflow 卡片列表" },
  { id: "listAction", kind: "decision", label: "判断：列表页下一步要做什么" },
  { id: "changeEvent", kind: "trigger", label: "触发：源码或配置发生变化" },
  { id: "refreshList", kind: "process", label: "处理：重新拉取 Workflow 列表" },
  { id: "refreshedCards", kind: "result", label: "结果：列表自动更新" },
  { id: "openDetail", kind: "trigger", label: "触发：用户点击某张 Workflow 卡片" },
  { id: "readDetail", kind: "process", label: "处理：读取 Workflow 详情并补全 app/model 信息" },
  { id: "detailGraph", kind: "result", label: "结果：Workflow 统一链路图 / 详情图" },
  { id: "detailAction", kind: "decision", label: "判断：详情页下一步要做什么" },
  { id: "openLogs", kind: "trigger", label: "触发：用户查看运行日志" },
  { id: "readLogs", kind: "process", label: "处理：读取 Workflow 运行日志" },
  { id: "logTimeline", kind: "result", label: "结果：运行日志时间线" },
  { id: "detailChange", kind: "trigger", label: "触发：详情相关源码或配置发生变化" },
  { id: "refreshDetail", kind: "process", label: "处理：重新拉取当前 Workflow 详情" },
  { id: "detailRefresh", kind: "result", label: "结果：详情自动更新" },
];

const AUTOMATION_WORKSPACE_SOURCE_INSIGHT_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "openWorkspace", target: "readList" },
  { source: "readList", target: "workflowCards", label: "渲染" },
  { source: "workflowCards", target: "listAction" },
  { source: "listAction", target: "changeEvent", label: "等待变化" },
  { source: "changeEvent", target: "refreshList" },
  { source: "refreshList", target: "refreshedCards", label: "刷新" },
  { source: "listAction", target: "openDetail", label: "打开详情" },
  { source: "openDetail", target: "readDetail" },
  { source: "readDetail", target: "detailGraph", label: "渲染" },
  { source: "detailGraph", target: "detailAction" },
  { source: "detailAction", target: "openLogs", label: "查看日志" },
  { source: "openLogs", target: "readLogs" },
  { source: "readLogs", target: "logTimeline", label: "渲染" },
  { source: "detailAction", target: "detailChange", label: "等待变化" },
  { source: "detailChange", target: "refreshDetail" },
  { source: "refreshDetail", target: "detailRefresh", label: "刷新" },
];

const AUTOMATION_WORKSPACE_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  openWorkspace: createInsight(
    "用户进入设置页里的 Workflow 分区，或直接进入 #/automation 时，这条链先从列表加载开始。",
    [],
    ["处理：读取 Workflow 列表"],
    ["设置页 / Workflow 工作区"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  readList: createInsight(
    "列表接口会把显式 workflow、应用 workflow 和 code-derived 流程统一汇总后返回。",
    ["触发：用户打开 Workflow 工作区"],
    ["结果：Workflow 卡片列表"],
    [],
    ["web/client/src/pages/automation/index.ts", "web/server/routes/automation-workspace.ts", "web/server/services/automation-workspace.ts"],
  ),
  workflowCards: createInsight(
    "这是用户在 Workflow 工作区里真正看到的分组卡片列表。",
    ["处理：读取 Workflow 列表"],
    ["判断：列表页下一步要做什么"],
    ["Workflow 列表"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  listAction: createInsight(
    "列表页当前只有两类真实后续：等待变更自动刷新，或打开某一条 Workflow 详情。",
    ["结果：Workflow 卡片列表"],
    ["触发：源码或配置发生变化", "触发：用户点击某张 Workflow 卡片"],
    [],
    ["web/client/src/pages/automation/index.ts"],
  ),
  changeEvent: createInsight(
    "当 flow sidecar、automation 配置、agent 配置或默认模型配置变化时，列表页会收到 SSE 变更事件。",
    ["判断：列表页下一步要做什么"],
    ["处理：重新拉取 Workflow 列表"],
    [],
    ["web/client/src/pages/automation/live-events.ts", "web/server/routes/automation-workspace.ts"],
  ),
  refreshList: createInsight(
    "列表收到 change 事件后会重新请求列表数据。",
    ["触发：源码或配置发生变化"],
    ["结果：列表自动更新"],
    [],
    ["web/client/src/pages/automation/live-events.ts"],
  ),
  refreshedCards: createInsight(
    "这是列表自动刷新的用户可见结果。",
    ["处理：重新拉取 Workflow 列表"],
    [],
    ["Workflow 列表"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  openDetail: createInsight(
    "用户从列表卡片进入某条 Workflow 详情。",
    ["判断：列表页下一步要做什么"],
    ["处理：读取 Workflow 详情并补全 app/model 信息"],
    ["Workflow 卡片点击"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  readDetail: createInsight(
    "详情接口除了返回 flow 之外，还会补全节点的 app 信息和 effective model 信息。",
    ["触发：用户点击某张 Workflow 卡片"],
    ["结果：Workflow 统一链路图 / 详情图"],
    [],
    ["web/client/src/pages/automation/index.ts", "web/server/routes/automation-workspace.ts", "web/server/services/automation-workspace.ts"],
  ),
  detailGraph: createInsight(
    "这就是详情页里用户看到的 Workflow 图形结果。",
    ["处理：读取 Workflow 详情并补全 app/model 信息"],
    ["判断：详情页下一步要做什么"],
    ["Workflow 详情图"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  detailAction: createInsight(
    "详情页当前会继续分成查看运行日志，或等待变化后自动刷新两条真实后续。",
    ["结果：Workflow 统一链路图 / 详情图"],
    ["触发：用户查看运行日志", "触发：详情相关源码或配置发生变化"],
    [],
    ["web/client/src/pages/automation/index.ts"],
  ),
  openLogs: createInsight(
    "用户从详情页进入运行日志。",
    ["判断：详情页下一步要做什么"],
    ["处理：读取 Workflow 运行日志"],
    ["详情页头部日志入口"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  readLogs: createInsight(
    "日志接口只对可执行 Workflow 读取历史运行记录。",
    ["触发：用户查看运行日志"],
    ["结果：运行日志时间线"],
    [],
    ["web/client/src/pages/automation/index.ts", "web/server/routes/automation-workspace.ts"],
  ),
  logTimeline: createInsight(
    "这是运行日志页里用户看到的时间线结果。",
    ["处理：读取 Workflow 运行日志"],
    [],
    ["Workflow 日志页"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  detailChange: createInsight(
    "详情页同样会订阅 SSE 变更事件，确保当前打开的 Workflow 能自动跟上源码和配置变化。",
    ["判断：详情页下一步要做什么"],
    ["处理：重新拉取当前 Workflow 详情"],
    [],
    ["web/client/src/pages/automation/live-events.ts", "web/server/routes/automation-workspace.ts"],
  ),
  refreshDetail: createInsight(
    "收到变更事件后，详情页会重拉当前 Workflow 的 detail、comments 和 layout。",
    ["触发：详情相关源码或配置发生变化"],
    ["结果：详情自动更新"],
    [],
    ["web/client/src/pages/automation/index.ts"],
  ),
  detailRefresh: createInsight(
    "这是详情自动刷新的用户可见结果。",
    ["处理：重新拉取当前 Workflow 详情"],
    [],
    ["Workflow 详情图"],
    ["web/client/src/pages/automation/index.ts"],
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
    slug: "automation-workspace",
    name: "Workflow 工作区",
    summary: "从 Workflow 列表加载，到详情、日志和页面刷新联动的真实页面/API 流程。",
    icon: "git-branch",
    sourcePaths: [
      "web/client/src/pages/automation/index.ts",
      "web/client/src/pages/automation/live-events.ts",
      "web/client/src/pages/automation/panels.ts",
      "web/server/routes/automation-workspace.ts",
      "web/server/services/automation-workspace.ts",
    ],
    mermaid: AUTOMATION_WORKSPACE_MERMAID,
    flow: {
      nodes: [
        flowNode("auto-trigger", "trigger", "打开 #/automation", "路由挂载 Workflow 列表页。", "renderAutomationWorkspacePage()"),
        flowNode("auto-list-api", "action", "GET /api/automation-workspace", "列表页先读取所有 Workflow 卡片数据。", "handleAutomationWorkspaceList()"),
        flowNode("auto-list-service", "action", "listWorkspaceAutomations()", "汇总显式 automation、code flow 和 app-derived flow。", "listWorkspaceAutomations()"),
        flowNode("auto-list-render", "action", "renderAutomationList()", "把应用流程、信息流转流程和源码真实流程分区渲染出来。", "bindAutomationListPage().refresh()"),
        flowNode("auto-list-branch", "branch", "列表页下一步要做什么", "列表页会等待变更事件，或打开某个 Workflow 详情。", "bindAutomationListActions()"),
        flowNode("auto-list-refresh", "action", "订阅 /api/automation-workspace/events", "收到 SSE change 事件后重新拉列表。", "bindAutomationWorkspaceLiveRefresh()"),
        flowNode("auto-open", "action", "点击 Workflow 卡片", "切到 #/automation/:id 详情路由。", "bindAutomationListActions()"),
        flowNode("auto-detail-api", "action", "GET /api/automation-workspace/:id", "详情路由请求 automation、comments、layout。", "handleAutomationWorkspaceDetail()"),
        flowNode("auto-detail-service", "action", "readAutomationWorkspaceDetail()", "补全 app 信息和 effectiveModel 后返回详情。", "readAutomationWorkspaceDetail() -> enrichNode()"),
        flowNode("auto-detail-render", "action", "renderAutomationMermaidView()", "把 flow 数据交给 Mermaid 视图渲染。", "renderAutomationDetail()"),
        flowNode("auto-detail-branch", "branch", "详情页下一步要做什么", "详情页可继续打开运行日志，或等待变更后自动刷新。", "bindAutomationDetailHeader()"),
        flowNode("auto-logs-api", "action", "GET /api/automation-workspace/:id/logs", "只对可执行 workflow 读取日志列表。", "handleAutomationWorkspaceLogs()"),
        flowNode("auto-logs-render", "action", "loadAutomationLogs()", "把运行日志渲染成时间线列表。", "loadAutomationLogs()"),
        flowNode("auto-detail-refresh", "action", "订阅 /api/automation-workspace/events", "详情页收到 SSE change 后重新拉详情。", "bindAutomationWorkspaceLiveRefresh()"),
      ],
      edges: [
        flowEdge("auto-trigger", "auto-list-api"),
        flowEdge("auto-list-api", "auto-list-service"),
        flowEdge("auto-list-service", "auto-list-render"),
        flowEdge("auto-list-render", "auto-list-branch"),
        flowEdge("auto-list-branch", "auto-list-refresh"),
        flowEdge("auto-list-branch", "auto-open"),
        flowEdge("auto-open", "auto-detail-api"),
        flowEdge("auto-detail-api", "auto-detail-service"),
        flowEdge("auto-detail-service", "auto-detail-render"),
        flowEdge("auto-detail-render", "auto-detail-branch"),
        flowEdge("auto-detail-branch", "auto-logs-api"),
        flowEdge("auto-logs-api", "auto-logs-render"),
        flowEdge("auto-detail-branch", "auto-detail-refresh"),
      ],
      branches: [
        flowBranch("auto-list-actions", "列表页动作分支", "auto-list-branch", ["auto-list-refresh", "auto-open"]),
        flowBranch("auto-detail-actions", "详情页动作分支", "auto-detail-branch", ["auto-logs-api", "auto-logs-render", "auto-detail-refresh"]),
      ],
    },
    sourceInsight: {
      scope: "page",
      page: {
        id: "automation",
        title: "Workflow 工作区",
        routeLabel: "#/automation",
      },
      graph: {
        mermaid: AUTOMATION_WORKSPACE_SOURCE_INSIGHT_MERMAID,
        nodes: AUTOMATION_WORKSPACE_SOURCE_INSIGHT_NODES,
        edges: AUTOMATION_WORKSPACE_SOURCE_INSIGHT_EDGES,
      },
      nodeInsights: AUTOMATION_WORKSPACE_NODE_INSIGHTS,
    },
  },
];
