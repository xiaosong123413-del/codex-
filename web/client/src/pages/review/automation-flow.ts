/**
 * Source-owned automation flow for the review board.
 *
 * This page-level seed turns the review board into one unified business graph:
 * how cards are loaded, which user decisions branch the flow, and how deep
 * research, confirm-write, inbox batch ingest, and chat all continue from the
 * same review queue.
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

const REVIEW_BOARD_MERMAID = `
flowchart TD
    A["打开 #/review<br/>renderReviewPage() / bindReviewPage()"] --> B["GET /api/review<br/>handleReviewSummary()"]
    B --> C["回填旧版 outdated-source<br/>backfillLegacyOutdatedSourceRepairs()"]
    C --> D["回填旧版 needs-deep-research<br/>backfillLegacyNeedsDeepResearchRepairs()"]
    D --> E["恢复 running 中的 deep research<br/>resumeRunningDeepResearchItems()"]
    E --> F["聚合审查项<br/>aggregateReviewItems()"]
    F --> G["补挂已缓存的 web suggestions<br/>attachStoredReviewWebSearchSuggestions()"]
    G --> H["渲染审查列表<br/>renderReviewItems() / renderReviewState()"]
    H --> I{"用户点了哪种动作"}
    I -->|单条推进| J["POST /api/review/deep-research/:id/actions<br/>handleDeepResearchAction()"]
    J --> K["校验 action<br/>normalizeAction()"]
    K --> L{"action = ignore ?"}
    L -->|是| M["写回 ignored 状态<br/>mutateDeepResearchItem()"]
    L -->|否| N["写回 running / progress=10<br/>mutateDeepResearchItem()"]
    N --> O{"category = missing-citation ?"}
    O -->|是| P["启动引用批处理<br/>enqueueMissingCitationBatch()"]
    O -->|否| Q["启动单条后台任务<br/>enqueueDeepResearchTask()"]
    P --> R["后台推进<br/>runMissingCitationBatch()"]
    Q --> S["后台推进<br/>runDeepResearchTask()"]
    R --> T{"后台结果"}
    S --> T
    T -->|成功| U["写回 done-await-confirm<br/>deep-research-items.json"]
    T -->|失败| V["写回 failed + errorMessage<br/>deep-research-items.json"]
    I -->|确认写入| W["POST /api/review/deep-research/:id/confirm<br/>handleDeepResearchConfirm()"]
    W --> X["读取 item 并校验状态<br/>getDeepResearchItem()"]
    X --> Y["把 draft 写回目标页<br/>applyDeepResearchDraftToTarget()"]
    Y --> Z["刷新 claim 生命周期<br/>refreshConfirmedDeepResearchClaimLifecycle()"]
    Z --> AA["写回 completed / progress=100<br/>mutateDeepResearchItem()"]
    AA --> AB["重新 GET /api/review<br/>loadReview()"]
    I -->|批量进行| AC["POST /api/review/deep-research/bulk-advance<br/>handleDeepResearchBulkAdvance()"]
    AC --> AD["扫描 pending 项<br/>bulkAdvanceDeepResearchItems()"]
    AD --> AE["批量写回 running / progress=10<br/>writeDeepResearchItems()"]
    AE --> AF["逐条 enqueueDeepResearchTask()<br/>或 enqueueMissingCitationBatch()"]
    I -->|全部写入| AG["POST /api/review/deep-research/bulk-confirm<br/>handleDeepResearchBulkConfirm()"]
    AG --> AH["扫描 done-await-confirm 项<br/>bulkConfirmDeepResearchItems()"]
    AH --> AI["逐条 confirmDeepResearchWrite()"]
    AI --> AJ["成功: completed<br/>失败: failed"]
    I -->|批量录入 inbox| AK["POST /api/review/inbox/batch-ingest<br/>handleReviewInboxBatchIngest()"]
    AK --> AL["校验 targets<br/>stringArrayBody()"]
    AL --> AM["逐条规范化 inbox 路径<br/>normalizeInboxTarget()"]
    AM --> AN["写入批量录入队列文件<br/>review-inbox-batch-ingest.json"]
    I -->|打开对话| AO["POST /api/review/deep-research/:id/chat<br/>handleDeepResearchChat()"]
    AO --> AP{"已有 chatId ?"}
    AP -->|有| AQ["读取会话<br/>getConversation()"]
    AP -->|没有| AR["创建会话<br/>createConversation()"]
    AR --> AS["写入首条上下文消息<br/>addConversationMessage()"]
    AS --> AT["回写 chatId<br/>setDeepResearchChatId()"]
    AQ --> AU["跳转 #/chat/:id"]
    AT --> AU
`.trim();

const REVIEW_BOARD_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    openReview{{"触发：用户打开审查页"}} --> loadQueue("处理：读取并恢复审查队列")
    loadQueue --> reviewCards(["结果：审查卡片列表"])
    reviewCards --> reviewAction{"判断：用户要发起哪种审查动作"}

    reviewAction -->|单条推进| singleAdvance{{"触发：用户推进单条 Deep Research"}}
    singleAdvance --> actionDecision{"判断：这次动作是忽略还是继续研究"}
    actionDecision -->|忽略| ignoredResult(["结果：卡片进入 ignored 状态"])
    actionDecision -->|继续研究| researchCategory{"判断：是否缺引用补证"}
    researchCategory -->|缺引用| citationBatch("处理：启动引用补证批处理")
    researchCategory -->|普通研究| deepTask("处理：启动单条 Deep Research 后台任务")
    citationBatch --> researchResult(["结果：待确认 / 失败 的研究结果"])
    deepTask --> researchResult

    reviewAction -->|确认写入| confirmWrite{{"触发：用户确认写入草案"}}
    confirmWrite --> applyDraft("处理：把草案写回目标页并刷新 claim 生命周期")
    applyDraft --> confirmResult(["结果：目标页已更新"])

    reviewAction -->|批量进行| bulkAdvance{{"触发：用户批量推进审查项"}}
    bulkAdvance --> bulkAdvanceProcess("处理：批量写回 running 并排队后台研究")
    bulkAdvanceProcess --> bulkAdvanceResult(["结果：多条审查项进入 running"])

    reviewAction -->|全部写入| bulkConfirm{{"触发：用户批量确认草案"}}
    bulkConfirm --> bulkConfirmProcess("处理：逐条把草案写回目标页")
    bulkConfirmProcess --> bulkConfirmResult(["结果：批量写回完成"])

    reviewAction -->|批量录入 inbox| inboxBatch{{"触发：用户批量录入 inbox"}}
    inboxBatch --> inboxProcess("处理：写入 review inbox 批量录入队列")
    inboxProcess --> inboxResult(["结果：review-inbox-batch-ingest.json"])

    reviewAction -->|打开对话| openChat{{"触发：用户打开 Deep Research 对话"}}
    openChat --> hasChat{"判断：当前卡片是否已有 chatId"}
    hasChat -->|有| reuseChat("处理：恢复已有对话")
    hasChat -->|没有| createChat("处理：创建对话并写入首条上下文")
    reuseChat --> chatResult(["结果：跳转到 Deep Research 对话页"])
    createChat --> chatResult
`.trim();

const REVIEW_BOARD_SOURCE_INSIGHT_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "openReview", kind: "trigger", label: "触发：用户打开审查页" },
  { id: "loadQueue", kind: "process", label: "处理：读取并恢复审查队列" },
  { id: "reviewCards", kind: "result", label: "结果：审查卡片列表" },
  { id: "reviewAction", kind: "decision", label: "判断：用户要发起哪种审查动作" },
  { id: "singleAdvance", kind: "trigger", label: "触发：用户推进单条 Deep Research" },
  { id: "actionDecision", kind: "decision", label: "判断：这次动作是忽略还是继续研究" },
  { id: "ignoredResult", kind: "result", label: "结果：卡片进入 ignored 状态" },
  { id: "researchCategory", kind: "decision", label: "判断：是否缺引用补证" },
  { id: "citationBatch", kind: "process", label: "处理：启动引用补证批处理" },
  { id: "deepTask", kind: "process", label: "处理：启动单条 Deep Research 后台任务" },
  { id: "researchResult", kind: "result", label: "结果：待确认 / 失败 的研究结果" },
  { id: "confirmWrite", kind: "trigger", label: "触发：用户确认写入草案" },
  { id: "applyDraft", kind: "process", label: "处理：把草案写回目标页并刷新 claim 生命周期" },
  { id: "confirmResult", kind: "result", label: "结果：目标页已更新" },
  { id: "bulkAdvance", kind: "trigger", label: "触发：用户批量推进审查项" },
  { id: "bulkAdvanceProcess", kind: "process", label: "处理：批量写回 running 并排队后台研究" },
  { id: "bulkAdvanceResult", kind: "result", label: "结果：多条审查项进入 running" },
  { id: "bulkConfirm", kind: "trigger", label: "触发：用户批量确认草案" },
  { id: "bulkConfirmProcess", kind: "process", label: "处理：逐条把草案写回目标页" },
  { id: "bulkConfirmResult", kind: "result", label: "结果：批量写回完成" },
  { id: "inboxBatch", kind: "trigger", label: "触发：用户批量录入 inbox" },
  { id: "inboxProcess", kind: "process", label: "处理：写入 review inbox 批量录入队列" },
  { id: "inboxResult", kind: "result", label: "结果：review-inbox-batch-ingest.json" },
  { id: "openChat", kind: "trigger", label: "触发：用户打开 Deep Research 对话" },
  { id: "hasChat", kind: "decision", label: "判断：当前卡片是否已有 chatId" },
  { id: "reuseChat", kind: "process", label: "处理：恢复已有对话" },
  { id: "createChat", kind: "process", label: "处理：创建对话并写入首条上下文" },
  { id: "chatResult", kind: "result", label: "结果：跳转到 Deep Research 对话页" },
];

const REVIEW_BOARD_SOURCE_INSIGHT_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "openReview", target: "loadQueue" },
  { source: "loadQueue", target: "reviewCards", label: "渲染" },
  { source: "reviewCards", target: "reviewAction" },
  { source: "reviewAction", target: "singleAdvance", label: "单条推进" },
  { source: "singleAdvance", target: "actionDecision" },
  { source: "actionDecision", target: "ignoredResult", label: "忽略" },
  { source: "actionDecision", target: "researchCategory", label: "继续研究" },
  { source: "researchCategory", target: "citationBatch", label: "缺引用" },
  { source: "researchCategory", target: "deepTask", label: "普通研究" },
  { source: "citationBatch", target: "researchResult" },
  { source: "deepTask", target: "researchResult" },
  { source: "reviewAction", target: "confirmWrite", label: "确认写入" },
  { source: "confirmWrite", target: "applyDraft" },
  { source: "applyDraft", target: "confirmResult", label: "写回" },
  { source: "reviewAction", target: "bulkAdvance", label: "批量进行" },
  { source: "bulkAdvance", target: "bulkAdvanceProcess" },
  { source: "bulkAdvanceProcess", target: "bulkAdvanceResult", label: "写回" },
  { source: "reviewAction", target: "bulkConfirm", label: "全部写入" },
  { source: "bulkConfirm", target: "bulkConfirmProcess" },
  { source: "bulkConfirmProcess", target: "bulkConfirmResult", label: "写回" },
  { source: "reviewAction", target: "inboxBatch", label: "批量录入 inbox" },
  { source: "inboxBatch", target: "inboxProcess" },
  { source: "inboxProcess", target: "inboxResult", label: "写入" },
  { source: "reviewAction", target: "openChat", label: "打开对话" },
  { source: "openChat", target: "hasChat" },
  { source: "hasChat", target: "reuseChat", label: "已有" },
  { source: "hasChat", target: "createChat", label: "没有" },
  { source: "reuseChat", target: "chatResult" },
  { source: "createChat", target: "chatResult" },
];

const REVIEW_BOARD_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  openReview: createInsight(
    "用户进入审查页时，这条链先把待处理项和历史状态统一恢复出来。",
    [],
    ["处理：读取并恢复审查队列"],
    ["审查页"],
    ["web/client/src/pages/review/index.ts"],
  ),
  loadQueue: createInsight(
    "这里会回填旧队列、恢复 running 任务、聚合审查项，并把缓存过的 web suggestions 挂回卡片。",
    ["触发：用户打开审查页"],
    ["结果：审查卡片列表"],
    [],
    ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts", "web/server/services/review-aggregator.ts", "web/server/services/review-web-search.ts"],
  ),
  reviewCards: createInsight(
    "这是用户在审查页真正看到的卡片列表，也是所有审查动作的共同操作面。",
    ["处理：读取并恢复审查队列"],
    ["判断：用户要发起哪种审查动作"],
    ["审查页卡片列表"],
    ["web/client/src/pages/review/index.ts"],
  ),
  reviewAction: createInsight(
    "同一组卡片支持单条推进、确认写入、批量推进、批量写入、inbox 录入和对话分支。",
    ["结果：审查卡片列表"],
    ["触发：用户推进单条 Deep Research", "触发：用户确认写入草案", "触发：用户批量推进审查项", "触发：用户批量确认草案", "触发：用户批量录入 inbox", "触发：用户打开 Deep Research 对话"],
    [],
    ["web/client/src/pages/review/index.ts"],
  ),
  singleAdvance: createInsight("用户对单条 Deep Research 卡片发起推进动作。", ["判断：用户要发起哪种审查动作"], ["判断：这次动作是忽略还是继续研究"], ["审查卡片动作按钮"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  actionDecision: createInsight("单条推进时，这里先判断用户是要忽略该卡片，还是继续做后台研究。", ["触发：用户推进单条 Deep Research"], ["结果：卡片进入 ignored 状态", "判断：是否缺引用补证"], [], ["web/server/routes/review.ts", "web/server/services/deep-research.ts"]),
  ignoredResult: createInsight("忽略动作会立刻把卡片写成 ignored 状态。", ["判断：这次动作是忽略还是继续研究"], [], ["审查卡片状态"], ["web/server/services/deep-research.ts"]),
  researchCategory: createInsight("继续研究时，会再判断是走缺引用补证批处理，还是普通单条 Deep Research 任务。", ["判断：这次动作是忽略还是继续研究"], ["处理：启动引用补证批处理", "处理：启动单条 Deep Research 后台任务"], [], ["web/server/routes/review.ts", "web/server/services/deep-research.ts"]),
  citationBatch: createInsight("缺引用类卡片会进入引用补证批处理。", ["判断：是否缺引用补证"], ["结果：待确认 / 失败 的研究结果"], [], ["web/server/services/deep-research.ts"]),
  deepTask: createInsight("普通 Deep Research 卡片会进入单条后台任务。", ["判断：是否缺引用补证"], ["结果：待确认 / 失败 的研究结果"], [], ["web/server/services/deep-research.ts"]),
  researchResult: createInsight("后台研究完成后，卡片会变成待确认写入，或者带失败原因返回审查页。", ["处理：启动引用补证批处理", "处理：启动单条 Deep Research 后台任务"], [], ["审查卡片状态"], ["web/server/services/deep-research.ts"]),
  confirmWrite: createInsight("用户确认某条草案后，流程开始把 draft 真正写回目标页面。", ["判断：用户要发起哪种审查动作"], ["处理：把草案写回目标页并刷新 claim 生命周期"], ["审查卡片动作按钮"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  applyDraft: createInsight("确认写入会把草案写回目标页，并同步刷新 claim 生命周期。", ["触发：用户确认写入草案"], ["结果：目标页已更新"], [], ["web/server/routes/review.ts", "web/server/services/deep-research.ts"]),
  confirmResult: createInsight("这是确认写入后的最终用户可见结果。", ["处理：把草案写回目标页并刷新 claim 生命周期"], [], ["目标 wiki 页面 / 审查卡片状态"], ["web/server/services/deep-research.ts"]),
  bulkAdvance: createInsight("用户可以批量推进多条 pending 审查项。", ["判断：用户要发起哪种审查动作"], ["处理：批量写回 running 并排队后台研究"], ["审查页工具栏"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  bulkAdvanceProcess: createInsight("这一步会批量把审查项改成 running，再逐条排进后台任务。", ["触发：用户批量推进审查项"], ["结果：多条审查项进入 running"], [], ["web/server/routes/review.ts", "web/server/services/deep-research.ts"]),
  bulkAdvanceResult: createInsight("这是批量推进后卡片状态的直接结果。", ["处理：批量写回 running 并排队后台研究"], [], ["审查卡片状态"], ["web/server/services/deep-research.ts"]),
  bulkConfirm: createInsight("用户可以把所有待确认的草案一次性写回。", ["判断：用户要发起哪种审查动作"], ["处理：逐条把草案写回目标页"], ["审查页工具栏"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  bulkConfirmProcess: createInsight("这一步逐条执行 confirm write。", ["触发：用户批量确认草案"], ["结果：批量写回完成"], [], ["web/server/routes/review.ts", "web/server/services/deep-research.ts"]),
  bulkConfirmResult: createInsight("批量确认后的最终结果会体现在目标页和审查卡片状态里。", ["处理：逐条把草案写回目标页"], [], ["目标 wiki 页面 / 审查卡片状态"], ["web/server/services/deep-research.ts"]),
  inboxBatch: createInsight("用户可以把审查页里选中的 inbox 项一键送入批量录入队列。", ["判断：用户要发起哪种审查动作"], ["处理：写入 review inbox 批量录入队列"], ["审查页工具栏"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  inboxProcess: createInsight("这里会规范化目标路径，再写入 review inbox 批量录入队列文件。", ["触发：用户批量录入 inbox"], ["结果：review-inbox-batch-ingest.json"], [], ["web/server/routes/review.ts", "web/server/services/review-inbox-batch.ts"]),
  inboxResult: createInsight("这是审查页批量录入 inbox 之后的真实队列文件结果。", ["处理：写入 review inbox 批量录入队列"], [], ["批量录入链路"], ["web/server/services/review-inbox-batch.ts"]),
  openChat: createInsight("用户可以从 Deep Research 卡片直接打开对话，把研究上下文带进 chat。", ["判断：用户要发起哪种审查动作"], ["判断：当前卡片是否已有 chatId"], ["审查卡片动作按钮"], ["web/client/src/pages/review/index.ts", "web/server/routes/review.ts"]),
  hasChat: createInsight("如果已有 chatId 就直接恢复旧会话，否则先创建新会话并写入首条上下文。", ["触发：用户打开 Deep Research 对话"], ["处理：恢复已有对话", "处理：创建对话并写入首条上下文"], [], ["web/server/routes/review.ts", "web/server/services/chat-store.ts"]),
  reuseChat: createInsight("直接复用已有对话。", ["判断：当前卡片是否已有 chatId"], ["结果：跳转到 Deep Research 对话页"], [], ["web/server/services/chat-store.ts"]),
  createChat: createInsight("新建对话并把审查上下文写进去。", ["判断：当前卡片是否已有 chatId"], ["结果：跳转到 Deep Research 对话页"], [], ["web/server/routes/review.ts", "web/server/services/chat-store.ts"]),
  chatResult: createInsight("最终会跳转到一条可继续追问和补充上下文的 Deep Research 对话。", ["处理：恢复已有对话", "处理：创建对话并写入首条上下文"], [], ["#/chat/:id"], ["web/client/src/pages/review/index.ts"]),
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
    slug: "review-board",
    name: "审查与运行结果",
    summary: "从审查页汇总，到推进 deep research、确认写入或触发 inbox 批量录入的真实流程。",
    icon: "bot",
    sourcePaths: [
      "web/client/src/pages/review/index.ts",
      "web/server/routes/review.ts",
      "web/server/services/chat-store.ts",
      "web/server/services/review-aggregator.ts",
      "web/server/services/deep-research.ts",
      "web/server/services/review-inbox-batch.ts",
      "web/server/services/review-web-search.ts",
    ],
    mermaid: REVIEW_BOARD_MERMAID,
    flow: {
      nodes: [
        flowNode("review-trigger", "trigger", "打开 /review", "页面挂载后立即读取审查队列。", "renderReviewPage() -> loadReview()"),
        flowNode("review-summary", "action", "GET /api/review", "审查页读取统一 review summary。", "handleReviewSummary()"),
        flowNode("review-backfill-outdated", "action", "backfillLegacyOutdatedSourceRepairs()", "先把历史 outdated-source 修复项补进统一队列。", "backfillLegacyOutdatedSourceRepairs()"),
        flowNode("review-backfill-deep", "action", "backfillLegacyNeedsDeepResearchRepairs()", "再把历史 needs-deep-research 修复项补进队列。", "backfillLegacyNeedsDeepResearchRepairs()"),
        flowNode("review-resume", "action", "resumeRunningDeepResearchItems()", "恢复仍在执行中的 Deep Research 项。", "resumeRunningDeepResearchItems()"),
        flowNode("review-aggregate", "action", "aggregateReviewItems()", "聚合 deep research、run、state、inbox 等审查项。", "aggregateReviewItems()"),
        flowNode("review-suggestions", "action", "attachStoredReviewWebSearchSuggestions()", "把已保存的 web search 建议附到审查项上。", "attachStoredReviewWebSearchSuggestions()"),
        flowNode("review-render", "action", "renderReviewItems()", "把审查项渲染成卡片列表和工作区。", "renderReviewItems() -> renderReviewState()"),
        flowNode("review-branch", "branch", "用户从审查卡片发起什么动作", "同一批卡片支持单条、批量、inbox 和聊天分支。", "handleReviewItemClick() / handleReviewToolbarClick()"),
        flowNode("review-action", "action", "POST /api/review/deep-research/:id/actions", "推进单条 Deep Research 动作。", "handleDeepResearchAction() -> startDeepResearchAction()"),
        flowNode("review-confirm", "action", "POST /api/review/deep-research/:id/confirm", "把待确认草案写回目标页面。", "handleDeepResearchConfirm() -> confirmDeepResearchWrite()"),
        flowNode("review-bulk-advance", "action", "POST /api/review/deep-research/bulk-advance", "批量推进 pending Deep Research 卡片。", "handleDeepResearchBulkAdvance() -> bulkAdvanceDeepResearchItems()"),
        flowNode("review-bulk-confirm", "action", "POST /api/review/deep-research/bulk-confirm", "批量确认 done-await-confirm 草案。", "handleDeepResearchBulkConfirm() -> bulkConfirmDeepResearchItems()"),
        flowNode("review-inbox-batch", "action", "POST /api/review/inbox/batch-ingest", "把 inbox 目标加入优先批量录入队列。", "handleReviewInboxBatchIngest() -> queueReviewInboxBatchIngest()"),
        flowNode("review-chat", "action", "POST /api/review/deep-research/:id/chat", "为单条 Deep Research 卡片打开或创建对话。", "handleDeepResearchChat() -> createConversation()"),
      ],
      edges: [
        flowEdge("review-trigger", "review-summary"),
        flowEdge("review-summary", "review-backfill-outdated"),
        flowEdge("review-backfill-outdated", "review-backfill-deep"),
        flowEdge("review-backfill-deep", "review-resume"),
        flowEdge("review-resume", "review-aggregate"),
        flowEdge("review-aggregate", "review-suggestions"),
        flowEdge("review-suggestions", "review-render"),
        flowEdge("review-render", "review-branch"),
        flowEdge("review-branch", "review-action"),
        flowEdge("review-branch", "review-confirm"),
        flowEdge("review-branch", "review-bulk-advance"),
        flowEdge("review-branch", "review-bulk-confirm"),
        flowEdge("review-branch", "review-inbox-batch"),
        flowEdge("review-branch", "review-chat"),
      ],
      branches: [
        flowBranch(
          "review-actions",
          "审查动作分支",
          "review-branch",
          ["review-action", "review-confirm", "review-bulk-advance", "review-bulk-confirm", "review-inbox-batch", "review-chat"],
        ),
      ],
    },
    sourceInsight: {
      scope: "page",
      page: {
        id: "review",
        title: "审查页",
        routeLabel: "#/review",
      },
      graph: {
        mermaid: REVIEW_BOARD_SOURCE_INSIGHT_MERMAID,
        nodes: REVIEW_BOARD_SOURCE_INSIGHT_NODES,
        edges: REVIEW_BOARD_SOURCE_INSIGHT_EDGES,
      },
      nodeInsights: REVIEW_BOARD_NODE_INSIGHTS,
    },
  },
];
