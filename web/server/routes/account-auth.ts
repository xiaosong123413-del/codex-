/**
 * Proxies public account authentication calls from the WebUI to Remote Brain.
 *
 * The browser must never receive WeChat secrets. These routes only forward the
 * redirect URI, state, OAuth code, and client type to the Worker that owns
 * provider secrets and account session creation.
 */
import type { Express, Request, Response } from "express";

interface WorkerJsonResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export function registerAccountAuthRoutes(app: Express): void {
  app.post("/api/account-auth/wechat/authorize-url", handleWeChatAuthorizeUrl);
  app.post("/api/account-auth/wechat/login", handleWeChatLogin);
  app.post("/api/account-auth/wechat/mini-login/start", handleWeChatMiniLoginStart);
  app.post("/api/account-auth/wechat/mini-login/confirm", handleWeChatMiniLoginConfirm);
  app.post("/api/account-auth/wechat/mini-login/poll", handleWeChatMiniLoginPoll);
}

async function handleWeChatAuthorizeUrl(req: Request, res: Response): Promise<void> {
  await proxyWorkerJson(res, "/auth/wechat/authorize-url", {
    redirectUri: req.body?.redirectUri,
    state: req.body?.state,
  });
}

async function handleWeChatLogin(req: Request, res: Response): Promise<void> {
  await proxyWorkerJson(res, "/auth/wechat/login", {
    code: req.body?.code,
    clientType: req.body?.clientType,
  });
}

async function handleWeChatMiniLoginStart(req: Request, res: Response): Promise<void> {
  await proxyWorkerJson(res, "/auth/wechat/mini-login/start", req.body ?? {});
}

async function handleWeChatMiniLoginConfirm(req: Request, res: Response): Promise<void> {
  await proxyWorkerJson(res, "/auth/wechat/mini-login/confirm", req.body ?? {});
}

async function handleWeChatMiniLoginPoll(req: Request, res: Response): Promise<void> {
  await proxyWorkerJson(res, "/auth/wechat/mini-login/poll", req.body ?? {});
}

async function proxyWorkerJson(res: Response, path: string, body: Record<string, unknown>): Promise<void> {
  const workerUrl = readWorkerUrl();
  if (!workerUrl) {
    res.status(500).json({ success: false, error: "CLOUDFLARE_WORKER_URL is not configured." });
    return;
  }
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readWorkerPayload(response);
  res.status(response.status).json({
    success: response.ok && payload.ok !== false,
    data: payload,
    error: payload.error,
  });
}

async function readWorkerPayload(response: Response): Promise<WorkerJsonResponse> {
  return await response.json().catch(() => ({ ok: false, error: "Invalid worker response." })) as WorkerJsonResponse;
}

function readWorkerUrl(): string {
  return String(process.env.CLOUDFLARE_WORKER_URL ?? "").trim().replace(/\/+$/, "");
}
