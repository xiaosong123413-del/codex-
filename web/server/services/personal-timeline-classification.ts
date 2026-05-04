/**
 * Infers lightweight timeline metadata from a candidate fact and its diary
 * context.
 *
 * Personal timeline confirmation should not leave every row with placeholder
 * metadata. This module keeps the inference deterministic and conservative:
 * classify only from the candidate text plus its source diary section.
 */

import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { normalizeMarkdownHeadingAnchor } from "../render/heading-anchors.js";
import type { TaskTaxonomy } from "./task-taxonomy.js";

interface TimelineDomainRule {
  domain: string;
  terms: readonly string[];
}

interface TimelineProjectRule {
  project: string;
  terms: readonly string[];
}

interface TimelineFactClassification {
  domain: string;
  project: string;
}

const DEFAULT_DOMAIN = "日常记录";
const DEFAULT_PROJECT = "—";

const DOMAIN_RULES: readonly TimelineDomainRule[] = [
  { domain: "健康", terms: ["睡", "熬夜", "好累", "头疼", "前额叶", "注意力", "皮质醇", "大便", "肠胃", "精力"] },
  { domain: "产品上线", terms: ["上线", "发布", "产品化"] },
  { domain: "安全", terms: ["安全", "数据隔离", "隐私"] },
  { domain: "产品架构", terms: ["架构", "memory", "路由", "流程", "编排"] },
  { domain: "产品功能", terms: ["llm wiki", "codex", "功能", "页面", "应用", "源料库", "原料库", "rss", "ocr", "github", "cloudflare", "插件", "快捷键", "工作台", "保存功能"] },
  { domain: "知识管理", terms: ["知识库", "个人档案", "手相", "命理", "发型", "形象分析", "剪藏", "日记"] },
  { domain: "学术发展", terms: ["学习", "论文", "课程", "法学", "研究"] },
  { domain: "工具使用", terms: ["通义听悟", "阿里云盘", "figma", "工具"] },
  { domain: "财务", terms: ["账单", "支出", "收入", "额度", "价格", "费用", "支付宝", "微信", "工商银行"] },
  { domain: "人际关系", terms: ["群里", "同届", "老师", "朋友", "队友", "合作", "人际"] },
];

const PROJECT_RULES: readonly TimelineProjectRule[] = [
  { project: "个人健康", terms: ["睡", "熬夜", "好累", "头疼", "前额叶", "健康", "皮质醇"] },
  { project: "个人App开发", terms: ["llm wiki", "codex", "功能", "页面", "应用", "工作台", "保存功能", "上线", "数据隔离"] },
  { project: "个人知识库", terms: ["知识库", "个人档案", "源料库", "原料库", "剪藏", "手相", "命理", "发型", "形象分析", "日记"] },
  { project: "效率工具", terms: ["通义听悟", "阿里云盘", "figma", "工具"] },
  { project: "个人成长", terms: ["学习", "研究", "法学", "比赛", "征文"] },
];

const MARKDOWN_HEADING_RE = /^(#{2,6})\s+(.+?)\s*#*\s*$/gmu;
const EXPLICIT_ANCHOR_RE = /\s*\{#([^}\s]+)\}\s*$/u;

export function classifyTimelineFact(
  fact: string,
  context: string,
  taxonomy: TaskTaxonomy = { domains: [], projects: [] },
): TimelineFactClassification {
  const text = normalizedText(`${fact}\n${context}`);
  return {
    domain: inferDomain(text, taxonomy),
    project: inferProject(text, taxonomy),
  };
}

export function readTimelineSourceContext(cfg: ServerConfig, sourceTarget: string): string {
  const file = sourceFileFromTarget(sourceTarget);
  if (!file) return "";
  const fullPath = resolveSourceFile(cfg, file);
  if (!fullPath) return "";
  const markdown = fs.readFileSync(fullPath, "utf8");
  return sourceSectionMarkdown(file, markdown, sourceTarget) || markdown;
}

function inferDomain(text: string, taxonomy: TaskTaxonomy): string {
  return taxonomy.domains.find((domain) => text.includes(domain.toLowerCase()))
    ?? DOMAIN_RULES.find((rule) => hasAnyTerm(text, rule.terms))?.domain
    ?? DEFAULT_DOMAIN;
}

function inferProject(text: string, taxonomy: TaskTaxonomy): string {
  return taxonomy.projects.find((project) => text.includes(project.name.toLowerCase()))?.name
    ?? PROJECT_RULES.find((rule) => hasAnyTerm(text, rule.terms))?.project
    ?? DEFAULT_PROJECT;
}

function hasAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ");
}

function sourceFileFromTarget(sourceTarget: string): string | null {
  const hashIndex = sourceTarget.indexOf("#");
  const file = hashIndex === -1 ? sourceTarget : sourceTarget.slice(0, hashIndex);
  return file.trim() || null;
}

function resolveSourceFile(cfg: ServerConfig, file: string): string | null {
  const normalized = file.replace(/\\/gu, "/").replace(/^\/+/u, "");
  const sourcePath = path.join(cfg.sourceVaultRoot, normalized);
  if (fs.existsSync(sourcePath)) return sourcePath;
  const runtimePath = path.join(cfg.runtimeRoot, normalized);
  return fs.existsSync(runtimePath) ? runtimePath : null;
}

function sourceSectionMarkdown(file: string, markdown: string, sourceTarget: string): string {
  const matches = Array.from(markdown.matchAll(MARKDOWN_HEADING_RE));
  const index = matches.findIndex((match) => headingTarget(file, match) === sourceTarget);
  if (index === -1) return "";
  const start = (matches[index]?.index ?? 0) + (matches[index]?.[0].length ?? 0);
  const end = matches[index + 1]?.index ?? markdown.length;
  return markdown.slice(start, end).trim();
}

function headingTarget(file: string, match: RegExpMatchArray): string {
  const rawHeading = match[2]?.trim() ?? "";
  const explicitAnchor = EXPLICIT_ANCHOR_RE.exec(rawHeading)?.[1]?.trim();
  const heading = rawHeading.replace(EXPLICIT_ANCHOR_RE, "").replace(/\s+#+\s*$/u, "").trim();
  return `${file}#${explicitAnchor || normalizeMarkdownHeadingAnchor(heading)}`;
}
