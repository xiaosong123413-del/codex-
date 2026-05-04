/**
 * Derived automation definitions for configured apps.
 *
 * App workflows are authored as newline-delimited steps in `agents.json`.
 * This module turns those steps into the same flow structure used by explicit
 * and code-derived automations, including per-node standards when known.
 */
import type { AutomationDefinition } from "./automation-config.js";
import type { AutomationFlow, AutomationFlowEdge, AutomationFlowNode } from "./automation-flow.js";
import type { AppDefinition } from "./app-config.js";

const DERIVED_AUTOMATION_PREFIX = "app-workflow-";
const TASK_PLAN_ASSISTANT_ID = "task-plan-assistant";

export function createDerivedAutomationFromApp(app: AppDefinition): AutomationDefinition {
  const id = `${DERIVED_AUTOMATION_PREFIX}${app.id}`;
  const summary = summarizeAutomationPurpose(app);
  return {
    id,
    name: app.name,
    summary,
    icon: iconForAppMode(app.mode),
    trigger: "message",
    appId: app.id,
    enabled: app.enabled,
    schedule: "",
    webhookPath: "",
    updatedAt: app.updatedAt,
    flow: createDerivedFlow(app, id, summary),
  };
}

function summarizeAutomationPurpose(app: AppDefinition): string {
  return app.purpose.trim() || `查看 ${app.name} 的自动化工作流。`;
}

function iconForAppMode(mode: AppDefinition["mode"]): string {
  switch (mode) {
    case "workflow":
      return "git-branch";
    case "knowledge":
      return "book-open";
    case "hybrid":
      return "sparkles";
    default:
      return "bot";
  }
}

function createDerivedFlow(app: AppDefinition, automationId: string, summary: string): AutomationFlow {
  const triggerId = `trigger-${automationId}`;
  const workflowSteps = parseWorkflowSteps(app);
  const nodes: AutomationFlowNode[] = [
    {
      id: triggerId,
      type: "trigger",
      title: triggerTitleForApp(app),
      description: summary,
      standard: createDerivedTriggerStandard(app),
      modelMode: "default",
    },
    ...workflowSteps.map((step, index) => createDerivedActionNode(app, automationId, step, index)),
  ];
  return {
    nodes,
    edges: createDerivedEdges(nodes),
    branches: [],
  };
}

function parseWorkflowSteps(app: AppDefinition): string[] {
  const steps = normalizeMultilineText(app.workflow)
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
  return steps.length > 0 ? steps : [`执行 ${app.name}`];
}

function triggerTitleForApp(app: AppDefinition): string {
  return app.mode === "workflow" ? "工作流触发" : "调用应用时触发";
}

function createDerivedActionNode(
  app: AppDefinition,
  automationId: string,
  step: string,
  index: number,
): AutomationFlowNode {
  return {
    id: `action-${automationId}-${index + 1}`,
    type: "action",
    title: step,
    description: describeDerivedAction(app, index),
    standard: describeDerivedActionStandard(app, step),
    appId: app.id,
    modelMode: "default",
  };
}

function createDerivedTriggerStandard(app: AppDefinition): string {
  if (app.id === TASK_PLAN_ASSISTANT_ID) {
    return "标准：只在任务计划页需要语音整理、排期生成、微调落盘或执行确认时触发。";
  }
  return "标准：只有用户调用该应用或对应 workflow 时触发。";
}

function describeDerivedAction(app: AppDefinition, index: number): string {
  if (index === 0 && app.prompt.trim()) {
    return `应用 ${app.name} · ${summarizePrompt(app.prompt)}`;
  }
  return `应用 ${app.name} 的内置工作流步骤。`;
}

function describeDerivedActionStandard(app: AppDefinition, step: string): string {
  if (app.id === TASK_PLAN_ASSISTANT_ID) {
    return describeTaskPlanActionStandard(step);
  }
  return "标准：输入清晰、输出可验收，不虚构缺失上下文。";
}

function describeTaskPlanActionStandard(step: string): string {
  if (step.includes("任务计划页状态")) {
    return "标准：读到 voice、pool、schedule、statusSummary；任务需保持领域、项目、任务层级。";
  }
  if (step.includes("最近语音输入") || step.includes("任务池") || step.includes("工作日志")) {
    return "标准：只把能跟踪、能验收、通常需多个行动的事项识别为任务；一步事项保留为行动或执行记录。";
  }
  if (step.includes("严格 JSON")) {
    return "标准：输出必须是合法 JSON，并包含任务目标、完成标准、当前状态、下一步和可落盘字段。";
  }
  if (step.includes("结构校正")) {
    return "标准：只修正结构和字段一致性，不改变用户意图、领域、项目或任务边界。";
  }
  return "标准：围绕任务卡的 currentProgress、nextStep 和 workflowLog 形成可验收结果。";
}

function summarizePrompt(prompt: string): string {
  const normalized = normalizeMultilineText(prompt).replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function normalizeMultilineText(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function createDerivedEdges(nodes: AutomationFlowNode[]): AutomationFlowEdge[] {
  const edges: AutomationFlowEdge[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const source = nodes[index - 1];
    const target = nodes[index];
    if (!source || !target) {
      continue;
    }
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
    });
  }
  return edges;
}
