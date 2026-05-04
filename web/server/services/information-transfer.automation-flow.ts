/**
 * Source-owned information-transfer flow.
 *
 * This seed is the workspace-level map for how user input becomes application
 * context, how prompt and page state are read, and where generated content is
 * finally written. It is separate from source-code DAGs so the UI can expose it
 * as its own topic while still cross-labeling the applications and source flows
 * that participate in each step.
 */

import type {
  CodeDerivedAutomationSeed,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "./code-derived-automation-types.js";
import {
  flowEdge,
  flowNode,
} from "./code-derived-automation-builders.js";

const INFORMATION_TRANSFER_MERMAID = `
flowchart TD
    A["用户输入信息<br/>聊天、闪念日记、源料、Review 操作"] --> B{"进入哪个触发器"}
    B -->|应用调用| C["读取应用定义<br/>agents/agents.json workflow + prompt"]
    B -->|页面操作| D["读取当前页面状态<br/>表单、选中项、批量计划"]
    B -->|同步/编译| E["读取源料和运行状态<br/>source vault + runtime state"]
    C --> F["组装模型上下文<br/>应用流程 + prompt + 输入文本"]
    D --> F
    E --> F
    F --> G["生成内容<br/>摘要、候选项、wiki 页面、审查结果"]
    G --> H{"写入什么落点"}
    H -->|应用结果| I["返回页面<br/>聊天区 / Workflow 详情 / Review 结果"]
    H -->|知识结果| J["写入 wiki<br/>页面、索引、tiered memory"]
    H -->|运行记录| K["写入 runtime<br/>run logs、batch state、workflow records"]
    I --> L["反向标注<br/>应用流程知道使用的应用和 prompt"]
    J --> M["反向标注<br/>源码真实流程知道生成内容和落点"]
    K --> N["反向标注<br/>信息流转流程知道触发器和产物"]
`.trim();

const INFORMATION_TRANSFER_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    userInput{{"触发：用户输入信息"}} --> routeTrigger{"判断：进入哪个触发器"}
    routeTrigger -->|应用流程| appDefinition("读取：应用 workflow / prompt / model")
    routeTrigger -->|页面流程| pageState("读取：当前页面状态和用户选择")
    routeTrigger -->|源码流程| sourceState("读取：源料、运行状态和源码侧 flow")
    appDefinition --> contextBundle("处理：组装输入、页面、prompt 和应用信息")
    pageState --> contextBundle
    sourceState --> contextBundle
    contextBundle --> generatedContent(["生成：用户可见内容或知识产物"])
    generatedContent --> destinationDecision{"判断：内容应该放到哪里"}
    destinationDecision -->|页面| pageOutput(["落点：当前页面或详情图"])
    destinationDecision -->|知识库| wikiOutput(["落点：wiki 页面 / tiered memory"])
    destinationDecision -->|运行态| runtimeOutput(["落点：runtime state / run logs"])
    pageOutput --> topicLinks("标注：关联应用流程、信息流转流程、源码真实流程")
    wikiOutput --> topicLinks
    runtimeOutput --> topicLinks
`.trim();

const INFORMATION_TRANSFER_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "userInput", kind: "trigger", label: "触发：用户输入信息" },
  { id: "routeTrigger", kind: "decision", label: "判断：进入哪个触发器" },
  { id: "appDefinition", kind: "input", label: "读取：应用 workflow / prompt / model" },
  { id: "pageState", kind: "input", label: "读取：当前页面状态和用户选择" },
  { id: "sourceState", kind: "input", label: "读取：源料、运行状态和源码侧 flow" },
  { id: "contextBundle", kind: "process", label: "处理：组装输入、页面、prompt 和应用信息" },
  { id: "generatedContent", kind: "result", label: "生成：用户可见内容或知识产物" },
  { id: "destinationDecision", kind: "decision", label: "判断：内容应该放到哪里" },
  { id: "pageOutput", kind: "result", label: "落点：当前页面或详情图" },
  { id: "wikiOutput", kind: "result", label: "落点：wiki 页面 / tiered memory" },
  { id: "runtimeOutput", kind: "result", label: "落点：runtime state / run logs" },
  { id: "topicLinks", kind: "process", label: "标注：关联应用流程、信息流转流程、源码真实流程" },
];

const INFORMATION_TRANSFER_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "userInput", target: "routeTrigger" },
  { source: "routeTrigger", target: "appDefinition", label: "应用流程" },
  { source: "routeTrigger", target: "pageState", label: "页面流程" },
  { source: "routeTrigger", target: "sourceState", label: "源码流程" },
  { source: "appDefinition", target: "contextBundle" },
  { source: "pageState", target: "contextBundle" },
  { source: "sourceState", target: "contextBundle" },
  { source: "contextBundle", target: "generatedContent" },
  { source: "generatedContent", target: "destinationDecision" },
  { source: "destinationDecision", target: "pageOutput", label: "页面" },
  { source: "destinationDecision", target: "wikiOutput", label: "知识库" },
  { source: "destinationDecision", target: "runtimeOutput", label: "运行态" },
  { source: "pageOutput", target: "topicLinks" },
  { source: "wikiOutput", target: "topicLinks" },
  { source: "runtimeOutput", target: "topicLinks" },
];

const INFORMATION_TRANSFER_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  userInput: createInsight(
    "用户输入是三类专题的共同起点：它可能进入应用流程，也可能直接触发页面或源码侧流程。",
    [],
    ["判断：进入哪个触发器"],
    ["应用流程", "信息流转流程", "源码真实流程"],
    ["web/client/src/pages/automation/index.ts"],
  ),
  routeTrigger: createInsight(
    "触发器决定输入进入应用调用、页面操作还是同步/编译链路，后续专题分组也从这里分开。",
    ["触发：用户输入信息"],
    ["读取：应用 workflow / prompt / model", "读取：当前页面状态和用户选择", "读取：源料、运行状态和源码侧 flow"],
    ["信息流转流程"],
    ["web/server/services/automation-workspace.ts"],
  ),
  appDefinition: createInsight(
    "应用流程读取 agents 配置里的 workflow、prompt、provider 和 model，用来说明本次输入会调用哪个应用。",
    ["判断：进入哪个触发器"],
    ["处理：组装输入、页面、prompt 和应用信息"],
    ["应用流程"],
    ["web/server/services/app-config.ts", "web/server/services/automation-workspace.ts"],
  ),
  pageState: createInsight(
    "页面流程读取当前路由、表单、选中项、批量计划或详情图节点，决定输入属于哪个操作。",
    ["判断：进入哪个触发器"],
    ["处理：组装输入、页面、prompt 和应用信息"],
    ["源码真实流程"],
    ["web/client/src/pages/runs/automation-flow.ts", "web/client/src/pages/review/automation-flow.ts"],
  ),
  sourceState: createInsight(
    "源码流程读取源料、运行状态和人工审计后的 flow seed，给信息流转流程提供真实触发器和产物落点。",
    ["判断：进入哪个触发器"],
    ["处理：组装输入、页面、prompt 和应用信息"],
    ["源码真实流程"],
    ["web/server/services/code-derived-automations.ts", "web/server/services/compile.automation-flow.ts"],
  ),
  contextBundle: createInsight(
    "这里把输入文本、页面状态、prompt、应用模型和源码侧流程合成一次生成所需的上下文。",
    ["读取：应用 workflow / prompt / model", "读取：当前页面状态和用户选择", "读取：源料、运行状态和源码侧 flow"],
    ["生成：用户可见内容或知识产物"],
    ["应用流程", "信息流转流程"],
    ["web/server/services/automation-workspace.ts"],
  ),
  generatedContent: createInsight(
    "生成结果可以是页面内容、wiki 内容、候选项、审查结果或运行记录，不在这里提前决定落点。",
    ["处理：组装输入、页面、prompt 和应用信息"],
    ["判断：内容应该放到哪里"],
    ["信息流转流程"],
    ["web/server/services/compile.automation-flow.ts", "web/server/routes/workflow-recorder.automation-flow.ts"],
  ),
  destinationDecision: createInsight(
    "生成后按落点分成页面、知识库和运行态三类，以便三个专题都能标注最终产物。",
    ["生成：用户可见内容或知识产物"],
    ["落点：当前页面或详情图", "落点：wiki 页面 / tiered memory", "落点：runtime state / run logs"],
    ["信息流转流程"],
    ["web/server/services/automation-workspace.ts"],
  ),
  pageOutput: createInsight(
    "页面落点会回到聊天区、Workflow 详情图、Review 结果或其他用户当前正在操作的页面。",
    ["判断：内容应该放到哪里"],
    ["标注：关联应用流程、信息流转流程、源码真实流程"],
    ["应用流程", "源码真实流程"],
    ["web/client/src/pages/automation/index.ts", "web/client/src/pages/review/automation-flow.ts"],
  ),
  wikiOutput: createInsight(
    "知识库落点会写入 wiki 页面、索引或 tiered memory，供后续页面和编译结果继续读取。",
    ["判断：内容应该放到哪里"],
    ["标注：关联应用流程、信息流转流程、源码真实流程"],
    ["信息流转流程", "源码真实流程"],
    ["web/server/services/compile.automation-flow.ts"],
  ),
  runtimeOutput: createInsight(
    "运行态落点会写入 run logs、batch state 或 workflow records，用于恢复、审查和后续刷新。",
    ["判断：内容应该放到哪里"],
    ["标注：关联应用流程、信息流转流程、源码真实流程"],
    ["信息流转流程", "源码真实流程"],
    ["web/server/routes/workflow-recorder.automation-flow.ts"],
  ),
  topicLinks: createInsight(
    "三类专题在这里互通：应用流程标注使用的应用，信息流转流程标注输入到产物的路径，源码真实流程标注真实入口和写入位置。",
    ["落点：当前页面或详情图", "落点：wiki 页面 / tiered memory", "落点：runtime state / run logs"],
    [],
    ["应用流程", "信息流转流程", "源码真实流程"],
    ["web/client/src/pages/automation/index.ts", "web/client/src/pages/automation/source-insight-sidebar.ts"],
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

export const informationTransferAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "information-transfer",
    name: "信息流转流程",
    summary: "追踪输入信息在触发器、页面状态、prompt、生成内容和最终落点之间的流转。",
    icon: "git-branch",
    sourceKind: "information",
    sourcePaths: [
      "web/server/services/automation-workspace.ts",
      "web/server/services/app-config.ts",
      "web/server/services/code-derived-automations.ts",
      "web/client/src/pages/automation/index.ts",
    ],
    mermaid: INFORMATION_TRANSFER_MERMAID,
    flow: {
      nodes: [
        flowNode("info-input", "trigger", "用户输入信息", "聊天、闪念日记、源料和 Review 操作都先形成输入。", "user input"),
        flowNode("info-trigger", "branch", "进入哪个触发器", "按应用调用、页面操作、同步/编译入口分流。", "route trigger"),
        flowNode("info-app", "action", "读取应用定义", "读取 workflow、prompt、provider 和 model。", "readAppConfig()"),
        flowNode("info-page", "action", "读取页面状态", "读取表单、选中项、批量计划或详情节点。", "page state"),
        flowNode("info-source", "action", "读取源料和运行状态", "读取 source vault、runtime state 和源码侧 flow。", "listCodeDerivedAutomations()"),
        flowNode("info-context", "action", "组装模型上下文", "把输入文本、页面状态、应用 prompt 和源码流程合并成生成上下文。", "context bundle"),
        flowNode("info-generate", "action", "生成内容", "产出摘要、候选项、wiki 页面、审查结果或运行记录。", "model/app execution"),
        flowNode("info-destination", "branch", "内容应该放到哪里", "按页面、知识库和运行态三个落点分流。", "destination decision"),
        flowNode("info-page-output", "action", "返回页面", "内容进入聊天区、Workflow 详情图或 Review 结果。", "render page"),
        flowNode("info-wiki-output", "action", "写入 wiki", "内容进入 wiki 页面、索引或 tiered memory。", "publish wiki"),
        flowNode("info-runtime-output", "action", "写入 runtime", "内容进入 run logs、batch state 或 workflow records。", "write runtime"),
        flowNode("info-topic-links", "merge", "三类专题互相标注", "标注进入了什么流程、产生了什么内容、使用了什么应用。", "sourceInsight"),
      ],
      edges: [
        flowEdge("info-input", "info-trigger"),
        flowEdge("info-trigger", "info-app"),
        flowEdge("info-trigger", "info-page"),
        flowEdge("info-trigger", "info-source"),
        flowEdge("info-app", "info-context"),
        flowEdge("info-page", "info-context"),
        flowEdge("info-source", "info-context"),
        flowEdge("info-context", "info-generate"),
        flowEdge("info-generate", "info-destination"),
        flowEdge("info-destination", "info-page-output"),
        flowEdge("info-destination", "info-wiki-output"),
        flowEdge("info-destination", "info-runtime-output"),
        flowEdge("info-page-output", "info-topic-links"),
        flowEdge("info-wiki-output", "info-topic-links"),
        flowEdge("info-runtime-output", "info-topic-links"),
      ],
      branches: [],
    },
    sourceInsight: {
      scope: "cross-page",
      page: {
        id: "information-transfer",
        title: "信息流转流程",
        routeLabel: "跨专题总览",
      },
      graph: {
        mermaid: INFORMATION_TRANSFER_SOURCE_INSIGHT_MERMAID,
        nodes: INFORMATION_TRANSFER_NODES,
        edges: INFORMATION_TRANSFER_EDGES,
      },
      nodeInsights: INFORMATION_TRANSFER_INSIGHTS,
    },
  },
];
