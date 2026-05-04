/**
 * Builds the editable dashboard's default widget configuration from the
 * identity Markdown page.
 */
import type {
  IdentityDashboardConfig,
  IdentityDashboardLayout,
  IdentityDashboardWidget,
  IdentityInfoDocument,
  IdentityInfoPageResponse,
  IdentityTimelineItem,
  IdentityWidgetSource,
  IdentityWidgetType,
} from "./identity-dashboard-types.js";

const EMPTY_VALUE = "待填写";

export function parseIdentityMarkdown(response: IdentityInfoPageResponse): IdentityInfoDocument {
  const raw = response.raw ?? `# ${response.title ?? "个人身份信息档案"}`;
  const sections = splitSections(raw);
  return {
    title: readTitle(raw, response.title ?? "个人身份信息档案"),
    basic: readKeyValues(sections.get("基本信息") ?? ""),
    education: readKeyValues(sections.get("教育信息") ?? ""),
    contact: readKeyValues(sections.get("联系方式") ?? ""),
    publicIdentity: readKeyValues(sections.get("公开身份") ?? ""),
    tags: readList(sections.get("长期标签") ?? ""),
    timeline: readTimeline(sections.get("身份时间线") ?? ""),
    rules: readList(sections.get("维护规则") ?? ""),
  };
}

export function buildDefaultIdentityDashboard(
  path: string,
  doc: IdentityInfoDocument,
  response: IdentityInfoPageResponse,
): IdentityDashboardConfig {
  return {
    version: 1,
    sourcePath: path,
    widgets: [
      widget("hero", "个人头像与基本信息", layout(0, 0, 4, 2), heroData(doc, response)),
      widget("stage", "当前阶段概览", layout(4, 0, 5, 2), stageData(doc)),
      widget("timeline", "人生时间线", layout(9, 0, 3, 7), { items: sortTimelineDesc(doc.timeline) }),
      widget("nav", "快速导航", layout(0, 2, 9, 1), { items: navItems() }),
      widget("relations", "人际关系总览", layout(0, 3, 4, 2), {}),
      widget("dreams", "梦境", layout(4, 3, 2, 2), dreamsData(doc)),
      widget("health", "健康与睡眠总览", layout(6, 3, 3, 2), healthData(doc)),
      widget("mood", "情绪与能量状态", layout(0, 5, 4, 2), moodData(doc)),
      widget("goals", "目标与价值观", layout(4, 5, 2, 2), goalsData(doc)),
      widget("metaphysics", "命理与传统解释系统", layout(6, 5, 3, 2), metaphysicsData(doc)),
    ],
  };
}

export function normalizeDashboardConfig(
  input: IdentityDashboardConfig | null,
  fallback: IdentityDashboardConfig,
): IdentityDashboardConfig {
  if (!input || input.version !== 1 || !Array.isArray(input.widgets)) return fallback;
  return {
    version: 1,
    sourcePath: input.sourcePath || fallback.sourcePath,
    widgets: input.widgets.map(normalizeWidget).filter((item): item is IdentityDashboardWidget => Boolean(item)),
  };
}

export function createWidget(type: IdentityWidgetType): IdentityDashboardWidget {
  return widget(type, defaultWidgetTitle(type), layout(0, 0, 3, 2), defaultWidgetData(type));
}

function widget(
  type: IdentityWidgetType,
  title: string,
  grid: IdentityDashboardLayout,
  data: Record<string, unknown>,
): IdentityDashboardWidget {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    enabled: true,
    layout: grid,
    data,
    source: manualSource(),
  };
}

function normalizeWidget(input: IdentityDashboardWidget): IdentityDashboardWidget | null {
  if (!input.id || !input.type || !input.title) return null;
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    enabled: input.enabled !== false,
    layout: normalizeLayout(input.layout),
    data: input.data && typeof input.data === "object" ? input.data : {},
    source: normalizeSource(input.source),
  };
}

function normalizeLayout(input: IdentityDashboardLayout): IdentityDashboardLayout {
  return {
    x: clampNumber(input?.x, 0, 11),
    y: clampNumber(input?.y, 0, 8),
    w: clampNumber(input?.w, 2, 12),
    h: clampNumber(input?.h, 1, 8),
  };
}

function normalizeSource(input: IdentityWidgetSource): IdentityWidgetSource {
  const kind = input?.kind === "ai" || input?.kind === "sync" ? input.kind : "manual";
  return { kind, note: String(input?.note ?? ""), path: input?.path, updatedAt: input?.updatedAt };
}

function heroData(doc: IdentityInfoDocument, response: IdentityInfoPageResponse): Record<string, unknown> {
  return {
    name: firstFilled(doc.basic["中文名"], doc.title.replace(/档案$/u, "")),
    avatarImage: readFrontmatterString(response.frontmatter, "avatar_image"),
    rows: [
      ["身份", firstFilled(doc.basic["当前身份"], "身份信息待补全")],
      ["坐标", firstFilled(doc.basic["所在城市"], "所在地待填写")],
      ["更新时间", formatDate(response.modifiedAt)],
    ],
    tags: doc.tags,
  };
}

function stageData(doc: IdentityInfoDocument): Record<string, unknown> {
  return { rows: [
    ["学业", firstFilled(doc.education["学校"], EMPTY_VALUE), firstFilled(doc.education["学历阶段"], EMPTY_VALUE)],
    ["专业", firstFilled(doc.education["专业"], EMPTY_VALUE), firstFilled(doc.education["预计毕业时间"], EMPTY_VALUE)],
    ["公开身份", firstFilled(doc.publicIdentity["作品集入口"], EMPTY_VALUE), "建设中"],
    ["联系方式", firstFilled(doc.contact.Email, EMPTY_VALUE), "可核对"],
    ["身份事实", "本页为主事实源", "稳定"],
    ["展示页", "wiki/个人信息档案/about-me.md", "对外呈现"],
  ] };
}

function dreamsData(doc: IdentityInfoDocument): Record<string, unknown> {
  return {
    items: [["迷雾的校园", "2025-05-19"], ["小时候的老房子", "2025-05-18"], ["考试迟到", "2025-05-17"]],
    note: firstFilled(doc.publicIdentity["简历入口"], "补充长期档案入口"),
  };
}

function healthData(doc: IdentityInfoDocument): Record<string, unknown> {
  return { metrics: [["7.2", "小时"], ["3.1", "次"], ["饮食", "良好"], ["运动", "4次/周"], ["精力", "72%"], ["状态", "良好"]], note: firstFilled(doc.rules[0], "身份事实以本页为准。") };
}

function moodData(doc: IdentityInfoDocument): Record<string, unknown> {
  return { rows: [["最近高频情绪", "焦虑 / 平静 / 充实 / 期待"], ["压力源", "学业压力 / 时间管理 / 不确定性"], ["恢复方式", doc.tags.join(" / ") || EMPTY_VALUE]] };
}

function goalsData(doc: IdentityInfoDocument): Record<string, unknown> {
  return { rows: [["长期目标", firstFilled(doc.publicIdentity["作品集入口"], "补充作品集与长期目标")], ["当前阶段目标", firstFilled(doc.education["预计毕业时间"], "补充阶段目标")], ["重要的东西", "成长 / 自由 / 真诚 / 健康 / 家人"]] };
}

function metaphysicsData(doc: IdentityInfoDocument): Record<string, unknown> {
  return { items: ["八字", "紫微斗数", "阳宅", "手相", "中医体质"], note: doc.rules.join(" ") };
}

function navItems(): Array<[string, string]> {
  return [["健康与睡眠", "眠"], ["梦境", "梦"], ["目标与价值观", "标"], ["命理与传统解释系统", "命"]];
}

function defaultWidgetData(type: IdentityWidgetType): Record<string, unknown> {
  if (type === "table") return { rows: [["字段", "内容"], ["待填写", "待填写"]] };
  if (type === "list") return { items: ["待填写"] };
  return { text: "待填写" };
}

function defaultWidgetTitle(type: IdentityWidgetType): string {
  return ({ text: "自定义文本", table: "自定义表格", list: "自定义列表" } as Partial<Record<IdentityWidgetType, string>>)[type] ?? "新组件";
}

function splitSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "";
  for (const line of raw.split(/\r?\n/u)) {
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading?.[1]) {
      current = heading[1].trim();
      sections.set(current, "");
    } else if (current) {
      sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
    }
  }
  return sections;
}

function readTitle(raw: string, fallback: string): string {
  return /^#\s+(.+)$/mu.exec(raw)?.[1]?.trim() ?? fallback;
}

function readKeyValues(section: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of section.split(/\r?\n/u)) {
    const match = /^-\s*([^:：]+)[:：]\s*(.+)$/u.exec(line.trim());
    if (match?.[1] && match[2]) values[match[1].trim()] = match[2].trim();
  }
  return values;
}

function readList(section: string): string[] {
  return section.split(/\r?\n/u).map((line) => /^-\s+(.+)$/u.exec(line.trim())?.[1]?.trim()).filter((item): item is string => Boolean(item));
}

function readTimeline(section: string): IdentityTimelineItem[] {
  return section.split(/\r?\n/u).map((line) => {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    return cells.length < 2 || cells[0] === "时间" || /^-+$/u.test(cells[0]) ? null : { date: cells[0], fact: cells[1] };
  }).filter((item): item is IdentityTimelineItem => Boolean(item));
}

function sortTimelineDesc(items: IdentityTimelineItem[]): IdentityTimelineItem[] {
  const visible = items.length > 0 ? items : [{ date: EMPTY_VALUE, fact: "补充身份时间线" }];
  return [...visible].sort((left, right) => timelineTime(right.date) - timelineTime(left.date));
}

function timelineTime(value: string): number {
  const time = Date.parse(value.replace(/\//gu, "-"));
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function layout(x: number, y: number, w: number, h: number): IdentityDashboardLayout {
  return { x, y, w, h };
}

function manualSource(): IdentityWidgetSource {
  return { kind: "manual", note: "手动维护" };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

function readFrontmatterString(frontmatter: Record<string, unknown> | null | undefined, key: string): string {
  const value = frontmatter?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstFilled(...values: Array<string | undefined>): string {
  return values.find((value) => value && value !== EMPTY_VALUE) ?? EMPTY_VALUE;
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "待同步";
}
