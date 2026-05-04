/**
 * Flash-diary HTTP routes.
 *
 * Exposes diary listing, editable page reads/writes, the rendered Memory page,
 * and quick-capture failure recovery for the flash-diary workspace.
 */
import fs from "node:fs";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { createRenderer } from "../render/markdown.js";
import type { LLMProvider } from "../../../src/utils/provider.js";
import {
  appendFlashDiaryEntry,
  listFlashDiaryFiles,
  readFlashDiaryFailures,
  readFlashDiaryPage,
  recordFlashDiaryFailure,
  removeFlashDiaryFailure,
  readTwelveQuestionsPage,
  readTwelveQuestionsSummary,
  saveCloudDocument,
  saveFlashDiaryPage,
  saveTwelveQuestionsPage,
  TWELVE_QUESTIONS_PATH,
} from "../services/flash-diary.js";
import {
  resolveFlashDiaryMediaFullPath,
  saveFlashDiaryEditorImage,
} from "../services/flash-diary-media.js";
import { ensureSourceImageOcr } from "../services/source-ocr.js";
import {
  isLegacyShortTermMemory,
  readFlashDiaryMemoryPage,
  readFlashDiaryMemorySummary,
  readStoredFlashDiaryMemoryPage,
  refreshStoredFlashDiaryShortTermPage,
  refreshFlashDiaryMemoryIfDue,
} from "../services/flash-diary-memory.js";
import {
  MEMORY_PATH,
  MEMORY_TITLE,
  writeFlashDiaryMemoryCopies,
} from "../services/flash-diary-memory-files.js";
import { recordWorkflowInput } from "../services/workflow-recorder.js";

const STORED_MEMORY_SHORT_TERM_REFRESH_TIMEOUT_MS = 5;

export function handleFlashDiaryList(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    const items = await listFlashDiaryFiles(cfg.sourceVaultRoot);
    const memory = readFlashDiaryMemorySummary(cfg.sourceVaultRoot, cfg.runtimeRoot);
    const twelveQuestions = await readTwelveQuestionsSummary(cfg.sourceVaultRoot);
    res.json({ success: true, data: { items, memory, twelveQuestions } });
  };
}

export function handleFlashDiaryPage(cfg: ServerConfig) {
  const renderer = createRenderer({ pageLookupRoot: cfg.sourceVaultRoot });

  return async (req: Request, res: Response) => {
    try {
      const rawPath = String(req.query.path ?? "").trim();
      const page = rawPath.replace(/\\/g, "/") === TWELVE_QUESTIONS_PATH
        ? await readTwelveQuestionsPage(cfg.sourceVaultRoot)
        : await readFlashDiaryPage(cfg.sourceVaultRoot, rawPath);
      const rendered = renderer.render(page.raw);
      res.json({
        success: true,
        data: {
          ...page,
          html: rendered.html,
        },
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleFlashDiaryMemory(
  cfg: ServerConfig,
  options: { now?: Date; provider?: LLMProvider; shortTermRefreshTimeoutMs?: number } = {},
) {
  const renderer = createRenderer({ pageLookupRoot: cfg.sourceVaultRoot });

  return async (_req: Request, res: Response) => {
    try {
      const storedPage = readStoredFlashDiaryMemoryPage(cfg.sourceVaultRoot, cfg.runtimeRoot);
      if (storedPage) {
        const shortTermRefreshTimeoutMs = options.shortTermRefreshTimeoutMs ?? STORED_MEMORY_SHORT_TERM_REFRESH_TIMEOUT_MS;
        const immediatePage = isLegacyShortTermMemory(storedPage.raw) && options.provider
          ? await Promise.race([
            refreshStoredFlashDiaryShortTermPage({
            projectRoot: cfg.projectRoot,
            sourceVaultRoot: cfg.sourceVaultRoot,
            runtimeRoot: cfg.runtimeRoot,
            now: options.now,
            provider: options.provider,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), shortTermRefreshTimeoutMs)),
          ]) ?? storedPage
          : storedPage;
        await writeFlashDiaryMemoryCopies(cfg.sourceVaultRoot, cfg.runtimeRoot, immediatePage.raw);
        void refreshFlashDiaryMemoryIfDue({
          projectRoot: cfg.projectRoot,
          sourceVaultRoot: cfg.sourceVaultRoot,
          runtimeRoot: cfg.runtimeRoot,
          now: options.now,
          provider: options.provider,
        }).catch(() => undefined);
        const rendered = renderer.render(immediatePage.raw);
        res.json({
          success: true,
          data: {
            ...immediatePage,
            html: rendered.html,
          },
        });
        return;
      }
      const page = await readFlashDiaryMemoryPage({
        projectRoot: cfg.projectRoot,
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        now: options.now,
        provider: options.provider,
      });
      const rendered = renderer.render(page.raw);
      res.json({
        success: true,
        data: {
          ...page,
          html: rendered.html,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleFlashDiarySave(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const rawPath = String(req.body?.path ?? "").trim();
      const raw = String(req.body?.raw ?? "");
      if (rawPath.replace(/\\/g, "/") === MEMORY_PATH) {
        await writeFlashDiaryMemoryCopies(cfg.sourceVaultRoot, cfg.runtimeRoot, raw);
        await saveCloudDocument(MEMORY_PATH, MEMORY_TITLE, raw).catch(() => undefined);
      } else if (rawPath.replace(/\\/g, "/") === TWELVE_QUESTIONS_PATH) {
        await saveTwelveQuestionsPage(cfg.sourceVaultRoot, raw);
      } else {
        await saveFlashDiaryPage(cfg.sourceVaultRoot, rawPath, raw);
        await ensureDiaryOcr(cfg, rawPath);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleFlashDiaryMediaUpload(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      const diaryPath = String(req.body?.path ?? "").trim();
      const fileName = String(req.body?.fileName ?? "").trim();
      const dataUrl = String(req.body?.dataUrl ?? "").trim();
      const uploaded = saveFlashDiaryEditorImage(cfg.sourceVaultRoot, diaryPath, fileName, dataUrl);
      res.json({ success: true, data: uploaded });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleFlashDiaryMedia(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const logicalPath = String(req.query.path ?? "").trim();
    const fullPath = resolveFlashDiaryMediaFullPath(cfg.sourceVaultRoot, logicalPath);
    if (!fullPath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.status(404).send("not found");
      return;
    }
    res.sendFile(fullPath);
  };
}

export function handleFlashDiaryAppend(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const text = String(req.body?.text ?? "");
    const mediaPaths = Array.isArray(req.body?.mediaPaths)
      ? req.body.mediaPaths.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const now = req.body?.now ? new Date(String(req.body.now)) : new Date();
    try {
      const result = await appendFlashDiaryEntry(cfg.sourceVaultRoot, { text, mediaPaths, now });
      await ensureDiaryOcr(cfg, result.path);
      await recordWorkflowInput(cfg, {
        text,
        attachments: result.mediaFiles,
        marker: "normal",
        source: "diary",
      });
      res.json({ success: true, data: result });
    } catch (error) {
      const record = await recordFlashDiaryFailure(cfg.runtimeRoot, {
        createdAt: now.toISOString(),
        targetDate: now.toISOString().slice(0, 10),
        text,
        mediaFiles: mediaPaths,
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
      res.status(500).json({ success: false, error: record.error, data: record });
    }
  };
}

export function handleFlashDiaryRetry(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const failure = readFlashDiaryFailures(cfg.runtimeRoot).find((item) => item.id === id);
    if (!failure) {
      res.status(404).json({ success: false, error: "flash diary failure not found" });
      return;
    }

    try {
      const result = await appendFlashDiaryEntry(cfg.sourceVaultRoot, {
        text: failure.text,
        mediaPaths: failure.mediaFiles,
        now: new Date(failure.createdAt),
      });
      await ensureDiaryOcr(cfg, result.path);
      await recordWorkflowInput(cfg, {
        text: failure.text,
        attachments: result.mediaFiles,
        marker: "normal",
        source: "diary",
      });
      await removeFlashDiaryFailure(cfg.runtimeRoot, id);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

async function ensureDiaryOcr(cfg: ServerConfig, diaryPath: string): Promise<void> {
  await ensureSourceImageOcr({
    sourceVaultRoot: cfg.sourceVaultRoot,
    runtimeRoot: cfg.runtimeRoot,
    recordPaths: [diaryPath],
    rescan: true,
  });
}
