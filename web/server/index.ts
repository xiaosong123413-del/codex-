import express from "express";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import { config as loadDotenv } from "dotenv";
import { parseArgs } from "./config.js";
import { registerCLIProxyRoutes } from "./routes/cliproxy.js";
import { registerAccountAuthRoutes } from "./routes/account-auth.js";
import { registerAccountAiRoutes } from "./routes/account-ai.js";
import { registerAgentConfigRoutes } from "./routes/agent-config.js";
import { registerAppConfigRoutes } from "./routes/app-config.js";
import { registerAutomationConfigRoutes } from "./routes/automation-config.js";
import { registerAutomationWorkspaceRoutes } from "./routes/automation-workspace.js";
import { registerHealthDomainRoutes } from "./routes/health-domain.js";
import { handleTaskPlanJsonParseError, registerTaskPlanRoutes } from "./routes/task-plan.js";
import { registerTaskPoolRoutes } from "./routes/task-pool.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { registerSearchRoutes } from "./routes/search.js";
import { buildAndSaveSearchIndex } from "./services/search-index-builder.js";
import { handleTree } from "./routes/tree.js";
import { handleWikiGraph } from "./routes/wiki-graph.js";
import { handleWorkspaceGraph } from "./routes/workspace-graph.js";
import {
  handleWorkspaceRelationCreate,
  handleWorkspaceRelationDelete,
  handleWorkspaceRelations,
} from "./routes/workspace-relations.js";
import { handleGraphResearchPrepare, handleGraphResearchRun, handleGraphResearchStream } from "./routes/graph-research.js";
import {
  handleActivityLog,
  handlePage,
  handleProjectLog,
  handleProjectWorkspace,
  handleProjectWorkspaceDelete,
  handleRaw,
  handleWorkspaceDocs,
  handleWorkspaceDocsDelete,
  handleWorkspaceDocsSave,
  handleWorkspaceDocsStatusMove,
} from "./routes/pages.js";
import { handlePageDelete, handlePageSave } from "./routes/page-save.js";
import { handlePageSideImageMedia, handlePageSideImageUpload } from "./routes/page-side-image.js";
import {
  handleIdentityDashboardGet,
  handleIdentityDashboardSave,
  handleIdentityDashboardWidgetGenerate,
} from "./routes/identity-dashboard.js";
import {
  handleCaseLibraryCaseAction,
  handleCaseLibrarySourceRefresh,
} from "./routes/case-library.js";
import { handlePendingTimelineFactMutation, handlePersonalTimelineSourceRefresh } from "./routes/personal-timeline.js";
import {
  handleWorkflowRecorderArchive,
  handleWorkflowRecorderInbox,
  handleWorkflowRecorderRecord,
} from "./routes/workflow-recorder.js";
import { handleWorkflowArtifacts } from "./routes/workflow-artifacts.js";
import {
  handleWikiCommentAiDraftConfirm,
  handleWikiCommentAiDraftCreate,
  handleWikiCommentAiDraftDiscard,
  handleWikiCommentsCreate,
  handleWikiCommentsDelete,
  handleWikiCommentsList,
  handleWikiCommentsUpdate,
} from "./routes/wiki-comments.js";
import {
  handleFlashDiaryAppend,
  handleFlashDiaryList,
  handleFlashDiaryMedia,
  handleFlashDiaryMediaUpload,
  handleFlashDiaryMemory,
  handleFlashDiaryPage,
  handleFlashDiaryRetry,
  handleFlashDiarySave,
} from "./routes/flash-diary.js";
import { handleIntakeScan } from "./routes/intake.js";
import { handleSourceImageOcr } from "./routes/ocr.js";
import { registerProviderStatusRoutes } from "./routes/provider-status.js";
import {
  handleDeepResearchAction,
  handleDeepResearchBulkAdvance,
  handleDeepResearchBulkConfirm,
  handleDeepResearchChat,
  handleDeepResearchConfirm,
  handleReviewInboxBatchIngest,
  handleReviewSummary,
} from "./routes/review.js";
import {
  handleRemoteBrainPull,
  handleRemoteBrainPublish,
  handleRemoteBrainPush,
  handleRemoteBrainStatus,
} from "./routes/remote-brain.js";
import {
  handleSourceGalleryCompile,
  handleSourceGalleryCreate,
  handleSourceGalleryDelete,
  handleSourceGalleryDetail,
  handleSourceGalleryIngestQueue,
  handleSourceGalleryList,
  handleSourceGalleryMedia,
  handleSourceGalleryMoveToInbox,
  handleSourceGalleryOcr,
  handleSourceGallerySave,
  handleSourceGalleryTranscribe,
} from "./routes/source-gallery.js";
import {
  handleChatAddMessage,
  handleChatCreate,
  handleChatDelete,
  handleChatGet,
  handleChatList,
  handleChatPatch,
  handleChatRegenerate,
  handleChatSaveMessageToWiki,
  handleChatStreamMessage,
} from "./routes/chat.js";
import { handleClipCreate, handleYtDlpInstall, handleYtDlpStatus } from "./routes/clips.js";
import { handleDouyinCookieSave, handleDouyinCookieStatusGet } from "./routes/douyin-import.js";
import {
  handleWorkspaceHealthApiConnectionSave,
  handleWorkspaceHealthState,
  handleWorkspaceHealthSync,
} from "./routes/health-domain.js";
import {
  handleXiaohongshuCookieSave,
  handleXiaohongshuImportConfigDelete,
  handleXiaohongshuImportConfigGet,
  handleXiaohongshuImportConfigSave,
  handleXiaohongshuImportProgress,
  handleXiaohongshuImportStart,
} from "./routes/xiaohongshu-import.js";
import { handleXhsBatch, handleXhsExtract, handleXhsFailureDelete, handleXhsFavoritesSync, handleXhsStatus } from "./routes/xhs-sync.js";
import { handleSyncConfigGet, handleSyncConfigSave } from "./routes/sync-config.js";
import { handleToolboxCreate, handleToolboxDelete, handleToolboxList, handleToolboxSave } from "./routes/toolbox.js";
import { handleRunCurrent, handleRunEvents, handleRunStart, handleRunStop } from "./routes/runs.js";
import { handleCodexQuotaReaderRead } from "./routes/codex-quota-reader.js";
import { startFlashDiaryImageScheduler } from "./services/flash-diary-image-scheduler.js";
import { startFlashDiaryMemoryScheduler } from "./services/flash-diary-memory-scheduler.js";
import { createRunManager } from "./services/run-manager.js";

const cfg = parseArgs(process.argv);
loadProjectEnv(cfg.projectRoot);
const runManager = createRunManager();
const memoryScheduler = startFlashDiaryMemoryScheduler({ cfg });
const diaryImageScheduler = startFlashDiaryImageScheduler({ cfg });
const unavailableHealthSyncRunner = async () => {
  throw new Error("健康域同步运行器尚未接入。");
};

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(handleTaskPlanJsonParseError);

// ── API ────────────────────────────────────────────────────────────────────
app.get("/api/tree", handleTree(cfg));
app.get("/api/wiki/graph", handleWikiGraph(cfg));
app.post("/api/wiki/graph/research/prepare", handleGraphResearchPrepare(cfg));
app.post("/api/wiki/graph/research", handleGraphResearchRun(cfg, runManager));
app.post("/api/wiki/graph/research/stream", handleGraphResearchStream(cfg, runManager));
registerCLIProxyRoutes(app, cfg);
registerAccountAuthRoutes(app);
registerAccountAiRoutes(app, cfg);
registerAgentConfigRoutes(app, cfg);
registerAppConfigRoutes(app, cfg);
registerAutomationConfigRoutes(app, cfg);
registerAutomationWorkspaceRoutes(app, cfg);
registerHealthDomainRoutes(app, cfg);
registerTaskPlanRoutes(app, cfg);
registerTaskPoolRoutes(app, cfg);
registerLlmRoutes(app, cfg);
registerSearchRoutes(app, cfg);
registerProviderStatusRoutes(app);
app.get("/api/remote-brain/status", handleRemoteBrainStatus(cfg));
app.post("/api/remote-brain/push", handleRemoteBrainPush(cfg));
app.post("/api/remote-brain/pull", handleRemoteBrainPull(cfg));
app.post("/api/remote-brain/publish", handleRemoteBrainPublish(cfg));
app.get("/api/page", handlePage(cfg));
app.put("/api/page", handlePageSave(cfg));
app.delete("/api/page", handlePageDelete(cfg));
app.get("/api/page-side-image", handlePageSideImageMedia(cfg));
app.post("/api/page-side-image", handlePageSideImageUpload(cfg));
app.get("/api/wiki/identity-dashboard", handleIdentityDashboardGet(cfg));
app.put("/api/wiki/identity-dashboard", handleIdentityDashboardSave(cfg));
app.post("/api/wiki/identity-dashboard/widget-generate", handleIdentityDashboardWidgetGenerate(cfg));
app.post("/api/wiki/personal-timeline/source-refresh", handlePersonalTimelineSourceRefresh(cfg));
app.post("/api/wiki/personal-timeline/pending-fact", handlePendingTimelineFactMutation(cfg));
app.post("/api/wiki/case-library/source-refresh", handleCaseLibrarySourceRefresh(cfg));
app.post("/api/wiki/case-library/case-action", handleCaseLibraryCaseAction(cfg));
app.get("/api/workflow-recorder/inbox", handleWorkflowRecorderInbox(cfg));
app.post("/api/workflow-recorder/record", handleWorkflowRecorderRecord(cfg));
app.post("/api/workflow-recorder/archive", handleWorkflowRecorderArchive(cfg));
app.get("/api/workflow-artifacts", handleWorkflowArtifacts(cfg));
app.get("/api/raw", handleRaw(cfg));
app.get("/api/log", handleActivityLog(cfg));
app.get("/api/project-log", handleProjectLog(cfg));
app.get("/api/project-log/workspace", handleProjectWorkspace(cfg));
app.delete("/api/project-log/workspace", handleProjectWorkspaceDelete(cfg));
app.get("/api/workspace/docs", handleWorkspaceDocs(cfg));
app.get("/api/workspace/graph", handleWorkspaceGraph(cfg));
app.get("/api/workspace/relations", handleWorkspaceRelations(cfg));
app.post("/api/workspace/relations", handleWorkspaceRelationCreate(cfg));
app.delete("/api/workspace/relations/:id", handleWorkspaceRelationDelete(cfg));
app.put("/api/workspace/docs", handleWorkspaceDocsSave(cfg));
app.post("/api/workspace/docs/status", handleWorkspaceDocsStatusMove(cfg));
app.delete("/api/workspace/docs", handleWorkspaceDocsDelete(cfg));
app.get("/api/flash-diary", handleFlashDiaryList(cfg));
app.get("/api/flash-diary/memory", handleFlashDiaryMemory(cfg));
app.get("/api/flash-diary/page", handleFlashDiaryPage(cfg));
app.get("/api/flash-diary/media", handleFlashDiaryMedia(cfg));
app.put("/api/flash-diary/page", handleFlashDiarySave(cfg));
app.post("/api/flash-diary/media", handleFlashDiaryMediaUpload(cfg));
app.post("/api/flash-diary/entry", handleFlashDiaryAppend(cfg));
app.post("/api/flash-diary/failures/:id/retry", handleFlashDiaryRetry(cfg));
app.post("/api/ocr/source-image", handleSourceImageOcr(cfg));
app.get("/api/source-gallery", handleSourceGalleryList(cfg));
app.get("/api/source-gallery/media", handleSourceGalleryMedia(cfg));
app.get("/api/source-gallery/:id", handleSourceGalleryDetail(cfg));
app.put("/api/source-gallery/:id", handleSourceGallerySave(cfg));
app.delete("/api/source-gallery", handleSourceGalleryDelete(cfg));
app.post("/api/source-gallery/:id/ocr", handleSourceGalleryOcr(cfg));
app.post("/api/source-gallery/:id/transcribe", handleSourceGalleryTranscribe(cfg));
app.post("/api/source-gallery/:id/compile", handleSourceGalleryCompile(cfg, runManager));
app.post("/api/source-gallery/create", handleSourceGalleryCreate(cfg));
app.post("/api/source-gallery/selection/inbox", handleSourceGalleryMoveToInbox(cfg));
app.post("/api/source-gallery/selection/ingest", handleSourceGalleryIngestQueue(cfg));
app.post("/api/clips", handleClipCreate(cfg));
app.get("/api/clips/yt-dlp", handleYtDlpStatus(cfg));
app.post("/api/clips/yt-dlp/install", handleYtDlpInstall(cfg));
app.get("/api/sync/config", handleSyncConfigGet(cfg));
app.post("/api/sync/config", handleSyncConfigSave(cfg));
app.get("/api/import/xiaohongshu/config", handleXiaohongshuImportConfigGet(cfg));
app.post("/api/import/xiaohongshu/config", handleXiaohongshuImportConfigSave(cfg));
app.delete("/api/import/xiaohongshu/config", handleXiaohongshuImportConfigDelete(cfg));
app.post("/api/import/xiaohongshu/cookie", handleXiaohongshuCookieSave(cfg));
app.post("/api/import/xiaohongshu/start", handleXiaohongshuImportStart(cfg));
app.get("/api/import/xiaohongshu/progress", handleXiaohongshuImportProgress(cfg));
app.get("/api/import/douyin/cookie", handleDouyinCookieStatusGet(cfg));
app.post("/api/import/douyin/cookie", handleDouyinCookieSave(cfg));
app.get("/api/workspace/health/state", handleWorkspaceHealthState(cfg));
app.post("/api/workspace/health/connection", handleWorkspaceHealthApiConnectionSave(cfg));
app.post("/api/workspace/health/sync", handleWorkspaceHealthSync(cfg, unavailableHealthSyncRunner));
app.get("/api/xhs-sync/status", handleXhsStatus(cfg));
app.post("/api/xhs-sync/extract", handleXhsExtract(cfg));
app.post("/api/xhs-sync/batch", handleXhsBatch(cfg));
app.post("/api/xhs-sync/favorites", handleXhsFavoritesSync(cfg));
app.delete("/api/xhs-sync/failures", handleXhsFailureDelete(cfg));
app.get("/api/intake/scan", handleIntakeScan(cfg));
app.get("/api/toolbox", handleToolboxList(cfg));
app.post("/api/toolbox", handleToolboxCreate(cfg));
app.put("/api/toolbox", handleToolboxSave(cfg));
app.delete("/api/toolbox", handleToolboxDelete(cfg));
app.get("/api/chat", handleChatList(cfg));
app.post("/api/chat", handleChatCreate(cfg));
app.get("/api/chat/:id", handleChatGet(cfg));
app.patch("/api/chat/:id", handleChatPatch(cfg));
app.delete("/api/chat/:id", handleChatDelete(cfg));
app.post("/api/chat/:id/regenerate", handleChatRegenerate(cfg));
app.post("/api/chat/:id/messages/:messageId/save-to-wiki", handleChatSaveMessageToWiki(cfg));
app.post("/api/chat/:id/messages/stream", handleChatStreamMessage(cfg));
app.post("/api/chat/:id/messages", handleChatAddMessage(cfg));
app.get("/api/runs/current", handleRunCurrent(runManager));
app.post("/api/runs/check", handleRunStart(cfg, runManager, "check"));
app.post("/api/runs/sync", handleRunStart(cfg, runManager, "sync"));
app.post("/api/runs/:id/stop", handleRunStop(runManager));
app.get("/api/runs/:id/events", handleRunEvents(runManager));
app.post("/api/codex-quota-reader/read", handleCodexQuotaReaderRead());
app.get("/api/review", handleReviewSummary(cfg, runManager));
app.post("/api/review/inbox/batch-ingest", handleReviewInboxBatchIngest(cfg));
app.post("/api/review/deep-research/bulk-advance", handleDeepResearchBulkAdvance(cfg));
app.post("/api/review/deep-research/bulk-confirm", handleDeepResearchBulkConfirm(cfg));
app.post("/api/review/deep-research/:id/actions", handleDeepResearchAction(cfg));
app.post("/api/review/deep-research/:id/confirm", handleDeepResearchConfirm(cfg));
app.post("/api/review/deep-research/:id/chat", handleDeepResearchChat(cfg));
app.get("/api/wiki-comments", handleWikiCommentsList(cfg));
app.post("/api/wiki-comments", handleWikiCommentsCreate(cfg));
app.post("/api/wiki-comments/:id/ai-draft", handleWikiCommentAiDraftCreate(cfg));
app.post("/api/wiki-comments/:id/ai-draft/:draftId/confirm", handleWikiCommentAiDraftConfirm(cfg));
app.delete("/api/wiki-comments/:id/ai-draft/:draftId", handleWikiCommentAiDraftDiscard(cfg));
app.patch("/api/wiki-comments/:id", handleWikiCommentsUpdate(cfg));
app.delete("/api/wiki-comments/:id", handleWikiCommentsDelete(cfg));
app.get("/api/config", (_req, res) => {
  res.json({
    author: cfg.author,
    sourceVaultRoot: path.basename(cfg.sourceVaultRoot),
    runtimeRoot: path.basename(cfg.runtimeRoot),
  });
});

// ── Static client ──────────────────────────────────────────────────────────
const here = path.dirname(url.fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../dist/client");
if (!fs.existsSync(clientDist)) {
  console.warn(
    `warning: client bundle not found at ${clientDist}. Run 'npm run build' first.`,
  );
}
app.use("/assets", express.static(path.join(clientDist, "assets")));
app.use("/katex", express.static(path.resolve(here, "../node_modules/katex/dist")));
app.use("/project-log-assets", express.static(path.join(cfg.projectRoot, "project-log-assets")));
app.get("/", (_req, res) => {
  const index = path.join(clientDist, "index.html");
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(500).send("client bundle missing. Run: npm run build");
  }
});

// ── Build search index on startup ───────────────────────────────────────────
try {
  buildAndSaveSearchIndex(cfg);
  console.log("search index built.");
} catch (error) {
  console.warn("search index build failed:", error instanceof Error ? error.message : String(error));
}

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(cfg.port, cfg.host, () => {
  console.log(`llm-wiki web server listening on http://${cfg.host}:${cfg.port}`);
  console.log(`  source vault: ${cfg.sourceVaultRoot}`);
  console.log(`  runtime root: ${cfg.runtimeRoot}`);
  console.log(`  author:    ${cfg.author}`);
});

process.on("exit", () => {
  memoryScheduler.dispose();
  diaryImageScheduler.dispose();
});

function loadProjectEnv(projectRoot: string): void {
  loadDotenv({ path: path.join(projectRoot, ".env") });
}
