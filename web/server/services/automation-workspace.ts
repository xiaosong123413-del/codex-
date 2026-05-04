/**
 * Automation workspace aggregation.
 *
 * The workspace reads explicit automation definitions, derived app workflows,
 * and source-code-audited DAGs, then enriches their nodes with app metadata,
 * effective model labels, comments, layouts, and logs for the client pages.
 */

import type { AutomationDefinition } from "./automation-config.js";
import { readAutomationConfig } from "./automation-config.js";
import type { AutomationFlowBranch, AutomationFlowEdge, AutomationFlowNode } from "./automation-flow.js";
import { readAppConfig, type AppDefinition } from "./app-config.js";
import { createDerivedAutomationFromApp } from "./app-derived-automation.js";
import {
  listCodeDerivedAutomations,
  type CodeDerivedAutomationDefinition,
} from "./code-derived-automations.js";
import type {
  CodeDerivedSourceInsight,
  CodeDerivedSourceInsightNodeInsight,
  CodeDerivedSourceInsightPotentialDestination,
} from "./code-derived-automation-types.js";
import { readLlmProviderConfig } from "./llm-config.js";
import {
  listAutomationPotentialDestinations,
  type AutomationPotentialDestinationRecord,
} from "./automation-source-insight-store.js";
import {
  listAutomationWorkspaceComments,
  listAutomationWorkspaceLogs,
  readAutomationWorkspaceLayout,
  type AutomationWorkspaceComment,
  type AutomationWorkspaceLayout,
  type AutomationWorkspaceLog,
} from "./automation-workspace-store.js";

type AutomationSourceKind = "automation" | "app" | "code" | "information";

interface WorkspaceAutomation extends AutomationDefinition {
  sourceKind: AutomationSourceKind;
  viewMode: "flow";
  documentSteps: [];
  mermaid?: string;
  sourceInsight?: CodeDerivedSourceInsight;
}

interface EffectiveAutomationModel {
  provider: string;
  model: string;
  source: "none" | "explicit" | "app" | "default";
  label: string;
}

interface AutomationWorkspaceNode extends AutomationFlowNode {
  app: Pick<AppDefinition, "id" | "name" | "workflow" | "prompt" | "provider" | "model"> | null;
  effectiveModel: EffectiveAutomationModel;
}

interface AutomationWorkspaceDetail {
  automation: WorkspaceAutomation & {
    apps: Array<Pick<AppDefinition, "id" | "name" | "workflow" | "prompt" | "provider" | "model">>;
    flow: {
      nodes: AutomationWorkspaceNode[];
      edges: AutomationFlowEdge[];
      branches: AutomationFlowBranch[];
    };
    mermaid?: string;
    sourceInsight?: CodeDerivedSourceInsight;
  };
  comments: AutomationWorkspaceComment[];
  layout: AutomationWorkspaceLayout;
}

export function listAutomationWorkspace(projectRoot: string): Promise<Array<{
  id: string;
  name: string;
  summary: string;
  icon: string;
  enabled: boolean;
  trigger: string;
  updatedAt?: string;
  sourceKind: AutomationSourceKind;
}>> {
  return listWorkspaceAutomations(projectRoot).then((automations) => automations.map((automation) => ({
    id: automation.id,
    name: automation.name,
    summary: automation.summary,
    icon: automation.icon,
    enabled: automation.enabled,
    trigger: automation.trigger,
    updatedAt: automation.updatedAt,
    sourceKind: automation.sourceKind,
  })));
}

export async function readAutomationWorkspaceDetail(
  projectRoot: string,
  runtimeRoot: string,
  automationId: string,
): Promise<AutomationWorkspaceDetail | null> {
  const automation = (await listWorkspaceAutomations(projectRoot)).find((item) => item.id === automationId);
  if (!automation) {
    return null;
  }
  const apps = readAppConfig(projectRoot).apps;
  const defaultModel = readLlmProviderConfig(projectRoot);
  const nodes = automation.flow.nodes.map((node) => enrichNode(node, apps, defaultModel));
  return {
    automation: {
      ...automation,
      apps: uniqueApps(nodes),
      flow: {
        nodes,
        edges: automation.flow.edges,
        branches: automation.flow.branches,
      },
      ...(automation.mermaid ? { mermaid: automation.mermaid } : {}),
      ...(automation.sourceInsight ? { sourceInsight: enrichSourceInsight(automation.sourceInsight, runtimeRoot, automation.id) } : {}),
    },
    comments: listAutomationWorkspaceComments(runtimeRoot, automationId),
    layout: readAutomationWorkspaceLayout(runtimeRoot, automationId),
  };
}

export function listAutomationWorkspaceCommentsForId(runtimeRoot: string, automationId: string): AutomationWorkspaceComment[] {
  return listAutomationWorkspaceComments(runtimeRoot, automationId);
}

export function listAutomationWorkspaceLogsForId(runtimeRoot: string, automationId: string): AutomationWorkspaceLog[] {
  return listAutomationWorkspaceLogs(runtimeRoot, automationId);
}

export function readAutomationWorkspaceLayoutForId(runtimeRoot: string, automationId: string): AutomationWorkspaceLayout {
  return readAutomationWorkspaceLayout(runtimeRoot, automationId);
}

async function listWorkspaceAutomations(projectRoot: string): Promise<WorkspaceAutomation[]> {
  const configuredAutomations = readAutomationConfig(projectRoot).automations.map((automation) => (
    createWorkspaceAutomation(automation, "automation")
  ));
  const codeDerivedAutomations = (await listCodeDerivedAutomations(projectRoot)).map((automation) => (
    createWorkspaceAutomation(automation, automation.sourceKind ?? "code")
  ));
  const apps = readAppConfig(projectRoot).apps;
  const configuredAppIds = new Set(configuredAutomations.map((automation) => automation.appId));
  const derivedAppAutomations = apps
    .filter((app) => !configuredAppIds.has(app.id))
    .map((app) => createWorkspaceAutomation(createDerivedAutomationFromApp(app), "app"));
  return [...configuredAutomations, ...codeDerivedAutomations, ...derivedAppAutomations];
}

function createWorkspaceAutomation(
  automation: AutomationDefinition | CodeDerivedAutomationDefinition,
  sourceKind: AutomationSourceKind,
): WorkspaceAutomation {
  return {
    ...automation,
    sourceKind,
    viewMode: "flow",
    documentSteps: [],
    ...(automation.sourceInsight ? { sourceInsight: automation.sourceInsight } : {}),
  };
}

function enrichSourceInsight(
  sourceInsight: CodeDerivedSourceInsight,
  runtimeRoot: string,
  automationId: string,
): CodeDerivedSourceInsight {
  const nodes = sourceInsight.graph.nodes.map((node, index) => ({
    ...node,
    displayId: node.displayId ?? createSpecNodeDisplayId(index),
  }));
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  return {
    ...sourceInsight,
    graph: {
      ...sourceInsight.graph,
      nodes,
      mermaid: sourceInsight.graph.preserveMermaid
        ? sourceInsight.graph.mermaid
        : buildSourceInsightSkeletonMermaid(nodes, sourceInsight.graph.edges),
    },
    nodeInsights: Object.fromEntries(Object.entries(sourceInsight.nodeInsights).map(([nodeId, insight]) => [
      nodeId,
      enrichSourceInsightNode(insight, runtimeRoot, automationId, nodeId, nodeLookup.get(nodeId)),
    ])),
    appendices: sourceInsight.appendices ?? createDefaultSourceInsightAppendices(sourceInsight),
  };
}

function enrichSourceInsightNode(
  insight: CodeDerivedSourceInsightNodeInsight,
  runtimeRoot: string,
  automationId: string,
  nodeId: string,
  node?: CodeDerivedSourceInsight["graph"]["nodes"][number],
): CodeDerivedSourceInsightNodeInsight {
  const storedPotentials = listAutomationPotentialDestinations(runtimeRoot, automationId, nodeId);
  return {
    ...insight,
    specRows: insight.specRows ?? createDefaultSpecRows(insight, node),
    potentialDestinations: [
      ...(insight.potentialDestinations ?? []),
      ...storedPotentials.map(toSourceInsightPotentialDestination),
    ],
  };
}

function createSpecNodeDisplayId(index: number): string {
  const letterCode = "A".charCodeAt(0) + (index % 26);
  const cycle = Math.floor(index / 26) + 1;
  return `${String.fromCharCode(letterCode)}${cycle}`;
}

function buildSourceInsightSkeletonMermaid(
  nodes: CodeDerivedSourceInsight["graph"]["nodes"],
  edges: CodeDerivedSourceInsight["graph"]["edges"],
): string {
  const nodeLines = nodes.map((node) => renderSourceInsightSkeletonNode(node));
  const edgeLines = edges.map((edge) => {
    const label = edge.label ? `|${escapeMermaidLabel(edge.label)}|` : "";
    return `    ${edge.source} -->${label} ${edge.target}`;
  });
  return [
    "flowchart TD",
    ...nodeLines,
    ...edgeLines,
  ].join("\n");
}

function renderSourceInsightSkeletonNode(node: CodeDerivedSourceInsight["graph"]["nodes"][number]): string {
  const label = `${node.displayId ?? node.id} ${readShortSourceInsightLabel(node.label)}`;
  const escapedLabel = `"${escapeMermaidLabel(label)}"`;
  if (node.kind === "decision") {
    return `    ${node.id}{${escapedLabel}}`;
  }
  return `    ${node.id}[${escapedLabel}]`;
}

function readShortSourceInsightLabel(label: string): string {
  const normalized = label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^(触发|判断|输入|处理|结果)：/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= 18 ? normalized : `${normalized.slice(0, 17).trimEnd()}…`;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/\|/g, "/");
}

function createDefaultSpecRows(
  insight: CodeDerivedSourceInsightNodeInsight,
  node?: CodeDerivedSourceInsight["graph"]["nodes"][number],
): Array<{ label: string; value: string }> {
  return [
    { label: "作用", value: insight.summary },
    { label: "输入", value: insight.upstream.join(" / ") || "无" },
    { label: "输出", value: insight.downstream.join(" / ") || "无" },
    { label: "标准", value: createDefaultNodeStandard(node) },
    { label: "源码", value: insight.sourcePaths.join(" / ") || "无" },
  ];
}

function createDefaultNodeStandard(node?: CodeDerivedSourceInsight["graph"]["nodes"][number]): string {
  switch (node?.kind) {
    case "trigger":
      return "只描述真实触发入口，不把后续处理细节塞进节点。";
    case "decision":
      return "只描述分支判断，具体阈值和规则放到规则附录。";
    case "input":
      return "只标明读取来源，字段和文件结构放到 Schema 附录。";
    case "process":
      return "只描述处理动作，prompt 和实现细节放到右侧说明或附录。";
    case "result":
      return "只标明最终落点，不把上游过程重复写进节点。";
    default:
      return "图上只保留骨架，细节统一放到节点说明与附录。";
  }
}

function createDefaultSourceInsightAppendices(
  sourceInsight: CodeDerivedSourceInsight,
): NonNullable<CodeDerivedSourceInsight["appendices"]> {
  return [
    {
      id: "prompt",
      title: "Prompt 附录",
      content: [
        "这类源码真实流程通常不等于单一 Prompt。",
        "阅读方式：先点左侧节点，再在节点说明中查看作用、输入、输出、标准和源码位置。",
        "如果某个节点确实调用 AI Prompt，应在该节点的 specRows 或本附录里单独写明。",
      ].join("\n"),
    },
    {
      id: "schema",
      title: "Schema 附录",
      content: JSON.stringify({
        page: sourceInsight.page,
        node: {
          displayId: "A1/B1/C1",
          id: "源码节点 id",
          kind: "trigger|decision|input|process|result",
          label: "短节点名",
        },
        edge: {
          source: "上游节点 id",
          target: "下游节点 id",
          label: "可选流转说明",
        },
      }, null, 2),
    },
    {
      id: "rules",
      title: "规则附录",
      content: [
        "1. Mermaid 主图只展示主骨架和节点编号。",
        "2. 节点标准、字段、prompt、异常和源码位置不写在图里。",
        "3. 点击节点后，右侧节点说明必须能解释该节点的作用、输入、输出和标准。",
        "4. 信息流转流程描述信息从输入到产物的转移；源码真实流程描述按钮、接口、函数和文件写入的真实反应链。",
      ].join("\n"),
    },
  ];
}

function toSourceInsightPotentialDestination(
  record: AutomationPotentialDestinationRecord,
): CodeDerivedSourceInsightPotentialDestination {
  return {
    id: record.id,
    automationId: record.automationId,
    nodeId: record.nodeId,
    label: record.label,
    intendedOutcome: record.intendedOutcome,
    note: record.note,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function enrichNode(
  node: AutomationFlowNode,
  apps: AppDefinition[],
  defaultModel: ReturnType<typeof readLlmProviderConfig>,
): AutomationWorkspaceNode {
  const app = findNodeApp(node, apps);
  return {
    ...node,
    app: summarizeApp(app),
    effectiveModel: resolveEffectiveModel(node, app, defaultModel),
  };
}

function resolveEffectiveModel(
  node: AutomationFlowNode,
  app: AppDefinition | null,
  defaultModel: ReturnType<typeof readLlmProviderConfig>,
): EffectiveAutomationModel {
  return resolveExplicitModel(node, app, defaultModel)
    ?? resolveAppModel(app)
    ?? resolveDefaultModel(app, defaultModel)
    ?? resolveMissingModel();
}

function findNodeApp(node: AutomationFlowNode, apps: AppDefinition[]): AppDefinition | null {
  return node.appId ? apps.find((item) => item.id === node.appId) ?? null : null;
}

function summarizeApp(app: AppDefinition | null): AutomationWorkspaceNode["app"] {
  if (!app) {
    return null;
  }
  return {
    id: app.id,
    name: app.name,
    workflow: app.workflow,
    prompt: app.prompt,
    provider: app.provider,
    model: app.model,
  };
}

function resolveExplicitModel(
  node: AutomationFlowNode,
  app: AppDefinition | null,
  defaultModel: ReturnType<typeof readLlmProviderConfig>,
): EffectiveAutomationModel | null {
  if (node.modelMode !== "explicit" || !node.model) {
    return null;
  }
  const provider = app?.provider || defaultModel.provider || "default";
  return {
    provider,
    model: node.model,
    source: "explicit",
    label: `显式模型 · ${provider} / ${node.model}`,
  };
}

function resolveAppModel(app: AppDefinition | null): EffectiveAutomationModel | null {
  if (!app?.model) {
    return null;
  }
  return {
    provider: app.provider,
    model: app.model,
    source: "app",
    label: `应用模型 · ${app.provider} / ${app.model}`,
  };
}

function resolveDefaultModel(
  app: AppDefinition | null,
  defaultModel: ReturnType<typeof readLlmProviderConfig>,
): EffectiveAutomationModel | null {
  if (!app) {
    return null;
  }
  const provider = defaultModel.provider || app.provider || "default";
  const model = defaultModel.model || "未配置";
  return {
    provider,
    model,
    source: "default",
    label: `跟随默认模型 · ${provider} / ${model}`,
  };
}

function resolveMissingModel(): EffectiveAutomationModel {
  return {
    provider: "",
    model: "",
    source: "none",
    label: "",
  };
}

function uniqueApps(
  nodes: AutomationWorkspaceNode[],
): Array<Pick<AppDefinition, "id" | "name" | "workflow" | "prompt" | "provider" | "model">> {
  const seen = new Set<string>();
  const result: Array<Pick<AppDefinition, "id" | "name" | "workflow" | "prompt" | "provider" | "model">> = [];
  for (const node of nodes) {
    if (!node.app || seen.has(node.app.id)) {
      continue;
    }
    seen.add(node.app.id);
    result.push(node.app);
  }
  return result;
}
