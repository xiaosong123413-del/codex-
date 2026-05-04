import type { Express, NextFunction, Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  generateTaskPlan,
  readCurrentTaskPlanRoadmap,
  readCurrentTaskPlanState,
  refreshTaskPlanStatusSummary,
  saveTaskPlanPool,
  saveTaskPlanSchedule,
  saveTaskPlanStatusSummary,
  saveTaskPlanText,
  saveTaskPlanVoice,
  TaskPlanServiceError,
} from "../services/task-plan-service.js";
import type { TaskPlanActionItem, TaskPlanPoolItem, TaskPlanStageItem, TaskPlanStoreOptions, TaskWorkflowLogEntry } from "../services/task-plan-store.js";
import type { TaskPlanPriority, TaskPlanScheduleItem, TaskPlanTaskSource, TaskPoolOwner, TaskPoolZone } from "../services/task-plan-store.js";
import type { LLMProvider } from "../../../src/utils/provider.js";

interface TaskPlanRouteOptions extends TaskPlanStoreOptions {
  provider?: LLMProvider;
}

export function registerTaskPlanRoutes(
  app: Express,
  cfg: ServerConfig,
  options: TaskPlanRouteOptions = {},
): void {
  app.get("/api/task-plan/state", handleTaskPlanState(cfg, options));
  app.get("/api/task-plan/roadmap", handleTaskPlanRoadmap(cfg, options));
  app.post("/api/task-plan/generate", handleTaskPlanGenerate(cfg, options));
  app.post("/api/task-plan/voice", handleTaskPlanVoice(cfg, options));
  app.put("/api/task-plan/text", handleTaskPlanText(cfg, options));
  app.put("/api/task-plan/pool", handleTaskPlanPoolSave(cfg, options));
  app.put("/api/task-plan/status", handleTaskPlanStatusSave(cfg, options));
  app.post("/api/task-plan/status/refresh", handleTaskPlanStatusRefresh(cfg, options));
  app.put("/api/task-plan/schedule", handleTaskPlanScheduleSave(cfg, options));
}

export function handleTaskPlanJsonParseError(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isTaskPlanJsonParseError(error) && isTaskPlanRequest(req)) {
    res.status(400).json({
      success: false,
      error: {
        code: "invalid_json",
        message: "invalid JSON request body",
      },
    });
    return;
  }
  next(error);
}

export function handleTaskPlanState(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const state = await readCurrentTaskPlanState(options);
      res.json({
        success: true,
        data: { state },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanRoadmap(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const roadmap = await readCurrentTaskPlanRoadmap(options);
      res.json({
        success: true,
        data: { roadmap },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanScheduleSave(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = parseScheduleSaveInput(req.body);
      res.json({
        success: true,
        data: await saveTaskPlanSchedule(input, options),
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanGenerate(cfg: ServerConfig, options: TaskPlanRouteOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const result = await generateTaskPlan({
        projectRoot: cfg.projectRoot,
        wikiRoot: cfg.sourceVaultRoot,
        storageRoot: options.storageRoot,
        provider: options.provider,
      });
      if (!result.ok) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }
      res.json({
        success: true,
        data: {
          schedule: result.data.schedule,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanVoice(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = parseVoiceInput(req.body);
      const result = await saveTaskPlanVoice({
        ...input,
        storageRoot: options.storageRoot,
      });
      res.json({
        success: true,
        data: {
          state: result.state,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanText(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = parseTextInput(req.body);
      const result = await saveTaskPlanText({
        ...input,
        storageRoot: options.storageRoot,
      });
      res.json({
        success: true,
        data: {
          state: result.state,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanPoolSave(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = parsePoolSaveInput(req.body);
      const result = await saveTaskPlanPool({
        ...input,
        storageRoot: options.storageRoot,
      });
      res.json({
        success: true,
        data: {
          state: result.state,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanStatusRefresh(cfg: ServerConfig, options: TaskPlanRouteOptions = {}) {
  return async (_req: Request, res: Response) => {
    try {
      const result = await refreshTaskPlanStatusSummary({
        projectRoot: cfg.projectRoot,
        wikiRoot: cfg.sourceVaultRoot,
        storageRoot: options.storageRoot,
        provider: options.provider,
      });
      res.json({
        success: true,
        data: {
          state: result.state,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

export function handleTaskPlanStatusSave(_cfg: ServerConfig, options: TaskPlanStoreOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const input = parseStatusSummaryInput(req.body);
      const result = await saveTaskPlanStatusSummary({
        ...input,
        storageRoot: options.storageRoot,
      });
      res.json({
        success: true,
        data: {
          state: result.state,
        },
      });
    } catch (error) {
      respondWithRouteError(res, error);
    }
  };
}

function respondWithRouteError(res: Response, error: unknown): void {
  if (error instanceof TaskPlanServiceError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

function parseScheduleSaveInput(input: unknown): { items: TaskPlanScheduleItem[]; confirmed: boolean } {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", "request body must be an object", 400);
  }
  const { items, confirmed } = input;
  if (!Array.isArray(items)) {
    throw new TaskPlanServiceError("invalid_request", "items must be an array", 400);
  }
  if (typeof confirmed !== "boolean") {
    throw new TaskPlanServiceError("invalid_request", "confirmed must be a boolean", 400);
  }
  return {
    items: items.map(parseScheduleItem),
    confirmed,
  };
}

function parseScheduleItem(input: unknown): TaskPlanScheduleItem {
  const item = requireTaskPlanRecord(input, "schedule item must be an object");
  const id = readTrimmedString(item.id);
  const title = readTrimmedString(item.title);
  const startTime = readTrimmedString(item.startTime);
  const priority = readTaskPlanPriority(item.priority);
  if (!id || !title || !startTime || !priority || !isTaskPlanStartTime(startTime)) {
    throw new TaskPlanServiceError("invalid_request", "schedule item is invalid", 400);
  }
  return { id, title, startTime, priority };
}

function parseVoiceInput(input: unknown): { filename: string; mimeType: string; audioBase64: string } {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", "request body must be an object", 400);
  }
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim() : "";
  const audioBase64 = typeof input.audioBase64 === "string" ? input.audioBase64.trim() : "";
  if (!filename || !mimeType || !audioBase64) {
    throw new TaskPlanServiceError(
      "invalid_request",
      "filename, mimeType, and audioBase64 are required",
      400,
    );
  }
  return { filename, mimeType, audioBase64 };
}

function parseTextInput(input: unknown): { text: string } {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", "request body must be an object", 400);
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    throw new TaskPlanServiceError("invalid_request", "text is required", 400);
  }
  return { text };
}

function parseStatusSummaryInput(input: unknown): { statusSummary: string } {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", "request body must be an object", 400);
  }
  const statusSummary = typeof input.statusSummary === "string" ? input.statusSummary.trim() : "";
  if (!statusSummary) {
    throw new TaskPlanServiceError("invalid_request", "statusSummary is required", 400);
  }
  return { statusSummary };
}

function parsePoolSaveInput(input: unknown): { items: TaskPlanPoolItem[]; stages?: TaskPlanStageItem[] } {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", "request body must be an object", 400);
  }
  if (!Array.isArray(input.items)) {
    throw new TaskPlanServiceError("invalid_request", "items must be an array", 400);
  }
  const stages = Array.isArray(input.stages) ? input.stages.map(parsePoolStage) : undefined;
  return { items: input.items.map(parsePoolItem), stages };
}

function parsePoolItem(input: unknown): TaskPlanPoolItem {
  const item = requireTaskPlanRecord(input, "pool item must be an object");
  const id = readTrimmedString(item.id);
  const title = readTrimmedString(item.title);
  const priority = readTaskPlanPriority(item.priority);
  const source = readTaskPlanTaskSource(item.source);
  if (!id || !title || !priority || !source) {
    throw new TaskPlanServiceError("invalid_request", "pool item is invalid", 400);
  }
  const parsedItem: TaskPlanPoolItem = {
    id,
    title,
    priority,
    source,
  };
  assignPoolItemOptionalFields(parsedItem, item);
  return parsedItem;
}

function assignPoolItemOptionalFields(item: TaskPlanPoolItem, input: Record<string, unknown>): void {
  const textFields = [
    "domain",
    "project",
    "stageId",
    "createdAt",
    "completedAt",
    "dueDate",
    "diaryDate",
    "generationBatchId",
    "generatedReason",
    "duplicateOfTitle",
    "currentProgress",
    "lastStop",
    "nextStep",
  ] as const;
  for (const field of textFields) {
    const value = readTrimmedString(input[field]);
    if (value) {
      item[field] = value;
    }
  }
  const zone = readTaskPoolZone(input.zone);
  if (zone) item.zone = zone;
  const projectOrder = readNumber(input.projectOrder);
  if (projectOrder !== undefined) item.projectOrder = projectOrder;
  const taskOrder = readNumber(input.taskOrder);
  if (taskOrder !== undefined) item.taskOrder = taskOrder;
  const owner = readTaskPoolOwner(input.owner);
  if (owner) item.owner = owner;
  const workflowLog = readWorkflowLog(input.workflowLog);
  if (workflowLog.length > 0) item.workflowLog = workflowLog;
  const actions = readTaskActions(input.actions);
  if (actions.length > 0) item.actions = actions;
  assignPoolItemListFields(item, input);
}

function parsePoolStage(input: unknown): TaskPlanStageItem {
  const stage = requireTaskPlanRecord(input, "pool stage must be an object");
  const id = readTrimmedString(stage.id);
  const title = readTrimmedString(stage.title);
  const domain = readTrimmedString(stage.domain);
  const project = readTrimmedString(stage.project);
  const order = readNumber(stage.order);
  if (!id || !title || !domain || !project || order === undefined) {
    throw new TaskPlanServiceError("invalid_request", "pool stage is invalid", 400);
  }
  return { id, title, domain, project, order };
}

function assignPoolItemListFields(item: TaskPlanPoolItem, input: Record<string, unknown>): void {
  const listFields = ["linkedCases", "linkedResources", "linkedMethods", "sourceRefs"] as const;
  for (const field of listFields) {
    const value = readStringArray(input[field]);
    if (value.length > 0) {
      item[field] = value;
    }
  }
}

function readWorkflowLog(value: unknown): TaskWorkflowLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(readWorkflowLogEntry).filter((entry): entry is TaskWorkflowLogEntry => entry !== null);
}

function readTaskActions(value: unknown): TaskPlanActionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(readTaskAction).filter((entry): entry is TaskPlanActionItem => entry !== null);
}

function readTaskAction(value: unknown): TaskPlanActionItem | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id);
  const title = readTrimmedString(value.title);
  const order = readNumber(value.order);
  if (!id || !title || order === undefined) return null;
  const completedAt = readTrimmedString(value.completedAt);
  return completedAt ? { id, title, order, completedAt } : { id, title, order };
}

// fallow-ignore-next-line complexity
function readWorkflowLogEntry(value: unknown): TaskWorkflowLogEntry | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id);
  const recordedAt = readTrimmedString(value.recordedAt);
  if (!id || !recordedAt) return null;
  return {
    id,
    recordedAt,
    node: readTrimmedString(value.node) ?? "待整理",
    tool: readTrimmedString(value.tool) ?? "未识别",
    input: readTrimmedString(value.input) ?? "",
    output: readTrimmedString(value.output) ?? "",
    issue: readTrimmedString(value.issue) ?? "",
    nextStep: readTrimmedString(value.nextStep) ?? "",
    attachments: Array.isArray(value.attachments)
      ? value.attachments.filter((item): item is string => typeof item === "string")
      : [],
    sourceRecordId: readTrimmedString(value.sourceRecordId) ?? id,
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireTaskPlanRecord(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new TaskPlanServiceError("invalid_request", message, 400);
  }
  return input;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTaskPlanPriority(value: unknown): TaskPlanPriority | null {
  return isTaskPlanPriority(value) ? value : null;
}

function readTaskPlanTaskSource(value: unknown): TaskPlanTaskSource | null {
  return isTaskPlanTaskSource(value) ? value : null;
}

function readTaskPoolZone(value: unknown): TaskPoolZone | undefined {
  return value === "mine" || value === "ai" || value === "candidate" ? value : undefined;
}

function readTaskPoolOwner(value: unknown): TaskPoolOwner | undefined {
  return value === "me" || value === "ai" ? value : undefined;
}

function isTaskPlanPriority(value: unknown): value is TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral";
}

function isTaskPlanTaskSource(value: unknown): value is TaskPlanTaskSource {
  return value === "文字输入" || value === "近日状态" || value === "闪念日记" || value === "工作日志" || value === "AI 生成"
    || value === "手动新增";
}

function isTaskPlanStartTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskPlanJsonParseError(error: unknown): error is SyntaxError & { body: string } {
  return error instanceof SyntaxError && "body" in error;
}

function isTaskPlanRequest(req: Request): boolean {
  const url = typeof req.originalUrl === "string" ? req.originalUrl : req.url;
  return typeof url === "string" && url.startsWith("/api/task-plan");
}
