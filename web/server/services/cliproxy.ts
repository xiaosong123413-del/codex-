import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ProxyAgent } from "undici";
import {
  cliproxyConfigDir,
  cliproxySourceDir,
  normalizeCLIProxyConfig,
  readCLIProxyConfig,
  serializeCLIProxyConfig,
  type CLIProxyConfig,
  type CLIProxyConfigInput,
} from "./cliproxy-config.js";
import { saveLlmProviderConfig } from "./llm-config.js";

const REPO_URL = "https://github.com/router-for-me/CLIProxyAPI.git";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

let runningProcess: ChildProcessWithoutNullStreams | null = null;

interface CLIProxyCommandResult {
  stdout: string;
  stderr: string;
}

interface CLIProxyCommandOptions {
  cwd?: string;
}

export type CLIProxyCommandRunner = (
  command: string,
  args: readonly string[],
  options?: CLIProxyCommandOptions,
) => Promise<CLIProxyCommandResult>;

export type CLIProxyFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type CLIProxyFetchInit = RequestInit & { dispatcher?: unknown };

interface CLIProxyBuiltConfig extends CLIProxyConfig {
  configDir: string;
  configPath: string;
  authDir: string;
  sourceDir: string;
  proxyBaseUrl: string;
  yaml: string;
}

interface CLIProxyAccount {
  name: string;
  provider: string;
  authIndex?: string;
  email?: string;
  status?: string;
  statusMessage?: string;
  disabled?: boolean;
  planType?: string;
}

interface CLIProxyStatus {
  running: boolean;
  proxyBaseUrl: string;
  config: CLIProxyConfig;
  sourceInstalled: boolean;
  accounts: CLIProxyAccount[];
  message: string;
}

type CLIProxyOAuthProvider = "anthropic" | "codex" | "gemini-cli" | "antigravity" | "kimi";

interface CLIProxyOAuthInput extends Partial<CLIProxyConfig> {
  provider: CLIProxyOAuthProvider;
}

interface CLIProxyOAuthResult {
  url: string;
  state: string;
}

interface CLIProxyOAuthStatusInput extends Partial<CLIProxyConfig> {
  state: unknown;
}

interface CLIProxyOAuthStatusResult {
  status: "ok" | "wait" | "error";
  error?: string;
}

interface CLIProxyOpenAICompatibilityInput extends Partial<CLIProxyConfig> {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
  alias?: unknown;
}

interface CLIProxyCodexAccount extends CLIProxyAccount {
  provider: "codex";
  enabled: boolean;
  quota?: CLIProxyCodexQuota;
}

interface CLIProxyOAuthAccount extends CLIProxyAccount {
  enabled: boolean;
  quota?: CLIProxyCodexQuota;
}

interface CLIProxyCodexQuota {
  fetchedAt: string;
  primaryWindow?: CLIProxyCodexQuotaWindow;
  secondaryWindow?: CLIProxyCodexQuotaWindow;
  error?: string;
}

interface CLIProxyCodexQuotaWindow {
  usedPercent: number | null;
  resetsAt: string | null;
}

interface CLIProxyCodexAccountsInput extends Partial<CLIProxyConfig> {
  projectRoot: string;
  refreshQuota?: boolean;
}

interface CLIProxyCodexAccountSelectionInput extends Partial<CLIProxyConfig> {
  name: unknown;
  enabled: unknown;
}

interface CLIProxyAccountDeleteInput extends Partial<CLIProxyConfig> {
  projectRoot: string;
  name: unknown;
}

interface CLIProxyAuthFileModelsInput extends Partial<CLIProxyConfig> {
  name: unknown;
}

interface CLIProxyCodexWorkerSyncInput extends Partial<CLIProxyConfig> {
  projectRoot: string;
  name: unknown;
  ownerUid: unknown;
  workerUrl: unknown;
  remoteToken: unknown;
}

interface CLIProxyModelDescriptor {
  id: string;
  displayName?: string;
  type?: string;
  ownedBy?: string;
}

export { readCLIProxyConfig } from "./cliproxy-config.js";

export function buildCLIProxyConfig(projectRoot: string, input: CLIProxyConfigInput = {}): CLIProxyBuiltConfig {
  const config = normalizeCLIProxyConfig({ ...readCLIProxyConfig(projectRoot), ...input });
  const dir = cliproxyConfigDir(projectRoot);
  const authDir = path.join(dir, "auths");
  const sourceDir = cliproxySourceDir(projectRoot);
  const configPath = path.join(dir, "config.yaml");
  const proxyBaseUrl = `http://127.0.0.1:${config.port}/v1`;
  const yaml = [
    'host: "127.0.0.1"',
    `port: ${config.port}`,
    "tls:",
    "  enable: false",
    "remote-management:",
    "  allow-remote: false",
    `  secret-key: ${quoteYaml(config.managementKey)}`,
    "  disable-control-panel: true",
    `auth-dir: ${quoteYaml(authDir)}`,
    "api-keys:",
    `  - ${quoteYaml(config.clientKey)}`,
    ...(config.proxyUrl ? [`proxy-url: ${quoteYaml(config.proxyUrl)}`] : []),
    "logging-to-file: true",
    "usage-statistics-enabled: true",
    "request-retry: 3",
    "routing:",
    '  strategy: "round-robin"',
    "",
  ].join("\n");
  return { ...config, configDir: dir, configPath, authDir, sourceDir, proxyBaseUrl, yaml };
}

export async function installCLIProxySource(
  projectRoot: string,
  runner: CLIProxyCommandRunner = runCommand,
): Promise<{ installed: boolean; sourceDir: string; message: string }> {
  const sourceDir = cliproxySourceDir(projectRoot);
  if (fs.existsSync(path.join(sourceDir, ".git"))) {
    await runner("git", ["pull", "--ff-only"], { cwd: sourceDir });
    return { installed: true, sourceDir, message: "CLIProxyAPI source updated" };
  }
  fs.mkdirSync(path.dirname(sourceDir), { recursive: true });
  await runner("git", ["clone", REPO_URL, sourceDir], { cwd: projectRoot });
  return { installed: true, sourceDir, message: "CLIProxyAPI source installed" };
}

export async function startCLIProxy(
  projectRoot: string,
  input: CLIProxyConfigInput = {},
  runner?: CLIProxyCommandRunner,
): Promise<{ running: boolean; proxyBaseUrl: string; message: string }> {
  const built = buildCLIProxyConfig(projectRoot, input);
  writeCLIProxyConfig(projectRoot, built);
  if (!fs.existsSync(path.join(built.sourceDir, "go.mod"))) {
    throw new Error("CLIProxyAPI source is missing. Install it first.");
  }

  await stopCLIProxy();
  if (runner) {
    await runner("go", ["run", "./cmd/server", "--config", built.configPath], { cwd: built.sourceDir });
  } else {
    runningProcess = spawn("go", ["run", "./cmd/server", "--config", built.configPath], {
      cwd: built.sourceDir,
      windowsHide: true,
      stdio: "pipe",
    });
    runningProcess.once("exit", () => {
      runningProcess = null;
    });
  }

  saveLlmProviderConfig(projectRoot, {
    provider: "openai",
    url: built.proxyBaseUrl,
    key: built.clientKey,
    model: built.model,
  });
  return { running: true, proxyBaseUrl: built.proxyBaseUrl, message: "CLIProxyAPI started" };
}

export async function stopCLIProxy(): Promise<{ running: boolean; message: string }> {
  if (!runningProcess) {
    return { running: false, message: "CLIProxyAPI is not running" };
  }
  const child = runningProcess;
  runningProcess = null;
  child.kill();
  return { running: false, message: "CLIProxyAPI stopped" };
}

export async function getCLIProxyStatus(
  input: Partial<CLIProxyConfig> = {},
  fetcher: CLIProxyFetcher = fetch,
): Promise<CLIProxyStatus> {
  const config = normalizeCLIProxyConfig(input);
  const base = baseURL(config.port);
  const sourceInstalled = Boolean(config.sourceDir && fs.existsSync(path.join(config.sourceDir, "go.mod")));
  try {
    const health = await fetcher(`${base}/healthz`);
    if (!health.ok) throw new Error(`health HTTP ${health.status}`);
    const accounts = await fetchAccounts(config, fetcher);
    return {
      running: true,
      proxyBaseUrl: `${base}/v1`,
      config,
      sourceInstalled,
      accounts,
      message: "CLIProxyAPI is running",
    };
  } catch (error) {
    return {
      running: false,
      proxyBaseUrl: `${base}/v1`,
      config,
      sourceInstalled,
      accounts: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestCLIProxyOAuth(
  input: CLIProxyOAuthInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<CLIProxyOAuthResult> {
  const config = normalizeCLIProxyConfig(input);
  const endpoint = oauthEndpoint(input.provider);
  const response = await managementFetch(config, endpoint, fetcher);
  const payload = await response.json() as { url?: unknown; state?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(readText(payload.error) ?? `OAuth start failed: HTTP ${response.status}`);
  }
  const url = readText(payload.url);
  const state = readText(payload.state);
  if (!url || !state) throw new Error("OAuth response missing url or state");
  return { url, state };
}

export async function getCLIProxyOAuthStatus(
  input: CLIProxyOAuthStatusInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<CLIProxyOAuthStatusResult> {
  const config = normalizeCLIProxyConfig(input);
  const state = readText(input.state);
  if (!state) throw new Error("OAuth state is required");
  const response = await managementFetch(config, `/get-auth-status?state=${encodeURIComponent(state)}`, fetcher);
  const payload = await response.json() as { status?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(readText(payload.error) ?? `OAuth status failed: HTTP ${response.status}`);
  }
  const status = readText(payload.status);
  if (status === "ok" || status === "wait") return { status };
  return { status: "error", error: readText(payload.error) ?? "OAuth failed" };
}

export async function saveCLIProxyOpenAICompatibility(
  input: CLIProxyOpenAICompatibilityInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ ok: boolean }> {
  const config = normalizeCLIProxyConfig(input);
  const name = readText(input.name) ?? "custom";
  const baseUrl = readText(input.baseUrl);
  const apiKey = readText(input.apiKey);
  const model = readText(input.model);
  const alias = readText(input.alias);
  if (!baseUrl || !apiKey) throw new Error("baseUrl and apiKey are required");

  const body = [{
    name,
    "base-url": baseUrl,
    "api-key-entries": [{ "api-key": apiKey }],
    models: model ? [{ name: model, alias: alias ?? model }] : [],
  }];
  const response = await managementFetch(config, "/openai-compatibility", fetcher, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`openai compatibility save failed: HTTP ${response.status}`);
  return { ok: true };
}

export async function getCLIProxyCodexAccounts(
  input: CLIProxyCodexAccountsInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ accounts: CLIProxyCodexAccount[] }> {
  const config = normalizeCLIProxyConfig(input);
  const allAccounts = await fetchAccountsWithCodexCliImport(config, input.projectRoot, fetcher);
  const accounts = allAccounts
    .filter((account): account is CLIProxyCodexAccount => account.provider === "codex")
    .map((account) => ({
      ...account,
      provider: "codex" as const,
      enabled: account.disabled !== true,
    }));
  if (!input.refreshQuota) return { accounts };
  const authDir = path.join(cliproxyConfigDir(input.projectRoot), "auths");
  return {
    accounts: await Promise.all(accounts.map((account) => withCodexQuota(account, authDir, config, fetcher))),
  };
}

export async function getCLIProxyOAuthAccounts(
  input: CLIProxyCodexAccountsInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ accounts: CLIProxyOAuthAccount[] }> {
  const config = normalizeCLIProxyConfig(input);
  const accounts = (await fetchAccountsWithCodexCliImport(config, input.projectRoot, fetcher)).map((account) => ({
    ...account,
    enabled: account.disabled !== true,
  }));
  if (!input.refreshQuota) return { accounts };
  const authDir = path.join(cliproxyConfigDir(input.projectRoot), "auths");
  return {
    accounts: await Promise.all(accounts.map((account) => (
      account.provider === "codex"
        ? withCodexQuota({ ...account, provider: "codex" as const }, authDir, config, fetcher)
        : account
    ))),
  };
}

export async function setCLIProxyAccountEnabled(
  input: CLIProxyCodexAccountSelectionInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ ok: boolean }> {
  const config = normalizeCLIProxyConfig(input);
  const name = readText(input.name);
  if (!name) throw new Error("Codex account name is required");
  if (typeof input.enabled !== "boolean") throw new Error("enabled is required");
  const response = await managementFetch(config, "/auth-files/status", fetcher, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, disabled: !input.enabled }),
  });
  if (!response.ok) throw new Error(`Codex account selection failed: HTTP ${response.status}`);
  return { ok: true };
}

export const setCLIProxyCodexAccountEnabled = setCLIProxyAccountEnabled;

export async function deleteCLIProxyAccount(input: CLIProxyAccountDeleteInput): Promise<{ ok: boolean }> {
  const name = readText(input.name);
  if (!name) throw new Error("OAuth account name is required");
  const authDir = path.join(cliproxyConfigDir(input.projectRoot), "auths");
  const filePath = path.resolve(authDir, path.basename(name));
  const resolvedAuthDir = path.resolve(authDir);
  if (!filePath.startsWith(`${resolvedAuthDir}${path.sep}`)) {
    throw new Error("Invalid OAuth account name.");
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false };
  }
  fs.rmSync(filePath, { force: true });
  return { ok: true };
}

export async function getCLIProxyAuthFileModels(
  input: CLIProxyAuthFileModelsInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ models: CLIProxyModelDescriptor[] }> {
  const config = normalizeCLIProxyConfig(input);
  const name = readText(input.name);
  if (!name) throw new Error("OAuth account name is required");
  const response = await managementFetch(config, `/auth-files/models?name=${encodeURIComponent(name)}`, fetcher);
  if (!response.ok) throw new Error(`OAuth models read failed: HTTP ${response.status}`);
  const payload = await response.json() as { models?: unknown };
  if (!Array.isArray(payload.models)) {
    return { models: [] };
  }
  return {
    models: payload.models.map(readModelDescriptor).filter((model): model is CLIProxyModelDescriptor => model !== null),
  };
}

export async function syncCLIProxyCodexTokenToWorker(
  input: CLIProxyCodexWorkerSyncInput,
  fetcher: CLIProxyFetcher = fetch,
): Promise<{ ok: boolean; accountName: string }> {
  const ownerUid = readText(input.ownerUid);
  const name = readText(input.name);
  const workerUrl = readText(input.workerUrl)?.replace(/\/+$/, "");
  const remoteToken = readText(input.remoteToken);
  if (!ownerUid) throw new Error("ownerUid is required");
  if (!name) throw new Error("Codex account name is required");
  if (!workerUrl) throw new Error("Cloudflare Worker URL is required");
  if (!remoteToken) throw new Error("Cloudflare Remote Token is required");

  const authDir = path.join(cliproxyConfigDir(input.projectRoot), "auths");
  const tokenFile = readCodexTokenFile(authDir, name);
  const response = await fetcher(`${workerUrl}/mobile/codex-quota/sync-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${remoteToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ownerUid,
      account: {
        name,
        email: readText(tokenFile.email),
        planType: readCodexPlanType(tokenFile),
        accessToken: readText(tokenFile.access_token),
        refreshToken: readText(tokenFile.refresh_token),
        accountId: readText(tokenFile.account_id),
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: unknown; error?: unknown };
  if (!response.ok || payload.ok === false) {
    throw new Error(readText(payload.error) ?? `Worker token sync failed: HTTP ${response.status}`);
  }
  return { ok: true, accountName: name };
}

async function fetchAccounts(config: CLIProxyConfig, fetcher: CLIProxyFetcher): Promise<CLIProxyAccount[]> {
  const response = await managementFetch(config, "/auth-files", fetcher);
  if (!response.ok) return [];
  const payload = await response.json() as { files?: unknown };
  if (!Array.isArray(payload.files)) return [];
  return payload.files.map(readAccount).filter((account): account is CLIProxyAccount => account !== null);
}

async function fetchAccountsWithCodexCliImport(
  config: CLIProxyConfig,
  projectRoot: string,
  fetcher: CLIProxyFetcher,
): Promise<CLIProxyAccount[]> {
  const accounts = await fetchAccounts(config, fetcher);
  if (accounts.some((account) => account.provider === "codex")) {
    return accounts;
  }
  const imported = await importCodexCliAuth(config, projectRoot, fetcher).catch(() => false);
  if (!imported) {
    return accounts;
  }
  return fetchAccounts(config, fetcher);
}

// fallow-ignore-next-line complexity
async function importCodexCliAuth(
  config: CLIProxyConfig,
  projectRoot: string,
  fetcher: CLIProxyFetcher,
): Promise<boolean> {
  const authPath = path.join(codexHomeDir(), "auth.json");
  if (!fs.existsSync(authPath)) {
    return false;
  }
  const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as unknown;
  const record = readRecord(raw);
  if (readText(record.auth_mode) !== "chatgpt") {
    return false;
  }
  const tokens = readRecord(record.tokens);
  const idToken = readText(tokens.id_token);
  const accessToken = readText(tokens.access_token);
  const refreshToken = readText(tokens.refresh_token);
  const accountId = readText(tokens.account_id);
  if (!idToken || !accessToken || !refreshToken || !accountId) {
    return false;
  }

  const claims = readJwtPayload(idToken);
  const openaiClaims = readRecord(claims["https://api.openai.com/auth"]);
  const email = readText(claims.email) ?? "chatgpt";
  const planType = readText(openaiClaims.chatgpt_plan_type) ?? "chatgpt";
  const fileName = `codex-${authFileNamePart(email)}-${authFileNamePart(planType)}.json`;
  const importedRecord = {
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken,
    account_id: accountId,
    last_refresh: readText(record.last_refresh) ?? new Date().toISOString(),
    email,
    type: "codex",
    disabled: false,
  };

  const response = await managementFetch(config, `/auth-files?name=${encodeURIComponent(fileName)}`, fetcher, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(importedRecord, null, 2)}\n`,
  });
  if (!response.ok) {
    return false;
  }

  const authDir = path.join(cliproxyConfigDir(projectRoot), "auths");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, fileName), `${JSON.stringify(importedRecord, null, 2)}\n`, "utf8");
  return true;
}

// fallow-ignore-next-line complexity
function readAccount(value: unknown): CLIProxyAccount | null {
  if (!isRecord(value)) return null;
  const name = readText(value.name);
  const provider = (readText(value.provider) ?? readText(value.type))?.toLowerCase();
  if (!name || !provider) return null;
  const account: CLIProxyAccount = { name, provider };
  const authIndex = readText(value.auth_index);
  const email = readText(value.email);
  const status = readText(value.status);
  const statusMessage = readText(value.status_message);
  const disabled = typeof value.disabled === "boolean" ? value.disabled : undefined;
  const idToken = isRecord(value.id_token) ? value.id_token : {};
  const planType = readText(idToken.plan_type) ?? readText(value.plan_type) ?? readText(value.account_type);
  if (authIndex) account.authIndex = authIndex;
  if (email) account.email = email;
  if (status) account.status = status;
  if (statusMessage) account.statusMessage = statusMessage;
  if (typeof disabled === "boolean") account.disabled = disabled;
  if (planType) account.planType = planType;
  return account;
}

function readModelDescriptor(value: unknown): CLIProxyModelDescriptor | null {
  if (!isRecord(value)) return null;
  const id = readText(value.id);
  if (!id) return null;
  const model: CLIProxyModelDescriptor = { id };
  const displayName = readText(value.display_name);
  const type = readText(value.type);
  const ownedBy = readText(value.owned_by);
  if (displayName) model.displayName = displayName;
  if (type) model.type = type;
  if (ownedBy) model.ownedBy = ownedBy;
  return model;
}

async function withCodexQuota(
  account: CLIProxyCodexAccount,
  authDir: string,
  config: CLIProxyConfig,
  fetcher: CLIProxyFetcher,
): Promise<CLIProxyCodexAccount> {
  try {
    const tokenFile = readCodexTokenFile(authDir, account.name);
    const quota = await fetchCodexQuota(tokenFile, config, fetcher);
    return { ...account, quota };
  } catch (error) {
    return {
      ...account,
      quota: {
        fetchedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function readCodexTokenFile(authDir: string, name: string): Record<string, unknown> {
  if (path.basename(name) !== name) throw new Error("Unsafe auth file name");
  const filePath = path.join(authDir, name);
  const record = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(record)) throw new Error("Invalid Codex auth file");
  if ((readText(record.type) ?? "").toLowerCase() !== "codex") throw new Error("Auth file is not Codex");
  return record;
}

async function fetchCodexQuota(
  tokenFile: Record<string, unknown>,
  config: CLIProxyConfig,
  fetcher: CLIProxyFetcher,
): Promise<CLIProxyCodexQuota> {
  const accessToken = readText(tokenFile.access_token);
  if (!accessToken) throw new Error("Codex access token missing");
  const accountId = readText(tokenFile.account_id);
  const response = await codexFetch(CODEX_USAGE_URL, config, fetcher, codexUsageInit(accessToken, accountId));
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(readQuotaError(payload) ?? `Codex quota HTTP ${response.status}`);
  return readCodexQuota(payload);
}

function codexUsageInit(accessToken: string, accountId: string | null): RequestInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return { headers };
}

async function codexFetch(
  url: string,
  config: CLIProxyConfig,
  fetcher: CLIProxyFetcher,
  init: RequestInit,
): Promise<Response> {
  const requestInit: CLIProxyFetchInit = { ...init };
  if (config.proxyUrl) requestInit.dispatcher = new ProxyAgent(config.proxyUrl);
  return fetcher(url, requestInit);
}

function readCodexQuota(payload: unknown): CLIProxyCodexQuota {
  const record = isRecord(payload) ? payload : {};
  const rateLimit = isRecord(record.rate_limit) ? record.rate_limit : record;
  return {
    fetchedAt: new Date().toISOString(),
    primaryWindow: readQuotaWindow(rateLimit.primary_window),
    secondaryWindow: readQuotaWindow(rateLimit.secondary_window),
  };
}

function readQuotaWindow(value: unknown): CLIProxyCodexQuotaWindow | undefined {
  if (!isRecord(value)) return undefined;
  return {
    usedPercent: readNumber(value.used_percent),
    resetsAt: readResetTime(value),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Codex quota returned ${contentType || "non-json"} response`);
  }
  return JSON.parse(text) as unknown;
}

function readResetTime(value: Record<string, unknown>): string | null {
  const direct = readText(value.resets_at);
  if (direct) return direct;
  const resetAt = readNumber(value.reset_at);
  if (resetAt !== null) return new Date(resetAt * 1000).toISOString();
  const resetAfter = readNumber(value.reset_after_seconds);
  if (resetAfter !== null) return new Date(Date.now() + resetAfter * 1000).toISOString();
  return null;
}

function readQuotaError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return readText(payload.error)
    ?? readText(readRecord(payload.error).message)
    ?? readText(payload.message);
}

function readCodexPlanType(tokenFile: Record<string, unknown>): string | null {
  const direct = readText(tokenFile.plan_type);
  if (direct) return direct;
  const idToken = readText(tokenFile.id_token);
  if (!idToken) return null;
  const claims = readJwtPayload(idToken);
  return readText(readRecord(claims["https://api.openai.com/auth"]).chatgpt_plan_type);
}

async function managementFetch(
  config: CLIProxyConfig,
  endpoint: string,
  fetcher: CLIProxyFetcher,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.managementKey}` };
  if (isRecord(init.headers)) {
    for (const [key, value] of Object.entries(init.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  return fetcher(`${baseURL(config.port)}/v0/management${endpoint}`, { ...init, headers });
}

function writeCLIProxyConfig(projectRoot: string, built: CLIProxyBuiltConfig): void {
  fs.mkdirSync(built.configDir, { recursive: true });
  fs.mkdirSync(built.authDir, { recursive: true });
  fs.writeFileSync(built.configPath, built.yaml, "utf8");
  fs.writeFileSync(
    path.join(built.configDir, "wiki-cliproxy.json"),
    `${JSON.stringify(serializeCLIProxyConfig(built), null, 2)}\n`,
    "utf8",
  );
}

function oauthEndpoint(provider: CLIProxyOAuthProvider): string {
  switch (provider) {
    case "anthropic":
      return "/anthropic-auth-url?is_webui=1";
    case "codex":
      return "/codex-auth-url?is_webui=1";
    case "gemini-cli":
      return "/gemini-cli-auth-url?is_webui=1";
    case "antigravity":
      return "/antigravity-auth-url?is_webui=1";
    case "kimi":
      return "/kimi-auth-url?is_webui=1";
  }
}

function runCommand(command: string, args: readonly string[], options?: CLIProxyCommandOptions): Promise<CLIProxyCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited ${code ?? "unknown"}`));
    });
  });
}

function baseURL(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value.replace(/\\/g, "/"));
}

function codexHomeDir(): string {
  const configured = readText(process.env.CODEX_HOME);
  return configured ?? path.join(os.homedir(), ".codex");
}

function readJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
    return readRecord(parsed);
  } catch {
    return {};
  }
}

function authFileNamePart(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9@.+-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "chatgpt";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
