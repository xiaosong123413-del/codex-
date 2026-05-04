/**
 * Health-domain workspace routes.
 *
 * Exposes the sleep-first health dashboard plus the local Xiaomi connection
 * endpoints used by the workspace health page.
 */

import type { Express, Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  readHealthDomainState,
  saveHealthDomainAccountConnection,
  saveHealthDomainApiConnection,
  syncHealthDomainData,
} from "../services/health-domain.js";
import {
  connectXiaomiHealthAccount,
  pollXiaomiHealthQrLogin,
  startXiaomiHealthQrLogin,
  startXiaomiHealthVerification,
  syncXiaomiHealthSnapshot,
  type XiaomiBridgeError,
} from "../services/health-domain-xiaomi.js";

interface HealthDomainPayload<T> {
  success: true;
  data: T;
}

interface HealthDomainErrorPayload {
  success: false;
  error: {
    code?: string;
    message: string;
    captchaImageDataUrl?: string;
  };
}

export function registerHealthDomainRoutes(
  app: Express,
  cfg: ServerConfig,
): void {
  app.get("/api/workspace/health/state", handleWorkspaceHealthState(cfg));
  app.post(
    "/api/workspace/health/connection/api",
    handleWorkspaceHealthApiConnectionSave(cfg),
  );
  app.post(
    "/api/workspace/health/connection/account/send-code",
    handleWorkspaceHealthAccountCodeSend(cfg),
  );
  app.post(
    "/api/workspace/health/connection/account",
    handleWorkspaceHealthAccountConnectionSave(cfg),
  );
  app.post(
    "/api/workspace/health/connection/qr/start",
    handleWorkspaceHealthQrLoginStart(cfg),
  );
  app.get(
    "/api/workspace/health/connection/qr/:sessionId",
    handleWorkspaceHealthQrLoginPoll(cfg),
  );
  app.post("/api/workspace/health/sync", handleWorkspaceHealthSync(cfg));
}

export function handleWorkspaceHealthState(cfg: ServerConfig) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const state = await readHealthDomainState(cfg.projectRoot);
      res.json(success({ state }));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

export function handleWorkspaceHealthApiConnectionSave(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = requireRecord(req.body, "request body must be an object");
      const state = await saveHealthDomainApiConnection(cfg.projectRoot, {
        tokenJson: requireText(body.tokenJson, "tokenJson is required"),
        apiBaseUrl: readText(body.apiBaseUrl),
        relativeUid: readText(body.relativeUid),
      });
      res.json(success({ state }));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

function handleWorkspaceHealthAccountCodeSend(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = requireRecord(req.body, "request body must be an object");
      const result = await startXiaomiHealthVerification(cfg.projectRoot, {
        username: requireText(body.username, "username is required"),
        captchaCode: readText(body.captchaCode),
      });
      res.json(success(result));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

function handleWorkspaceHealthAccountConnectionSave(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = requireRecord(req.body, "request body must be an object");
      const connection = await connectXiaomiHealthAccount(cfg.projectRoot, {
        username: requireText(body.username, "username is required"),
        password: readText(body.password),
        verificationCode: readText(body.verificationCode),
        captchaCode: readText(body.captchaCode),
      });
      const state = await saveHealthDomainAccountConnection(cfg.projectRoot, {
        tokenJson: connection.tokenJson,
        relativeUid: readText(body.relativeUid),
      });
      res.json(success({ state }));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

function handleWorkspaceHealthQrLoginStart(cfg: ServerConfig) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await startXiaomiHealthQrLogin(cfg.projectRoot);
      res.json(success(result));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

function handleWorkspaceHealthQrLoginPoll(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pollXiaomiHealthQrLogin(
        requireText(req.params.sessionId, "sessionId is required"),
      );
      if (result.status === "pending") {
        res.json(success(result));
        return;
      }
      const state = await saveHealthDomainAccountConnection(cfg.projectRoot, {
        tokenJson: result.tokenJson,
        relativeUid: readText(req.query.relativeUid),
      });
      res.json(success({ status: "connected", state }));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

export function handleWorkspaceHealthSync(cfg: ServerConfig) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const state = await syncHealthDomainData(cfg.projectRoot, (input) =>
        syncXiaomiHealthSnapshot(cfg.projectRoot, input)
      );
      res.json(success({ state }));
    } catch (error) {
      respondWithHealthDomainError(res, error);
    }
  };
}

function success<T>(data: T): HealthDomainPayload<T> {
  return { success: true, data };
}

function respondWithHealthDomainError(res: Response, error: unknown): void {
  const payload = buildHealthDomainErrorPayload(error);
  res.status(payload.error.code === "captcha_required" ? 409 : 400).json(payload);
}

function buildHealthDomainErrorPayload(error: unknown): HealthDomainErrorPayload {
  if (isCaptchaChallengeError(error)) {
    return {
      success: false,
      error: {
        code: error.code ?? undefined,
        message: error.message,
        captchaImageDataUrl: readText(error.details?.captchaImageDataUrl),
      },
    };
  }
  return {
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function isCaptchaChallengeError(
  error: unknown,
): error is XiaomiBridgeError & { code: "captcha_required" } {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "captcha_required"
  );
}

function requireRecord(
  input: unknown,
  message: string,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(message);
  }
  return input;
}

function requireText(input: unknown, message: string): string {
  const value = readText(input);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function readText(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}
