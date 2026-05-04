// fallow-ignore-file duplicate-export

/**
 * Source-owned automation flow for the workflow recorder.
 *
 * This seed describes the current execution-record entry path: the desktop
 * shortcut opens a lightweight recorder, the submitted note is normalized by
 * the workflow-recorder service, and the result is filed into a task workflow
 * log or the pending archive queue with optional case-library extraction.
 */

import type {
  CodeDerivedAutomationSeed,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "../services/code-derived-automation-types.js";
import {
  flowBranch,
  flowEdge,
  flowNode,
} from "../services/code-derived-automation-builders.js";

const WORKFLOW_RECORDER_SOURCE_PATHS = [
  "desktop-webui/src/main.ts",
  "desktop-webui/src/workflow-recorder-capture.ts",
  "web/server/routes/workflow-recorder.ts",
  "web/server/services/workflow-recorder.ts",
  "web/server/services/project-work-log.ts",
  "web/server/services/case-library.ts",
  "web/server/services/task-plan-store.ts",
] as const;

const WORKFLOW_RECORDER_MERMAID = `
flowchart TD
    A1["A1 执行记录器输入"] --> B1["B1 记录清洗"]
    B1 --> C1["C1 AI 解析事件"]
    C1 --> D1["D1 匹配任务卡"]
    D1 --> E1{"E1 置信度判断"}
    E1 -->|高| F1["F1 写入任务行动"]
    E1 -->|中| G1["G1 待确认"]
    E1 -->|低| H1["H1 待归档"]
    F1 --> N1["N1 写入工作日志"]
    N1 --> I1["I1 更新当前进度"]
    I1 --> J1["J1 问题信号检测"]
    J1 -->|是| K1["K1 生成案例候选"]
    J1 --> L1["L1 链接/教程检测"]
    K1 --> L1
    L1 -->|有| M1["M1 写入资源库"]
`.trim();

const WORKFLOW_RECORDER_STANDARDS = {
  shortcut: "标准：只作为执行现场入口触发，不直接新建任务、不绕过任务池主事实源。",
  input: "标准：记录必须描述刚刚真实发生的行动、工具、输出、卡点或下一步；计划想法应回到任务池确认。",
  api: "标准：提交内容必须先进入统一 Workflow Event 形态，再由归档逻辑决定写入任务卡或待归档。",
  normalize: "标准：只清洗文本、记录类型、附件引用和来源，不改变用户原意，不替用户补造不存在的任务归属。",
  record: "标准：任务池 / 任务计划页仍是要做什么的主事实源；执行记录只作为实际发生的输入事件。",
  event: "标准：执行记录器和日记都先形成 Workflow Event；同一事件后续再分流到任务卡、案例、方法和工具候选。",
  rank: "标准：优先匹配当前正式任务，其次参考任务标题、项目、领域和近期上下文；备选任务未确认前不作为默认归档目标。",
  confidence: "标准：高置信度才能自动写入任务卡；中低置信度必须进入待确认或待归档，不能强行绑定。",
  archive: "标准：任务卡 workflowLog 绑定行动层，记录一个个行动如何推进任务完成。",
  workLog: "标准：工作日志按项目时间线写入领域、项目、任务、行动和 Workflow Event，供人直接阅读。",
  confirm: "标准：出现候选任务但置信度不足时进入待确认队列，必须由用户确认后才能写入正式任务卡。",
  inbox: "标准：无法确认领域、项目或任务时只进入待归档队列，等待用户选择归属后再写任务卡。",
  caseBranch: "标准：只有出现失败、卡住、报错、解决、换工具等问题解决信号时，才生成案例候选。",
  case: "标准：案例库只沉淀任务执行中的问题和解决过程，不复制完整任务卡，也不记录普通行动流水。",
    resourceBranch: "标准：只有记录里出现工具、网站、链接、教程或验证线索，才进入方法库或工具箱待验证候选。",
  resource: "标准：工具箱候选只记录任务中实际用过的网站、App、教程和链接，不替代任务日志。",
    validation: "标准：当记录包含按教程验证、部分正确、部分错误等信息时，先写入方法库待验证候选。",
  methodBranch: "标准：方法候选必须至少有 workflowLog，并优先结合案例或资料验证证据。",
    method: "标准：方法草稿先进方法库待验证，不能把一次普通行动直接当成稳定方法。",
  archivedResult: "标准：返回结果必须明确说明已写入哪个任务的工作流日志，方便用户从停点继续。",
  pendingResult: "标准：返回结果必须明确说明仍待确认或待归档，避免用户误以为记录已经进入正式任务卡。",
} as const;

const WORKFLOW_RECORDER_GRAPH_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "A1", kind: "trigger", label: "A1 执行记录器输入" },
  { id: "B1", kind: "process", label: "B1 记录清洗" },
  { id: "C1", kind: "process", label: "C1 AI 解析事件" },
  { id: "D1", kind: "process", label: "D1 匹配任务卡" },
  { id: "E1", kind: "decision", label: "E1 置信度判断" },
  { id: "F1", kind: "result", label: "F1 写入任务行动" },
  { id: "G1", kind: "result", label: "G1 待确认" },
  { id: "H1", kind: "result", label: "H1 待归档" },
  { id: "I1", kind: "process", label: "I1 更新当前进度" },
  { id: "J1", kind: "decision", label: "J1 问题信号检测" },
  { id: "K1", kind: "result", label: "K1 生成案例候选" },
  { id: "L1", kind: "decision", label: "L1 链接/教程检测" },
  { id: "M1", kind: "result", label: "M1 写入资源库" },
  { id: "N1", kind: "result", label: "N1 写入工作日志" },
];

const WORKFLOW_RECORDER_GRAPH_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "A1", target: "B1" },
  { source: "B1", target: "C1" },
  { source: "C1", target: "D1" },
  { source: "D1", target: "E1" },
  { source: "E1", target: "F1", label: "高" },
  { source: "E1", target: "G1", label: "中" },
  { source: "E1", target: "H1", label: "低" },
  { source: "F1", target: "N1" },
  { source: "N1", target: "I1" },
  { source: "I1", target: "J1" },
  { source: "J1", target: "K1", label: "是" },
  { source: "J1", target: "L1" },
  { source: "K1", target: "L1" },
  { source: "L1", target: "M1", label: "有" },
];

function specInsight(
  summary: string,
  rows: Array<{ label: string; value: string }>,
  upstream: string[],
  downstream: string[],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn: ["执行记录器归档流程设计"],
    sourcePaths: [...WORKFLOW_RECORDER_SOURCE_PATHS],
    missingLinks: [],
    specRows: rows,
  };
}

const WORKFLOW_RECORDER_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  A1: specInsight("接收用户的现场执行记录。", [
    { label: "作用", value: "接收执行现场的文本、图片、链接或附件。" },
    { label: "输入", value: "text / image / link / attachment" },
    { label: "输出", value: "原始执行记录" },
    { label: "标准", value: "只作为现场入口，不直接新建任务，不绕过任务池主事实源。" },
    { label: "Prompt摘要", value: "无 AI 解析，只保留原始输入。" },
  ], [], ["B1 记录清洗"]),
  B1: specInsight("把原始输入整理成统一记录。", [
    { label: "作用", value: "抽取 text、links、attachments、source。" },
    { label: "输入", value: "原始执行记录" },
    { label: "输出", value: "清洗后记录" },
    { label: "标准", value: "原始文本必须保留，不改变用户原意。" },
    { label: "Prompt摘要", value: "无 prompt，只做结构清洗。" },
  ], ["A1 执行记录器输入"], ["C1 AI 解析事件"]),
  C1: specInsight("把记录解析成 Workflow Event Candidate。", [
    { label: "作用", value: "提取过程、卡点、解决、下一步。" },
    { label: "输入", value: "清洗后记录" },
    { label: "输出", value: "Workflow Event Candidate" },
    { label: "标准", value: "不臆造任务，不直接当方法。" },
    { label: "Prompt摘要", value: "提取 record_type、task、problem、solution、next_step。" },
  ], ["B1 记录清洗"], ["D1 匹配任务卡"]),
  D1: specInsight("用事件候选匹配任务池中的任务卡。", [
    { label: "作用", value: "按任务标题、领域、项目、上下文打分。" },
    { label: "输入", value: "Workflow Event Candidate + 任务池" },
    { label: "输出", value: "任务匹配结果" },
    { label: "标准", value: "正式任务优先，备选任务未确认前不默认归档。" },
    { label: "Prompt摘要", value: "判断属于哪个领域、项目、任务。" },
  ], ["C1 AI 解析事件"], ["E1 置信度判断"]),
  E1: specInsight("决定自动写入还是等待用户确认。", [
    { label: "作用", value: "按匹配分数分成高 / 中 / 低置信度。" },
    { label: "输入", value: "任务匹配结果" },
    { label: "输出", value: "高置信度 / 中置信度 / 低置信度" },
    { label: "标准", value: "只有高置信度可自动写入任务卡。" },
    { label: "Prompt摘要", value: "置信度来自标题、项目、领域和近期上下文。" },
  ], ["D1 匹配任务卡"], ["F1 写入任务行动", "G1 待确认", "H1 待归档"]),
  F1: specInsight("把事件写入任务卡的行动记录。", [
    { label: "作用", value: "把一次行动写入任务卡 workflowLog。" },
    { label: "输入", value: "高置信度事件" },
    { label: "输出", value: "任务行动记录" },
    { label: "标准", value: "任务卡记录一个个行动如何完成任务。" },
    { label: "Prompt摘要", value: "无新增 prompt，使用事件结构落盘。" },
  ], ["E1 置信度判断"], ["N1 写入工作日志"]),
  N1: specInsight("把同一事件写入项目工作日志页面。", [
    { label: "作用", value: "按时间线写入领域、项目、任务、行动和 Workflow Event。" },
    { label: "输入", value: "任务行动记录 + Workflow Event" },
    { label: "输出", value: "领域/<领域>/<项目>/工作日志.md" },
    { label: "标准", value: "工作日志是给人看的项目过程页，Workflow Event 是同一条记录的机器凭证。" },
    { label: "Prompt摘要", value: "无新增 prompt，使用已解析事件落盘。" },
  ], ["F1 写入任务行动"], ["I1 更新当前进度"]),
  G1: specInsight("把中置信度事件交给用户确认。", [
    { label: "作用", value: "展示候选任务，由用户选择是否归档。" },
    { label: "输入", value: "中置信度事件" },
    { label: "输出", value: "待确认队列" },
    { label: "标准", value: "用户确认前不能写入正式任务卡。" },
    { label: "Prompt摘要", value: "无新增 prompt。" },
  ], ["E1 置信度判断"], []),
  H1: specInsight("暂存无法归属的记录。", [
    { label: "作用", value: "保存到待归档队列。" },
    { label: "输入", value: "低置信度事件" },
    { label: "输出", value: "待归档队列" },
    { label: "标准", value: "不能强行绑定任务。" },
    { label: "Prompt摘要", value: "无新增 prompt。" },
  ], ["E1 置信度判断"], []),
  I1: specInsight("同步任务卡摘要状态。", [
    { label: "作用", value: "更新 currentProgress、lastStop、nextStep。" },
    { label: "输入", value: "任务卡 workflowLog" },
    { label: "输出", value: "可继续执行的任务卡状态" },
    { label: "标准", value: "下次打开任务能知道停在哪。" },
    { label: "Prompt摘要", value: "从事件中提取当前进度和下一步。" },
  ], ["N1 写入工作日志"], ["J1 问题信号检测"]),
  J1: specInsight("判断是否需要沉淀案例。", [
    { label: "作用", value: "检测失败、卡住、报错、解决、换工具。" },
    { label: "输入", value: "Workflow Event" },
    { label: "输出", value: "问题信号判断" },
    { label: "标准", value: "普通行动流水不生成案例。" },
    { label: "Prompt摘要", value: "判断 problem / solution 是否存在。" },
  ], ["I1 更新当前进度"], ["K1 生成案例候选", "L1 链接/教程检测"]),
  K1: specInsight("生成问题解决案例候选。", [
    { label: "作用", value: "把问题、解决、来源任务写成案例候选。" },
    { label: "输入", value: "有问题信号的 Workflow Event" },
    { label: "输出", value: "Case Candidate" },
    { label: "标准", value: "案例只记录问题解决过程，不复制完整任务卡。" },
    { label: "Prompt摘要", value: "提取 problem、solution、evidence。" },
  ], ["J1 问题信号检测"], ["L1 链接/教程检测"]),
  L1: specInsight("判断是否涉及外部资料。", [
    { label: "作用", value: "检测链接、教程、工具和实操验证描述。" },
    { label: "输入", value: "Workflow Event / Case Candidate" },
    { label: "输出", value: "资料验证判断" },
    { label: "标准", value: "只有真实使用过的链接或教程才进入验证。" },
    { label: "Prompt摘要", value: "识别 link、tool、tutorial、valid/invalid 部分。" },
  ], ["J1 问题信号检测", "K1 生成案例候选"], ["M1 写入资源库"]),
  M1: specInsight("记录资料、工具或方法草稿是否真实可用。", [
      { label: "作用", value: "写入方法库或工具箱待验证候选。" },
    { label: "输入", value: "链接 / 教程 / 工具验证信息" },
    { label: "输出", value: "Material Verification Record" },
    { label: "标准", value: "必须区分有效部分、错误部分和适用场景。" },
    { label: "Prompt摘要", value: "提取 source、claim、verified_result、limitation。" },
  ], ["L1 链接/教程检测"], []),
};

const WORKFLOW_RECORDER_APPENDICES = [
  {
    id: "prompt",
    title: "Prompt 附录",
    content: `你是 Workflow Event 解析助手。
从以下输入中提取结构化事件，不臆造任务，不直接当方法。
关注：过程（做了什么）/ 卡点（遇到什么问题）/ 解决（如何解决）/ 下一步（接下来做什么）。
输出 JSON，字段包括 record_type、task、problem、solution、next_step、confidence、evidence。`,
  },
  {
    id: "schema",
    title: "Schema 附录",
    content: `{
  "record_type": "process|problem|solution|next_step|other",
  "task": "任务或目标（不能臆造）",
  "problem": "卡点或问题（可为空）",
  "solution": "解决方式（可为空）",
  "next_step": "下一步行动（可为空）",
  "confidence": 0.0,
  "evidence": "关键证据片段或链接（可为空）"
}`,
  },
  {
    id: "rules",
    title: "规则附录",
    content: `1. Mermaid 只画主骨架，节点说明、prompt、schema、规则放在图外。
2. 高置信度写入任务卡；中置信度进入待确认；低置信度进入待归档。
3. 只有失败、卡住、报错、解决、换工具等信号才生成案例候选。
4. 只有真实使用过链接、教程或工具，才生成方法库或工具箱待验证候选。
5. 任何节点不得臆造任务名、方法结论或验证结果。`,
  },
] as const;

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "workflow-recorder",
    name: "执行记录器归档流程",
    summary: "从快捷键打开执行记录器，到识别任务、写入任务卡工作流日志、进入待归档队列或生成案例候选的真实流程。",
    icon: "clipboard-pen-line",
    sourceKind: "code",
    sourcePaths: [...WORKFLOW_RECORDER_SOURCE_PATHS],
    mermaid: WORKFLOW_RECORDER_MERMAID,
    flow: {
      nodes: [
        flowNode("workflow-shortcut", "trigger", "执行记录器 / 日记输入", "执行记录器和日记都可以作为 Workflow Event 来源。", "source: execution_recorder | diary", WORKFLOW_RECORDER_STANDARDS.shortcut),
        flowNode("workflow-api", "action", "POST /api/workflow-recorder/record", "把文本、记录类型和附件交给后端归档入口。", "handleWorkflowRecorderRecord()", WORKFLOW_RECORDER_STANDARDS.api),
        flowNode("workflow-normalize", "action", "normalizeRecordInput()", "清洗 text、marker、attachments 和 source。", "normalizeRecordInput(req.body)", WORKFLOW_RECORDER_STANDARDS.normalize),
        flowNode("workflow-record", "action", "recordWorkflowInput()", "读取任务池状态并创建本次工作流事件。", "recordWorkflowInput(cfg, input)", WORKFLOW_RECORDER_STANDARDS.record),
        flowNode("workflow-event", "action", "Workflow Event 事件池", "写入 .llmwiki/workflow-events.json，作为统一事件源。", "appendWorkflowEvent()", WORKFLOW_RECORDER_STANDARDS.event),
        flowNode("workflow-rank", "action", "rankTaskCandidates()", "根据任务标题、领域、项目 token 计算候选任务分数。", "rankTaskCandidates(input.text, state.pool.items)", WORKFLOW_RECORDER_STANDARDS.rank),
        flowNode("workflow-branch-confidence", "branch", "置信度分流", "高置信度归档；中置信度待确认；低置信度待归档。", "classifyConfidence(candidates)", WORKFLOW_RECORDER_STANDARDS.confidence),
        flowNode("workflow-archive", "action", "写入任务行动", "把一次执行写入任务卡 workflowLog。", "appendWorkflowLogToTask()", WORKFLOW_RECORDER_STANDARDS.archive),
        flowNode("workflow-work-log", "action", "写入项目工作日志", "把领域、项目、任务、行动和 Workflow Event 写入工作日志页。", "appendProjectWorkLog()", WORKFLOW_RECORDER_STANDARDS.workLog),
        flowNode("workflow-confirm", "action", "待确认队列", "有候选任务但不足以自动归档时等待用户确认。", "confidence: \"medium\"", WORKFLOW_RECORDER_STANDARDS.confirm),
        flowNode("workflow-inbox", "action", "写入待归档工作流记录", "无法判断归属时先进入 .llmwiki/workflow-recorder-inbox.json。", "writeInboxRecord()", WORKFLOW_RECORDER_STANDARDS.inbox),
        flowNode("workflow-branch-case", "branch", "是否出现问题信号", "卡住、失败、解决等信号会额外沉淀案例候选。", "appendCaseFromWorkflow()", WORKFLOW_RECORDER_STANDARDS.caseBranch),
        flowNode("workflow-case", "action", "生成案例库候选", "把来源任务、问题和记录正文写入案例库候选。", "appendCaseFromWorkflow()", WORKFLOW_RECORDER_STANDARDS.case),
        flowNode("workflow-resource-branch", "branch", "是否出现资源线索", "检查工具、链接、教程和验证语义。", "appendResourceCandidates()", WORKFLOW_RECORDER_STANDARDS.resourceBranch),
        flowNode("workflow-resource", "action", "生成资源与工具候选", "把工具、网站和链接写入资源候选。", "workflow-resource-candidates.json", WORKFLOW_RECORDER_STANDARDS.resource),
        flowNode("workflow-validation", "action", "生成资料验证候选", "把教程验证、部分正确或部分错误写入验证候选。", "workflow-validation-candidates.json", WORKFLOW_RECORDER_STANDARDS.validation),
        flowNode("workflow-method-branch", "branch", "是否形成方法候选", "根据 workflowLog、案例和验证证据判断方法候选。", "appendMethodCandidates()", WORKFLOW_RECORDER_STANDARDS.methodBranch),
        flowNode("workflow-method", "action", "生成方法候选", "把可复用流程候选写入方法候选。", "workflow-method-candidates.json", WORKFLOW_RECORDER_STANDARDS.method),
        flowNode("workflow-archived-result", "action", "返回已归档", "前端显示已写入任务卡工作流日志。", "status: \"archived\"", WORKFLOW_RECORDER_STANDARDS.archivedResult),
        flowNode("workflow-pending-result", "action", "返回待归档", "前端显示已放入待归档工作流记录。", "status: \"pending\"", WORKFLOW_RECORDER_STANDARDS.pendingResult),
      ],
      edges: [
        flowEdge("workflow-shortcut", "workflow-api"),
        flowEdge("workflow-api", "workflow-normalize"),
        flowEdge("workflow-normalize", "workflow-record"),
        flowEdge("workflow-record", "workflow-event"),
        flowEdge("workflow-event", "workflow-rank"),
        flowEdge("workflow-rank", "workflow-branch-confidence"),
        flowEdge("workflow-branch-confidence", "workflow-archive"),
        flowEdge("workflow-branch-confidence", "workflow-confirm"),
        flowEdge("workflow-branch-confidence", "workflow-inbox"),
        flowEdge("workflow-archive", "workflow-work-log"),
        flowEdge("workflow-work-log", "workflow-branch-case"),
        flowEdge("workflow-branch-case", "workflow-case"),
        flowEdge("workflow-branch-case", "workflow-resource-branch"),
        flowEdge("workflow-case", "workflow-resource-branch"),
        flowEdge("workflow-resource-branch", "workflow-resource"),
        flowEdge("workflow-resource-branch", "workflow-validation"),
        flowEdge("workflow-resource-branch", "workflow-method-branch"),
        flowEdge("workflow-resource", "workflow-method-branch"),
        flowEdge("workflow-validation", "workflow-method-branch"),
        flowEdge("workflow-method-branch", "workflow-method"),
        flowEdge("workflow-method-branch", "workflow-archived-result"),
        flowEdge("workflow-method", "workflow-archived-result"),
        flowEdge("workflow-confirm", "workflow-pending-result"),
        flowEdge("workflow-inbox", "workflow-pending-result"),
      ],
      branches: [
        flowBranch("workflow-confidence", "任务归属判断", "workflow-branch-confidence", ["workflow-archive", "workflow-confirm", "workflow-inbox"]),
        flowBranch("workflow-case-candidate", "案例候选判断", "workflow-branch-case", ["workflow-case", "workflow-resource-branch"]),
        flowBranch("workflow-resource-candidate", "资源验证判断", "workflow-resource-branch", ["workflow-resource", "workflow-validation", "workflow-method-branch"]),
        flowBranch("workflow-method-candidate", "方法候选判断", "workflow-method-branch", ["workflow-method", "workflow-archived-result"]),
      ],
    },
    sourceInsight: {
      scope: "cross-page",
      page: {
        id: "workflow-recorder",
        title: "执行记录器归档流程设计",
        routeLabel: "主流程图 + 节点说明 + 附录",
      },
      graph: {
        mermaid: WORKFLOW_RECORDER_MERMAID,
        nodes: WORKFLOW_RECORDER_GRAPH_NODES,
        edges: WORKFLOW_RECORDER_GRAPH_EDGES,
      },
      nodeInsights: WORKFLOW_RECORDER_NODE_INSIGHTS,
      appendices: [...WORKFLOW_RECORDER_APPENDICES],
    },
  },
];
