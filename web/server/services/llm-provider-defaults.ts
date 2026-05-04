/**
 * Shared LLM provider defaults for the WebUI settings and account services.
 *
 * Keeps provider validation, OpenAI-compatible URL normalization, and default
 * model/base URL choices in one place so the settings form and saved account
 * store cannot drift apart.
 */

const OPENAI_COMPAT_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "groq",
  "xai",
  "kimi-global",
  "kimi-cn",
  "glm",
  "nvidia",
  "bailian-cn",
  "bailian-us",
  "bailian-intl",
  "openrouter",
  "perplexity",
  "mistral",
  "morph",
  "lm-studio",
  "custom",
  "relay",
  "codex-cli",
]);

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  cloudflare: "Cloudflare Workers AI",
  gemini: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  "kimi-global": "https://api.moonshot.ai/v1",
  "kimi-cn": "https://api.moonshot.cn/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  nvidia: "https://integrate.api.nvidia.com/v1",
  "bailian-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "bailian-us": "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  "bailian-intl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  openrouter: "https://openrouter.ai/api/v1",
  perplexity: "https://api.perplexity.ai",
  mistral: "https://api.mistral.ai/v1",
  morph: "https://api.morphllm.com/v1",
  minimax: "https://api.minimax.io/anthropic",
  ollama: "http://localhost:11434/v1",
  "lm-studio": "http://localhost:1234/v1",
};

const PROVIDER_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  cloudflare: "@cf/meta/llama-3.1-8b-instruct",
  gemini: "gemini-2.5-flash",
  ollama: "llama3.1",
  minimax: "MiniMax-M2.7",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-4",
  "kimi-global": "kimi-k2-0711-preview",
  "kimi-cn": "kimi-k2-0711-preview",
  glm: "glm-4.5",
  nvidia: "meta/llama-3.3-70b-instruct",
  "bailian-cn": "qwen-plus",
  "bailian-us": "qwen-plus",
  "bailian-intl": "qwen-plus",
  openrouter: "openai/gpt-4o",
  perplexity: "sonar",
  mistral: "mistral-large-latest",
  morph: "morph-v3-large",
  "codex-cli": "gpt-5-codex",
  "lm-studio": "local-model",
};

export function isSupportedLlmProvider(provider: string): boolean {
  return (
    provider === "anthropic"
    || provider === "cloudflare"
    || provider === "gemini"
    || provider === "minimax"
    || provider === "ollama"
    || OPENAI_COMPAT_PROVIDERS.has(provider)
  );
}

export function usesOpenAICompatibleUrl(provider: string): boolean {
  return provider !== "anthropic" && provider !== "cloudflare" && provider !== "gemini" && provider !== "ollama";
}

export function normalizeOpenAICompatibleBaseUrl(url: string, provider: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    parsed.pathname = path.replace(/\/chat\/completions$/, "");
    return parsed.toString().replace(/\/$/, "");
  }
  if (!path || path === "/") {
    parsed.pathname = defaultOpenAICompatiblePath(provider);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function defaultBaseUrlForProvider(provider: string): string {
  return PROVIDER_BASE_URLS[provider] ?? "https://api.openai.com/v1";
}

export function defaultModelForProvider(provider: string): string {
  return PROVIDER_MODELS[provider] ?? "gpt-4o";
}

function defaultOpenAICompatiblePath(provider: string): string {
  if (provider === "groq") return "/openai/v1";
  if (provider === "glm") return "/api/paas/v4";
  if (provider === "openrouter") return "/api/v1";
  if (provider === "perplexity") return "";
  if (provider === "bailian-cn" || provider === "bailian-us" || provider === "bailian-intl") {
    return "/compatible-mode/v1";
  }
  return "/v1";
}
