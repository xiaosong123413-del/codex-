/**
 * Cloudflare Workers AI helpers for LLM settings.
 *
 * Keeps Cloudflare account-ref resolution and connectivity testing out of the
 * generic LLM config service so the common account path stays small.
 */

import { CloudflareProvider } from "../../../src/providers/cloudflare.js";
import {
  readCloudflareServicesConfig,
  type CloudflareServicesConfig,
} from "../../../src/utils/cloudflare-services-config.js";
import { defaultModelForProvider } from "./llm-provider-defaults.js";

interface ResolvedCloudflareLlmAccount {
  accountRef: string;
  provider: "cloudflare";
  url: string;
  key: string;
  model: string;
}

interface CloudflareLlmTestResult {
  ok: boolean;
  provider: "cloudflare";
  endpoint: string;
  message: string;
}

/** Resolves the synthetic Cloudflare provider card account into runtime config. */
export function resolveCloudflareLlmAccountRef(
  accountRef: string,
  env: NodeJS.ProcessEnv,
  fallbackModel: string | null,
): ResolvedCloudflareLlmAccount {
  const config = readCloudflareServicesConfig(env);
  return {
    accountRef,
    provider: "cloudflare",
    url: cloudflareEndpointLabel(config),
    key: readCloudflareProviderKey(env) ?? "",
    model: config.aiModel ?? fallbackModel ?? defaultModelForProvider("cloudflare"),
  };
}

/** Returns the redacted endpoint label used by LLM settings responses. */
export function readCloudflareProviderUrl(env: NodeJS.ProcessEnv): string {
  return cloudflareEndpointLabel(readCloudflareServicesConfig(env));
}

/** Returns only whether a Cloudflare credential exists; callers must redact it. */
export function readCloudflareProviderKey(env: NodeJS.ProcessEnv): string | null {
  const config = readCloudflareServicesConfig(env);
  return config.remoteToken ?? config.apiToken;
}

/** Runs a real Cloudflare Workers AI text request for settings connectivity checks. */
export async function testCloudflareLlmProvider(
  model: string,
  endpoint: string,
): Promise<CloudflareLlmTestResult> {
  try {
    const text = await new CloudflareProvider(model).complete(
      "Return a short connectivity confirmation.",
      [{ role: "user", content: "ping" }],
      16,
    );
    return cloudflareTestSuccess(text, endpoint);
  } catch (error) {
    return {
      ok: false,
      provider: "cloudflare",
      endpoint,
      message: `验证失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function cloudflareEndpointLabel(config: CloudflareServicesConfig): string {
  if (config.workerUrl) return `${config.workerUrl.replace(/\/+$/, "")}/llm`;
  if (config.accountId) return `Cloudflare Workers AI REST · ${config.accountId}`;
  return "Cloudflare Workers AI";
}

function cloudflareTestSuccess(text: string, endpoint: string): CloudflareLlmTestResult {
  const hasText = text.trim().length > 0;
  return {
    ok: hasText,
    provider: "cloudflare",
    endpoint,
    message: hasText
      ? "验证成功，Cloudflare Workers AI 可以连通。"
      : "验证失败：Cloudflare Workers AI 没有返回文本。",
  };
}
