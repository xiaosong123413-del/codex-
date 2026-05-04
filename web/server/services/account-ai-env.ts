/**
 * Shared account AI sync environment helpers.
 *
 * The desktop server receives the logged-in account session from Electron and
 * uses these helpers to address the public Worker routes without falling back
 * to the admin Remote Token.
 */

export const ACCOUNT_CODEX_OAUTH_REF = "oauth:codex:cloud-account";

export interface AccountAiSyncConfig {
  workerUrl: string;
  sessionToken: string;
}

export function readAccountAiSyncConfig(env: NodeJS.ProcessEnv = process.env): AccountAiSyncConfig | null {
  const workerUrl = readText(env.CLOUDFLARE_WORKER_URL)?.replace(/\/+$/, "");
  const sessionToken = readText(env.CLOUDFLARE_ACCOUNT_SESSION_TOKEN);
  return workerUrl && sessionToken ? { workerUrl, sessionToken } : null;
}

export function accountAiOpenAiBaseUrl(workerUrl: string): string {
  return `${workerUrl.replace(/\/+$/, "")}/user/ai`;
}

function readText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
