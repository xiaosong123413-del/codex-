/**
 * Project work-log writer.
 *
 * A task card keeps the current execution state, while the project work-log
 * keeps the chronological process page under the user's area/project tree.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import type { TaskPlanPoolItem, TaskWorkflowLogEntry } from "./task-plan-store.js";

interface ProjectWorkLogInput {
  task: TaskPlanPoolItem;
  log: TaskWorkflowLogEntry;
  eventId: string;
}

export async function appendProjectWorkLog(
  cfg: ServerConfig,
  input: ProjectWorkLogInput,
): Promise<string | null> {
  if (!input.task.domain || !input.task.project) {
    return null;
  }
  const relPath = buildProjectWorkLogRelPath(input.task.domain, input.task.project);
  const filePath = path.join(cfg.sourceVaultRoot, relPath);
  await ensureProjectPages(cfg.sourceVaultRoot, input.task.domain, input.task.project);
  await appendWorkLogEntry(filePath, input);
  return relPath.split(path.sep).join("/");
}

function buildProjectWorkLogRelPath(domain: string, project: string): string {
  return path.join("领域", safeSegment(domain), safeSegment(project), "工作日志.md");
}

async function ensureProjectPages(root: string, domain: string, project: string): Promise<void> {
  await ensureMarkdownFile(path.join(root, "领域.md"), "# 领域\n");
  await ensureMarkdownFile(path.join(root, "领域", `${safeSegment(domain)}.md`), `# ${domain}\n`);
  await ensureMarkdownFile(
    path.join(root, "领域", safeSegment(domain), `${safeSegment(project)}.md`),
    `# ${project}\n`,
  );
  await ensureMarkdownFile(path.join(root, "领域", safeSegment(domain), safeSegment(project), "工作日志.md"), "# 工作日志\n");
}

async function ensureMarkdownFile(filePath: string, initialContent: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, `${initialContent.trimEnd()}\n`, "utf8");
  }
}

async function appendWorkLogEntry(filePath: string, input: ProjectWorkLogInput): Promise<void> {
  const existing = await readFile(filePath, "utf8");
  const entry = buildWorkLogEntry(input);
  await writeFile(filePath, `${existing.trimEnd()}\n\n${entry}\n`, "utf8");
}

function buildWorkLogEntry(input: ProjectWorkLogInput): string {
  const recorded = formatRecordedAt(input.log.recordedAt);
  const lines = [
    `## ${recorded.date} ${recorded.time}｜${input.task.title}`,
    `- 领域：${input.task.domain ?? "未绑定"}`,
    `- 项目：${input.task.project ?? "未绑定"}`,
    `- 任务：${input.task.title}`,
    `- 任务 ID：${input.task.id}`,
    `- 任务卡：task-pool/${input.task.id}`,
    `- 行动：${input.log.node}`,
    `- Workflow Event：workflow-event/${input.eventId}`,
    `- 工具：${input.log.tool}`,
    `- 记录：${input.log.input}`,
    `- 输出：${input.log.output}`,
    input.log.issue ? `- 问题：${input.log.issue}` : "",
    input.log.nextStep ? `- 下一步：${input.log.nextStep}` : "",
    input.log.attachments.length > 0 ? `- 附件：${input.log.attachments.join("、")}` : "",
    `- 任务卡记录：workflow-${input.log.sourceRecordId}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function formatRecordedAt(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "未知日期", time: "未知时间" };
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")}`,
  };
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, " ").replace(/\s+/gu, " ").trim();
}
