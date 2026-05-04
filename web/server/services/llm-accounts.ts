import fs from "node:fs";
import path from "node:path";
import {
  defaultBaseUrlForProvider,
  defaultModelForProvider,
  isSupportedLlmProvider,
  normalizeOpenAICompatibleBaseUrl,
  usesOpenAICompatibleUrl,
} from "./llm-provider-defaults.js";

const LLM_ACCOUNTS_PATH = path.join(".llmwiki", "llm-accounts.json");

const PROVIDER_BY_HOST: Readonly<Record<string, string>> = {
  "integrate.api.nvidia.com": "nvidia",
  "dashscope.aliyuncs.com": "bailian-cn",
  "dashscope-us.aliyuncs.com": "bailian-us",
  "dashscope-intl.aliyuncs.com": "bailian-intl",
  "openrouter.ai": "openrouter",
  "api.perplexity.ai": "perplexity",
  "api.mistral.ai": "mistral",
  "api.morphllm.com": "morph",
  "api.minimax.io": "minimax",
  "api.minimaxi.com": "minimax",
  "api.whatai.cc": "relay",
  "localhost:1234": "lm-studio",
  "127.0.0.1:1234": "lm-studio",
};

export interface LlmApiAccount {
  id: string;
  name: string;
  provider: string;
  url: string;
  key: string;
  model: string;
  enabled: boolean;
  updatedAt: string;
}

interface LlmApiAccountSummary {
  id: string;
  name: string;
  provider: string;
  url: string;
  keyConfigured: boolean;
  model: string;
  enabled: boolean;
  updatedAt: string;
}

interface LlmApiAccountsStore {
  accounts: LlmApiAccountSummary[];
}

interface LlmApiAccountInput {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  url?: unknown;
  key?: unknown;
  model?: unknown;
  enabled?: unknown;
}

export function readLlmApiAccounts(projectRoot: string): LlmApiAccountsStore {
  const accounts = readAccountsFile(projectRoot).accounts.map(toSummary);
  return { accounts };
}

export function readLlmApiAccountsForSync(projectRoot: string): { accounts: LlmApiAccount[] } {
  return readAccountsFile(projectRoot);
}

export function readLlmApiAccount(projectRoot: string, idOrProvider: string): LlmApiAccount | null {
  const normalized = normalizeText(idOrProvider)?.toLowerCase();
  if (!normalized) return null;
  const store = readAccountsFile(projectRoot);
  return store.accounts.find((account) => account.id === normalized || account.provider === normalized) ?? null;
}

export function saveLlmApiAccount(projectRoot: string, input: LlmApiAccountInput): LlmApiAccountSummary {
  const store = readAccountsFile(projectRoot);
  const normalized = normalizeAccountInput(input, store.accounts);
  const index = store.accounts.findIndex((account) => account.id === normalized.id);
  if (index >= 0) {
    store.accounts[index] = normalized;
  } else {
    store.accounts.push(normalized);
  }
  writeAccountsFile(projectRoot, store);
  return toSummary(normalized);
}

export function mergeLlmApiAccountsFromSync(
  projectRoot: string,
  incomingAccounts: readonly unknown[],
): LlmApiAccountsStore {
  const store = readAccountsFile(projectRoot);
  const byId = new Map(store.accounts.map((account) => [account.id, account]));
  let changed = false;
  for (const item of incomingAccounts) {
    const incoming = normalizeStoredAccount(item);
    if (!incoming) continue;
    const current = byId.get(incoming.id);
    if (!current || shouldReplaceAccount(current, incoming)) {
      byId.set(incoming.id, incoming);
      changed = true;
    }
  }
  if (changed) writeAccountsFile(projectRoot, { accounts: [...byId.values()] });
  return readLlmApiAccounts(projectRoot);
}

export function deleteLlmApiAccount(projectRoot: string, input: { id?: unknown; provider?: unknown; name?: unknown }): { ok: boolean } {
  const id = normalizeText(input.id)?.toLowerCase();
  const provider = normalizeSavedProvider(input.provider);
  const name = normalizeText(input.name)?.toLowerCase();
  const store = readAccountsFile(projectRoot);
  const nextAccounts = store.accounts.filter((account) => {
    if (id) return account.id !== id;
    if (provider && name) return !(account.provider === provider && account.name.toLowerCase() === name);
    return true;
  });
  const changed = nextAccounts.length !== store.accounts.length;
  if (changed) {
    writeAccountsFile(projectRoot, { accounts: nextAccounts });
  }
  return { ok: changed };
}

export function startLlmApiAccount(projectRoot: string, input: { id?: unknown }): LlmApiAccountSummary {
  const id = normalizeText(input.id)?.toLowerCase();
  if (!id) {
    throw new Error("LLM account id is required.");
  }
  const store = readAccountsFile(projectRoot);
  const index = store.accounts.findIndex((account) => account.id === id);
  if (index < 0) {
    throw new Error("LLM account not found.");
  }
  const account = { ...store.accounts[index]!, enabled: true, updatedAt: new Date().toISOString() };
  store.accounts[index] = account;
  writeAccountsFile(projectRoot, store);
  return toSummary(account);
}

function readAccountsFile(projectRoot: string): { accounts: LlmApiAccount[] } {
  const filePath = getAccountsFilePath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return { accounts: [] };
  }
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw) as { accounts?: unknown };
  return {
    accounts: Array.isArray(parsed.accounts)
      ? parsed.accounts.map((account) => normalizeStoredAccount(account)).filter((account): account is LlmApiAccount => account !== null)
      : [],
  };
}

function writeAccountsFile(projectRoot: string, store: { accounts: LlmApiAccount[] }): void {
  const filePath = getAccountsFilePath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getAccountsFilePath(projectRoot: string): string {
  return path.join(projectRoot, LLM_ACCOUNTS_PATH);
}

function normalizeStoredAccount(input: unknown): LlmApiAccount | null {
  if (!isRecord(input)) return null;
  const provider = normalizeSavedProvider(input.provider);
  const name = normalizeText(input.name);
  if (!provider || !name) return null;
  const url = normalizeAccountUrl(provider, input.url) ?? defaultBaseUrlForProvider(provider);
  return {
    id: normalizeText(input.id)?.toLowerCase() ?? buildAccountId(provider, name),
    name,
    provider,
    url,
    key: normalizeText(input.key) ?? "",
    model: normalizeText(input.model) ?? defaultModelForProvider(provider),
    enabled: input.enabled !== false,
    updatedAt: normalizeText(input.updatedAt) ?? new Date().toISOString(),
  };
}

// fallow-ignore-next-line complexity
function normalizeAccountInput(input: LlmApiAccountInput, existing: readonly LlmApiAccount[]): LlmApiAccount {
  const provider = normalizeProviderInput(input);
  if (!provider) {
    throw new Error("LLM provider is required.");
  }
  const name = normalizeText(input.name) ?? provider;
  const id = normalizeText(input.id)?.toLowerCase() ?? buildAccountId(provider, name);
  const previous = existing.find((account) => account.id === id);
  const url = normalizeAccountUrl(provider, input.url) ?? previous?.url ?? defaultBaseUrlForProvider(provider);
  const key = normalizeText(input.key) ?? previous?.key ?? "";
  const model = normalizeText(input.model) ?? previous?.model ?? defaultModelForProvider(provider);
  return {
    id,
    name,
    provider,
    url,
    key,
    model,
    enabled: input.enabled !== false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProviderInput(input: LlmApiAccountInput): string | null {
  const provider = normalizeSavedProvider(input.provider);
  if (provider !== "openai" && provider !== "custom") {
    return provider;
  }
  return providerFromBaseUrl(input.url) ?? provider;
}

function buildAccountId(provider: string, name: string): string {
  return `${provider}:${name}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
}

function toSummary(account: LlmApiAccount): LlmApiAccountSummary {
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    url: account.url,
    keyConfigured: Boolean(account.key),
    model: account.model,
    enabled: account.enabled,
    updatedAt: account.updatedAt,
  };
}

function shouldReplaceAccount(current: LlmApiAccount, incoming: LlmApiAccount): boolean {
  const currentTime = Date.parse(current.updatedAt) || 0;
  const incomingTime = Date.parse(incoming.updatedAt) || 0;
  return incomingTime >= currentTime && JSON.stringify(current) !== JSON.stringify(incoming);
}

function normalizeSavedProvider(value: unknown): string | null {
  const provider = normalizeText(value);
  if (!provider) return null;
  if (!isSupportedLlmProvider(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  return provider;
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    new URL(withProtocol);
    return withProtocol;
  } catch {
    throw new Error("LLM API 地址必须是完整 URL。");
  }
}

// fallow-ignore-next-line complexity
function providerFromBaseUrl(value: unknown): string | null {
  const url = normalizeUrl(value);
  if (!url) return null;
  const host = new URL(url).host.toLowerCase();
  return PROVIDER_BY_HOST[host] ?? null;
}

function normalizeAccountUrl(provider: string, value: unknown): string | null {
  const url = normalizeUrl(value);
  if (!url) return null;
  if (!usesOpenAICompatibleUrl(provider)) {
    return url;
  }
  return normalizeOpenAICompatibleBaseUrl(url, provider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
