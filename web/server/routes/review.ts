import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  backfillLegacyNeedsDeepResearchRepairs,
  backfillLegacyOutdatedSourceRepairs,
  bulkAdvanceDeepResearchItems,
  bulkConfirmDeepResearchItems,
  confirmDeepResearchWrite,
  getDeepResearchItem,
  needsDeepResearch,
  resumeRunningDeepResearchItems,
  setDeepResearchChatId,
  startDeepResearchAction,
  type DeepResearchAction,
} from "../services/deep-research.js";
import { queueReviewInboxBatchIngest } from "../services/review-inbox-batch.js";
import { aggregateReviewItems, mapDeepResearchItemToReviewItem, type ReviewSummary } from "../services/review-aggregator.js";
import { attachStoredReviewWebSearchSuggestions } from "../services/review-web-search.js";
import type { RunManager } from "../services/run-manager.js";
import { addConversationMessage, createConversation, getConversation } from "../services/chat-store.js";

export function handleReviewSummary(cfg: ServerConfig, runManager: RunManager) {
  return (_req: Request, res: Response) => {
    backfillLegacyOutdatedSourceRepairs(cfg.runtimeRoot, cfg.sourceVaultRoot);
    backfillLegacyNeedsDeepResearchRepairs(cfg.runtimeRoot, cfg.sourceVaultRoot);
    resumeRunningDeepResearchItems(cfg.runtimeRoot, cfg.sourceVaultRoot);
    const data = attachStoredReviewWebSearchSuggestions(cfg.runtimeRoot, aggregateReviewItems({
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      projectRoot: cfg.projectRoot,
      currentRun: runManager.getCurrent(),
    }));
    res.json({
      success: true,
      data,
    });
  };
}

export function handleDeepResearchAction(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const action = normalizeAction(req.body?.action);
      if (!action) {
        res.status(400).json({ success: false, error: "invalid deep research action" });
        return;
      }
      const item = await startDeepResearchAction(cfg.runtimeRoot, cfg.sourceVaultRoot, req.params.id, action);
      res.json({ success: true, data: mapDeepResearchItemToReviewItem(item) });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleDeepResearchConfirm(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const item = await confirmDeepResearchWrite(cfg.runtimeRoot, cfg.sourceVaultRoot, req.params.id);
      res.json({ success: true, data: mapDeepResearchItemToReviewItem(item) });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleDeepResearchChat(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const item = getDeepResearchItem(cfg.runtimeRoot, req.params.id);
    if (!item) {
      res.status(404).json({ success: false, error: "deep research item not found" });
      return;
    }

    const existing = item.chatId ? getConversation(cfg.sourceVaultRoot, item.chatId) : null;
    const conversation = existing ?? createConversation(cfg.sourceVaultRoot, {
      title: `${item.title} · ${basename(item.pagePath)}`,
      webSearchEnabled: true,
      searchScope: "web",
      articleRefs: [item.pagePath],
    });

    if (!existing) {
      addConversationMessage(cfg.sourceVaultRoot, conversation.id, {
        role: "user",
        content: [
          `问题类型：${item.title}`,
          `页面：${item.pagePath}`,
          item.line ? `行号：${item.line}` : "",
          `对象：${item.factText?.trim() || item.gapText.trim()}`,
          `触发依据：${item.triggerReason}`,
          item.errorMessage ? `失败原因：${item.errorMessage}` : "",
          item.draftResult ? `待确认写入预览：\n${item.draftResult.preview}` : "",
        ].filter(Boolean).join("\n"),
        articleRefs: [item.pagePath],
      });
      setDeepResearchChatId(cfg.runtimeRoot, item.id, conversation.id);
    }

    res.json({
      success: true,
      data: {
        id: conversation.id,
      },
    });
  };
}

export function handleDeepResearchBulkAdvance(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    try {
      const result = await bulkAdvanceDeepResearchItems(cfg.runtimeRoot, cfg.sourceVaultRoot);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleDeepResearchBulkConfirm(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    try {
      const result = await bulkConfirmDeepResearchItems(cfg.runtimeRoot, cfg.sourceVaultRoot);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleReviewInboxBatchIngest(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await queueReviewInboxBatchIngest(cfg.sourceVaultRoot, cfg.runtimeRoot, stringArrayBody(req.body?.targets));
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function normalizeAction(value: unknown): DeepResearchAction | null {
  return value === "start-rewrite"
    || value === "add-citation"
    || value === "deep-research"
    || value === "accept-suggestion"
    || value === "ignore"
    ? value
    : null;
}

function basename(pagePath: string): string {
  const normalized = pagePath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function stringArrayBody(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}
