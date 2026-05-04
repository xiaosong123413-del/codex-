import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { readXiaohongshuImportConfig } from "../services/xiaohongshu-import.js";
import { runDouyinSingle, type DouyinCollector, type DouyinRunOptions } from "../services/douyin-sync.js";
import {
  runClipTask,
  type ClipRunOptions,
} from "../services/clip-pipeline.js";
import { detectClipPlatform } from "../services/clip-platform.js";
import {
  appendLocalClippingMedia,
  readLocalMediaPaths,
} from "../services/clipping-local-media.js";
import { detectYtDlp, installYtDlp, type YtDlpStatus } from "../services/yt-dlp.js";
import { runXhsSingle, type XhsRunOptions } from "../services/xhs-sync.js";

interface ClipRouteOptions extends ClipRunOptions {
  detector?: (projectRoot: string) => Promise<YtDlpStatus>;
  installer?: (projectRoot: string) => Promise<YtDlpStatus>;
  xhs?: XhsRunOptions;
  douyin?: DouyinRunOptions;
}

interface DesktopDouyinCapture {
  localVideoPath: string;
  title?: string;
  desc?: string;
  author?: string;
  date?: string;
  durationSeconds?: number;
  videoSourceUrl?: string;
}

interface ClipRouteInput {
  url: string;
  title?: string;
  body?: string;
  mediaPaths: string[];
  now: Date;
  desktopCapture: DesktopDouyinCapture | null;
}

interface ClipRouteResult {
  status: string;
  path?: string;
  error?: unknown;
}

export function handleClipCreate(cfg: ServerConfig, options: ClipRouteOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = readClipRouteInput(req);
      const data = await routeClipCreate(cfg, input, options);
      await appendSuccessfulClipMedia(cfg, data, input.mediaPaths);
      sendClipResult(res, data);
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleYtDlpStatus(cfg: ServerConfig, options: ClipRouteOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const data = await (options.detector ?? detectYtDlp)(cfg.projectRoot);
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleYtDlpInstall(cfg: ServerConfig, options: ClipRouteOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const installer = options.installer ?? installYtDlp;
      const detector = options.detector ?? detectYtDlp;
      const current = await detector(cfg.projectRoot);
      const data = current.installed
        ? { ...current, message: "yt-dlp already installed" }
        : await installer(cfg.projectRoot);
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

function sendError(res: Response, error: unknown): void {
  res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
}

function sendClipResult(res: Response, data: ClipRouteResult): void {
  res.status(data.status === "failed" ? 400 : 200).json({ success: data.status !== "failed", data, error: data.error });
}

function stringBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readClipRouteInput(req: Request): ClipRouteInput {
  return {
    url: stringBody(req.body?.url) ?? "",
    title: stringBody(req.body?.title),
    body: stringBody(req.body?.body),
    mediaPaths: readLocalMediaPaths(req.body?.mediaPaths),
    now: readClipRouteDate(req.body?.now),
    desktopCapture: readDesktopDouyinCapture(req.body?.desktopCapture),
  };
}

async function appendSuccessfulClipMedia(
  cfg: ServerConfig,
  data: ClipRouteResult,
  mediaPaths: readonly string[],
): Promise<void> {
  if (data.status === "failed" || !data.path || mediaPaths.length === 0) {
    return;
  }
  await appendLocalClippingMedia(cfg.sourceVaultRoot, cfg.runtimeRoot, data.path, mediaPaths);
}

function readClipRouteDate(value: unknown): Date {
  const raw = stringBody(value);
  return raw ? new Date(raw) : new Date();
}

async function routeClipCreate(
  cfg: ServerConfig,
  input: ClipRouteInput,
  options: ClipRouteOptions,
): Promise<ClipRouteResult> {
  const platform = detectClipPlatform(input.url);
  if (platform === "xhs") {
    return runXhsClipRoute(cfg, input, options);
  }
  if (platform === "douyin") {
    return runDouyinClipRoute(cfg, input, options);
  }
  return runDefaultClipRoute(cfg, input, options);
}

async function runXhsClipRoute(
  cfg: ServerConfig,
  input: ClipRouteInput,
  options: ClipRouteOptions,
): Promise<ClipRouteResult> {
  const outputRoot = resolveXhsOutputRoot(cfg.projectRoot);
  return runXhsSingle(cfg.sourceVaultRoot, {
    url: input.url,
    body: input.body,
    now: input.now,
  }, { ...options.xhs, outputRoot, projectRoot: cfg.projectRoot });
}

async function runDouyinClipRoute(
  cfg: ServerConfig,
  input: ClipRouteInput,
  options: ClipRouteOptions,
): Promise<ClipRouteResult> {
  return runDouyinSingle(cfg.sourceVaultRoot, {
    url: input.url,
    body: input.body,
    now: input.now,
  }, {
    ...options.douyin,
    collector: input.desktopCapture
      ? createDesktopDouyinCollector(input.url, input.body, input.desktopCapture)
      : options.douyin?.collector,
    projectRoot: cfg.projectRoot,
  });
}

async function runDefaultClipRoute(
  cfg: ServerConfig,
  input: ClipRouteInput,
  options: ClipRouteOptions,
): Promise<ClipRouteResult> {
  return runClipTask(cfg.sourceVaultRoot, {
    url: input.url,
    title: input.title,
    body: input.body,
    quality: "720",
    now: input.now,
  }, { runner: options.runner, projectRoot: cfg.projectRoot, runtimeRoot: cfg.runtimeRoot });
}

function resolveXhsOutputRoot(projectRoot: string): string | undefined {
  const config = readXiaohongshuImportConfig(projectRoot);
  return config.importDirPath || undefined;
}

function readDesktopDouyinCapture(value: unknown): DesktopDouyinCapture | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const localVideoPath = stringBody(record.localVideoPath);
  if (!localVideoPath) {
    return null;
  }
  const durationSeconds = numberBody(record.durationSeconds);
  return {
    localVideoPath,
    title: stringBody(record.title),
    desc: stringBody(record.desc),
    author: stringBody(record.author),
    date: stringBody(record.date),
    durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : undefined,
    videoSourceUrl: stringBody(record.videoSourceUrl),
  };
}

function createDesktopDouyinCollector(
  sourceUrl: string,
  userBody: string | undefined,
  capture: DesktopDouyinCapture,
): DouyinCollector {
  return {
    // fallow-ignore-next-line complexity
    async collect(input) {
      const sourceVideoPath = path.resolve(capture.localVideoPath);
      if (!fs.existsSync(sourceVideoPath)) {
        throw new Error(`桌面端抖音视频文件不存在：${sourceVideoPath}`);
      }
      const videoDir = path.join(input.outputDir, "video");
      fs.mkdirSync(videoDir, { recursive: true });
      const postId = readDouyinPostId(sourceUrl);
      const extension = inferVideoExtension(sourceVideoPath);
      const targetPath = uniqueDesktopVideoPath(videoDir, `${postId || "douyin-desktop"}.${extension}`);
      fs.copyFileSync(sourceVideoPath, targetPath);
      const normalizedSourceUrl = capture.videoSourceUrl ?? sourceUrl;
      return {
        post: {
          id: postId || "douyin-desktop",
          title: capture.title || firstLine(userBody) || "未命名抖音视频",
          desc: capture.desc || userBody || "",
          date: normalizeCaptureDate(capture.date),
          author: capture.author || "未知作者",
          tags: [],
          sourceUrl,
          videoUrl: normalizedSourceUrl,
          durationSeconds: capture.durationSeconds,
        },
        video: {
          sourceUrl: normalizedSourceUrl,
          storedPath: path.relative(input.outputDir, targetPath).split(path.sep).join("/"),
        },
      };
    },
  };
}

function numberBody(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readDouyinPostId(value: string): string {
  return /\/(?:video|note)\/(\d{8,})/i.exec(value)?.[1] ?? "";
}

function inferVideoExtension(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
  return extension && /^[a-z0-9]+$/i.test(extension) ? extension : "mp4";
}

function uniqueDesktopVideoPath(videoDir: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let attempt = path.join(videoDir, `${parsed.name}${parsed.ext}`);
  let index = 1;
  while (fs.existsSync(attempt)) {
    attempt = path.join(videoDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return attempt;
}

function firstLine(value: string | undefined): string {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function normalizeCaptureDate(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return new Date().toISOString().slice(0, 10);
}
