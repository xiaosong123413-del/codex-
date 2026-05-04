import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { readAgentConfig, type AgentDefinition } from "./agent-config.js";
import { resolveAgentRuntimeProvider } from "./llm-chat.js";
import { detectYtDlp } from "./yt-dlp.js";
import { sourceMediaId } from "./source-media-index.js";
import { transcribeFileWithCloudflare, writeSourceTranscriptSidecar } from "./transcript-service.js";
import { CloudflareProvider } from "../../../src/providers/cloudflare.js";
import type { LLMProvider } from "../../../src/utils/provider.js";
import {
  buildExecutableEnv,
  parseDecisionNoteDraft,
  resolveExecutablePath,
  type XhsDecisionNoteDraft,
} from "./xhs-sync.js";

const DOUYIN_OUTPUT_SEGMENTS = ["raw", "剪藏", "抖音"];
const DOUYIN_COOKIE_FILE = path.join(".llmwiki", "douyin-cookie.txt");
const DOUYIN_DECISION_AGENT_ID = "xhs-decision-note";
const DOUYIN_PROJECT_CONTEXT_FILES = [
  "docs/current-task.md",
  "docs/project-log.md",
  "docs/project-pending.json",
  "progress.json",
];
const DOUYIN_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const execFileAsync = promisify(execFile);

type DouyinSyncStatus = "completed" | "partial" | "failed";

interface DouyinSingleInput {
  url: string;
  body?: string;
  now?: Date;
}

interface DouyinPost {
  id: string;
  title: string;
  desc: string;
  date: string;
  author: string;
  tags: string[];
  sourceUrl: string;
  videoUrl: string;
  durationSeconds?: number;
}

interface DouyinCollectedMedia {
  sourceUrl: string;
  storedPath: string;
}

interface DouyinCollectedPost {
  post: DouyinPost;
  video?: DouyinCollectedMedia;
  warnings?: string[];
}

interface DouyinCollectInput {
  url: string;
  outputDir: string;
  quality: "720";
  projectRoot: string;
}

export interface DouyinCollector {
  collect(input: DouyinCollectInput): Promise<DouyinCollectedPost>;
}

interface DouyinPostFormatterInput {
  agent: {
    id: string;
    name: string;
    purpose: string;
    workflow: string;
    prompt: string;
  } | null;
  projectContext: string;
  sourceUrl: string;
  post: {
    id: string;
    title: string;
    desc: string;
    date: string;
    author: string;
    tags: string[];
    durationSeconds?: number;
  };
  userBody: string;
  transcript: string;
}

type DouyinVideoTranscriber = (
  post: DouyinPost,
  video: DouyinCollectedMedia,
  options: DouyinRunOptions,
) => Promise<string>;

type DouyinTranscriptFormatter = (input: { transcript: string; post: DouyinPost }) => Promise<string>;
type DouyinPostFormatter = (input: DouyinPostFormatterInput) => Promise<XhsDecisionNoteDraft>;

export interface DouyinRunOptions {
  collector?: DouyinCollector;
  tempDir?: string;
  whisperModel?: string;
  videoTranscriber?: DouyinVideoTranscriber;
  transcriptFormatter?: DouyinTranscriptFormatter;
  outputRoot?: string;
  projectRoot?: string;
  postFormatter?: DouyinPostFormatter;
  cookiesPath?: string;
  cookieBrowsers?: readonly string[];
}

interface DouyinSyncTask {
  id: string;
  command: "douyin";
  status: DouyinSyncStatus;
  createdAt: string;
  updatedAt: string;
  urls: string[];
  path?: string;
  error?: string;
  warnings: string[];
}

interface DouyinSingleResult {
  status: DouyinSyncStatus;
  task: DouyinSyncTask;
  path?: string;
  error?: string;
  warnings: string[];
}

interface DouyinCookieStatus {
  hasCookie: boolean;
  path: string;
}

interface DouyinArtifacts {
  warnings: string[];
  transcript?: string;
  video: DouyinCollectedMedia;
}

interface DouyinRawMetadata {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  uploader?: unknown;
  channel?: unknown;
  webpage_url?: unknown;
  duration?: unknown;
  timestamp?: unknown;
  upload_date?: unknown;
  tags?: unknown;
}

interface DouyinCookieStrategy {
  label: string;
  args: string[];
  cleanup?: () => Promise<void>;
}

export async function runDouyinSingle(
  wikiRoot: string,
  input: DouyinSingleInput,
  options: DouyinRunOptions = {},
): Promise<DouyinSingleResult> {
  const url = input.url.trim();
  if (!url) {
    throw new Error("douyin url required");
  }
  const createdAt = (input.now ?? new Date()).toISOString();
  const task = createTask(url, createdAt);
  try {
    const outputDir = resolveDouyinOutputDir(wikiRoot, options.outputRoot);
    const collected = await (options.collector ?? createDouyinCollector(options.projectRoot ?? wikiRoot, options)).collect({
      url,
      outputDir,
      quality: "720",
      projectRoot: options.projectRoot ?? wikiRoot,
    });
    if (!collected.video) {
      throw new Error("抖音视频下载完成，但没有找到本地视频文件");
    }
    const artifacts: DouyinArtifacts = {
      warnings: [...(collected.warnings ?? [])],
      video: collected.video,
    };
    try {
      artifacts.transcript = await transcribeDouyinVideo(outputDir, collected.post, collected.video, options);
      artifacts.transcript = await formatDouyinTranscript(artifacts.transcript, collected.post, options);
      if (!artifacts.transcript.trim()) {
        artifacts.warnings.push("视频转录已执行，但没有得到有效文本；已保存视频链接。");
      }
    } catch (error) {
      artifacts.warnings.push(`视频转录失败：${errorMessage(error)}；已保存视频链接。`);
    }
    const decision = await formatDouyinDecisionNote(wikiRoot, url, collected.post, input.body, artifacts.transcript, options);
    artifacts.warnings.push(...decision.warnings);
    const markdownPath = uniqueMarkdownPath(wikiRoot, outputDir, decision.note.shortTitle);
    await writeDouyinMarkdown(wikiRoot, markdownPath, collected.post, input.body, artifacts, decision.note);
    await writeDouyinTranscriptSidecar(wikiRoot, markdownPath, artifacts.transcript);
    const status: DouyinSyncStatus = artifacts.warnings.length > 0 ? "partial" : "completed";
    const finished = finishTask(task, status, { path: markdownPath, warnings: artifacts.warnings });
    return { status, task: finished, path: markdownPath, warnings: artifacts.warnings };
  } catch (error) {
    const failed = finishTask(task, "failed", { error: errorMessage(error), warnings: [] });
    return { status: "failed", task: failed, error: failed.error, warnings: [] };
  }
}

export async function saveDouyinCookie(projectRoot: string, cookie: string): Promise<DouyinCookieStatus> {
  const normalized = cookie.trim();
  if (!normalized) {
    throw new Error("cookie 不能为空");
  }
  const file = resolveDouyinCookiesPath(projectRoot, {});
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${normalized}\n`, "utf8");
  return readDouyinCookieStatus(projectRoot);
}

export function readDouyinCookieStatus(projectRoot: string): DouyinCookieStatus {
  const file = resolveDouyinCookiesPath(projectRoot, {});
  return {
    hasCookie: fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().length > 0,
    path: file,
  };
}

export function createDouyinCollector(projectRoot: string, options: DouyinRunOptions = {}): DouyinCollector {
  return {
    async collect(input: DouyinCollectInput): Promise<DouyinCollectedPost> {
      const status = await detectYtDlp(projectRoot);
      if (!status.installed || !status.path) {
        throw new Error("yt-dlp not found");
      }
      await mkdir(path.join(input.outputDir, "video"), { recursive: true });
      const failures: string[] = [];
      for (const strategy of await buildDouyinCookieStrategies(input.projectRoot, options)) {
        try {
          const raw = await runCommand(status.path, [
            ...buildDouyinBaseArgs(),
            ...strategy.args,
            "--dump-single-json",
            "--skip-download",
            input.url,
          ]);
          const metadata = JSON.parse(raw) as DouyinRawMetadata;
          const videoPath = await downloadDouyinVideo(status.path, input, strategy);
          const post = normalizeDouyinPost(metadata, input.url);
          return {
            post,
            video: {
              sourceUrl: post.videoUrl,
              storedPath: toStoredMediaPath(input.outputDir, videoPath),
            },
          };
        } catch (error) {
          failures.push(`${strategy.label}: ${errorMessage(error)}`);
        } finally {
          await strategy.cleanup?.();
        }
      }
      if (failures.some((message) => isDouyinCookieFailure(message))) {
        throw new Error(formatDouyinCookieFailure(input.projectRoot, options, failures));
      }
      throw new Error(failures[failures.length - 1] ?? "抖音视频采集失败");
    },
  };
}

function formatDouyinCookieFailure(
  projectRoot: string,
  options: DouyinRunOptions,
  failures: readonly string[],
): string {
  return [
    "抖音需要新的 cookies，请先刷新浏览器里的抖音登录状态；如果仍然失败，请保存项目级抖音 cookies。",
    `cookies 文件位置：${resolveDouyinCookiesPath(projectRoot, options)}`,
    `尝试记录：${failures.join(" | ")}`,
  ].join(" ");
}

async function downloadDouyinVideo(
  binary: string,
  input: DouyinCollectInput,
  strategy: DouyinCookieStrategy,
): Promise<string> {
  const before = await listFiles(path.join(input.outputDir, "video"));
  await runCommand(binary, [
    ...buildDouyinBaseArgs(),
    ...strategy.args,
    "-f",
    "bv*[height<=720]+ba/b[height<=720]/best[height<=720]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    path.join(input.outputDir, "video", "%(title).80s.%(ext)s"),
    input.url,
  ]);
  const after = await listFiles(path.join(input.outputDir, "video"));
  const video = [...after]
    .filter((file) => !before.has(file))
    .find((file) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(file));
  if (!video) {
    throw new Error("抖音视频下载完成，但没有生成本地视频文件");
  }
  return video;
}

async function transcribeDouyinVideo(
  outputDir: string,
  post: DouyinPost,
  video: DouyinCollectedMedia,
  options: DouyinRunOptions,
): Promise<string> {
  if (options.videoTranscriber) {
    return await options.videoTranscriber(post, video, options);
  }
  const localVideoPath = resolveDownloadedMediaPath(outputDir, video.storedPath);
  if (!localVideoPath) {
    throw new Error("本地视频文件不存在");
  }
  const cloudflareResult = await transcribeFileWithCloudflare({ filePath: localVideoPath });
  if (cloudflareResult.ok) {
    return cloudflareResult.text;
  }
  if (cloudflareResult.error.type !== "cloudflare-unconfigured") {
    try {
      return await transcribeVideoFileWithWhisper(localVideoPath, post.id, options);
    } catch (fallbackError) {
      throw new Error([
        `Cloudflare: ${cloudflareResult.error.message}`,
        `Whisper: ${errorMessage(fallbackError)}`,
      ].join(" | "));
    }
  }
  return await transcribeVideoFileWithWhisper(localVideoPath, post.id, options);
}

async function writeDouyinTranscriptSidecar(
  wikiRoot: string,
  markdownPath: string,
  transcript?: string,
): Promise<void> {
  const text = transcript?.trim();
  if (!text) {
    return;
  }
  const relativeMarkdownPath = toSourceGalleryPath(wikiRoot, markdownPath);
  if (!relativeMarkdownPath) {
    return;
  }
  await writeSourceTranscriptSidecar(wikiRoot, sourceMediaId(relativeMarkdownPath), text);
}

async function writeDouyinMarkdown(
  wikiRoot: string,
  markdownPath: string,
  post: DouyinPost,
  userBody: string | undefined,
  artifacts: DouyinArtifacts,
  decision: XhsDecisionNoteDraft,
): Promise<void> {
  const lines = [
    "---",
    `title: ${yamlQuote(decision.insightTitle)}`,
    `short_title: ${yamlQuote(decision.shortTitle)}`,
    `original_title: ${yamlQuote(post.title)}`,
    "type: douyin-clipping",
    "platform: douyin",
    `source_url: ${yamlQuote(post.sourceUrl)}`,
    `video_id: ${yamlQuote(post.id)}`,
    `created: ${yamlQuote(new Date().toISOString())}`,
    `post_date: ${yamlQuote(post.date)}`,
    `author: ${yamlQuote(post.author)}`,
    `clip_status: ${artifacts.warnings.length > 0 ? "partial" : "completed"}`,
    "tags: [剪藏, 抖音]",
    "---",
    "",
    `# ${decision.insightTitle}`,
    "",
    ...decision.summaryLines.slice(0, 6),
    "",
    "> [!tip]- 详情",
    ...quoteBlockLines([
      `原文链接: ${post.sourceUrl}`,
      `原始标题: ${post.title}`,
      "",
      "决策笔记:",
      decision.decisionNote,
      "",
      post.desc || "原视频没有额外文案。",
      "",
      "视频:",
      `![](${artifacts.video.storedPath})`,
      "",
    ]),
  ];
  if (artifacts.transcript?.trim()) {
    lines.push(...quoteBlockLines(["视频转录:", artifacts.transcript.trim(), ""]));
  }
  if (userBody?.trim()) {
    lines.push(...quoteBlockLines(["用户备注:", userBody.trim(), ""]));
  }
  if (artifacts.warnings.length > 0) {
    lines.push(...quoteBlockLines(["同步警告:", artifacts.warnings.join("\n\n"), ""]));
  }
  lines.push(
    "> [!info]- 笔记属性",
    ...quoteBlockLines([
      `- 来源: 抖音 · ${post.author}`,
      `- 视频ID: ${post.id}`,
      `- 日期: ${post.date}`,
      `- 标签: ${post.tags.join(", ") || "无"}`,
      post.durationSeconds ? `- 时长: ${formatDuration(post.durationSeconds)}` : "- 时长: 未知",
    ]),
  );
  const outputFile = resolveStoredPath(wikiRoot, markdownPath);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${lines.join("\n").trim()}\n`, "utf8");
}

async function formatDouyinDecisionNote(
  wikiRoot: string,
  sourceUrl: string,
  post: DouyinPost,
  userBody: string | undefined,
  transcript: string | undefined,
  options: DouyinRunOptions,
): Promise<{ note: XhsDecisionNoteDraft; warnings: string[] }> {
  const fallback = buildFallbackDecisionNote(post, userBody, transcript);
  if (!options.projectRoot && !options.postFormatter) {
    return { note: fallback, warnings: [] };
  }
  const projectRoot = options.projectRoot ?? wikiRoot;
  const agent = options.projectRoot ? readDouyinDecisionAgent(projectRoot) : null;
  const formatterInput = buildDouyinPostFormatterInput(projectRoot, sourceUrl, post, userBody, transcript, agent);
  try {
    const draft = options.postFormatter
      ? await options.postFormatter(formatterInput)
      : await formatDouyinPostWithAgent(projectRoot, formatterInput, agent);
    return { note: normalizeDecisionNoteDraft(draft, fallback), warnings: [] };
  } catch (error) {
    return {
      note: fallback,
      warnings: [`LLM 决策笔记生成失败：${errorMessage(error)}；已使用规则化模板生成 partial 笔记。`],
    };
  }
}

async function formatDouyinPostWithAgent(
  projectRoot: string,
  input: DouyinPostFormatterInput,
  agent: AgentDefinition | null,
): Promise<XhsDecisionNoteDraft> {
  if (!agent) {
    throw new Error(`未找到 ${DOUYIN_DECISION_AGENT_ID} Agent`);
  }
  const provider = resolveDouyinDecisionProvider(projectRoot, agent, input.post.id);
  const system = [
    "你是 LLM Wiki 的抖音决策笔记格式化器。",
    "必须先阅读 agent workflow 和 prompt，再执行任务。",
    "只返回 JSON，不返回 Markdown，不返回解释。",
    "<agent_config>",
    `name: ${agent.name}`,
    agent.purpose ? `purpose: ${agent.purpose}` : "",
    agent.workflow ? `workflow:\n${agent.workflow}` : "",
    agent.prompt ? `prompt:\n${agent.prompt}` : "",
    "</agent_config>",
  ].filter(Boolean).join("\n\n");
  const raw = await provider.complete(system, [{ role: "user", content: buildDouyinDecisionPrompt(input) }], 900);
  return parseDecisionNoteDraft(raw);
}

async function formatDouyinTranscript(
  transcript: string,
  post: DouyinPost,
  options: DouyinRunOptions,
): Promise<string> {
  const raw = transcript.replace(/\r/g, "").trim();
  if (!raw) {
    return "";
  }
  if (options.transcriptFormatter) {
    const formatted = (await options.transcriptFormatter({ transcript: raw, post })).replace(/\r/g, "").trim();
    return formatted || raw;
  }
  return applyTranscriptLayout(raw);
}

function applyTranscriptLayout(transcript: string): string {
  const normalized = transcript
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  let formatted = normalized.replace(/([。！？!?；;])(?=[^\n])/g, "$1\n\n");
  for (const marker of ["第一个部分", "第二个部分", "第三个部分", "第四个部分", "第五个部分", "首先", "其次", "然后", "最后", "另外", "同时", "但是", "所以", "因为", "例如", "比如"]) {
    formatted = formatted.replace(new RegExp(marker, "g"), (match, offset) => (offset === 0 ? match : `\n\n${match}`));
  }
  return formatted
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function transcribeVideoFileWithWhisper(
  videoPath: string,
  postId: string,
  options: DouyinRunOptions,
): Promise<string> {
  const tempRoot = await mkdirTempDir(options.tempDir ?? os.tmpdir(), `douyin-audio-${postId}-`);
  const audioPath = path.join(tempRoot, `${postId}.wav`);
  try {
    await execFileAsync(resolveExecutablePath("ffmpeg"), [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      audioPath,
    ], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    const ffmpegPath = resolveExecutablePath("ffmpeg");
    const script = [
      "import json, sys, whisper",
      "audio_path = sys.argv[1]",
      "model_name = sys.argv[2]",
      "loaded = whisper.load_model(model_name)",
      "result = loaded.transcribe(audio_path, language='zh', fp16=False, verbose=False)",
      "print(json.dumps({'text': result.get('text', '')}, ensure_ascii=False))",
    ].join("; ");
    const { stdout } = await execFileAsync(resolveExecutablePath("py"), [
      "-X",
      "utf8",
      "-c",
      script,
      audioPath,
      options.whisperModel ?? process.env.LLM_WIKI_XHS_WHISPER_MODEL ?? "base",
    ], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: buildExecutableEnv(ffmpegPath, {
        ...process.env,
        PYTHONUTF8: "1",
      }),
    });
    const parsed = JSON.parse(stdout.trim()) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text.trim() : "";
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function resolveDouyinDecisionProvider(projectRoot: string, agent: AgentDefinition, postId: string): LLMProvider {
  if (agent.provider.trim().toLowerCase() === "cloudflare") {
    return new CloudflareProvider(agent.model.trim() || null);
  }
  return resolveAgentRuntimeProvider(projectRoot, agent, `douyin:${postId}`);
}

function readDouyinDecisionAgent(projectRoot: string): AgentDefinition | null {
  const config = readAgentConfig(projectRoot);
  return config.agents.find((agent) => agent.id === DOUYIN_DECISION_AGENT_ID && agent.enabled) ?? null;
}

function buildDouyinPostFormatterInput(
  projectRoot: string,
  sourceUrl: string,
  post: DouyinPost,
  userBody: string | undefined,
  transcript: string | undefined,
  agent: AgentDefinition | null,
): DouyinPostFormatterInput {
  return {
    agent: agent ? {
      id: agent.id,
      name: agent.name,
      purpose: agent.purpose,
      workflow: agent.workflow,
      prompt: agent.prompt,
    } : null,
    projectContext: loadDouyinProjectContext(projectRoot),
    sourceUrl,
    post: {
      id: post.id,
      title: post.title,
      desc: post.desc,
      date: post.date,
      author: post.author,
      tags: post.tags,
      durationSeconds: post.durationSeconds,
    },
    userBody: userBody?.trim() ?? "",
    transcript: transcript?.trim() ?? "",
  };
}

function buildDouyinDecisionPrompt(input: DouyinPostFormatterInput): string {
  return [
    "请把下面抖音视频内容重写成决策笔记 JSON。",
    "",
    "<project_context>",
    input.projectContext || "当前没有项目上下文文件。",
    "</project_context>",
    "",
    "<douyin_post>",
    JSON.stringify({
      sourceUrl: input.sourceUrl,
      post: input.post,
      userBody: input.userBody,
      transcript: input.transcript,
    }, null, 2),
    "</douyin_post>",
    "",
    "JSON 字段必须是：insightTitle, shortTitle, summaryLines, decisionNote。",
    "shortTitle 必须适合作为文件名，15 字以内。",
    "summaryLines 必须是数组，最多 6 行。",
  ].join("\n");
}

function buildFallbackDecisionNote(post: DouyinPost, userBody?: string, transcript?: string): XhsDecisionNoteDraft {
  const insightTitle = buildInsightTitle(post, userBody);
  return {
    insightTitle,
    shortTitle: buildFileTitle(insightTitle, post, userBody),
    summaryLines: buildSummary(post, userBody, transcript),
    decisionNote: [
      `原视频给出的核心变量是：${firstSentence(post.desc) || post.title}`,
      "先把视频叙事拆成可验证判断，而不是直接把情绪和观点归档成结论。",
      post.tags.length > 0 ? `这条内容可先归到这些观察方向：${post.tags.join(" / ")}。` : "暂时没有稳定标签，后续需要人工判断归类。",
      "下一步只做一件事：确认它是否会改变你当前项目、流程或职业动作里的一个具体决策。",
    ].join("\n"),
  };
}

function normalizeDecisionNoteDraft(draft: XhsDecisionNoteDraft, fallback: XhsDecisionNoteDraft): XhsDecisionNoteDraft {
  const summaryLines = draft.summaryLines
    .map((line) => String(line).trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    insightTitle: draft.insightTitle.trim() || fallback.insightTitle,
    shortTitle: sanitizeFileName(draft.shortTitle).replace(/\s+/g, "").slice(0, 15) || fallback.shortTitle,
    summaryLines: summaryLines.length > 0 ? summaryLines : fallback.summaryLines,
    decisionNote: draft.decisionNote.trim() || fallback.decisionNote,
  };
}

function buildInsightTitle(post: DouyinPost, userBody?: string): string {
  const source = firstSentence(userBody) || firstSentence(post.desc) || post.title || "抖音剪藏";
  const compact = source.replace(/[#【】\[\]（）()]/g, "").replace(/\s+/g, " ").trim();
  return `把${(compact.slice(0, 32) || "这条抖音视频")}转成可验证行动`;
}

function buildFileTitle(insightTitle: string, post: DouyinPost, userBody?: string): string {
  const source = post.title || titleFromBody(userBody) || insightTitle || "抖音剪藏";
  return source.replace(/[#【】\[\]（）()]/g, "").replace(/\s+/g, "").trim().slice(0, 15) || "抖音剪藏";
}

function buildSummary(post: DouyinPost, userBody: string | undefined, transcript?: string): string[] {
  const core = firstSentence(post.desc) || firstSentence(userBody) || firstSentence(transcript) || post.title;
  return [
    `这条视频的核心不是“${post.title}”，而是：${core}`,
    post.tags.length > 0 ? `它真正要验证的是：${post.tags.slice(0, 3).join(" / ")} 是否会改变行动结果。` : "它真正要验证的是：这条视频里的判断，是否足以改变一个具体动作。",
    transcript?.trim()
      ? "视频内容已转写，后续应优先抽取步骤、条件和边界，而不是保留情绪化叙述。"
      : "后续应优先抽取步骤、条件和边界，而不是保留情绪化叙述。",
    "决策用途：把视频经验压缩成可验证动作，再判断是否进入项目或工具库。",
  ].slice(0, 6);
}

async function runCommand(binary: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binary, args, {
    windowsHide: true,
    maxBuffer: 24 * 1024 * 1024,
  });
  const text = String(stdout).trim();
  if (!text && String(stderr).trim()) {
    throw new Error(String(stderr).trim());
  }
  return text;
}

function buildDouyinBaseArgs(): string[] {
  return [
    "--no-warnings",
    "--add-header",
    "Referer: https://www.douyin.com/",
    "--add-header",
    `User-Agent: ${DOUYIN_USER_AGENT}`,
  ];
}

async function buildDouyinCookieStrategies(projectRoot: string, options: DouyinRunOptions): Promise<DouyinCookieStrategy[]> {
  const strategies: DouyinCookieStrategy[] = [];
  for (const browser of options.cookieBrowsers ?? ["chrome", "edge", "firefox"]) {
    const name = browser.trim();
    if (name) {
      strategies.push({ label: `browser:${name}`, args: ["--cookies-from-browser", name] });
    }
  }
  const savedCookie = readSavedDouyinCookie(projectRoot, options);
  if (savedCookie) {
    const { path: cookiePath, cleanup } = await createDouyinCookieJar(savedCookie);
    strategies.push({ label: "saved-cookie", args: ["--cookies", cookiePath], cleanup });
  }
  return strategies;
}

async function createDouyinCookieJar(rawCookie: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempRoot = await mkdirTempDir(os.tmpdir(), "douyin-cookie-");
  const cookiePath = path.join(tempRoot, "cookies.txt");
  await writeFile(cookiePath, renderDouyinCookieJar(rawCookie), "utf8");
  return {
    path: cookiePath,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

function renderDouyinCookieJar(rawCookie: string): string {
  const lines = ["# Netscape HTTP Cookie File", ""];
  for (const entry of parseCookiePairs(rawCookie)) {
    lines.push([
      ".douyin.com",
      "TRUE",
      "/",
      "TRUE",
      "2147483647",
      entry.name,
      entry.value,
    ].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function parseCookiePairs(rawCookie: string): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = [];
  for (const segment of rawCookie.split(";")) {
    const part = segment.trim();
    if (!part) {
      continue;
    }
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim().replace(/[\r\n\t]/g, " ");
    if (!name || !value) {
      continue;
    }
    pairs.push({ name, value });
  }
  return pairs;
}

// fallow-ignore-next-line complexity
function normalizeDouyinPost(raw: DouyinRawMetadata, sourceUrl: string): DouyinPost {
  return {
    id: stringField(raw.id) || readDouyinPostId(sourceUrl) || crypto.createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16),
    title: stringField(raw.title) || "未命名抖音视频",
    desc: stringField(raw.description),
    date: formatDouyinDate(raw.timestamp, raw.upload_date),
    author: stringField(raw.uploader) || stringField(raw.channel) || "未知作者",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).map((item) => item.trim()).filter(Boolean) : [],
    sourceUrl: stringField(raw.webpage_url) || sourceUrl,
    videoUrl: stringField(raw.webpage_url) || sourceUrl,
    durationSeconds: typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : undefined,
  };
}

function createTask(url: string, createdAt: string): DouyinSyncTask {
  return {
    id: crypto.createHash("sha1").update(`${url}:${createdAt}`).digest("hex").slice(0, 16),
    command: "douyin",
    status: "failed",
    createdAt,
    updatedAt: createdAt,
    urls: [url],
    warnings: [],
  };
}

function finishTask(task: DouyinSyncTask, status: DouyinSyncStatus, patch: Partial<DouyinSyncTask>): DouyinSyncTask {
  return {
    ...task,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
    warnings: patch.warnings ?? task.warnings,
  };
}

function resolveDouyinOutputDir(wikiRoot: string, outputRoot?: string): string {
  return outputRoot?.trim() ? path.resolve(outputRoot.trim()) : path.join(wikiRoot, ...DOUYIN_OUTPUT_SEGMENTS);
}

function uniqueMarkdownPath(wikiRoot: string, outputDir: string, title: string): string {
  const base = sanitizeFileName(title).slice(0, 90) || "抖音剪藏";
  let name = `${base}.md`;
  let index = 1;
  while (fs.existsSync(path.join(outputDir, name))) {
    name = `${base}-${index}.md`;
    index += 1;
  }
  return toStoredPath(wikiRoot, path.join(outputDir, name));
}

async function listFiles(dir: string): Promise<Set<string>> {
  if (!fs.existsSync(dir)) {
    return new Set();
  }
  return new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name)));
}

async function mkdirTempDir(baseDir: string, prefix: string): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  return await fs.promises.mkdtemp(path.join(baseDir, prefix));
}

function resolveDownloadedMediaPath(outputDir: string, storedPath: string): string | null {
  const filePath = path.join(outputDir, ...storedPath.split("/"));
  return fs.existsSync(filePath) ? filePath : null;
}

function toStoredMediaPath(outputDir: string, absolutePath: string): string {
  return path.relative(outputDir, absolutePath).split(path.sep).join("/");
}

function toStoredPath(wikiRoot: string, absolutePath: string): string {
  const relative = path.relative(wikiRoot, absolutePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : path.normalize(absolutePath);
}

function resolveStoredPath(wikiRoot: string, storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.join(wikiRoot, ...storedPath.split("/"));
}

function toSourceGalleryPath(wikiRoot: string, markdownPath: string): string | null {
  if (!path.isAbsolute(markdownPath)) {
    return markdownPath.replace(/\\/g, "/");
  }
  const relativePath = path.relative(wikiRoot, markdownPath);
  return !relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath) ? null : relativePath.replace(/\\/g, "/");
}

function loadDouyinProjectContext(projectRoot: string): string {
  const chunks: string[] = [];
  for (const relativePath of DOUYIN_PROJECT_CONTEXT_FILES) {
    const filePath = path.join(projectRoot, ...relativePath.split("/"));
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (raw) {
      chunks.push(`## ${relativePath}\n${truncateChars(raw, 1800)}`);
    }
  }
  return truncateChars(chunks.join("\n\n---\n\n"), 5000);
}

function resolveDouyinCookiesPath(projectRoot: string, options: DouyinRunOptions): string {
  const configured = options.cookiesPath?.trim() || process.env.LLM_WIKI_DOUYIN_COOKIE_PATH?.trim();
  return configured ? path.resolve(configured) : path.join(projectRoot, DOUYIN_COOKIE_FILE);
}

function readSavedDouyinCookie(projectRoot: string, options: DouyinRunOptions): string {
  const file = resolveDouyinCookiesPath(projectRoot, options);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r/g, "").trim() : "";
}

function isDouyinCookieFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("fresh cookies")
    || normalized.includes("login")
    || normalized.includes("cookies")
    || normalized.includes("authorization")
    || normalized.includes("sign in");
}

function readDouyinPostId(value: string): string | null {
  return /\/(?:video|note)\/(\d{8,})/i.exec(value)?.[1] ?? null;
}

function formatDouyinDate(timestamp: unknown, uploadDate: unknown): string {
  const numeric = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(millis).toISOString().slice(0, 10);
  }
  const raw = stringField(uploadDate);
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : new Date().toISOString().slice(0, 10);
}

function quoteBlockLines(lines: string[]): string[] {
  return lines.map((line) => (line ? `> ${line}` : ">"));
}

function titleFromBody(body?: string): string | undefined {
  return body?.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^https?:\/\//i.test(line))?.slice(0, 80);
}

function firstSentence(value?: string): string {
  if (!value?.trim()) {
    return "";
  }
  return value.replace(/#([^#\s]+)\[话题\]#/g, "$1").split(/[。！？!?]\s*/).map((item) => item.trim()).find(Boolean)?.slice(0, 80) ?? "";
}

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  return chars.length <= maxChars ? value : `${chars.slice(0, maxChars).join("")}...`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
