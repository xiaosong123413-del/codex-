/**
 * Source-owned automation flow for flash-diary quick capture.
 *
 * This seed describes the desktop global-shortcut capture path as one lineage
 * graph: trigger, input, branch, write success, and failure recording. The
 * workspace can then explain what the quick window really changes without
 * pretending it is a page-bound route.
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

const FLASH_DIARY_CAPTURE_MERMAID = `
flowchart TD
    A["全局快捷键触发<br/>globalShortcut.register()"] --> B["打开闪念记录窗口<br/>showFlashDiaryCaptureWindow()"]
    B --> C["POST /api/flash-diary/append<br/>handleFlashDiaryAppend()"]
    C --> D["appendFlashDiaryEntry()<br/>生成当天闪念日记写入内容"]
    D --> E["copyDiaryMedia()<br/>复制附件到当天媒体目录"]
    E --> F["renderDiaryEntryBlock()<br/>拼出 Markdown 条目块"]
    F --> G{"当天日记文件是否已存在"}
    G -->|否| H["初始化当天日记文件<br/>current = # YYYY-MM-DD"]
    G -->|是| I["读取现有日记文件<br/>readFile(diaryPath, \"utf8\")"]
    H --> J["prependDiaryBlock()<br/>把新条目插到标题下方"]
    I --> J
    J --> K["writeFile()<br/>写回当天日记文件"]
    K --> L{"appendFlashDiaryEntry() 是否抛错"}
    L -->|否| M["返回相对路径和修改时间<br/>res.json({ success: true, data: result })"]
    L -->|是| N["recordFlashDiaryFailure()<br/>写入 flash-diary-failures.json"]
`.trim();

const FLASH_DIARY_CAPTURE_SOURCE_INSIGHT_MERMAID = `
flowchart TD
    hotkeyTrigger{{"触发：全局快捷键触发"}} --> captureWindow(["结果：闪念记录窗口显示"])
    submitTrigger{{"触发：用户提交本次闪念"}} --> entryInput["输入：文本 / 时间 / 选中的媒体路径"]
    captureWindow --> submitTrigger
    entryInput --> copyMedia("处理：复制附件到当天媒体目录")
    copyMedia --> renderBlock("处理：拼出新的 Markdown 条目块")
    renderBlock --> fileDecision{"判断：当天日记文件是否已存在"}
    fileDecision -->|不存在| newDiary(["结果：初始化当天日记文件"])
    fileDecision -->|已存在| diaryInput["输入：现有当天日记内容"]
    newDiary --> prependBlock("处理：把新条目插到标题下方")
    diaryInput --> prependBlock
    prependBlock --> diaryFile(["结果：raw/闪念日记/YYYY-MM-DD.md"])
    diaryFile --> writeDecision{"判断：本次写入是否成功"}
    writeDecision -->|成功| appendSuccess(["结果：返回 path / mediaFiles / modifiedAt"])
    writeDecision -->|失败| recordFailure("处理：写入 flash-diary-failures.json")
    recordFailure --> failureFile(["结果：flash-diary-failures.json"])
`.trim();

const FLASH_DIARY_CAPTURE_NODES: CodeDerivedSourceInsightGraphNode[] = [
  { id: "hotkeyTrigger", kind: "trigger", label: "触发：全局快捷键触发" },
  { id: "captureWindow", kind: "result", label: "结果：闪念记录窗口显示" },
  { id: "submitTrigger", kind: "trigger", label: "触发：用户提交本次闪念" },
  { id: "entryInput", kind: "input", label: "输入：文本 / 时间 / 选中的媒体路径" },
  { id: "copyMedia", kind: "process", label: "处理：复制附件到当天媒体目录" },
  { id: "renderBlock", kind: "process", label: "处理：拼出新的 Markdown 条目块" },
  { id: "fileDecision", kind: "decision", label: "判断：当天日记文件是否已存在" },
  { id: "newDiary", kind: "result", label: "结果：初始化当天日记文件" },
  { id: "diaryInput", kind: "input", label: "输入：现有当天日记内容" },
  { id: "prependBlock", kind: "process", label: "处理：把新条目插到标题下方" },
  { id: "diaryFile", kind: "result", label: "结果：raw/闪念日记/YYYY-MM-DD.md" },
  { id: "writeDecision", kind: "decision", label: "判断：本次写入是否成功" },
  { id: "appendSuccess", kind: "result", label: "结果：返回 path / mediaFiles / modifiedAt" },
  { id: "recordFailure", kind: "process", label: "处理：写入 flash-diary-failures.json" },
  { id: "failureFile", kind: "result", label: "结果：flash-diary-failures.json" },
];

const FLASH_DIARY_CAPTURE_EDGES: CodeDerivedSourceInsightGraphEdge[] = [
  { source: "hotkeyTrigger", target: "captureWindow" },
  { source: "captureWindow", target: "submitTrigger" },
  { source: "submitTrigger", target: "entryInput" },
  { source: "entryInput", target: "copyMedia" },
  { source: "copyMedia", target: "renderBlock" },
  { source: "renderBlock", target: "fileDecision" },
  { source: "fileDecision", target: "newDiary", label: "不存在" },
  { source: "fileDecision", target: "diaryInput", label: "已存在" },
  { source: "newDiary", target: "prependBlock" },
  { source: "diaryInput", target: "prependBlock" },
  { source: "prependBlock", target: "diaryFile" },
  { source: "diaryFile", target: "writeDecision" },
  { source: "writeDecision", target: "appendSuccess", label: "成功" },
  { source: "writeDecision", target: "recordFailure", label: "失败" },
  { source: "recordFailure", target: "failureFile" },
];

const FLASH_DIARY_CAPTURE_PATHS = [
  "desktop-webui/src/main.ts",
  "web/server/routes/flash-diary.ts",
  "web/server/services/flash-diary.ts",
] as const;

const FLASH_DIARY_CAPTURE_NODE_INSIGHTS: Record<string, CodeDerivedSourceInsightNodeInsight> = {
  hotkeyTrigger: createInsight("桌面端全局快捷键拉起快速录入入口。", [], ["结果：闪念记录窗口显示"], [], FLASH_DIARY_CAPTURE_PATHS),
  captureWindow: createInsight("用户真正看到的闪念记录小窗。", ["触发：全局快捷键触发"], ["触发：用户提交本次闪念"], ["桌面快速录入窗口"], FLASH_DIARY_CAPTURE_PATHS),
  submitTrigger: createInsight("用户点击提交后，后端才开始真正写日记。", ["结果：闪念记录窗口显示"], ["输入：文本 / 时间 / 选中的媒体路径"], [], FLASH_DIARY_CAPTURE_PATHS),
  entryInput: createInsight("本次提交的正文、时间戳和媒体路径会一起进入写入链。", ["触发：用户提交本次闪念"], ["处理：复制附件到当天媒体目录"], [], FLASH_DIARY_CAPTURE_PATHS),
  copyMedia: createInsight("先把附件复制到当天闪念日记的 assets 目录。", ["输入：文本 / 时间 / 选中的媒体路径"], ["处理：拼出新的 Markdown 条目块"], [], FLASH_DIARY_CAPTURE_PATHS),
  renderBlock: createInsight("把时间、正文和附件引用拼成一条新的 Markdown 日记块。", ["处理：复制附件到当天媒体目录"], ["判断：当天日记文件是否已存在"], [], FLASH_DIARY_CAPTURE_PATHS),
  fileDecision: createInsight("决定是初始化当天日记文件，还是读取已有内容后 prepend。", ["处理：拼出新的 Markdown 条目块"], ["结果：初始化当天日记文件", "输入：现有当天日记内容"], [], FLASH_DIARY_CAPTURE_PATHS),
  newDiary: createInsight("如果当天还没有日记，就先创建带标题的初始文件。", ["判断：当天日记文件是否已存在"], ["处理：把新条目插到标题下方"], [], FLASH_DIARY_CAPTURE_PATHS),
  diaryInput: createInsight("当天已有日记时，会把完整现有内容读进来作为 prepend 基底。", ["判断：当天日记文件是否已存在"], ["处理：把新条目插到标题下方"], [], FLASH_DIARY_CAPTURE_PATHS),
  prependBlock: createInsight("把新条目插在标题下面最前面，然后准备写回文件。", ["结果：初始化当天日记文件", "输入：现有当天日记内容"], ["结果：raw/闪念日记/YYYY-MM-DD.md"], [], FLASH_DIARY_CAPTURE_PATHS),
  diaryFile: createInsight("当天真实落盘的闪念日记文件。", ["处理：把新条目插到标题下方"], ["判断：本次写入是否成功"], ["raw/闪念日记/YYYY-MM-DD.md"], FLASH_DIARY_CAPTURE_PATHS),
  writeDecision: createInsight("后端路由根据 service 是否抛错，决定走成功返回还是 failure 记录。", ["结果：raw/闪念日记/YYYY-MM-DD.md"], ["结果：返回 path / mediaFiles / modifiedAt", "处理：写入 flash-diary-failures.json"], [], FLASH_DIARY_CAPTURE_PATHS),
  appendSuccess: createInsight("前端收到成功响应，会拿到 path、mediaFiles 和 modifiedAt。", ["判断：本次写入是否成功"], [], ["快速录入成功提示 / 闪念日记页刷新"], FLASH_DIARY_CAPTURE_PATHS),
  recordFailure: createInsight("失败时把未成功写入的内容整理进 failure 记录。", ["判断：本次写入是否成功"], ["结果：flash-diary-failures.json"], [], FLASH_DIARY_CAPTURE_PATHS),
  failureFile: createInsight("失败条目会进入 flash-diary-failures.json，后续可在审查链路里重试。", ["处理：写入 flash-diary-failures.json"], [], ["审查页闪念日记失败项"], FLASH_DIARY_CAPTURE_PATHS),
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

export const codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[] = [
  {
    slug: "flash-diary-capture",
    name: "闪念日记快速记录",
    summary: "从全局快捷键唤起记录窗口，到写入当天日记文件或记录失败项的真实流程。",
    icon: "message-circle",
    sourcePaths: [
      "desktop-webui/src/main.ts",
      "web/server/routes/flash-diary.ts",
      "web/server/services/flash-diary.ts",
    ],
    mermaid: FLASH_DIARY_CAPTURE_MERMAID,
    sourceInsight: {
      scope: "cross-page",
      page: {
        id: "flash-diary-capture",
        title: "闪念日记快速录入",
        routeLabel: "桌面全局快捷键",
      },
      graph: {
        mermaid: FLASH_DIARY_CAPTURE_SOURCE_INSIGHT_MERMAID,
        nodes: FLASH_DIARY_CAPTURE_NODES,
        edges: FLASH_DIARY_CAPTURE_EDGES,
      },
      nodeInsights: FLASH_DIARY_CAPTURE_NODE_INSIGHTS,
    },
    flow: {
      nodes: [
        flowNode("flash-trigger", "trigger", "全局快捷键触发", "桌面端快捷键先拉起快速记录窗口。", "globalShortcut.register()"),
        flowNode("flash-window", "action", "打开闪念记录窗口", "把文本和媒体选择界面展示给用户。", "showFlashDiaryCaptureWindow()"),
        flowNode("flash-append-api", "action", "POST /api/flash-diary/append", "把文本、媒体路径和时间发给后端。", "handleFlashDiaryAppend()"),
        flowNode("flash-append-service", "action", "appendFlashDiaryEntry()", "后端开始生成当天闪念日记的写入内容。", "appendFlashDiaryEntry()"),
        flowNode("flash-copy-media", "action", "copyDiaryMedia()", "先把附件复制到当天闪念日记媒体目录。", "copyDiaryMedia()"),
        flowNode("flash-render-block", "action", "renderDiaryEntryBlock()", "把时间、正文和附件引用拼成 Markdown 条目块。", "renderDiaryEntryBlock()"),
        flowNode("flash-branch-file", "branch", "当天日记文件是否已存在", "不存在就初始化文件，存在就读取现有内容。", "fs.existsSync(diaryPath)"),
        flowNode("flash-new-file", "action", "初始化当天日记文件", "不存在时创建 '# YYYY-MM-DD\\n\\n' 头部。", "current = `# ${date}\\n\\n`"),
        flowNode("flash-read-file", "action", "读取现有日记文件", "存在时读取完整内容作为 prepend 基底。", "readFile(diaryPath, \"utf8\")"),
        flowNode("flash-prepend", "merge", "prependDiaryBlock()", "把新条目插到标题下方最前面。", "prependDiaryBlock()"),
        flowNode("flash-write", "action", "writeFile()", "把更新后的 Markdown 写回当天日记文件。", "writeFile(diaryPath, next, \"utf8\")"),
        flowNode("flash-branch-result", "branch", "appendFlashDiaryEntry() 是否抛错", "成功返回 path/modifiedAt，失败则在路由层记录 failure。", "handleFlashDiaryAppend() try / catch"),
        flowNode("flash-success", "action", "返回相对路径和修改时间", "成功响应 path、mediaFiles 和 modifiedAt。", "res.json({ success: true, data: result })"),
        flowNode("flash-failure", "action", "recordFlashDiaryFailure()", "把失败记录写入 .llmwiki/flash-diary-failures.json。", "recordFlashDiaryFailure()"),
      ],
      edges: [
        flowEdge("flash-trigger", "flash-window"),
        flowEdge("flash-window", "flash-append-api"),
        flowEdge("flash-append-api", "flash-append-service"),
        flowEdge("flash-append-service", "flash-copy-media"),
        flowEdge("flash-copy-media", "flash-render-block"),
        flowEdge("flash-render-block", "flash-branch-file"),
        flowEdge("flash-branch-file", "flash-new-file"),
        flowEdge("flash-branch-file", "flash-read-file"),
        flowEdge("flash-new-file", "flash-prepend"),
        flowEdge("flash-read-file", "flash-prepend"),
        flowEdge("flash-prepend", "flash-write"),
        flowEdge("flash-write", "flash-branch-result"),
        flowEdge("flash-branch-result", "flash-success"),
        flowEdge("flash-branch-result", "flash-failure"),
      ],
      branches: [
        flowBranch("flash-file-state", "文件存在分支", "flash-branch-file", ["flash-new-file", "flash-read-file"], "flash-prepend"),
        flowBranch("flash-write-result", "写入结果分支", "flash-branch-result", ["flash-success", "flash-failure"]),
      ],
    },
  },
];
