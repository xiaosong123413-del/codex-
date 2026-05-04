/**
 * Tests the Remote Brain account auth boundary used by desktop and mobile
 * clients before they bind user-owned sync workspaces.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../cloudflare/remote-brain-worker/src/index.js";
import {
  createDbHarness,
  createDurableObjectNamespaceHarness,
  createEnv,
} from "./cloudflare-remote-brain-worker-test-helpers.js";

interface AccountRow {
  id: string;
  createdAt: string;
  updatedAt: string;
}

interface IdentityRow {
  accountId: string;
  type: string;
  identifier: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  accountId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

interface WorkspaceRow {
  accountId: string;
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  syncBackendType: string;
  syncBackendConfigJson: string;
  createdAt: string;
  updatedAt: string;
}

interface AccountAiSettingsRow {
  accountId: string;
  settingsJson: string;
  updatedAt: string;
}

interface WeChatLoginChallengeRow {
  id: string;
  pollTokenHash: string;
  status: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string;
  consumedAt: string;
}

describe("Cloudflare account auth routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an email identity, returns a session, and reads the session user", async () => {
    const env = createEnv({ DB: createAccountDb().db });

    const registerResponse = await worker.fetch(publicJsonRequest("/auth/register", {
      identityType: "email",
      identifier: "Alice@Example.COM",
      password: "correct-password",
    }), env);
    const registerPayload = await registerResponse.json() as {
      ok: boolean;
      user: { id: string; identities: Array<{ type: string; identifier: string }> };
      session: { token: string; expiresAt: string };
    };

    expect(registerResponse.status).toBe(200);
    expect(registerPayload.user.identities).toEqual([{ type: "email", identifier: "alice@example.com" }]);
    expect(registerPayload.session.token.length).toBeGreaterThan(20);

    const sessionResponse = await worker.fetch(sessionRequest("/auth/session", registerPayload.session.token, {}), env);
    const sessionPayload = await sessionResponse.json() as { ok: boolean; user: { id: string } };

    expect(sessionResponse.status).toBe(200);
    expect(sessionPayload).toMatchObject({
      ok: true,
      user: { id: registerPayload.user.id },
    });
  });

  it("rejects duplicate identities", async () => {
    const env = createEnv({ DB: createAccountDb().db });
    const body = { identityType: "phone", identifier: "+1 555 0100", password: "correct-password" };

    expect((await worker.fetch(publicJsonRequest("/auth/register", body), env)).status).toBe(200);
    const duplicateResponse = await worker.fetch(publicJsonRequest("/auth/register", body), env);
    const duplicatePayload = await duplicateResponse.json() as { ok: boolean; error: string };

    expect(duplicateResponse.status).toBe(409);
    expect(duplicatePayload).toEqual({ ok: false, error: "identity_exists" });
  });

  it("logs in an existing phone identity with the correct password", async () => {
    const env = createEnv({ DB: createAccountDb().db });
    await worker.fetch(publicJsonRequest("/auth/register", {
      identityType: "phone",
      identifier: "+1 555 0100",
      password: "correct-password",
    }), env);

    const loginResponse = await worker.fetch(publicJsonRequest("/auth/login", {
      identityType: "phone",
      identifier: "+1-555-0100",
      password: "correct-password",
    }), env);
    const loginPayload = await loginResponse.json() as {
      ok: boolean;
      user: { identities: Array<{ type: string; identifier: string }> };
      session: { token: string };
    };

    expect(loginResponse.status).toBe(200);
    expect(loginPayload.user.identities).toEqual([{ type: "phone", identifier: "+15550100" }]);
    expect(loginPayload.session.token.length).toBeGreaterThan(20);
  });

  it("builds a WeChat authorize URL for desktop and web clients", async () => {
    const env = createEnv({ DB: createAccountDb().db, WECHAT_WEB_APP_ID: "wx-web-app-id" });

    const response = await worker.fetch(publicJsonRequest("/auth/wechat/authorize-url", {
      redirectUri: "http://127.0.0.1:4175/wechat/callback",
      state: "state-one",
    }), env);
    const payload = await response.json() as { ok: boolean; url: string };

    expect(response.status).toBe(200);
    const url = new URL(payload.url.replace("#wechat_redirect", ""));
    expect(url.origin + url.pathname).toBe("https://open.weixin.qq.com/connect/qrconnect");
    expect(url.searchParams.get("appid")).toBe("wx-web-app-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4175/wechat/callback");
    expect(url.searchParams.get("scope")).toBe("snsapi_login");
    expect(url.searchParams.get("state")).toBe("state-one");
  });

  it("exchanges a WeChat web code with the website OAuth API", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({ openid: "openid-one", unionid: "union-one" });
    }));
    const env = createEnv({
      DB: createAccountDb().db,
      WECHAT_WEB_APP_ID: "wx-web-app-id",
      WECHAT_WEB_APP_SECRET: "web-secret",
    });

    const response = await worker.fetch(publicJsonRequest("/auth/wechat/login", {
      code: "web-code",
      clientType: "web",
    }), env);
    const payload = await response.json() as {
      ok: boolean;
      user: { identities: Array<{ type: string; identifier: string }> };
      session: { token: string };
    };

    expect(response.status).toBe(200);
    const tokenUrl = new URL(requestedUrls[0] ?? "");
    expect(tokenUrl.origin + tokenUrl.pathname).toBe("https://api.weixin.qq.com/sns/oauth2/access_token");
    expect(tokenUrl.searchParams.get("appid")).toBe("wx-web-app-id");
    expect(tokenUrl.searchParams.get("grant_type")).toBe("authorization_code");
    expect(payload.user.identities).toEqual([{ type: "wechat", identifier: "union-one" }]);
    expect(payload.session.token.length).toBeGreaterThan(20);
  });

  it("exchanges a WeChat mini program code with jscode2session", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({ openid: "mini-openid", unionid: "union-one" });
    }));
    const env = createEnv({
      DB: createAccountDb().db,
      WECHAT_MINI_PROGRAM_APP_ID: "wx-mini-app-id",
      WECHAT_MINI_PROGRAM_APP_SECRET: "mini-secret",
    });

    const response = await worker.fetch(publicJsonRequest("/auth/wechat/login", {
      code: "mini-code",
      clientType: "mini_program",
    }), env);
    const payload = await response.json() as {
      ok: boolean;
      user: { identities: Array<{ type: string; identifier: string }> };
    };

    expect(response.status).toBe(200);
    const tokenUrl = new URL(requestedUrls[0] ?? "");
    expect(tokenUrl.origin + tokenUrl.pathname).toBe("https://api.weixin.qq.com/sns/jscode2session");
    expect(tokenUrl.searchParams.get("appid")).toBe("wx-mini-app-id");
    expect(tokenUrl.searchParams.has("grant_type")).toBe(false);
    expect(payload.user.identities).toEqual([{ type: "wechat", identifier: "union-one" }]);
  });

  it("lets a mini program confirm a desktop QR login challenge", async () => {
    const dbHarness = createAccountDb();
    const env = createEnv({
      DB: dbHarness.db,
      WECHAT_MINI_PROGRAM_APP_ID: "wx-mini-app-id",
      WECHAT_MINI_PROGRAM_APP_SECRET: "mini-secret",
    });

    const startResponse = await worker.fetch(publicJsonRequest("/auth/wechat/mini-login/start", {}), env);
    const startPayload = await startResponse.json() as {
      loginId: string;
      pollToken: string;
      qrPayload: string;
    };
    const pendingResponse = await worker.fetch(publicJsonRequest("/auth/wechat/mini-login/poll", {
      loginId: startPayload.loginId,
      pollToken: startPayload.pollToken,
    }), env);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ openid: "mini-openid", unionid: "union-one" })));
    const confirmResponse = await worker.fetch(publicJsonRequest("/auth/wechat/mini-login/confirm", {
      loginId: startPayload.loginId,
      code: "mini-code",
    }), env);
    const pollResponse = await worker.fetch(publicJsonRequest("/auth/wechat/mini-login/poll", {
      loginId: startPayload.loginId,
      pollToken: startPayload.pollToken,
    }), env);
    const pollPayload = await pollResponse.json() as {
      status: string;
      user: { identities: Array<{ type: string; identifier: string }> };
      session: { token: string };
    };

    expect(startResponse.status).toBe(200);
    expect(startPayload.qrPayload).toContain(startPayload.loginId);
    expect(startPayload.qrPayload.startsWith("llmwiki://wechat-login")).toBe(true);
    expect(pendingResponse.status).toBe(200);
    expect(confirmResponse.status).toBe(200);
    expect(pollResponse.status).toBe(200);
    expect(pollPayload.status).toBe("confirmed");
    expect(pollPayload.user.identities).toEqual([{ type: "wechat", identifier: "union-one" }]);
    expect(pollPayload.session.token.length).toBeGreaterThan(20);
  });

  it("binds and lists workspaces under the authenticated account", async () => {
    const env = createEnv({ DB: createAccountDb().db });
    const registerResponse = await worker.fetch(publicJsonRequest("/auth/register", {
      identityType: "email",
      identifier: "alice@example.com",
      password: "correct-password",
    }), env);
    const registerPayload = await registerResponse.json() as { session: { token: string }; user: { id: string } };

    const bindResponse = await worker.fetch(sessionRequest("/account/workspaces/bind", registerPayload.session.token, {
      workspaceId: "workspace-one",
    }), env);
    const bindPayload = await bindResponse.json() as {
      ok: boolean;
      workspace: { workspaceId: string; ownerUserId: string };
    };

    expect(bindResponse.status).toBe(200);
    expect(bindPayload.workspace).toMatchObject({
      workspaceId: "workspace-one",
      ownerUserId: registerPayload.user.id,
    });

    const listResponse = await worker.fetch(sessionRequest("/account/workspaces/list", registerPayload.session.token, {}), env);
    const listPayload = await listResponse.json() as {
      ok: boolean;
      workspaces: Array<{ workspaceId: string; ownerUserId: string }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listPayload.workspaces).toEqual([{
      workspaceId: "workspace-one",
      ownerUserId: registerPayload.user.id,
      displayName: "",
      syncBackend: { type: "local_directory", config: {} },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }]);
  });

  it("saves and reads the account sync location without exposing a shared remote token", async () => {
    const env = createEnv({ DB: createAccountDb().db });
    const registerPayload = await registerAccount(env);

    const saveResponse = await worker.fetch(sessionRequest("/account/sync-location/save", registerPayload.session.token, {
      workspaceId: "workspace-one",
      displayName: "Alice desktop vault",
      syncBackend: {
        type: "local_directory",
        config: { localPath: "D:/Alice/wiki-vault" },
      },
    }), env);
    const savePayload = await saveResponse.json() as {
      ok: boolean;
      workspace: { syncBackend: { type: string; config: { localPath: string } } };
    };

    expect(saveResponse.status).toBe(200);
    expect(savePayload.workspace.syncBackend).toEqual({
      type: "local_directory",
      config: { localPath: "D:/Alice/wiki-vault" },
    });

    const readResponse = await worker.fetch(sessionRequest("/account/sync-location/get", registerPayload.session.token, {
      workspaceId: "workspace-one",
    }), env);
    const readPayload = await readResponse.json() as {
      ok: boolean;
      workspace: {
        workspaceId: string;
        ownerUserId: string;
        displayName: string;
        syncBackend: { type: string; config: { localPath: string } };
      };
    };

    expect(readResponse.status).toBe(200);
    expect(readPayload.workspace).toMatchObject({
      workspaceId: "workspace-one",
      ownerUserId: registerPayload.user.id,
      displayName: "Alice desktop vault",
      syncBackend: {
        type: "local_directory",
        config: { localPath: "D:/Alice/wiki-vault" },
      },
    });

    const unauthorizedResponse = await worker.fetch(publicJsonRequest("/account/sync-location/get", {
      workspaceId: "workspace-one",
    }), env);
    expect(unauthorizedResponse.status).toBe(401);
  });

  it("saves and reads account AI settings under the authenticated account", async () => {
    const env = createEnv({ DB: createAccountDb().db });
    const registerPayload = await registerAccount(env);

    const saveResponse = await worker.fetch(sessionRequest("/user/ai/settings/save", registerPayload.session.token, {
      settings: {
        defaultAccountRef: "api:openai:primary",
        apiAccounts: [{
          id: "openai:primary",
          name: "primary",
          provider: "openai",
          url: "https://api.openai.com/v1",
          key: "user-key",
          model: "gpt-4o",
          enabled: true,
        }],
        codexOAuth: { accountRef: "oauth:codex:cloud-account", enabled: true },
      },
    }), env);
    expect(saveResponse.status).toBe(200);

    const readResponse = await worker.fetch(sessionRequest("/user/ai/settings/get", registerPayload.session.token, {}), env);
    const readPayload = await readResponse.json() as {
      ok: boolean;
      settings: { defaultAccountRef: string; apiAccounts: Array<{ key: string }> };
    };

    expect(readResponse.status).toBe(200);
    expect(readPayload.settings.defaultAccountRef).toBe("api:openai:primary");
    expect(readPayload.settings.apiAccounts[0]?.key).toBe("user-key");
    const secondAccount = await registerAccountWithEmail(env, "bob@example.com");
    const isolatedResponse = await worker.fetch(sessionRequest("/user/ai/settings/get", secondAccount.session.token, {}), env);
    const isolatedPayload = await isolatedResponse.json() as { settings: unknown };
    expect(isolatedPayload.settings).toBeNull();
  });

  it("publishes wiki pages through an account session into an account-scoped path", async () => {
    const dbHarness = createAccountDb();
    const eventsHarness = createDurableObjectNamespaceHarness();
    const env = createEnv({
      DB: dbHarness.db,
      WIKI_PUBLISH_EVENTS: eventsHarness.namespace,
    });
    const registerPayload = await registerAccount(env);

    const response = await worker.fetch(sessionRequest("/user/publish", registerPayload.session.token, {
      workspaceId: "workspace-one",
      wikiRoot: "vault",
      publishVersion: "publish-1",
      publishedAt: "2026-04-29T12:00:00.000Z",
      files: [{
        path: "wiki/index.md",
        content: "# Index",
        hash: "hash-1",
        modifiedAt: "2026-04-29T11:00:00.000Z",
      }],
    }), env);
    const payload = await response.json() as { ok: boolean; pageCount: number };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, pageCount: 1 });
    const pageUpsert = dbHarness.calls.find((call) => call.sql.includes("INSERT INTO wiki_pages"));
    expect(pageUpsert?.params[0]).toBe(`accounts/${registerPayload.user.id}/workspace-one/wiki/index.md`);
    expect(eventsHarness.broadcasts[0]).toMatchObject({
      publishVersion: "publish-1",
      pageCount: 1,
      scope: "account",
      workspaceId: "workspace-one",
    });
  });

  it("uses the account session as the mobile entry owner on user routes", async () => {
    const dbHarness = createAccountDb();
    const env = createEnv({ DB: dbHarness.db });
    const registerPayload = await registerAccount(env);

    const response = await worker.fetch(sessionRequest("/user/mobile/entries", registerPayload.session.token, {
      ownerUid: "spoofed-owner",
      type: "flash_diary",
      title: "手机记录",
      text: "账号隔离记录",
      targetDate: "2026-04-29",
      createdAt: "2026-04-29T12:00:00.000Z",
    }), env);

    expect(response.status).toBe(200);
    const entryInsert = dbHarness.calls.find((call) => call.sql.includes("INSERT INTO mobile_entries"));
    expect(entryInsert?.params[1]).toBe(registerPayload.user.id);
  });

  it("uses the account session for mobile chat owner and wiki workspace scope", async () => {
    const dbHarness = createAccountDb();
    const env = createEnv({
      DB: dbHarness.db,
      LLM_MODEL: "@cf/fake-model",
      AI: {
        run: async () => ({ response: "账号回答" }),
      } as ReturnType<typeof createEnv>["AI"],
    });
    const registerPayload = await registerAccount(env);

    const response = await worker.fetch(sessionRequest("/user/mobile/chat/send", registerPayload.session.token, {
      ownerUid: "spoofed-owner",
      workspaceId: "workspace-one",
      message: "问题",
      mode: "wiki",
      selectedWikiPaths: ["wiki/manual.md"],
    }), env);
    const payload = await response.json() as { ok: boolean; chat: { ownerUid: string; sources: Array<{ path: string }> } };

    expect(response.status).toBe(200);
    expect(payload.chat.ownerUid).toBe(registerPayload.user.id);
    expect(payload.chat.sources).toEqual([expect.objectContaining({ path: "wiki/manual.md" })]);
    const selectedWikiRead = dbHarness.calls.find((call) => call.sql.includes("FROM wiki_pages WHERE path IN"));
    expect(selectedWikiRead?.params[0]).toBe(`accounts/${registerPayload.user.id}/workspace-one/wiki/manual.md`);
    const chatInsert = dbHarness.calls.find((call) => call.sql.includes("INSERT INTO mobile_chats"));
    expect(chatInsert?.params[1]).toBe(registerPayload.user.id);
  });

  it("uses the account session as the mobile task owner on user routes", async () => {
    const dbHarness = createAccountDb();
    const env = createEnv({ DB: dbHarness.db });
    const registerPayload = await registerAccount(env);

    const response = await worker.fetch(sessionRequest("/user/mobile/tasks/save", registerPayload.session.token, {
      ownerUid: "spoofed-owner",
      items: [{
        id: "task-1",
        ownerUid: "nested-spoofed-owner",
        title: "账号任务",
        kind: "todo",
        startTime: "09:00",
      }],
    }), env);

    expect(response.status).toBe(200);
    const taskInsert = dbHarness.calls.find((call) => call.sql.includes("INSERT INTO mobile_task_schedule"));
    expect(taskInsert?.params[1]).toBe(registerPayload.user.id);
  });
});

function publicJsonRequest(path: string, body: unknown): Request {
  return new Request(`https://remote-brain.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionRequest(path: string, token: string, body: unknown): Request {
  return new Request(`https://remote-brain.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function registerAccount(env: ReturnType<typeof createEnv>) {
  const response = await worker.fetch(publicJsonRequest("/auth/register", {
    identityType: "email",
    identifier: "alice@example.com",
    password: "correct-password",
  }), env);
  return await response.json() as {
    user: { id: string };
    session: { token: string; expiresAt: string };
  };
}

function createAccountDb() {
  const accounts = new Map<string, AccountRow>();
  const identities = new Map<string, IdentityRow>();
  const sessions = new Map<string, SessionRow>();
  const workspaces = new Map<string, WorkspaceRow>();
  const accountAiSettings = new Map<string, AccountAiSettingsRow>();
  const weChatLoginChallenges = new Map<string, WeChatLoginChallengeRow>();

  // fallow-ignore-next-line complexity
  const harness = createDbHarness((sql, params) => {
    if (sql.includes("CREATE TABLE") || sql.includes("CREATE INDEX")) return {};
    if (sql.includes("FROM account_identities WHERE type = ? AND identifier = ?")) {
      return readIdentity(identities, params);
    }
    if (sql.includes("SELECT type, identifier FROM account_identities WHERE account_id = ?")) {
      return listIdentities(identities, params);
    }
    if (sql.includes("INSERT INTO accounts")) {
      return insertAccount(accounts, params);
    }
    if (sql.includes("INSERT INTO account_identities")) {
      return insertIdentity(identities, params);
    }
    if (sql.includes("INSERT INTO account_sessions")) {
      return insertSession(sessions, params);
    }
    if (sql.includes("FROM account_sessions s JOIN accounts a")) {
      return readSession(accounts, sessions, params);
    }
    if (sql.includes("INSERT INTO account_wechat_login_challenges")) {
      return insertWeChatLoginChallenge(weChatLoginChallenges, params);
    }
    if (sql.includes("FROM account_wechat_login_challenges WHERE id = ? AND poll_token_hash = ?")) {
      return readWeChatLoginChallengeForPoll(weChatLoginChallenges, params);
    }
    if (sql.includes("FROM account_wechat_login_challenges WHERE id = ?")) {
      return readWeChatLoginChallenge(weChatLoginChallenges, params);
    }
    if (sql.includes("SET status = 'confirmed'")) {
      return confirmWeChatLoginChallenge(weChatLoginChallenges, params);
    }
    if (sql.includes("SET status = 'consumed'")) {
      return consumeWeChatLoginChallenge(weChatLoginChallenges, params);
    }
    if (sql.includes("INSERT INTO account_workspaces")) {
      return upsertWorkspace(workspaces, params);
    }
    if (sql.includes("FROM account_workspaces WHERE account_id = ? AND workspace_id = ?")) {
      return readWorkspace(workspaces, params);
    }
    if (sql.includes("FROM account_workspaces WHERE account_id = ?")) {
      return listWorkspaces(workspaces, params);
    }
    if (sql.includes("INSERT INTO account_ai_settings")) {
      return upsertAccountAiSettings(accountAiSettings, params);
    }
    if (sql.includes("FROM account_ai_settings WHERE account_id = ?")) {
      return readAccountAiSettings(accountAiSettings, params);
    }
    if (sql.includes("INSERT INTO publish_runs") || sql.includes("UPDATE publish_runs")) {
      return {};
    }
    if (sql.includes("INSERT INTO wiki_pages")) {
      return {};
    }
    if (sql.includes("ALTER TABLE mobile_chats ADD COLUMN mode")) {
      return {};
    }
    if (sql.includes("FROM mobile_chats WHERE id = ? AND owner_uid = ?")) {
      return { first: null };
    }
    if (sql.includes("FROM wiki_pages WHERE path IN")) {
      return {
        results: [{
          path: String(params[0]),
          title: "手动页面",
          content: "账号 workspace 页面内容",
        }],
      };
    }
    if (sql.includes("FROM wiki_pages WHERE path LIKE")) {
      return { results: [] };
    }
    if (sql.includes("INSERT INTO mobile_chats")) {
      return {};
    }
    if (sql.includes("INSERT INTO mobile_entries")) {
      return {};
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS mobile_task_schedule")) {
      return {};
    }
    if (sql.includes("ALTER TABLE mobile_task_schedule ADD COLUMN")) {
      return {};
    }
    if (sql.includes("DELETE FROM mobile_task_schedule")) {
      return {};
    }
    if (sql.includes("INSERT INTO mobile_task_schedule")) {
      return {};
    }
    return {};
  });
  return { ...harness, calls: harness.calls };
}

async function registerAccountWithEmail(env: ReturnType<typeof createEnv>, identifier: string) {
  const response = await worker.fetch(publicJsonRequest("/auth/register", {
    identityType: "email",
    identifier,
    password: "correct-password",
  }), env);
  return await response.json() as {
    user: { id: string };
    session: { token: string; expiresAt: string };
  };
}

function identityKey(type: unknown, identifier: unknown): string {
  return `${String(type)}:${String(identifier)}`;
}

function readIdentity(identities: Map<string, IdentityRow>, params: unknown[]) {
  const identity = identities.get(identityKey(params[0], params[1]));
  if (!identity) return { first: null };
  return {
    first: {
      accountId: identity.accountId,
      passwordHash: identity.passwordHash,
    },
  };
}

function listIdentities(identities: Map<string, IdentityRow>, params: unknown[]) {
  const accountId = String(params[0]);
  return {
    results: [...identities.values()]
      .filter((identity) => identity.accountId === accountId)
      .map((identity) => ({
        type: identity.type,
        identifier: identity.identifier,
      })),
  };
}

function insertAccount(accounts: Map<string, AccountRow>, params: unknown[]) {
  accounts.set(String(params[0]), {
    id: String(params[0]),
    createdAt: String(params[1]),
    updatedAt: String(params[2]),
  });
  return {};
}

function insertIdentity(identities: Map<string, IdentityRow>, params: unknown[]) {
  identities.set(identityKey(params[1], params[2]), {
    accountId: String(params[0]),
    type: String(params[1]),
    identifier: String(params[2]),
    passwordHash: String(params[3]),
    createdAt: String(params[4]),
    updatedAt: String(params[5]),
  });
  return {};
}

function insertSession(sessions: Map<string, SessionRow>, params: unknown[]) {
  sessions.set(String(params[1]), {
    accountId: String(params[0]),
    tokenHash: String(params[1]),
    createdAt: String(params[2]),
    expiresAt: String(params[3]),
  });
  return {};
}

function readSession(
  accounts: Map<string, AccountRow>,
  sessions: Map<string, SessionRow>,
  params: unknown[],
) {
  const session = sessions.get(String(params[0]));
  const now = String(params[1]);
  if (!session || session.expiresAt <= now) return { first: null };
  const account = accounts.get(session.accountId);
  if (!account) return { first: null };
  return {
    first: {
      accountId: account.id,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    },
  };
}

function insertWeChatLoginChallenge(
  challenges: Map<string, WeChatLoginChallengeRow>,
  params: unknown[],
) {
  challenges.set(String(params[0]), {
    id: String(params[0]),
    pollTokenHash: String(params[1]),
    status: "pending",
    accountId: "",
    createdAt: String(params[2]),
    expiresAt: String(params[3]),
    confirmedAt: "",
    consumedAt: "",
  });
  return {};
}

function readWeChatLoginChallenge(
  challenges: Map<string, WeChatLoginChallengeRow>,
  params: unknown[],
) {
  return { first: weChatLoginChallengeToRow(challenges.get(String(params[0]))) };
}

function readWeChatLoginChallengeForPoll(
  challenges: Map<string, WeChatLoginChallengeRow>,
  params: unknown[],
) {
  const row = challenges.get(String(params[0]));
  return row?.pollTokenHash === String(params[1]) ? { first: weChatLoginChallengeToRow(row) } : { first: null };
}

function confirmWeChatLoginChallenge(
  challenges: Map<string, WeChatLoginChallengeRow>,
  params: unknown[],
) {
  const row = challenges.get(String(params[2]));
  if (row?.status === "pending") {
    row.status = "confirmed";
    row.accountId = String(params[0]);
    row.confirmedAt = String(params[1]);
  }
  return {};
}

function consumeWeChatLoginChallenge(
  challenges: Map<string, WeChatLoginChallengeRow>,
  params: unknown[],
) {
  const row = challenges.get(String(params[1]));
  if (row?.status === "confirmed") {
    row.status = "consumed";
    row.consumedAt = String(params[0]);
  }
  return {};
}

function weChatLoginChallengeToRow(row: WeChatLoginChallengeRow | undefined) {
  return row
    ? {
      id: row.id,
      pollTokenHash: row.pollTokenHash,
      status: row.status,
      accountId: row.accountId,
      expiresAt: row.expiresAt,
    }
    : null;
}

// fallow-ignore-next-line complexity
function upsertWorkspace(workspaces: Map<string, WorkspaceRow>, params: unknown[]) {
  const now = String(params[3]);
  const existing = workspaces.get(String(params[1]));
  workspaces.set(String(params[1]), {
    accountId: String(params[0]),
    workspaceId: String(params[1]),
    ownerUserId: String(params[2]),
    displayName: String(params[5] ?? existing?.displayName ?? ""),
    syncBackendType: String(params[6] ?? existing?.syncBackendType ?? "local_directory"),
    syncBackendConfigJson: String(params[7] ?? existing?.syncBackendConfigJson ?? "{}"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return {};
}

function readWorkspace(workspaces: Map<string, WorkspaceRow>, params: unknown[]) {
  const workspace = workspaces.get(String(params[1]));
  if (!workspace || workspace.accountId !== String(params[0])) return { first: null };
  return { first: workspaceToRow(workspace) };
}

function listWorkspaces(workspaces: Map<string, WorkspaceRow>, params: unknown[]) {
  return {
    results: [...workspaces.values()]
      .filter((workspace) => workspace.accountId === String(params[0]))
      .map(workspaceToRow),
  };
}

function workspaceToRow(workspace: WorkspaceRow) {
  return {
    workspaceId: workspace.workspaceId,
    ownerUserId: workspace.ownerUserId,
    displayName: workspace.displayName,
    syncBackendType: workspace.syncBackendType,
    syncBackendConfigJson: workspace.syncBackendConfigJson,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

function upsertAccountAiSettings(settings: Map<string, AccountAiSettingsRow>, params: unknown[]) {
  settings.set(String(params[0]), {
    accountId: String(params[0]),
    settingsJson: String(params[1]),
    updatedAt: String(params[2]),
  });
  return {};
}

function readAccountAiSettings(settings: Map<string, AccountAiSettingsRow>, params: unknown[]) {
  const row = settings.get(String(params[0]));
  if (!row) return { first: null };
  return {
    first: {
      settingsJson: row.settingsJson,
      updatedAt: row.updatedAt,
    },
  };
}
