/**
 * Mini-program scan login endpoints for desktop and browser clients.
 *
 * Desktop and WebUI clients create a short-lived login challenge and render the
 * returned payload as a QR code. The WeChat mini program scans that payload,
 * confirms it with a `wx.login` code, and the polling client receives the same
 * account session model used by password login.
 */
import { ensureAccountSchema, missingDb, requireDb, type AccountAuthEnv } from "./account-storage.js";
import {
  createAccountSessionPayload,
  readOrCreateWeChatAccountIdFromCode,
} from "./account-auth-api.js";
import { json, safeJson } from "./worker-support.js";

type ChallengeStatus = "pending" | "confirmed" | "consumed";

interface ChallengeRow {
  id: string;
  pollTokenHash: string;
  status: ChallengeStatus;
  accountId: string;
  expiresAt: string;
}

interface LoginChallengePayload {
  loginId?: unknown;
  pollToken?: unknown;
  code?: unknown;
}

interface WeChatAuthEnv extends AccountAuthEnv {
  WECHAT_MINI_PROGRAM_APP_ID?: string;
  WECHAT_MINI_PROGRAM_APP_SECRET?: string;
}

const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LOGIN_QR_SCHEME = "llmwiki://wechat-login";

export async function handleAuthWeChatMiniLoginStart(_request: Request, env: WeChatAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const now = new Date();
  const loginId = randomBase64Url(18);
  const pollToken = randomBase64Url(32);
  const expiresAt = new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MS).toISOString();
  await insertChallenge(db, loginId, await sha256Base64Url(pollToken), now.toISOString(), expiresAt);
  return json({
    ok: true,
    loginId,
    pollToken,
    expiresAt,
    qrPayload: buildQrPayload(loginId),
  });
}

export async function handleAuthWeChatMiniLoginConfirm(request: Request, env: WeChatAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const payload = await safeJson<LoginChallengePayload>(request);
  const loginId = readText(payload.loginId);
  const code = readText(payload.code);
  if (!loginId || !code) return json({ ok: false, error: "invalid_wechat_login_challenge" }, 400);

  const challenge = await readChallengeById(db, loginId);
  if (!challenge || challengeExpired(challenge)) return json({ ok: false, error: "wechat_login_challenge_expired" }, 410);
  if (challenge.status !== "pending") return json({ ok: false, error: "wechat_login_challenge_used" }, 409);

  const account = await readOrCreateWeChatAccountIdFromCode(db, env, code, "mini_program");
  if (!account.ok) return json({ ok: false, error: account.error }, account.status);
  await confirmChallenge(db, loginId, account.accountId, new Date().toISOString());
  return json({ ok: true, status: "confirmed" });
}

export async function handleAuthWeChatMiniLoginPoll(request: Request, env: WeChatAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const payload = await safeJson<LoginChallengePayload>(request);
  const loginId = readText(payload.loginId);
  const pollToken = readText(payload.pollToken);
  if (!loginId || !pollToken) return json({ ok: false, error: "invalid_wechat_login_challenge" }, 400);

  const challenge = await readChallengeForPoll(db, loginId, await sha256Base64Url(pollToken));
  if (!challenge || challengeExpired(challenge)) return json({ ok: false, status: "expired", error: "wechat_login_challenge_expired" }, 410);
  if (challenge.status === "pending") return json({ ok: true, status: "pending", expiresAt: challenge.expiresAt });
  if (challenge.status !== "confirmed" || !challenge.accountId) {
    return json({ ok: false, status: "consumed", error: "wechat_login_challenge_used" }, 409);
  }

  await consumeChallenge(db, loginId, new Date().toISOString());
  return json({
    ok: true,
    status: "confirmed",
    ...await createAccountSessionPayload(db, challenge.accountId, new Date()),
  });
}

async function insertChallenge(
  db: D1Database,
  id: string,
  pollTokenHash: string,
  createdAt: string,
  expiresAt: string,
): Promise<void> {
  await db.prepare(
    "INSERT INTO account_wechat_login_challenges (id, poll_token_hash, status, created_at, expires_at) VALUES (?, ?, 'pending', ?, ?)",
  ).bind(id, pollTokenHash, createdAt, expiresAt).run();
}

async function readChallengeById(db: D1Database, id: string): Promise<ChallengeRow | null> {
  return normalizeChallenge(await db.prepare(
    "SELECT id, poll_token_hash AS pollTokenHash, status, account_id AS accountId, expires_at AS expiresAt FROM account_wechat_login_challenges WHERE id = ?",
  ).bind(id).first());
}

async function readChallengeForPoll(db: D1Database, id: string, pollTokenHash: string): Promise<ChallengeRow | null> {
  return normalizeChallenge(await db.prepare(
    "SELECT id, poll_token_hash AS pollTokenHash, status, account_id AS accountId, expires_at AS expiresAt FROM account_wechat_login_challenges WHERE id = ? AND poll_token_hash = ?",
  ).bind(id, pollTokenHash).first());
}

async function confirmChallenge(db: D1Database, id: string, accountId: string, confirmedAt: string): Promise<void> {
  await db.prepare(
    "UPDATE account_wechat_login_challenges SET status = 'confirmed', account_id = ?, confirmed_at = ? WHERE id = ? AND status = 'pending'",
  ).bind(accountId, confirmedAt, id).run();
}

async function consumeChallenge(db: D1Database, id: string, consumedAt: string): Promise<void> {
  await db.prepare(
    "UPDATE account_wechat_login_challenges SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'confirmed'",
  ).bind(consumedAt, id).run();
}

function normalizeChallenge(row: Record<string, unknown> | null): ChallengeRow | null {
  if (!row) return null;
  const status = readChallengeStatus(row.status);
  const id = readText(row.id);
  const pollTokenHash = readText(row.pollTokenHash);
  const expiresAt = readText(row.expiresAt);
  return id && pollTokenHash && status && expiresAt
    ? { id, pollTokenHash, status, accountId: readText(row.accountId), expiresAt }
    : null;
}

function readChallengeStatus(value: unknown): ChallengeStatus | null {
  return value === "pending" || value === "confirmed" || value === "consumed" ? value : null;
}

function challengeExpired(challenge: ChallengeRow): boolean {
  return Date.parse(challenge.expiresAt) <= Date.now();
}

function buildQrPayload(loginId: string): string {
  const url = new URL(LOGIN_QR_SCHEME);
  url.searchParams.set("loginId", loginId);
  return url.toString();
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readText(value: unknown): string {
  return String(value ?? "").trim();
}
