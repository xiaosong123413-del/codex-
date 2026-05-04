/**
 * Route-level regression tests for the workspace health-domain endpoints.
 *
 * These tests focus on the transport shape exposed to the WebUI so login
 * challenges such as Xiaomi image captchas do not collapse into unreadable
 * generic errors at the HTTP boundary.
 */

import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { ServerConfig } from "../web/server/config.js";

const {
  startXiaomiHealthVerificationMock,
  readHealthDomainStateMock,
  saveHealthDomainAccountConnectionMock,
  saveHealthDomainApiConnectionMock,
  syncHealthDomainDataMock,
  connectXiaomiHealthAccountMock,
  syncXiaomiHealthSnapshotMock,
  startXiaomiHealthQrLoginMock,
  pollXiaomiHealthQrLoginMock,
} = vi.hoisted(() => ({
  startXiaomiHealthVerificationMock: vi.fn(),
  readHealthDomainStateMock: vi.fn(),
  saveHealthDomainAccountConnectionMock: vi.fn(),
  saveHealthDomainApiConnectionMock: vi.fn(),
  syncHealthDomainDataMock: vi.fn(),
  connectXiaomiHealthAccountMock: vi.fn(),
  syncXiaomiHealthSnapshotMock: vi.fn(),
  startXiaomiHealthQrLoginMock: vi.fn(),
  pollXiaomiHealthQrLoginMock: vi.fn(),
}));

vi.mock("../web/server/services/health-domain.js", () => ({
  readHealthDomainState: readHealthDomainStateMock,
  saveHealthDomainAccountConnection: saveHealthDomainAccountConnectionMock,
  saveHealthDomainApiConnection: saveHealthDomainApiConnectionMock,
  syncHealthDomainData: syncHealthDomainDataMock,
}));

vi.mock("../web/server/services/health-domain-xiaomi.js", () => ({
  startXiaomiHealthVerification: startXiaomiHealthVerificationMock,
  connectXiaomiHealthAccount: connectXiaomiHealthAccountMock,
  syncXiaomiHealthSnapshot: syncXiaomiHealthSnapshotMock,
  startXiaomiHealthQrLogin: startXiaomiHealthQrLoginMock,
  pollXiaomiHealthQrLogin: pollXiaomiHealthQrLoginMock,
}));

import { registerHealthDomainRoutes } from "../web/server/routes/health-domain.js";

describe("health domain routes", () => {
  it("returns a structured captcha challenge payload for account verification code requests", async () => {
    const app = createFakeApp();
    registerHealthDomainRoutes(app.express, makeConfig());
    const handler = app.routes.get("POST /api/workspace/health/connection/account/send-code");

    expect(handler).toBeTypeOf("function");

    const challenge = new Error("获取验证码前需要先完成图形验证码。") as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    challenge.code = "captcha_required";
    challenge.details = {
      captchaImageDataUrl: "data:image/png;base64,ZmFrZQ==",
    };
    startXiaomiHealthVerificationMock.mockRejectedValueOnce(challenge);

    const response = createResponse();
    await handler!(
      {
        body: {
          username: "19000000000",
        },
      } as Request,
      response as Response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "captcha_required",
        message: "获取验证码前需要先完成图形验证码。",
        captchaImageDataUrl: "data:image/png;base64,ZmFrZQ==",
      },
    });
  });

  it("forwards captcha code when finishing account connection", async () => {
    const app = createFakeApp();
    registerHealthDomainRoutes(app.express, makeConfig());
    const handler = app.routes.get("POST /api/workspace/health/connection/account");

    expect(handler).toBeTypeOf("function");

    connectXiaomiHealthAccountMock.mockResolvedValueOnce({
      tokenJson: "{}",
      userId: "123",
    });
    saveHealthDomainAccountConnectionMock.mockResolvedValueOnce(createConnectedHealthState());

    const response = createResponse();
    await handler!(
      {
        body: {
          username: "19000000000",
          verificationCode: "123456",
          captchaCode: "aBcD",
        },
      } as Request,
      response as Response,
    );

    expect(connectXiaomiHealthAccountMock).toHaveBeenCalledWith("D:/project", {
      username: "19000000000",
      password: "",
      verificationCode: "123456",
      captchaCode: "aBcD",
    });
    expect(response.statusCode).toBe(200);
  });

  it("starts Xiaomi QR login and returns the QR image url", async () => {
    const app = createFakeApp();
    registerHealthDomainRoutes(app.express, makeConfig());
    const handler = app.routes.get("POST /api/workspace/health/connection/qr/start");

    expect(handler).toBeTypeOf("function");
    startXiaomiHealthQrLoginMock.mockResolvedValueOnce({
      sessionId: "qr-1",
      qrImageUrl: "https://account.xiaomi.com/qr.png",
      loginUrl: "https://account.xiaomi.com/login",
    });

    const response = createResponse();
    await handler!({ body: {} } as Request, response as Response);

    expect(startXiaomiHealthQrLoginMock).toHaveBeenCalledWith("D:/project");
    expect(response.body).toEqual({
      success: true,
      data: {
        sessionId: "qr-1",
        qrImageUrl: "https://account.xiaomi.com/qr.png",
        loginUrl: "https://account.xiaomi.com/login",
      },
    });
  });

  it("saves the token when Xiaomi QR login completes", async () => {
    const app = createFakeApp();
    registerHealthDomainRoutes(app.express, makeConfig());
    const handler = app.routes.get("GET /api/workspace/health/connection/qr/:sessionId");

    expect(handler).toBeTypeOf("function");
    pollXiaomiHealthQrLoginMock.mockResolvedValueOnce({
      status: "connected",
      tokenJson: "{\"userId\":\"123\"}",
      userId: "123",
    });
    saveHealthDomainAccountConnectionMock.mockResolvedValueOnce(createConnectedHealthState());

    const response = createResponse();
    await handler!(
      {
        params: { sessionId: "qr-1" },
        query: { relativeUid: "456" },
      } as unknown as Request,
      response as Response,
    );

    expect(pollXiaomiHealthQrLoginMock).toHaveBeenCalledWith("qr-1");
    expect(saveHealthDomainAccountConnectionMock).toHaveBeenCalledWith("D:/project", {
      tokenJson: "{\"userId\":\"123\"}",
      relativeUid: "456",
    });
    expect(response.body).toEqual({
      success: true,
      data: {
        status: "connected",
        state: expect.any(Object),
      },
    });
  });
});

function createConnectedHealthState() {
  return {
    connection: {
      mode: "account",
      status: "connected",
      label: "小米账号",
      lastSyncedAt: null,
      lastError: null,
    },
    sleep: {
      latest: {
        bedTime: null,
        wakeTime: null,
        totalSleep: null,
        deepSleepQuality: null,
        deepSleepMinutes: null,
        restingHeartRate: null,
        sleepScore: null,
        awakeDuration: null,
        sleepAverageHeartRate: null,
        steps: null,
        intensityMinutes: null,
      },
      insights: [],
      trends: {
        bedTimes: [],
        wakeTimes: [],
        deepSleepMinutes: [],
        sleepScores: [],
        steps: [],
        intensityMinutes: [],
      },
    },
  };
}

function makeConfig(): ServerConfig {
  return {
    sourceVaultRoot: "D:/vault",
    runtimeRoot: "D:/.runtime",
    projectRoot: "D:/project",
    host: "127.0.0.1",
    port: 4175,
    author: "test",
  };
}

function createFakeApp(): {
  express: {
    get(path: string, handler: unknown): void;
    post(path: string, handler: unknown): void;
  };
  routes: Map<string, (req: Request, res: Response) => Promise<void>>;
} {
  const routes = new Map<string, (req: Request, res: Response) => Promise<void>>();
  return {
    express: {
      get(path, handler) {
        routes.set(`GET ${path}`, handler as (req: Request, res: Response) => Promise<void>);
      },
      post(path, handler) {
        routes.set(`POST ${path}`, handler as (req: Request, res: Response) => Promise<void>);
      },
    },
    routes,
  };
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function createResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
  };
  return response;
}
