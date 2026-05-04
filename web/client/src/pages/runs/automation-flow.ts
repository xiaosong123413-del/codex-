/**
 * Source-owned automation flow for the sync entry page.
 *
 * This page-level seed keeps the sync button's real lineage beside the run
 * page source: which trigger starts the flow, which intake inputs are read,
 * which decisions stop the run, and which result is finally shown back in the
 * run page.
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

const SYNC_ENTRY_MERMAID = `
flowchart TD
    A["点击同步按钮<br/>bindRunPage() startButton.click"] --> B["confirmSyncPlan()<br/>统一决定是 none / inbox / confirm"]
    B --> C["GET /api/intake/scan<br/>loadIntakeScan()"]
    C --> D{"scan.items.length 是否为 0"}
    D -->|是| E["返回 none 并提示未检测到新源料<br/>statusNode / metaNode update"]
    D -->|否| F{"scan.plan.length 是否为 0"}
    F -->|是| G["返回 inbox 并提示去审查页<br/>statusNode / metaNode update"]
    F -->|否| H["showIntakePlanDialog()<br/>showIntakePlanDialog(root, scan.plan)"]
    H --> I{"用户是否确认同步编译方案"}
    I -->|否| J["返回 none 并结束<br/>return \\"none\\""]
    I -->|是| K["POST /api/runs/sync<br/>startRun(\\"sync\\")"]
    K --> L["attachRunStream()<br/>实时刷新运行日志"]
`.trim();

const SYNC_ENTRY_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    syncTrigger{{"触发：用户点击同步"}} --> intakeScan("处理：扫描 intake 待处理项")
    intakeScan --> intakeItems["输入：raw / inbox 中待处理原料"]
    intakeItems --> hasItems{"判断：是否检测到待处理原料"}
    hasItems -->|没有| noItems(["结果：运行页提示“未检测到新源料”"])
    hasItems -->|有| batchPlan["输入：本轮可批量录入计划"]
    batchPlan --> hasPlan{"判断：是否已有批量录入计划"}
    hasPlan -->|没有| inboxHint(["结果：提示先去审查页处理 inbox"])
    hasPlan -->|有| confirmPlan("处理：展示同步编译方案")
    confirmPlan --> userConfirm{"判断：用户是否确认同步方案"}
    userConfirm -->|取消| cancelSync(["结果：本次不启动同步"])
    userConfirm -->|确认| startRun("处理：启动 sync run")
    startRun --> runLog(["结果：运行页实时日志"])
`.trim();

const SYNC_ENTRY_SOURCE_INSIGHT_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "syncTrigger", kind: "trigger", label: "触发：用户点击同步" },
  { id: "intakeScan", kind: "process", label: "处理：扫描 intake 待处理项" },
  { id: "intakeItems", kind: "input", label: "输入：raw / inbox 中待处理原料" },
  { id: "hasItems", kind: "decision", label: "判断：是否检测到待处理原料" },
  { id: "noItems", kind: "result", label: "结果：运行页提示“未检测到新源料”" },
  { id: "batchPlan", kind: "input", label: "输入：本轮可批量录入计划" },
  { id: "hasPlan", kind: "decision", label: "判断：是否已有批量录入计划" },
  { id: "inboxHint", kind: "result", label: "结果：提示先去审查页处理 inbox" },
  { id: "confirmPlan", kind: "process", label: "处理：展示同步编译方案" },
  { id: "userConfirm", kind: "decision", label: "判断：用户是否确认同步方案" },
  { id: "cancelSync", kind: "result", label: "结果：本次不启动同步" },
  { id: "startRun", kind: "process", label: "处理：启动 sync run" },
  { id: "runLog", kind: "result", label: "结果：运行页实时日志" },
];

const SYNC_ENTRY_SOURCE_INSIGHT_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "syncTrigger", target: "intakeScan" },
  { source: "intakeScan", target: "intakeItems", label: "读取" },
  { source: "intakeItems", target: "hasItems" },
  { source: "hasItems", target: "noItems", label: "没有" },
  { source: "hasItems", target: "batchPlan", label: "有" },
  { source: "batchPlan", target: "hasPlan" },
  { source: "hasPlan", target: "inboxHint", label: "没有" },
  { source: "hasPlan", target: "confirmPlan", label: "有" },
  { source: "confirmPlan", target: "userConfirm" },
  { source: "userConfirm", target: "cancelSync", label: "取消" },
  { source: "userConfirm", target: "startRun", label: "确认" },
  { source: "startRun", target: "runLog", label: "订阅并呈现" },
];

const SYNC_ENTRY_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  syncTrigger: createInsight(
    "运行页里的同步按钮是这条链路的真正起点。",
    [],
    ["处理：扫描 intake 待处理项"],
    ["运行页顶部同步按钮"],
    ["web/client/src/pages/runs/index.ts"],
  ),
  intakeScan: createInsight(
    "同步入口先统一读取 intake scan，决定是直接结束、先去审查，还是可以继续启动同步。",
    ["触发：用户点击同步"],
    ["输入：raw / inbox 中待处理原料"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  intakeItems: createInsight(
    "这里代表本轮真正被同步入口检查的待处理原料集合。",
    ["处理：扫描 intake 待处理项"],
    ["判断：是否检测到待处理原料"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  hasItems: createInsight(
    "如果没有待处理原料，流程会在这里直接停止，不会进入后端 sync run。",
    ["输入：raw / inbox 中待处理原料"],
    ["结果：运行页提示“未检测到新源料”", "输入：本轮可批量录入计划"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  noItems: createInsight(
    "这是“没有新源料”时用户在运行页立刻看到的提示结果。",
    ["判断：是否检测到待处理原料"],
    [],
    ["运行页状态文案"],
    ["web/client/src/pages/runs/index.ts"],
  ),
  batchPlan: createInsight(
    "有待处理原料时，会继续检查这批原料里是否已经形成可批量录入的计划。",
    ["判断：是否检测到待处理原料"],
    ["判断：是否已有批量录入计划"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  hasPlan: createInsight(
    "没有批量录入计划时，当前同步入口会把用户导回审查页处理 inbox，而不是直接启动同步。",
    ["输入：本轮可批量录入计划"],
    ["结果：提示先去审查页处理 inbox", "处理：展示同步编译方案"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  inboxHint: createInsight(
    "这是“先去审查页处理 inbox”的用户可见结果。",
    ["判断：是否已有批量录入计划"],
    [],
    ["运行页状态文案"],
    ["web/client/src/pages/runs/index.ts"],
  ),
  confirmPlan: createInsight(
    "只有当同步方案已经可生成时，页面才会弹出确认弹窗给用户最后决定。",
    ["判断：是否已有批量录入计划"],
    ["判断：用户是否确认同步方案"],
    ["同步编译方案弹窗"],
    ["web/client/src/pages/runs/index.ts"],
  ),
  userConfirm: createInsight(
    "用户取消时流程到此结束；只有确认后才真正创建 sync run。",
    ["处理：展示同步编译方案"],
    ["结果：本次不启动同步", "处理：启动 sync run"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  cancelSync: createInsight(
    "用户关闭同步方案弹窗后，不会写任何运行结果，也不会启动后端同步。",
    ["判断：用户是否确认同步方案"],
    [],
    ["运行页状态文案"],
    ["web/client/src/pages/runs/index.ts"],
  ),
  startRun: createInsight(
    "这里是真正进入后端 sync run 的边界，前面的所有步骤都只是前置判断。",
    ["判断：用户是否确认同步方案"],
    ["结果：运行页实时日志"],
    [],
    ["web/client/src/pages/runs/index.ts"],
  ),
  runLog: createInsight(
    "sync run 创建成功后，运行页会持续订阅事件流，把执行进展显示成实时日志。",
    ["处理：启动 sync run"],
    [],
    ["运行页日志区域"],
    ["web/client/src/pages/runs/index.ts"],
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
    slug: "sync-entry",
    name: "同步入口",
    summary: "从运行页点击同步，到 intake 扫描、计划判断和启动 sync run 的真实分支。",
    icon: "rocket",
    sourcePaths: [
      "web/client/src/pages/runs/index.ts",
    ],
    mermaid: SYNC_ENTRY_MERMAID,
    flow: {
      nodes: [
        flowNode("sync-trigger", "trigger", "点击同步按钮", "运行页点击后进入同步前置检查。", "bindRunPage() startButton.click"),
        flowNode("sync-confirm-plan", "action", "confirmSyncPlan()", "同步入口先统一决定是 none、inbox 还是 confirm。", "confirmSyncPlan()"),
        flowNode("sync-scan", "action", "GET /api/intake/scan", "先读取 intake scan 结果。", "loadIntakeScan()"),
        flowNode("sync-branch-items", "branch", "scan.items.length 是否为 0", "没有待处理原料时直接终止同步。", "if (scan.items.length === 0)"),
        flowNode("sync-none", "action", "返回 none 并提示未检测到新源料", "写入状态文案后直接结束。", "statusNode/metaNode update"),
        flowNode("sync-branch-plan", "branch", "scan.plan.length 是否为 0", "有原料但没有批量计划时，要求先去审查页处理 inbox。", "if (scan.plan.length === 0)"),
        flowNode("sync-inbox", "action", "返回 inbox 并提示去审查页", "提示用户做亲自指导录入或优先批量录入。", "statusNode/metaNode update"),
        flowNode("sync-dialog", "action", "showIntakePlanDialog()", "把同步编译方案弹窗展示给用户确认。", "showIntakePlanDialog(root, scan.plan)"),
        flowNode("sync-branch-confirm", "branch", "用户是否确认同步编译方案", "取消则结束，确认则真正启动 sync run。", "showIntakePlanDialog() result"),
        flowNode("sync-cancel", "action", "返回 none 并结束", "用户取消方案后不启动后端任务。", "return \"none\""),
        flowNode("sync-start", "action", "POST /api/runs/sync", "请求后端创建 sync run。", "startRun(\"sync\")"),
        flowNode("sync-stream", "action", "attachRunStream()", "订阅 line/status 事件并实时刷新运行日志。", "attachRunStream()"),
      ],
      edges: [
        flowEdge("sync-trigger", "sync-confirm-plan"),
        flowEdge("sync-confirm-plan", "sync-scan"),
        flowEdge("sync-scan", "sync-branch-items"),
        flowEdge("sync-branch-items", "sync-none"),
        flowEdge("sync-branch-items", "sync-branch-plan"),
        flowEdge("sync-branch-plan", "sync-inbox"),
        flowEdge("sync-branch-plan", "sync-dialog"),
        flowEdge("sync-dialog", "sync-branch-confirm"),
        flowEdge("sync-branch-confirm", "sync-cancel"),
        flowEdge("sync-branch-confirm", "sync-start"),
        flowEdge("sync-start", "sync-stream"),
      ],
      branches: [
        flowBranch("sync-items", "是否存在待处理项", "sync-branch-items", ["sync-none", "sync-branch-plan"]),
        flowBranch("sync-plan", "是否需要先去 inbox", "sync-branch-plan", ["sync-inbox", "sync-dialog", "sync-branch-confirm", "sync-cancel", "sync-start", "sync-stream"]),
        flowBranch("sync-confirm", "用户确认方案", "sync-branch-confirm", ["sync-cancel", "sync-start"]),
      ],
    },
    sourceInsight: {
      scope: "page",
      page: {
        id: "runs",
        title: "运行页",
        routeLabel: "#/runs",
      },
      graph: {
        mermaid: SYNC_ENTRY_SOURCE_INSIGHT_MERMAID,
        nodes: SYNC_ENTRY_SOURCE_INSIGHT_NODES,
        edges: SYNC_ENTRY_SOURCE_INSIGHT_EDGES,
      },
      nodeInsights: SYNC_ENTRY_NODE_INSIGHTS,
    },
  },
];
