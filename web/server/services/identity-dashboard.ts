/**
 * Storage and AI generation helpers for the editable identity dashboard.
 *
 * Dashboard JSON lives next to the source Markdown page so it can move with the
 * user's wiki vault while leaving the Markdown facts untouched.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { resolveAgentRuntimeProvider } from "./llm-agent-provider.js";
import { readAppConfig } from "./app-config.js";
import type { LLMMessage, LLMProvider } from "../../../src/utils/provider.js";

interface IdentityDashboardWidget {
  id: string;
  type: string;
  title: string;
  enabled: boolean;
  layout: IdentityDashboardLayout;
  data: Record<string, unknown>;
  source: IdentityDashboardSource;
}

interface IdentityDashboardConfig {
  version: 1;
  sourcePath: string;
  widgets: IdentityDashboardWidget[];
}

interface IdentityDashboardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface IdentityDashboardSource {
  kind: string;
  note: string;
  path?: string;
  updatedAt?: string;
}

interface GenerateInput {
  widget?: IdentityDashboardWidget;
  prompt?: string;
  pageRaw?: string;
  provider?: LLMProvider;
}

const MAX_WIDGET_GENERATE_TOKENS = 1200;

export function readIdentityDashboardConfig(cfg: ServerConfig, logicalPath: string): IdentityDashboardConfig | null {
  const filePath = dashboardConfigPath(cfg, logicalPath);
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return normalizeDashboardConfig(parsed, logicalPath);
}

export function saveIdentityDashboardConfig(
  cfg: ServerConfig,
  logicalPath: string,
  input: unknown,
): IdentityDashboardConfig {
  const config = normalizeDashboardConfig(input, logicalPath);
  if (!config) throw new Error("invalid dashboard config");
  const filePath = dashboardConfigPath(cfg, logicalPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

// fallow-ignore-next-line complexity
export async function generateIdentityDashboardWidget(
  cfg: ServerConfig,
  input: GenerateInput,
): Promise<{ widget: IdentityDashboardWidget; raw: string }> {
  const widget = normalizeWidget(input.widget);
  if (!widget) throw new Error("invalid widget");
  const provider = input.provider ?? await resolveIdentityDashboardProvider(cfg.projectRoot);
  const raw = await provider.complete(
    buildWidgetGenerateSystemPrompt(),
    buildWidgetGenerateMessages(widget, input.prompt ?? "", input.pageRaw ?? ""),
    MAX_WIDGET_GENERATE_TOKENS,
  );
  return { widget: parseGeneratedWidget(raw, widget), raw };
}

function dashboardConfigPath(cfg: ServerConfig, logicalPath: string): string {
  const normalized = normalizeLogicalPath(logicalPath);
  if (!normalized.startsWith("wiki/") || !normalized.endsWith(".md")) {
    throw new Error("dashboard path must be a wiki markdown page");
  }
  return path.join(cfg.sourceVaultRoot, normalized.replace(/\.md$/u, ".dashboard.json"));
}

function normalizeLogicalPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../")) {
    throw new Error("invalid dashboard path");
  }
  return normalized;
}

// fallow-ignore-next-line complexity
function normalizeDashboardConfig(input: unknown, logicalPath: string): IdentityDashboardConfig | null {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.widgets)) return null;
  return {
    version: 1,
    sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : logicalPath,
    widgets: input.widgets.map(normalizeWidget).filter((item): item is IdentityDashboardWidget => Boolean(item)),
  };
}

// fallow-ignore-next-line complexity
function normalizeWidget(input: unknown): IdentityDashboardWidget | null {
  if (!isRecord(input)) return null;
  const id = stringValue(input.id);
  const type = stringValue(input.type);
  const title = stringValue(input.title);
  if (!id || !type || !title) return null;
  return {
    id,
    type,
    title,
    enabled: input.enabled !== false,
    layout: normalizeLayout(input.layout),
    data: isRecord(input.data) ? input.data : {},
    source: normalizeSource(input.source),
  };
}

function normalizeLayout(input: unknown): IdentityDashboardLayout {
  const source = isRecord(input) ? input : {};
  return {
    x: clampNumber(source.x, 0, 11),
    y: clampNumber(source.y, 0, 8),
    w: clampNumber(source.w, 2, 12),
    h: clampNumber(source.h, 1, 8),
  };
}

// fallow-ignore-next-line complexity
function normalizeSource(input: unknown): IdentityDashboardSource {
  const source = isRecord(input) ? input : {};
  const kind = source.kind === "ai" || source.kind === "sync" ? source.kind : "manual";
  return {
    kind,
    note: stringValue(source.note),
    path: stringValue(source.path) || undefined,
    updatedAt: stringValue(source.updatedAt) || undefined,
  };
}

async function resolveIdentityDashboardProvider(projectRoot: string): Promise<LLMProvider> {
  const app = readAppConfig(projectRoot).apps.find((item) => item.id === "wiki-general" && item.enabled)
    ?? readAppConfig(projectRoot).apps.find((item) => item.enabled)
    ?? null;
  return resolveAgentRuntimeProvider(projectRoot, app, "identity-dashboard");
}

function buildWidgetGenerateSystemPrompt(): string {
  return [
    "你是个人信息档案仪表盘组件内容助手。",
    "只返回 JSON，不要 Markdown 代码块。",
    "JSON 形状必须是 {\"title\":\"...\",\"data\":{...}}。",
    "保留原组件 data 的字段结构；不知道的内容写“待填写”。",
  ].join("\n");
}

function buildWidgetGenerateMessages(widget: IdentityDashboardWidget, prompt: string, pageRaw: string): LLMMessage[] {
  return [{
    role: "user",
    content: JSON.stringify({
      widget,
      userPrompt: prompt,
      pageRaw,
    }, null, 2),
  }];
}

function parseGeneratedWidget(raw: string, fallback: IdentityDashboardWidget): IdentityDashboardWidget {
  const parsed = parseJsonObject(raw);
  if (!parsed) return generatedTextWidget(fallback, raw);
  return {
    ...fallback,
    title: stringValue(parsed.title) || fallback.title,
    data: isRecord(parsed.data) ? parsed.data : fallback.data,
    source: { kind: "ai", note: "AI 生成预览", updatedAt: new Date().toISOString() },
  };
}

function generatedTextWidget(fallback: IdentityDashboardWidget, raw: string): IdentityDashboardWidget {
  return {
    ...fallback,
    data: { text: raw.trim() || "待填写" },
    source: { kind: "ai", note: "AI 生成预览", updatedAt: new Date().toISOString() },
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
