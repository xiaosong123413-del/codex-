/**
 * Account authentication routes for public desktop and mobile clients.
 *
 * This module owns the first production login method: email/phone plus
 * password. Verification-code delivery can be added later without changing the
 * account, identity, session, or workspace ownership tables.
 */
import { AccountAuthEnv, ensureAccountSchema, missingDb, requireDb } from "./account-storage.js";
import { json, safeJson } from "./worker-support.js";

type AccountIdentityType = "email" | "phone" | "wechat";
type WeChatClientType = "web" | "mini_program";

interface AuthRequestPayload {
  identityType?: unknown;
  identifier?: unknown;
  password?: unknown;
}

interface WeChatAuthRequestPayload {
  code?: unknown;
  clientType?: unknown;
}

interface WeChatAuthorizeUrlPayload {
  redirectUri?: unknown;
  state?: unknown;
}

interface AccountIdentityActionPayload {
  identityType?: unknown;
  identifier?: unknown;
  password?: unknown;
}

interface WeChatTokenPayload {
  access_token?: unknown;
  openid?: unknown;
  unionid?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

interface NormalizedIdentity {
  type: AccountIdentityType;
  identifier: string;
}

interface WeChatAuthEnv extends AccountAuthEnv {
  WECHAT_WEB_APP_ID?: string;
  WECHAT_WEB_APP_SECRET?: string;
  WECHAT_MINI_PROGRAM_APP_ID?: string;
  WECHAT_MINI_PROGRAM_APP_SECRET?: string;
}

interface AccountUserPayload {
  id: string;
  identities: NormalizedIdentity[];
}

interface AccountSessionPayload {
  user: AccountUserPayload;
  session: SessionRecord;
}

type WeChatAccountResult =
  | { ok: true; accountId: string }
  | { ok: false; status: number; error: string };

interface WeChatClientConfig {
  appId: string;
  appSecret: string;
  clientType: WeChatClientType;
}

export interface AccountSession {
  accountId: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRecord {
  token: string;
  expiresAt: string;
}

const PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_MIN_LENGTH = 8;
const SESSION_TTL_DAYS = 30;

export async function handleAuthRegister(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const payload = await safeJson<AuthRequestPayload>(request);
  const identity = normalizeIdentity(payload.identityType, payload.identifier);
  const password = readPassword(payload.password);
  if (!identity) return json({ ok: false, error: "invalid_identity" }, 400);
  if (!password) return json({ ok: false, error: "invalid_password" }, 400);

  const existing = await readIdentity(db, identity);
  if (existing) return json({ ok: false, error: "identity_exists" }, 409);

  const now = new Date();
  const accountId = crypto.randomUUID();
  await createAccount(db, accountId, now.toISOString());
  await createIdentity(db, accountId, identity, await hashPassword(password), now.toISOString());
  const session = await createSession(db, accountId, now);
  return json({ ok: true, user: buildUser(accountId, [identity]), session });
}

export async function handleAuthLogin(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const payload = await safeJson<AuthRequestPayload>(request);
  const identity = normalizeIdentity(payload.identityType, payload.identifier);
  const password = readPassword(payload.password);
  if (!identity || !password) return json({ ok: false, error: "invalid_credentials" }, 401);

  const existing = await readIdentity(db, identity);
  if (!existing || !(await verifyPassword(password, existing.passwordHash))) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const session = await createSession(db, existing.accountId, new Date());
  const identities = await listAccountIdentities(db, existing.accountId);
  return json({ ok: true, user: buildUser(existing.accountId, identities), session });
}

export async function handleAuthWeChatLogin(request: Request, env: WeChatAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const payload = await safeJson<WeChatAuthRequestPayload>(request);
  const code = readText(payload.code);
  if (!code) return json({ ok: false, error: "missing_wechat_code" }, 400);

  const account = await readOrCreateWeChatAccountIdFromCode(db, env, code, readWeChatClientType(payload.clientType));
  if (!account.ok) return json({ ok: false, error: account.error }, account.status);
  const now = new Date();
  return json({ ok: true, ...await createAccountSessionPayload(db, account.accountId, now) });
}

export async function handleAuthWeChatAuthorizeUrl(request: Request, env: WeChatAuthEnv): Promise<Response> {
  const appId = readText(env.WECHAT_WEB_APP_ID);
  if (!appId) return json({ ok: false, error: "missing_wechat_config" }, 500);

  const payload = await safeJson<WeChatAuthorizeUrlPayload>(request);
  const redirectUri = readText(payload.redirectUri);
  const state = readText(payload.state);
  if (!redirectUri) return json({ ok: false, error: "missing_redirect_uri" }, 400);

  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.searchParams.set("appid", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_login");
  if (state) url.searchParams.set("state", state);
  return json({ ok: true, url: `${url.toString()}#wechat_redirect` });
}

export async function handleAuthSession(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);
  const identities = await listAccountIdentities(db, account.accountId);
  return json({ ok: true, user: buildUser(account.accountId, identities) });
}

export async function handleAccountIdentitiesList(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);
  const identities = await listAccountIdentities(db, account.accountId);
  return json({ ok: true, identities, user: buildUser(account.accountId, identities) });
}

export async function handleAccountWeChatBind(request: Request, env: WeChatAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await safeJson<WeChatAuthRequestPayload>(request);
  const clientType = readWeChatClientType(payload.clientType);
  const config = readWeChatClientConfig(env, clientType);
  if (!config) return json({ ok: false, error: "missing_wechat_config" }, 500);

  const code = readText(payload.code);
  if (!code) return json({ ok: false, error: "missing_wechat_code" }, 400);

  const tokenPayload = await fetchWeChatToken(config, code);
  const openId = readText(tokenPayload.openid);
  const unionId = readText(tokenPayload.unionid);
  const identity = normalizeWeChatIdentity(unionId || openId);
  if (!identity) {
    return json({ ok: false, error: readWeChatError(tokenPayload) || "wechat_auth_failed" }, 401);
  }

  const existing = await readIdentity(db, identity);
  if (existing && existing.accountId !== account.accountId) {
    return json({ ok: false, error: "identity_bound_to_another_account" }, 409);
  }

  const now = new Date().toISOString();
  if (!existing) {
    await createIdentity(db, account.accountId, identity, "", now);
  }
  const identities = await listAccountIdentities(db, account.accountId);
  return json({ ok: true, identities, user: buildUser(account.accountId, identities) });
}

export async function handleAccountIdentityBind(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await safeJson<AccountIdentityActionPayload>(request);
  const identity = normalizeIdentity(payload.identityType, payload.identifier);
  const password = readPassword(payload.password);
  if (!identity) return json({ ok: false, error: "invalid_identity" }, 400);
  if (!password) return json({ ok: false, error: "invalid_password" }, 400);
  if (identity.type === "wechat") return json({ ok: false, error: "invalid_identity" }, 400);

  const existing = await readIdentity(db, identity);
  if (existing && existing.accountId !== account.accountId) {
    return json({ ok: false, error: "identity_bound_to_another_account" }, 409);
  }

  if (!existing) {
    await createIdentity(db, account.accountId, identity, await hashPassword(password), new Date().toISOString());
  }

  const identities = await listAccountIdentities(db, account.accountId);
  return json({ ok: true, identities, user: buildUser(account.accountId, identities) });
}

export async function handleAccountIdentityUnbind(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await safeJson<AccountIdentityActionPayload>(request);
  const identityType = readAccountIdentityType(payload.identityType);
  const identifier = readText(payload.identifier);
  if (!identityType || !identifier) return json({ ok: false, error: "invalid_identity" }, 400);

  const identities = await listAccountIdentities(db, account.accountId);
  const target = identities.find((identity) => identity.type === identityType && identity.identifier === identifier);
  if (!target) return json({ ok: false, error: "identity_not_bound" }, 404);
  if (identities.length <= 1) return json({ ok: false, error: "cannot_unbind_last_identity" }, 409);

  await db.prepare("DELETE FROM account_identities WHERE account_id = ? AND type = ? AND identifier = ?")
    .bind(account.accountId, target.type, target.identifier)
    .run();
  const nextIdentities = await listAccountIdentities(db, account.accountId);
  return json({ ok: true, identities: nextIdentities, user: buildUser(account.accountId, nextIdentities) });
}

export async function readAccountSessionFromRequest(
  request: Request,
  env: AccountAuthEnv,
): Promise<AccountSession | null> {
  const db = requireDb(env);
  const token = readBearerToken(request);
  if (!db || !token) return null;
  const tokenHash = await sha256Base64Url(token);
  const row = await db.prepare(
    "SELECT s.account_id AS accountId, a.created_at AS createdAt, a.updated_at AS updatedAt FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?",
  ).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  return {
    accountId: String(row.accountId ?? ""),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function normalizeIdentity(type: unknown, identifier: unknown): NormalizedIdentity | null {
  const identityType = type === "email" || type === "phone" ? type : null;
  if (!identityType) return null;
  const normalized = identityType === "email"
    ? normalizeEmail(identifier)
    : normalizePhone(identifier);
  return normalized ? { type: identityType, identifier: normalized } : null;
}

function normalizeEmail(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text : "";
}

function normalizePhone(value: unknown): string {
  const text = String(value ?? "").replace(/[\s()-]/g, "");
  return /^\+?\d{6,15}$/.test(text) ? text : "";
}

function normalizeWeChatIdentity(value: unknown): NormalizedIdentity | null {
  const identifier = readText(value).slice(0, 128);
  return identifier ? { type: "wechat", identifier } : null;
}

function readWeChatClientType(value: unknown): WeChatClientType {
  return value === "mini_program" ? "mini_program" : "web";
}

function readWeChatClientConfig(
  env: WeChatAuthEnv,
  clientType: WeChatClientType,
): WeChatClientConfig | null {
  const appId = clientType === "mini_program"
    ? readText(env.WECHAT_MINI_PROGRAM_APP_ID)
    : readText(env.WECHAT_WEB_APP_ID);
  const appSecret = clientType === "mini_program"
    ? readText(env.WECHAT_MINI_PROGRAM_APP_SECRET)
    : readText(env.WECHAT_WEB_APP_SECRET);
  return appId && appSecret ? { appId, appSecret, clientType } : null;
}

function readAccountIdentityType(value: unknown): AccountIdentityType | null {
  return value === "email" || value === "phone" || value === "wechat" ? value : null;
}

export async function readOrCreateWeChatAccountIdFromCode(
  db: D1Database,
  env: WeChatAuthEnv,
  code: string,
  clientType: WeChatClientType,
): Promise<WeChatAccountResult> {
  const config = readWeChatClientConfig(env, clientType);
  if (!config) return { ok: false, status: 500, error: "missing_wechat_config" };

  const tokenPayload = await fetchWeChatToken(config, code);
  const openId = readText(tokenPayload.openid);
  const unionId = readText(tokenPayload.unionid);
  const identity = normalizeWeChatIdentity(unionId || openId);
  if (!identity) {
    return {
      ok: false,
      status: 401,
      error: readWeChatError(tokenPayload) || "wechat_auth_failed",
    };
  }
  return {
    ok: true,
    accountId: await readOrCreateSocialAccount(db, identity, new Date().toISOString()),
  };
}

function readPassword(value: unknown): string {
  const password = String(value ?? "");
  return password.length >= PASSWORD_MIN_LENGTH ? password : "";
}

async function readIdentity(
  db: D1Database,
  identity: NormalizedIdentity,
): Promise<{ accountId: string; passwordHash: string } | null> {
  const row = await db.prepare(
    "SELECT account_id AS accountId, password_hash AS passwordHash FROM account_identities WHERE type = ? AND identifier = ?",
  ).bind(identity.type, identity.identifier).first();
  if (!row) return null;
  return {
    accountId: String(row.accountId ?? ""),
    passwordHash: String(row.passwordHash ?? ""),
  };
}

async function listAccountIdentities(
  db: D1Database,
  accountId: string,
): Promise<NormalizedIdentity[]> {
  const { results } = await db.prepare(
    "SELECT type, identifier FROM account_identities WHERE account_id = ? ORDER BY created_at ASC",
  ).bind(accountId).all();
  return (results ?? []).flatMap((row) => {
    const type = readAccountIdentityType(row.type);
    const identifier = readText(row.identifier);
    return type && identifier ? [{ type, identifier }] : [];
  });
}

async function createAccount(db: D1Database, accountId: string, now: string): Promise<void> {
  await db.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
    .bind(accountId, now, now)
    .run();
}

async function createIdentity(
  db: D1Database,
  accountId: string,
  identity: NormalizedIdentity,
  passwordHash: string,
  now: string,
): Promise<void> {
  await db.prepare(
    "INSERT INTO account_identities (account_id, type, identifier, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(accountId, identity.type, identity.identifier, passwordHash, now, now).run();
}

async function readOrCreateSocialAccount(
  db: D1Database,
  identity: NormalizedIdentity,
  now: string,
): Promise<string> {
  const existing = await readIdentity(db, identity);
  if (existing) return existing.accountId;
  const accountId = crypto.randomUUID();
  await createAccount(db, accountId, now);
  await createIdentity(db, accountId, identity, "", now);
  return accountId;
}

async function createSession(
  db: D1Database,
  accountId: string,
  now: Date,
): Promise<SessionRecord> {
  const token = randomBase64Url(32);
  const tokenHash = await sha256Base64Url(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    "INSERT INTO account_sessions (account_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(accountId, tokenHash, createdAt, expiresAt).run();
  return { token, expiresAt };
}

export async function createAccountSessionPayload(
  db: D1Database,
  accountId: string,
  now: Date,
): Promise<AccountSessionPayload> {
  const session = await createSession(db, accountId, now);
  const identities = await listAccountIdentities(db, accountId);
  return { user: buildUser(accountId, identities), session };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBase64Url(16);
  const derived = await derivePasswordHash(password, salt);
  return `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${salt}$${derived}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_ALGORITHM) return false;
  const iterations = Number(parts[1]);
  if (iterations !== PASSWORD_HASH_ITERATIONS) return false;
  const derived = await derivePasswordHash(password, parts[2] ?? "");
  return timingSafeTextEqual(derived, parts[3] ?? "");
}

async function fetchWeChatToken(
  config: WeChatClientConfig,
  code: string,
): Promise<WeChatTokenPayload> {
  const url = new URL(readWeChatTokenEndpoint(config.clientType));
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);
  url.searchParams.set("code", code);
  if (config.clientType === "web") url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  return await response.json().catch(() => ({})) as WeChatTokenPayload;
}

function readWeChatTokenEndpoint(clientType: WeChatClientType): string {
  return clientType === "mini_program"
    ? "https://api.weixin.qq.com/sns/jscode2session"
    : "https://api.weixin.qq.com/sns/oauth2/access_token";
}

function readWeChatError(payload: WeChatTokenPayload): string {
  const errcode = readText(payload.errcode);
  const errmsg = readText(payload.errmsg);
  return errmsg ? `wechat_auth_failed:${errcode ? ` ${errcode}` : ""} ${errmsg}` : "";
}

async function derivePasswordHash(password: string, saltBase64Url: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64UrlToBytes(saltBase64Url),
    iterations: PASSWORD_HASH_ITERATIONS,
  }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
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

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeTextEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function readBearerToken(request: Request): string {
  return request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
}

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function buildUser(accountId: string, identities: NormalizedIdentity[] = []): {
  id: string;
  identities: Array<{ type: AccountIdentityType; identifier: string }>;
} {
  return {
    id: accountId,
    identities: identities.map((identity) => ({ type: identity.type, identifier: identity.identifier })),
  };
}
