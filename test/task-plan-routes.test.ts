import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { ServerConfig } from "../web/server/config.js";
const { transcribeFileWithCloudflareMock } = vi.hoisted(() => ({
  transcribeFileWithCloudflareMock: vi.fn(),
}));

vi.mock("../web/server/services/transcript-service.js", () => ({
  transcribeFileWithCloudflare: transcribeFileWithCloudflareMock,
}));

import {
  handleTaskPlanGenerate,
  handleTaskPlanJsonParseError,
  handleTaskPlanPoolSave,
  handleTaskPlanRoadmap,
  handleTaskPlanScheduleSave,
  handleTaskPlanStatusSave,
  handleTaskPlanState,
  handleTaskPlanStatusRefresh,
  handleTaskPlanText,
  handleTaskPlanVoice,
} from "../web/server/routes/task-plan.js";
import { readTaskPlanState } from "../web/server/services/task-plan-store.js";
import { saveTaskPlanSchedule } from "../web/server/services/task-plan-service.js";
import type { LLMProvider } from "../src/utils/provider.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  transcribeFileWithCloudflareMock.mockReset();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("task plan routes", () => {
  it("state route returns the persisted seeded state", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanState(cfg, { storageRoot: root })({} as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        state: await readTaskPlanState({ storageRoot: root }),
      },
    });
  });

  it("text route saves direct planning text into the persisted state", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanText(cfg, { storageRoot: root })({
      body: {
        text: "直接输入今天的计划",
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.state.voice.transcript).toBe("直接输入今天的计划");
    expect(state.voice.transcript).toBe("直接输入今天的计划");
    expect(state.morningFlow.voiceDone).toBe(true);
  });

  it("status refresh route updates the persisted status summary from provider output", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "project-log.md"),
      "# Project Log\n\n- 上午推进任务计划。\n",
      "utf8",
    );
    await handleTaskPlanText(cfg, { storageRoot: root })({
      body: {
        text: "先完成任务计划，再同步上下文。",
      },
    } as unknown as Request, createResponse() as Response);
    const provider = createProvider("最近状态：任务计划已更新，正在同步上下文。");

    await handleTaskPlanStatusRefresh(cfg, {
      storageRoot: root,
      provider,
    })({} as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        state,
      },
    });
    expect(state.statusSummary).toBe("最近状态：任务计划已更新，正在同步上下文。");
  });

  it("status save route persists manual status summary edits", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanStatusSave(cfg, { storageRoot: root })({
      body: {
        statusSummary: "手动保存的状态摘要",
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        state,
      },
    });
    expect(state.statusSummary).toBe("手动保存的状态摘要");
  });

  it("pool save route persists manual task pool edits", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanPoolSave(cfg, { storageRoot: root })({
      body: {
        items: [
          { id: "pool-manual-1", title: "手动新增任务", priority: "mid", source: "手动新增" },
          { id: "pool-manual-2", title: "来自工作日志的任务", priority: "low", source: "工作日志" },
        ],
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        state,
      },
    });
    expect(state.pool.items).toEqual([
      {
        id: "pool-manual-1",
        title: "手动新增任务",
        priority: "mid",
        source: "手动新增",
        stageId: "stage:待分组领域:未归类项目:待推进",
      },
      {
        id: "pool-manual-2",
        title: "来自工作日志的任务",
        priority: "low",
        source: "工作日志",
        stageId: "stage:待分组领域:未归类项目:待推进",
      },
    ]);
    expect(state.pool.stages).toEqual([
      { id: "stage:待分组领域:未归类项目:待推进", title: "待推进", domain: "待分组领域", project: "未归类项目", order: 0 },
    ]);
  });

  it("generate route uses an injected provider when supplied", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "project-log.md"),
      "# Project Log\n\n- 路由层 provider 注入回归测试。\n",
      "utf8",
    );
    const provider = createProvider(JSON.stringify({
      items: [
        { id: "route-generated-1", title: "生成事项", startTime: "09:30", priority: "high" },
      ],
    }));

    await handleTaskPlanGenerate(cfg, {
      storageRoot: root,
      provider,
    })({} as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        schedule: {
          generationId: expect.any(String),
          revisionId: null,
          items: [
            { id: "route-generated-1", title: "生成事项", startTime: "09:30", priority: "high" },
          ],
          confirmed: false,
        },
      },
    });
  });

  it("schedule save route persists items and confirmed state", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    const nextItems = [
      { id: "schedule-keep-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" as const },
      { id: "schedule-keep-2", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" as const },
    ];

    await handleTaskPlanScheduleSave(cfg, { storageRoot: root })({
      body: {
        items: nextItems,
        confirmed: true,
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.schedule.items).toEqual(nextItems);
    expect(response.body.data.schedule.confirmed).toBe(true);
    expect(response.body.data.schedule.generationId).toBeNull();
    expect(typeof response.body.data.schedule.revisionId).toBe("string");
    expect(response.body.data.schedule.revisionId.length).toBeGreaterThan(0);
    expect(state.schedule).toEqual(response.body.data.schedule);
    expect(state.morningFlow.fineTuneDone).toBe(true);
  });

  it("schedule save route rejects confirming an empty schedule", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    const initialState = await readTaskPlanState({ storageRoot: root });

    await handleTaskPlanScheduleSave(cfg, { storageRoot: root })({
      body: {
        items: [],
        confirmed: true,
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "invalid_request",
        message: "confirmed schedule must include at least one item",
      },
    });
    expect(state.schedule).toEqual(initialState.schedule);
  });

  it("schedule save route rejects invalid startTime values", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanScheduleSave(cfg, { storageRoot: root })({
      body: {
        items: [
          { id: "schedule-invalid-time", title: "非法时间", startTime: "9:00", priority: "high" },
        ],
        confirmed: false,
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "invalid_request",
        message: "schedule item is invalid",
      },
    });
  });

  it("roadmap route returns the persisted roadmap payload", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();

    await handleTaskPlanRoadmap(cfg, { storageRoot: root })({} as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        roadmap: (await readTaskPlanState({ storageRoot: root })).roadmap,
      },
    });
  });

  it("returns a structured 400 payload for malformed task-plan JSON", async () => {
    const response = createResponse();
    const next = (() => {
      throw new Error("next should not be called");
    }) as NextFunction;

    handleTaskPlanJsonParseError(
      createJsonSyntaxError(),
      { originalUrl: "/api/task-plan/schedule" } as Request,
      response as Response,
      next,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "invalid_json",
        message: "invalid JSON request body",
      },
    });
  });

  it("serializes concurrent schedule save mutations for the same storage root", async () => {
    const root = makeTempRoot();

    const firstItems = [
      { id: "schedule-queue-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" as const },
    ];
    const secondItems = [
      { id: "schedule-queue-2", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" as const },
    ];

    const [firstSaveResult, secondSaveResult] = await Promise.all([
      saveTaskPlanSchedule({ items: firstItems, confirmed: true }, { storageRoot: root }),
      saveTaskPlanSchedule({ items: secondItems, confirmed: false }, { storageRoot: root }),
    ]);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(firstSaveResult.schedule.items).toEqual(firstItems);
    expect(firstSaveResult.schedule.confirmed).toBe(true);
    expect(secondSaveResult.schedule.items).toEqual(secondItems);
    expect(secondSaveResult.schedule.confirmed).toBe(false);
    expect(state.schedule).toEqual(secondSaveResult.schedule);
  });

  it("voice route transcribes audio, persists state, and records the saved audio path", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    const audioBase64 = Buffer.from("fake audio bytes", "utf8").toString("base64");
    transcribeFileWithCloudflareMock.mockResolvedValue({
      ok: true,
      text: "这是转录后的语音内容",
    });

    await handleTaskPlanVoice(cfg, { storageRoot: root })({
      body: {
        filename: "voice-note.wav",
        mimeType: "audio/wav",
        audioBase64,
      },
    } as unknown as Request, response as Response);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.state.voice.transcript).toBe("这是转录后的语音内容");
    expect(response.body.data.state.morningFlow.voiceDone).toBe(true);
    expect(state.voice.transcript).toBe("这是转录后的语音内容");
    expect(state.voice.audioPath).toBeTruthy();
    expect(typeof state.voice.updatedAt).toBe("string");
    const savedAudioPath = state.voice.audioPath ? path.join(root, state.voice.audioPath) : "";
    expect(fs.existsSync(savedAudioPath)).toBe(true);
  });

  it("voice route cleans up written audio when transcription fails", async () => {
    const root = makeTempRoot();
    const cfg = makeConfig(root);
    const response = createResponse();
    const audioBase64 = Buffer.from("fake audio bytes", "utf8").toString("base64");
    transcribeFileWithCloudflareMock.mockResolvedValue({
      ok: false,
      error: {
        type: "cloudflare-unconfigured",
        message: "transcription unavailable",
      },
    });

    await handleTaskPlanVoice(cfg, { storageRoot: root })({
      body: {
        filename: "voice-note.wav",
        mimeType: "audio/wav",
        audioBase64,
      },
    } as unknown as Request, response as Response);

    const audioDir = path.join(root, "audio");
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "transcription_failed",
        message: "transcription unavailable",
      },
    });
    expect(fs.existsSync(audioDir)).toBe(true);
    expect(fs.readdirSync(audioDir)).toEqual([]);
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-routes-"));
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  roots.push(root);
  return root;
}

function makeConfig(projectRoot: string): ServerConfig {
  return {
    sourceVaultRoot: projectRoot,
    wikiRoot: projectRoot,
    runtimeRoot: path.join(projectRoot, ".runtime"),
    projectRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "test",
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createJsonSyntaxError(): SyntaxError & { body: string } {
  const error = new SyntaxError("Unexpected end of JSON input") as SyntaxError & { body: string };
  error.body = "{\"items\":";
  return error;
}

function createProvider(result: string): LLMProvider {
  return {
    async complete() {
      return result;
    },
    async stream() {
      return result;
    },
  };
}
