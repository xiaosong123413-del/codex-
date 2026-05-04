import type { MobileOwnerPayload } from "./mobile-shared.js";
import { json, safeJson } from "./worker-support.js";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_DEVICE_USER_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const CODEX_DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const CODEX_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
const CODEX_DEVICE_TOKEN_EXCHANGE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_STATE_TTL_MS = 15 * 60 * 1000;

interface MobileCodexOAuthEnv {
  DB?: D1Database;
  REMOTE_TOKEN?: string;
}

interface MobileCodexOAuthStartPayload extends MobileOwnerPayload {}

interface MobileCodexOAuthPollPayload extends MobileOwnerPayload {
  state?: unknown;
}

interface CodexDeviceUserCodeResponse {
  device_auth_id?: unknown;
  user_code?: unknown;
  usercode?: unknown;
  interval?: unknown;
  expires_in?: unknown;
  verification_uri?: unknown;
  verification_url?: unknown;
  verification_uri_complete?: unknown;
}

interface CodexDeviceTokenResponse {
  authorization_code?: unknown;
  code_verifier?: unknown;
  code_challenge?: unknown;
  error?: unknown;
}

interface TokenExchangeResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
}

interface SignedDeviceState {
  ownerUid: string;
  deviceAuthId: string;
  userCode: string;
  expiresAt: number;
  nonce: string;
}

type CodexDeviceCodeResult =
  | {
    ok: true;
    deviceAuthId: string;
    userCode: string;
    verificationUrl: string;
    pollIntervalSeconds: number;
    expiresInSeconds: number;
  }
  | { ok: false; error: string };

export async function handleMobileCodexOAuthStart(
  request: Request,
  env: MobileCodexOAuthEnv,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  if (!readText(env.REMOTE_TOKEN)) return json({ ok: false, error: "missing_remote_token" }, 500);

  const payload = await safeJson<MobileCodexOAuthStartPayload>(request);
  const ownerUid = readText(payload.ownerUid);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);

  const device = await requestCodexDeviceCode();
  if (!device.ok) {
    return json({ ok: false, error: device.error }, 502);
  }

  const state = await signDeviceState(env, {
    ownerUid,
    deviceAuthId: device.deviceAuthId,
    userCode: device.userCode,
    expiresAt: Date.now() + device.expiresInSeconds * 1000,
    nonce: crypto.randomUUID(),
  });

  return json({
    ok: true,
    url: device.verificationUrl,
    userCode: device.userCode,
    state,
    pollIntervalSeconds: device.pollIntervalSeconds,
  });
}

export async function handleMobileCodexOAuthPoll(
  request: Request,
  env: MobileCodexOAuthEnv,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);

  const payload = await safeJson<MobileCodexOAuthPollPayload>(request);
  const ownerUid = readText(payload.ownerUid);
  const stateText = readText(payload.state);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!stateText) return json({ ok: false, error: "missing_oauth_state" }, 400);

  const state = await verifyDeviceState(env, stateText);
  if (!state || state.ownerUid !== ownerUid) {
    return json({ ok: false, error: "invalid_oauth_state" }, 400);
  }
  if (Date.now() > state.expiresAt) {
    return json({ ok: true, status: "error", error: "Codex OAuth 登录超时，请重新点击。" });
  }

  const tokenResponse = await pollCodexDeviceToken(state.deviceAuthId, state.userCode);
  if (tokenResponse.status === "wait") {
    return json({ ok: true, status: "wait" });
  }
  if (tokenResponse.status === "error") {
    return json({ ok: true, status: "error", error: tokenResponse.error });
  }

  const token = await exchangeCodexDeviceCode(tokenResponse.authorizationCode, tokenResponse.codeVerifier);
  if (!token) {
    return json({ ok: true, status: "error", error: "Codex OAuth token exchange failed" });
  }

  const claims = readJwtPayload(token.idToken);
  const authClaims = readRecord(claims["https://api.openai.com/auth"]);
  const email = readText(claims.email);
  const accountId = readNullableText(authClaims.chatgpt_account_id);
  const planType = readNullableText(authClaims.chatgpt_plan_type);
  const accountName = codexAccountName(email, accountId, state.ownerUid);

  await env.DB.prepare(
    "INSERT INTO mobile_codex_tokens (owner_uid, account_name, email, plan_type, access_token, refresh_token, account_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(owner_uid, account_name) DO UPDATE SET email = excluded.email, plan_type = excluded.plan_type, access_token = excluded.access_token, refresh_token = excluded.refresh_token, account_id = excluded.account_id, updated_at = CURRENT_TIMESTAMP",
  ).bind(
    state.ownerUid,
    accountName,
    email || null,
    planType,
    token.accessToken,
    token.refreshToken,
    accountId,
  ).run();

  return json({
    ok: true,
    status: "ok",
    account: {
      name: accountName,
      provider: "codex",
      email: email || undefined,
      enabled: true,
      planType: planType || undefined,
    },
  });
}

// fallow-ignore-next-line complexity
async function requestCodexDeviceCode(): Promise<CodexDeviceCodeResult> {
  const response = await fetch(CODEX_DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });
  const payload = await readJsonPayload(response) as CodexDeviceUserCodeResponse;
  if (!response.ok) {
    return { ok: false, error: readCodexDeviceCodeError(response, payload) };
  }

  const deviceAuthId = readText(payload.device_auth_id);
  const userCode = readText(payload.user_code) || readText(payload.usercode);
  if (!deviceAuthId || !userCode) {
    return { ok: false, error: "Codex device code response missing required fields" };
  }

  return {
    ok: true,
    deviceAuthId,
    userCode,
    verificationUrl: readText(payload.verification_uri_complete)
      || readText(payload.verification_uri)
      || readText(payload.verification_url)
      || CODEX_DEVICE_VERIFICATION_URL,
    pollIntervalSeconds: readPositiveInteger(payload.interval) ?? DEFAULT_POLL_INTERVAL_SECONDS,
    expiresInSeconds: readPositiveInteger(payload.expires_in) ?? DEFAULT_STATE_TTL_MS / 1000,
  };
}

function readCodexDeviceCodeError(response: Response, payload: CodexDeviceUserCodeResponse): string {
  const payloadError = readText((payload as { error?: unknown }).error);
  if (payloadError) return `Codex device code HTTP ${response.status}: ${payloadError}`;
  return `Codex device code HTTP ${response.status}`;
}

async function pollCodexDeviceToken(
  deviceAuthId: string,
  userCode: string,
): Promise<
  | { status: "wait" }
  | { status: "error"; error: string }
  | { status: "ok"; authorizationCode: string; codeVerifier: string }
> {
  const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
  });
  const payload = await readJsonPayload(response) as CodexDeviceTokenResponse;
  if (response.status === 403 || response.status === 404) {
    return { status: "wait" };
  }
  if (!response.ok) {
    return { status: "error", error: readText(payload.error) || `Codex device token HTTP ${response.status}` };
  }

  const authorizationCode = readText(payload.authorization_code);
  const codeVerifier = readText(payload.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    return { status: "error", error: "Codex device token response missing required fields" };
  }
  return { status: "ok", authorizationCode, codeVerifier };
}

async function exchangeCodexDeviceCode(
  code: string,
  codeVerifier: string,
): Promise<{ accessToken: string; refreshToken: string | null; idToken: string } | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CODEX_CLIENT_ID,
    code,
    redirect_uri: CODEX_DEVICE_TOKEN_EXCHANGE_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await readJsonPayload(response) as TokenExchangeResponse;
  if (!response.ok) return null;

  const accessToken = readText(payload.access_token);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: readNullableText(payload.refresh_token),
    idToken: readText(payload.id_token),
  };
}

async function signDeviceState(env: MobileCodexOAuthEnv, state: SignedDeviceState): Promise<string> {
  const payload = utf8ToBase64Url(JSON.stringify(state));
  const signature = await hmacBase64Url(readText(env.REMOTE_TOKEN), payload);
  return `${payload}.${signature}`;
}

// fallow-ignore-next-line complexity
async function verifyDeviceState(env: MobileCodexOAuthEnv, stateText: string): Promise<SignedDeviceState | null> {
  const [payload, signature] = stateText.split(".");
  if (!payload || !signature) return null;
  const expected = await hmacBase64Url(readText(env.REMOTE_TOKEN), payload);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(base64UrlToUtf8(payload)) as Partial<SignedDeviceState>;
    const ownerUid = readText(parsed.ownerUid);
    const deviceAuthId = readText(parsed.deviceAuthId);
    const userCode = readText(parsed.userCode);
    const nonce = readText(parsed.nonce);
    const expiresAt = typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : 0;
    if (!ownerUid || !deviceAuthId || !userCode || !nonce || expiresAt <= 0) return null;
    return { ownerUid, deviceAuthId, userCode, nonce, expiresAt };
  } catch {
    return null;
  }
}

async function hmacBase64Url(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function codexAccountName(email: string, accountId: string | null, ownerUid: string): string {
  const identity = email || accountId || ownerUid;
  return `codex-mobile-${identity.replace(/[^a-zA-Z0-9@._-]+/g, "-")}.json`;
}

function readJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    return readRecord(JSON.parse(base64UrlToUtf8(payload)) as unknown);
  } catch {
    return {};
  }
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableText(value: unknown): string | null {
  const text = readText(value);
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlToUtf8(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
