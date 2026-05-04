/**
 * Cross-page source-owned automation flow for the whole knowledge system.
 *
 * This overview answers one question: how do the major raw files, wiki files,
 * and workspace states actually transform into each other. Same-rule families
 * such as concepts / procedures are grouped by their parent folder, while
 * special files keep their own dedicated nodes.
 */

import type {
  CodeDerivedAutomationSeed,
  CodeDerivedSourceInsightGraphEdge,
  CodeDerivedSourceInsightGraphNode,
  CodeDerivedSourceInsightNodeInsight,
} from "./code-derived-automation-types.js";

const SOURCE_PATHS = [
  "web/server/services/flash-diary.ts",
  "web/server/services/flash-diary-memory.ts",
  "web/server/services/personal-timeline-source-refresh.ts",
  "web/server/services/personal-timeline-pending-facts.ts",
  "web/server/services/case-library.ts",
  "web/server/services/workflow-recorder.ts",
  "web/server/services/task-pool-generation-service.ts",
  "web/server/services/task-plan-service.ts",
  "web/server/services/task-plan-store.ts",
  "web/server/routes/workflow-recorder.automation-flow.ts",
  "scripts/sync-compile.mjs",
  "src/compiler/index.ts",
  "web/client/src/pages/wiki/personal-timeline.ts",
  "web/client/src/pages/wiki/personal-timeline-manual.ts",
  "web/client/src/pages/wiki/case-library.ts",
  "web/client/src/pages/wiki/about-me-profile.ts",
  "web/client/src/pages/wiki/identity-info-profile.ts",
] as const;

const GLOBAL_KNOWLEDGE_OVERVIEW_MERMAID = `
flowchart TD
    diaryTrigger{{"触发：用户保存闪念日记"}} --> diaryFile(["结果：raw/闪念日记/*.md"])
    sourceTrigger{{"触发：用户录入剪藏 / 源料"}} --> sourceFiles(["结果：raw/剪藏/* + sources_full/*"])

    diaryFile --> memoryProcess("处理：汇总近日日记，生成 Journal Memory")
    memoryProcess --> memoryFile(["结果：wiki/journal-memory.md"])
    memoryFile --> memoryView(["结果：Memory 页面显示"])

    subgraph archiveFiles["个人信息档案特殊文件"]
        historyFile["输入：wiki/个人信息档案/历史回忆.md"]
        historyView(["结果：历史回忆页面显示"])
        timelinePending(["结果：个人时间线待确认事实<br/>wiki/个人信息档案/个人时间线.md"])
        timelineFile(["结果：wiki/个人信息档案/个人时间线.md"])
        timelineView(["结果：个人时间线页面显示"])
        caseRefreshTrigger{{"触发：用户刷新案例库"}}
        caseRefreshProcess("处理：扫描日记、历史回忆和时间线的问题解决信号")
    caseLibraryIndex(["结果：wiki/专题/01-案例库/index.md"])
    caseLibraryPages(["结果：wiki/专题/01-案例库/*.md"])
        caseLibraryView(["结果：案例库页面显示"])
    workflowRecorderFile["输入：领域/<领域>/<项目>/工作日志.md"]
        workflowRecorderTrigger{{"触发：执行记录器归档出现问题信号"}}
        aboutMeFile["输入：wiki/个人信息档案/about-me.md"]
        aboutMeCompose("处理：解析 About Me 面板内容")
        aboutMeView(["结果：About Me 展示页"])
        identityFile["输入：wiki/个人信息档案/个人身份信息档案.md"]
        identityCompose("处理：把身份档案和关系总览组装成身份中心")
        identityView(["结果：个人身份信息档案展示页"])
    end

    historyFile --> historyView
    timelineTrigger{{"触发：用户刷新个人时间线来源"}} --> timelineProcess("处理：刷新来源并写入待确认事实")
    diaryFile --> timelineProcess
    historyFile --> timelineProcess
    chatRecords["输入：wiki/聊天记录/*（可配置来源）"] --> timelineProcess
    timelineProcess --> timelinePending
    timelinePending --> timelineConfirm("处理：确认 / 补充时间线事实")
    timelineConfirm --> timelineFile
    timelineFile --> timelineView
    caseRefreshTrigger --> caseRefreshProcess
    diaryFile --> caseRefreshProcess
    historyFile --> caseRefreshProcess
    timelineFile --> caseRefreshProcess
    caseRefreshProcess --> caseLibraryPages
    workflowRecorderFile --> caseLibraryView
    workflowRecorderTrigger --> caseLibraryPages
    caseLibraryPages --> caseLibraryIndex
    caseLibraryIndex --> caseLibraryView

    poolTrigger{{"触发：根据近日日记生成任务池候选"}} --> poolProcess("处理：生成候选任务并写入共享任务池")
    diaryFile --> poolProcess
    poolProcess --> taskPoolState(["结果：task plan/state.json · 共享任务池"])

    statusTrigger{{"触发：用户刷新近日状态"}} --> statusProcess("处理：生成近日状态摘要")
    diaryFile --> statusProcess
    workLog["输入：工作日志"] --> statusProcess
    taskPoolState --> statusProcess
    statusProcess --> statusFile(["结果：task plan/state.json · statusSummary"])
    statusFile --> statusView(["结果：工作台近日状态"])

    scheduleTrigger{{"触发：用户生成建议时间表"}} --> scheduleProcess("处理：结合文本、日记与任务池生成建议时间表")
    planningInput["输入：task plan 文字 / 语音输入"] --> scheduleProcess
    diaryFile --> scheduleProcess
    taskPoolState --> scheduleProcess
    scheduleProcess --> scheduleFile(["结果：task plan/state.json · 今日建议时间表"])
    scheduleFile --> scheduleView(["结果：工作台时间表"])

    syncTrigger{{"触发：同步编译 run 启动"}} --> compileInput["输入：raw/剪藏/* + sources_full/* + auto compile diary 候选"]
    sourceFiles --> compileInput
    diaryFile --> compileInput
    compileInput --> compileProcess("处理：提取概念、更新记忆、生成 wiki 页面")
    compileProcess --> concepts(["结果：wiki/concepts/*"])
    compileProcess --> procedures(["结果：wiki/procedures/*"])
    compileProcess --> navigation(["结果：wiki/导航页（Index / MOC）"])

    questionsFile["输入：wiki/journal-twelve-questions.md"] --> questionsView(["结果：闪念日记页 Twelve Questions"])
    aboutMeFile --> aboutMeCompose
    aboutMeCompose --> aboutMeView
    identityFile --> identityCompose
    crmFile["输入：wiki/crm/人际关系总览.md"] --> identityView
    crmFile --> crmView(["结果：CRM 人际关系总览页面显示"])
    crmFile --> identityCompose
    identityCompose --> identityView
`.trim();

const GLOBAL_KNOWLEDGE_OVERVIEW_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "diaryTrigger", kind: "trigger", label: "触发：用户保存闪念日记" },
  { id: "diaryFile", kind: "result", label: "结果：raw/闪念日记/*.md" },
  { id: "sourceTrigger", kind: "trigger", label: "触发：用户录入剪藏 / 源料" },
  { id: "sourceFiles", kind: "result", label: "结果：raw/剪藏/* + sources_full/*" },
  { id: "memoryProcess", kind: "process", label: "处理：汇总近日日记，生成 Journal Memory" },
  { id: "memoryFile", kind: "result", label: "结果：wiki/journal-memory.md" },
  { id: "memoryView", kind: "result", label: "结果：Memory 页面显示" },
  { id: "timelineTrigger", kind: "trigger", label: "触发：用户刷新个人时间线来源" },
  { id: "historyFile", kind: "input", label: "输入：wiki/个人信息档案/历史回忆.md" },
  { id: "historyView", kind: "result", label: "结果：历史回忆页面显示" },
  { id: "chatRecords", kind: "input", label: "输入：wiki/聊天记录/*（可配置来源）" },
  { id: "timelineProcess", kind: "process", label: "处理：刷新来源并写入待确认事实" },
  { id: "timelinePending", kind: "result", label: "结果：个人时间线待确认事实（个人时间线.md）" },
  { id: "timelineConfirm", kind: "process", label: "处理：确认 / 补充时间线事实" },
  { id: "timelineFile", kind: "result", label: "结果：wiki/个人信息档案/个人时间线.md" },
  { id: "timelineView", kind: "result", label: "结果：个人时间线页面显示" },
  { id: "caseRefreshTrigger", kind: "trigger", label: "触发：用户刷新案例库" },
  { id: "caseRefreshProcess", kind: "process", label: "处理：扫描日记、历史回忆和时间线的问题解决信号" },
  { id: "caseLibraryIndex", kind: "result", label: "结果：wiki/专题/01-案例库/index.md" },
  { id: "caseLibraryPages", kind: "result", label: "结果：wiki/专题/01-案例库/*.md" },
  { id: "caseLibraryView", kind: "result", label: "结果：案例库页面显示" },
  { id: "workflowRecorderFile", kind: "input", label: "输入：领域/<领域>/<项目>/工作日志.md" },
  { id: "workflowRecorderTrigger", kind: "trigger", label: "触发：执行记录器归档出现问题信号" },
  { id: "poolTrigger", kind: "trigger", label: "触发：根据近日日记生成任务池候选" },
  { id: "poolProcess", kind: "process", label: "处理：生成候选任务并写入共享任务池" },
  { id: "taskPoolState", kind: "result", label: "结果：task plan/state.json · 共享任务池" },
  { id: "statusTrigger", kind: "trigger", label: "触发：用户刷新近日状态" },
  { id: "workLog", kind: "input", label: "输入：工作日志" },
  { id: "statusProcess", kind: "process", label: "处理：生成近日状态摘要" },
  { id: "statusFile", kind: "result", label: "结果：task plan/state.json · statusSummary" },
  { id: "statusView", kind: "result", label: "结果：工作台近日状态" },
  { id: "scheduleTrigger", kind: "trigger", label: "触发：用户生成建议时间表" },
  { id: "planningInput", kind: "input", label: "输入：task plan 文字 / 语音输入" },
  { id: "scheduleProcess", kind: "process", label: "处理：结合文本、日记与任务池生成建议时间表" },
  { id: "scheduleFile", kind: "result", label: "结果：task plan/state.json · 今日建议时间表" },
  { id: "scheduleView", kind: "result", label: "结果：工作台时间表" },
  { id: "syncTrigger", kind: "trigger", label: "触发：同步编译 run 启动" },
  { id: "compileInput", kind: "input", label: "输入：raw/剪藏/* + sources_full/* + auto compile diary 候选" },
  { id: "compileProcess", kind: "process", label: "处理：提取概念、更新记忆、生成 wiki 页面" },
  { id: "concepts", kind: "result", label: "结果：wiki/concepts/*" },
  { id: "procedures", kind: "result", label: "结果：wiki/procedures/*" },
  { id: "navigation", kind: "result", label: "结果：wiki/导航页（Index / MOC）" },
  { id: "questionsFile", kind: "input", label: "输入：wiki/journal-twelve-questions.md" },
  { id: "questionsView", kind: "result", label: "结果：闪念日记页 Twelve Questions" },
  { id: "aboutMeFile", kind: "input", label: "输入：wiki/个人信息档案/about-me.md" },
  { id: "aboutMeCompose", kind: "process", label: "处理：解析 About Me 面板内容" },
  { id: "aboutMeView", kind: "result", label: "结果：About Me 展示页" },
  { id: "identityFile", kind: "input", label: "输入：wiki/个人信息档案/个人身份信息档案.md" },
  { id: "identityCompose", kind: "process", label: "处理：把身份档案和关系总览组装成身份中心" },
  { id: "crmFile", kind: "input", label: "输入：wiki/crm/人际关系总览.md" },
  { id: "crmView", kind: "result", label: "结果：CRM 人际关系总览页面显示" },
  { id: "identityView", kind: "result", label: "结果：个人身份信息档案展示页" },
];

const GLOBAL_KNOWLEDGE_OVERVIEW_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "diaryTrigger", target: "diaryFile", label: "写入" },
  { source: "sourceTrigger", target: "sourceFiles", label: "写入" },
  { source: "diaryFile", target: "memoryProcess", label: "近日日记输入" },
  { source: "memoryProcess", target: "memoryFile", label: "写回" },
  { source: "memoryFile", target: "memoryView", label: "渲染" },
  { source: "timelineTrigger", target: "timelineProcess" },
  { source: "diaryFile", target: "timelineProcess", label: "来源之一" },
  { source: "historyFile", target: "historyView", label: "直接展示" },
  { source: "historyFile", target: "timelineProcess", label: "来源之一" },
  { source: "chatRecords", target: "timelineProcess", label: "来源之一" },
  { source: "timelineProcess", target: "timelinePending", label: "写入" },
  { source: "timelinePending", target: "timelineConfirm" },
  { source: "timelineConfirm", target: "timelineFile", label: "确认写入" },
  { source: "timelineFile", target: "timelineView", label: "渲染" },
  { source: "caseRefreshTrigger", target: "caseRefreshProcess" },
  { source: "diaryFile", target: "caseRefreshProcess", label: "来源之一" },
  { source: "historyFile", target: "caseRefreshProcess", label: "来源之一" },
  { source: "timelineFile", target: "caseRefreshProcess", label: "来源之一" },
  { source: "caseRefreshProcess", target: "caseLibraryPages", label: "写入案例事实层" },
  { source: "workflowRecorderFile", target: "caseLibraryView", label: "规则说明" },
  { source: "workflowRecorderTrigger", target: "caseLibraryPages", label: "生成案例候选" },
  { source: "caseLibraryPages", target: "caseLibraryIndex", label: "重建索引" },
  { source: "caseLibraryIndex", target: "caseLibraryView", label: "渲染" },
  { source: "poolTrigger", target: "poolProcess" },
  { source: "diaryFile", target: "poolProcess", label: "新日记输入" },
  { source: "poolProcess", target: "taskPoolState", label: "写回" },
  { source: "statusTrigger", target: "statusProcess" },
  { source: "diaryFile", target: "statusProcess", label: "日记上下文" },
  { source: "workLog", target: "statusProcess" },
  { source: "taskPoolState", target: "statusProcess" },
  { source: "statusProcess", target: "statusFile", label: "写回" },
  { source: "statusFile", target: "statusView", label: "渲染" },
  { source: "scheduleTrigger", target: "scheduleProcess" },
  { source: "planningInput", target: "scheduleProcess" },
  { source: "diaryFile", target: "scheduleProcess", label: "近日日记上下文" },
  { source: "taskPoolState", target: "scheduleProcess" },
  { source: "scheduleProcess", target: "scheduleFile", label: "写回" },
  { source: "scheduleFile", target: "scheduleView", label: "渲染" },
  { source: "syncTrigger", target: "compileInput" },
  { source: "sourceFiles", target: "compileInput", label: "源料输入" },
  { source: "diaryFile", target: "compileInput", label: "auto compile 候选" },
  { source: "compileInput", target: "compileProcess" },
  { source: "compileProcess", target: "concepts" },
  { source: "compileProcess", target: "procedures" },
  { source: "compileProcess", target: "navigation" },
  { source: "questionsFile", target: "questionsView", label: "渲染" },
  { source: "aboutMeFile", target: "aboutMeCompose", label: "解析" },
  { source: "aboutMeCompose", target: "aboutMeView", label: "渲染" },
  { source: "identityFile", target: "identityCompose", label: "主档案" },
  { source: "crmFile", target: "crmView", label: "直接展示" },
  { source: "crmFile", target: "identityCompose", label: "关系总览" },
  { source: "identityCompose", target: "identityView", label: "组合渲染" },
];

function createInsight(
  summary: string,
  upstream: string[],
  downstream: string[],
  shownIn: string[],
  missingLinks: CodeDerivedSourceInsightNodeInsight["missingLinks"] = [],
): CodeDerivedSourceInsightNodeInsight {
  return {
    summary,
    upstream,
    downstream,
    shownIn,
    sourcePaths: [...SOURCE_PATHS],
    missingLinks,
  };
}

const GLOBAL_KNOWLEDGE_OVERVIEW_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  diaryFile: createInsight("闪念日记是整个系统里最强的共同上游之一，会同时喂给 Memory、时间线、任务池、近日状态、建议时间表和 auto compile。", ["触发：用户保存闪念日记"], ["处理：汇总近日日记，生成 Journal Memory", "处理：刷新来源并写入待确认事实", "处理：生成候选任务并写入共享任务池", "处理：生成近日状态摘要", "处理：结合文本、日记与任务池生成建议时间表", "输入：raw/剪藏/* + sources_full/* + auto compile diary 候选"], ["raw/闪念日记/*.md"]),
  sourceFiles: createInsight("剪藏和源料库文件会在同步编译时进入 compile 输入。", ["触发：用户录入剪藏 / 源料"], ["输入：raw/剪藏/* + sources_full/* + auto compile diary 候选"], ["raw/剪藏/* / sources_full/*"]),
  memoryProcess: createInsight("Memory 刷新会把最近几天的日记压缩成一份更稳定的短期记忆摘要。", ["结果：raw/闪念日记/*.md"], ["结果：wiki/journal-memory.md"], ["Journal Memory 刷新过程"]),
  memoryFile: createInsight("Journal Memory 是由近日日记汇总生成的特殊 wiki 文件，不属于 concepts/procedures 这类 compile 家族。", ["处理：汇总近日日记，生成 Journal Memory"], ["结果：Memory 页面显示"], ["wiki/journal-memory.md", "闪念日记页 Memory 视图"], [{ to: "结果：wiki/个人信息档案/个人时间线.md", statusNote: "当前源码里个人时间线来源刷新直接读取日记、历史回忆和可配置来源，不读取 journal-memory.md。" }]),
  memoryView: createInsight("Memory 页面展示的是当前 journal-memory.md 的内容，不代表它自动喂给个人时间线或近日状态。", ["结果：wiki/journal-memory.md"], [], ["闪念日记页 Memory 视图"]),
  timelineTrigger: createInsight("刷新个人时间线来源时，系统会重新扫描日记、历史回忆和可配置来源。", [], ["处理：刷新来源并写入待确认事实"], ["个人时间线页刷新按钮"]),
  timelineProcess: createInsight("时间线来源刷新会把日记、历史回忆和可配置聊天记录来源转换成待确认事实。", ["触发：用户刷新个人时间线来源", "结果：raw/闪念日记/*.md", "输入：wiki/个人信息档案/历史回忆.md", "输入：wiki/聊天记录/*（可配置来源）"], ["结果：个人时间线待确认事实（个人时间线.md）"], ["个人时间线页刷新结果"]),
  timelinePending: createInsight("待确认事实和正式时间线共用同一个 wiki/个人信息档案/个人时间线.md，只是分不同 section。", ["处理：刷新来源并写入待确认事实"], ["处理：确认 / 补充时间线事实"], ["wiki/个人信息档案/个人时间线.md"]),
  timelineConfirm: createInsight("待确认事实需要人工确认或补充后，才会沉淀成正式时间线。", ["结果：个人时间线待确认事实（个人时间线.md）"], ["结果：wiki/个人信息档案/个人时间线.md"], ["个人时间线页待确认事实区"]),
  timelineFile: createInsight("正式写入后的个人时间线事实页面。", ["处理：确认 / 补充时间线事实"], ["结果：个人时间线页面显示"], ["个人时间线页"]),
  timelineView: createInsight("个人时间线页面显示的是已确认时间线，不是 Journal Memory 的直接镜像。", ["结果：wiki/个人信息档案/个人时间线.md"], [], ["个人时间线页"]),
  caseRefreshTrigger: createInsight("案例库刷新由案例库索引页触发，会检查已配置的个人来源是否出现新的问题解决案例。", [], ["处理：扫描日记、历史回忆和时间线的问题解决信号"], ["案例库索引页刷新按钮"]),
  caseRefreshProcess: createInsight("案例库刷新会读取日记、历史回忆和个人时间线，按失败、卡住、解决等信号生成候选案例事实层。", ["结果：raw/闪念日记/*.md", "输入：wiki/个人信息档案/历史回忆.md", "结果：wiki/个人信息档案/个人时间线.md"], ["结果：wiki/专题/01-案例库/*.md"], ["案例库刷新接口"]),
  caseLibraryPages: createInsight("案例详情页只自动写事实层，判断层保持待沉淀，避免把未经复盘的方法直接写成规则。", ["处理：扫描日记、历史回忆和时间线的问题解决信号", "触发：执行记录器归档出现问题信号"], ["结果：wiki/专题/01-案例库/index.md"], ["wiki/专题/01-案例库/*.md"]),
  caseLibraryIndex: createInsight("案例库索引由案例详情页重建，按案例状态和来源汇总当前案例。", ["结果：wiki/专题/01-案例库/*.md"], ["结果：案例库页面显示"], ["wiki/专题/01-案例库/index.md"]),
  caseLibraryView: createInsight("案例库页面展示案例索引和维护动作；工作日志页承接执行记录器的事件时间线。", ["结果：wiki/专题/01-案例库/index.md", "输入：领域/<领域>/<项目>/工作日志.md"], [], ["案例库页面", "项目工作日志页面"]),
  workflowRecorderFile: createInsight("项目工作日志按时间线记录领域、项目、任务、行动和 Workflow Event。", [], ["结果：案例库页面显示"], ["领域/<领域>/<项目>/工作日志.md"]),
  workflowRecorderTrigger: createInsight("执行记录器归档到任务行动时，如果正文出现失败、卡住、解决等问题信号，会额外调用案例库写入候选案例。", [], ["结果：wiki/专题/01-案例库/*.md"], ["执行记录器归档流程"]),
  poolTrigger: createInsight("任务池候选刷新会把近日日记里显式或隐含的待办抽出来。", [], ["处理：生成候选任务并写入共享任务池"], ["工作台任务池刷新动作"]),
  poolProcess: createInsight("任务池生成过程会把日记里的动作线索整理成共享任务池里的任务项。", ["结果：raw/闪念日记/*.md"], ["结果：task plan/state.json · 共享任务池"], ["工作台任务池生成过程"]),
  taskPoolState: createInsight("共享任务池的主事实源保存在 task plan/state.json。", ["处理：生成候选任务并写入共享任务池"], ["处理：生成近日状态摘要", "处理：结合文本、日记与任务池生成建议时间表"], ["工作台任务池"]),
  statusTrigger: createInsight("近日状态刷新会重新聚合今天最重要的上下文。", [], ["处理：生成近日状态摘要"], ["工作台近日状态刷新动作"]),
  workLog: createInsight("工作日志是近日状态的独立输入之一，不经过 Journal Memory。", [], ["处理：生成近日状态摘要"], ["工作日志 / 运行日志"]),
  statusProcess: createInsight("近日状态不是从 Memory 继续推出来的，而是直接重新汇总日记、工作日志和任务池。", ["结果：raw/闪念日记/*.md", "输入：工作日志", "结果：task plan/state.json · 共享任务池"], ["结果：task plan/state.json · statusSummary"], ["工作台近日状态刷新过程"]),
  statusFile: createInsight("近日状态摘要写回 task plan/state.json 的 statusSummary 字段。", ["处理：生成近日状态摘要"], ["结果：工作台近日状态"], ["工作台近日状态"]),
  statusView: createInsight("工作台里的近日状态就是 statusSummary 的直接渲染结果。", ["结果：task plan/state.json · statusSummary"], [], ["工作台近日状态"]),
  scheduleTrigger: createInsight("建议时间表生成会在你主动要求排程时触发。", [], ["处理：结合文本、日记与任务池生成建议时间表"], ["工作台时间表生成动作"]),
  planningInput: createInsight("建议时间表除了读日记和任务池，还会读你当下输入的目标、限制和语音记录。", [], ["处理：结合文本、日记与任务池生成建议时间表"], ["task plan 输入区"]),
  scheduleProcess: createInsight("建议时间表会把文字/语音输入、近日日记上下文和任务池合并成一份当天排程建议。", ["输入：task plan 文字 / 语音输入", "结果：raw/闪念日记/*.md", "结果：task plan/state.json · 共享任务池"], ["结果：task plan/state.json · 今日建议时间表"], ["工作台时间表生成过程"]),
  scheduleFile: createInsight("建议时间表也写在 task plan/state.json 里，和任务池、statusSummary 共用同一状态文件。", ["处理：结合文本、日记与任务池生成建议时间表"], ["结果：工作台时间表"], ["工作台时间表"]),
  scheduleView: createInsight("工作台时间表展示的就是今日建议时间表结果。", ["结果：task plan/state.json · 今日建议时间表"], [], ["工作台时间表"]),
  syncTrigger: createInsight("同步编译 run 启动后，系统会把源料和符合规则的 diary 候选统一送进 compile。", [], ["输入：raw/剪藏/* + sources_full/* + auto compile diary 候选"], ["运行页同步 / compile 总览"]),
  compileInput: createInsight("compile 输入是一组混合源：剪藏、源料库，以及命中 auto compile 条件的 diary 候选。", ["结果：raw/剪藏/* + sources_full/*", "结果：raw/闪念日记/*.md"], ["处理：提取概念、更新记忆、生成 wiki 页面"], ["compile batch 输入"]),
  compileProcess: createInsight("compile 会把源料和 diary 候选统一转换成 wiki 家族页面，并把来源证据保存在 claims。", ["输入：raw/剪藏/* + sources_full/* + auto compile diary 候选"], ["结果：wiki/concepts/*", "结果：wiki/procedures/*", "结果：wiki/导航页（Index / MOC）"], ["compile staging / live wiki"]),
  concepts: createInsight("同质知识页统一按 concepts 父级节点展示。", ["处理：提取概念、更新记忆、生成 wiki 页面"], [], ["wiki/concepts/*"]),
  procedures: createInsight("流程类知识页统一按 procedures 父级节点展示。", ["处理：提取概念、更新记忆、生成 wiki 页面"], [], ["wiki/procedures/*"]),
  navigation: createInsight("Index / MOC 这类导航页是 compile 特殊产物，规则不同于 concepts/procedures。", ["处理：提取概念、更新记忆、生成 wiki 页面"], [], ["wiki/index.md / wiki/MOC.md"]),
  historyFile: createInsight("历史回忆页是人工维护的特殊来源文件，既直接显示，也会作为时间线来源之一。", [], ["结果：历史回忆页面显示", "处理：刷新来源并写入待确认事实"], ["wiki/个人信息档案/历史回忆.md"]),
  historyView: createInsight("历史回忆是独立特殊页，不属于 compile 家族，也不会自动汇总成 About Me。", ["输入：wiki/个人信息档案/历史回忆.md"], [], ["历史回忆页面"]),
  chatRecords: createInsight("聊天记录目录不会自动进入时间线，只有被配置成时间线来源时才参与刷新。", [], ["处理：刷新来源并写入待确认事实"], ["wiki/聊天记录/*"], [{ to: "结果：wiki/个人信息档案/个人时间线.md", statusNote: "只有在个人时间线页里把聊天记录路径加入来源配置后，聊天记录才会被时间线刷新消费。" }]),
  questionsFile: createInsight("Journal Twelve Questions 是闪念日记页直接读取的特殊 wiki 文件。", [], ["结果：闪念日记页 Twelve Questions"], ["wiki/journal-twelve-questions.md", "闪念日记页"]),
  questionsView: createInsight("闪念日记页里的 Twelve Questions 来自固定 wiki 文件，不经过 compile。", ["输入：wiki/journal-twelve-questions.md"], [], ["闪念日记页 Twelve Questions"]),
  aboutMeFile: createInsight("About Me 是人工维护的个人展示事实源。", [], ["结果：About Me 展示页"], ["wiki/个人信息档案/about-me.md"]),
  aboutMeCompose: createInsight("About Me 页面会先解析 Markdown 里的资料区块，再拼成展示面板。", ["输入：wiki/个人信息档案/about-me.md"], ["结果：About Me 展示页"], ["About Me 资料面板"]),
  aboutMeView: createInsight("About Me 展示页直接渲染 about-me.md 的内容。", ["输入：wiki/个人信息档案/about-me.md"], [], ["About Me 页面"]),
  identityFile: createInsight("个人身份信息档案是独立的特殊 wiki 文件，专门驱动身份信息中心。", [], ["结果：个人身份信息档案展示页"], ["wiki/个人信息档案/个人身份信息档案.md"]),
  identityCompose: createInsight("身份中心不是直接渲染单一文件，而是把身份档案正文和 CRM 关系总览组合到一起。", ["输入：wiki/个人信息档案/个人身份信息档案.md", "输入：wiki/crm/人际关系总览.md"], ["结果：个人身份信息档案展示页"], ["身份中心组装过程"]),
  crmFile: createInsight("CRM 人际关系总览既能直接作为 wiki 页显示，也会参与身份中心里的关系图谱。", [], ["结果：CRM 人际关系总览页面显示", "处理：把身份档案和关系总览组装成身份中心"], ["wiki/crm/人际关系总览.md"]),
  crmView: createInsight("CRM 人际关系总览有自己的直接页面，不只是身份中心的附属数据。", ["输入：wiki/crm/人际关系总览.md"], [], ["CRM 人际关系总览页面"]),
  identityView: createInsight("身份信息中心会合并身份档案正文和 CRM 关系总览一起展示。", ["输入：wiki/个人信息档案/个人身份信息档案.md", "输入：wiki/crm/人际关系总览.md"], [], ["个人身份信息档案页面"]),
};

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "global-knowledge-overview",
    name: "全局知识流转总览",
    summary: "从 raw 日记、剪藏、个人信息档案和工作台状态出发，展示这些特殊文件与 wiki 家族页面如何相互流通和转换。",
    icon: "git-compare-arrows",
    sourceKind: "information",
    sourcePaths: [...SOURCE_PATHS],
    mermaid: GLOBAL_KNOWLEDGE_OVERVIEW_MERMAID,
    flow: {
      nodes: [
        { id: "global-overview-trigger", type: "trigger", title: "打开全局知识流转总览", description: "查看跨页统一链路图。", modelMode: "default" },
        { id: "global-overview-view", type: "action", title: "渲染统一链路图", description: "把特殊文件、目录级家族和工作台状态放进同一张图。", modelMode: "default" },
      ],
      edges: [
        { id: "edge-global-overview", source: "global-overview-trigger", target: "global-overview-view" },
      ],
      branches: [],
    },
    sourceInsight: {
      scope: "cross-page",
      page: {
        id: "global-knowledge-overview",
        title: "全局知识流转总览",
        routeLabel: "跨页总览",
      },
      graph: {
        mermaid: GLOBAL_KNOWLEDGE_OVERVIEW_MERMAID,
        nodes: GLOBAL_KNOWLEDGE_OVERVIEW_NODES,
        edges: GLOBAL_KNOWLEDGE_OVERVIEW_EDGES,
      },
      nodeInsights: GLOBAL_KNOWLEDGE_OVERVIEW_NODE_INSIGHTS,
    },
  },
];
