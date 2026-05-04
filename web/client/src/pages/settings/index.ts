import { attachResizeHandle } from "../../shell/resize-handle.js";
import { renderIcon } from "../../components/icon.js";
import { hydrateAppPublishSection, renderAppPublishSection } from "../publish/index.js";
import {
  fetchCLIProxyAccountModels,
  fetchCLIProxyOAuthAccounts,
  formatCLIProxyProvider,
  type CLIProxyOAuthAccountResponse,
} from "./cli-proxy.js";
import { readSettingsJsonPayload } from "./json.js";
import {
  bindNetworkSearchPanel,
  renderNetworkSearchProviderCard,
  renderVectorSearchProviderCard,
} from "./network-search.js";
import {
  bindPluginsPanel,
  renderPluginsPanel,
  renderPluginSidebarGroups,
  selectPluginPanelTarget,
  type PluginPanelTarget,
} from "./plugin-panel.js";
import {
  disposeSettingsAutomationPanel,
  mountSettingsAutomationPanel,
  renderSettingsAutomationPanel,
  type SettingsAutomationPanelState,
} from "./automation-workspace-panel.js";
import {
  disposeSettingsProjectLogPanel,
  mountSettingsProjectLogPanel,
  renderSettingsProjectLogPanel,
} from "./project-log-panel.js";
import {
  disposeSettingsUserGuidePanel,
  mountSettingsUserGuidePanel,
  renderSettingsUserGuidePanel,
} from "./user-guide-panel.js";
import {
  bindRssImportPanel,
  renderRssImportPanel,
} from "./rss-import-panel.js";
import {
  bindFlashNoteImportPanel,
  renderFlashNoteImportPanel,
} from "./flash-note-import-panel.js";
import {
  DEFAULT_SHORTCUTS,
  acceleratorFromKeyboardEvent,
  setClientKeyboardShortcuts,
  type AppShortcuts,
  type ShortcutId,
} from "../../keyboard-shortcuts.js";
import {
  buildLlmDefaultAccountOptions,
  buildXiaohongshuImportDirState,
  buildXiaohongshuImportState,
  buildDouyinCookieSnapshot,
  buildXiaohongshuProgressSnapshot,
  describeLlmAccountRowView,
  describeLlmProviderStatus,
  describeLlmDefaultSelection,
  describeXhsSyncStatus,
  resolveRenderedLlmDefaultOptions,
} from "./state-helpers.js";

const SETTINGS_SIDEBAR_WIDTH_KEY = "llm-wiki-settings-sidebar-width";
interface ShortcutDefinition {
  readonly id: ShortcutId;
  readonly title: string;
  readonly description: string;
}

const SETTINGS_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "flashDiaryCapture",
    title: "闪念日记快速记录",
    description: "打开独立小窗口。",
  },
  {
    id: "pageTextSearch",
    title: "页面内查找",
    description: "在当前页面内容中查找文本。",
  },
  {
    id: "workflowRecorder",
    title: "执行记录器",
    description: "打开任务池的快捷记录窗口。",
  },
  {
    id: "workspaceSave",
    title: "工作台保存",
    description: "保存当前正在编辑的工作台文档。",
  },
];
const LLM_PROVIDER_API_TYPE_OPTIONS = [
  "OpenAI Compatible",
  "OpenAI Responses",
  "Anthropic API",
  "Gemini API",
] as const;
const LLM_PROVIDER_TRANSPORT_OPTIONS = [
  "自动（推荐）",
  "仅浏览器 fetch",
  "仅 Obsidian requestUrl",
  "仅桌面端 Node fetch",
] as const;
const LLM_PROVIDER_LABELS_STORAGE_KEY = "llm-wiki-provider-display-labels";
const LLM_PROVIDER_OAUTH_POLL_ATTEMPTS = 150;
const LLM_PROVIDER_OAUTH_POLL_DELAY_MS = 2000;
const LLM_PROVIDER_OAUTH_MIN_POLL_DELAY_MS = 1000;

interface LlmProviderPreset {
  label: string;
  hint: string;
  provider: string;
  baseUrl: string;
  apiType: (typeof LLM_PROVIDER_API_TYPE_OPTIONS)[number];
  defaultModel: string;
  suggestedModels: readonly string[];
}

const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  { label: "Anthropic (Claude)", hint: "Official Claude API", provider: "anthropic", baseUrl: "https://api.anthropic.com", apiType: "Anthropic API", defaultModel: "claude-sonnet-4-20250514", suggestedModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest"] },
  { label: "OpenAI (GPT)", hint: "Official OpenAI API", provider: "openai", baseUrl: "https://api.openai.com/v1", apiType: "OpenAI Compatible", defaultModel: "gpt-4o", suggestedModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"] },
  { label: "Google (Gemini)", hint: "Generative Language API", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", apiType: "Gemini API", defaultModel: "gemini-2.5-flash", suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
  { label: "DeepSeek", hint: "api.deepseek.com", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiType: "OpenAI Compatible", defaultModel: "deepseek-chat", suggestedModels: ["deepseek-chat", "deepseek-reasoner"] },
  { label: "Groq", hint: "api.groq.com", provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiType: "OpenAI Compatible", defaultModel: "llama-3.3-70b-versatile", suggestedModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"] },
  { label: "xAI (Grok)", hint: "api.x.ai", provider: "xai", baseUrl: "https://api.x.ai/v1", apiType: "OpenAI Compatible", defaultModel: "grok-4", suggestedModels: ["grok-4", "grok-3", "grok-code-fast-1"] },
  { label: "NVIDIA NIM", hint: "integrate.api.nvidia.com", provider: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1", apiType: "OpenAI Compatible", defaultModel: "meta/llama-3.3-70b-instruct", suggestedModels: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "deepseek-ai/deepseek-v3.2", "minimaxai/minimax-m2.7", "openai/gpt-oss-120b"] },
  { label: "Kimi (Moonshot)", hint: "api.moonshot.ai", provider: "kimi-global", baseUrl: "https://api.moonshot.ai/v1", apiType: "OpenAI Compatible", defaultModel: "kimi-k2.6", suggestedModels: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking", "kimi-for-coding"] },
  { label: "Kimi (Moonshot, 中国)", hint: "api.moonshot.cn", provider: "kimi-cn", baseUrl: "https://api.moonshot.cn/v1", apiType: "OpenAI Compatible", defaultModel: "kimi-k2.6", suggestedModels: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking", "kimi-for-coding"] },
  { label: "智谱 GLM (Zhipu)", hint: "open.bigmodel.cn", provider: "glm", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiType: "OpenAI Compatible", defaultModel: "glm-4.6", suggestedModels: ["glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4-flash"] },
  { label: "MiniMax (Global)", hint: "api.minimax.io/anthropic", provider: "minimax", baseUrl: "https://api.minimax.io/anthropic", apiType: "Anthropic API", defaultModel: "MiniMax-M2.7", suggestedModels: ["MiniMax-M2.7", "MiniMax-M2.5"] },
  { label: "MiniMax (中国)", hint: "api.minimaxi.com/anthropic", provider: "minimax", baseUrl: "https://api.minimaxi.com/anthropic", apiType: "Anthropic API", defaultModel: "MiniMax-M2.7", suggestedModels: ["MiniMax-M2.7", "MiniMax-M2.5"] },
  { label: "阿里百炼 Coding Plan", hint: "coding.dashscope.aliyuncs.com", provider: "custom", baseUrl: "https://coding.dashscope.aliyuncs.com/v1", apiType: "OpenAI Compatible", defaultModel: "qwen3.6-plus", suggestedModels: ["qwen3.6-plus", "qwen3-coder-plus", "MiniMax-M2.5", "kimi-k2.5"] },
  { label: "小米 MiMo (Xiaomi)", hint: "api.xiaomimimo.com", provider: "custom", baseUrl: "https://api.xiaomimimo.com/v1", apiType: "OpenAI Compatible", defaultModel: "mimo-v2-pro", suggestedModels: ["mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"] },
  { label: "火山引擎 Ark (Volcengine)", hint: "ark.cn-beijing.volces.com/api/coding/v3", provider: "custom", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", apiType: "OpenAI Compatible", defaultModel: "Doubao-Seed-2.0-Code", suggestedModels: ["Doubao-Seed-2.0-Code", "Doubao-Seed-2.0-pro", "DeepSeek-V3"] },
  { label: "小马 / 神马中转", hint: "api.whatai.cc", provider: "relay", baseUrl: "https://api.whatai.cc/v1", apiType: "OpenAI Compatible", defaultModel: "gpt-4o", suggestedModels: ["gpt-4o", "gpt-4.1", "claude-sonnet-4-20250514", "gemini-2.5-pro"] },
  { label: "Ollama (Local)", hint: "localhost:11434", provider: "ollama", baseUrl: "http://localhost:11434/v1", apiType: "OpenAI Compatible", defaultModel: "llama3.1", suggestedModels: ["llama3.1", "qwen2.5", "deepseek-r1:latest"] },
  { label: "Ollama Cloud", hint: "ollama.com", provider: "custom", baseUrl: "https://ollama.com/v1", apiType: "OpenAI Compatible", defaultModel: "gpt-oss:120b", suggestedModels: ["gpt-oss:120b", "gpt-oss:20b", "qwen3-coder:480b"] },
  { label: "OpenRouter", hint: "openrouter.ai", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiType: "OpenAI Compatible", defaultModel: "openai/gpt-4o", suggestedModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro"] },
  { label: "Custom", hint: "Any OpenAI-compatible endpoint", provider: "custom", baseUrl: "", apiType: "OpenAI Compatible", defaultModel: "gpt-4o", suggestedModels: ["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro"] },
  { label: "ChatGPT OAuth", hint: "Browser OAuth", provider: "codex-cli", baseUrl: "", apiType: "OpenAI Compatible", defaultModel: "gpt-5-codex", suggestedModels: ["gpt-5-codex"] },
  { label: "Gemini OAuth", hint: "Gemini CLI OAuth", provider: "gemini", baseUrl: "", apiType: "Gemini API", defaultModel: "gemini-2.5-pro", suggestedModels: ["gemini-2.5-pro"] },
];
const LLM_PROVIDER_PRESET_OPTIONS = LLM_PROVIDER_PRESETS.map((preset) => preset.label);
const LLM_PROVIDER_PRESET_BY_LABEL: Readonly<Record<string, LlmProviderPreset>> = Object.fromEntries(
  LLM_PROVIDER_PRESETS.map((preset) => [preset.label, preset]),
);

interface LlmProviderConfigResponse {
  accountRef?: string;
  provider: string;
  url: string;
  keyConfigured: boolean;
  model: string;
}

interface LlmApiAccountResponse {
  id: string;
  name: string;
  provider: string;
  url: string;
  keyConfigured: boolean;
  model: string;
  enabled: boolean;
  updatedAt: string;
}

interface LlmApiAccountsResponse {
  accounts: LlmApiAccountResponse[];
}

interface LlmProviderTestResponse {
  ok: boolean;
  provider: string;
  endpoint: string;
  message: string;
}

interface LlmProviderDraftInput {
  id?: string;
  name: string;
  provider: string;
  url: string;
  key: string;
  model: string;
  enabled: boolean;
}

interface LlmProviderOAuthStatusResponse {
  status: "ok" | "wait" | "error";
  error?: string;
}

interface LlmProviderOAuthStartResponse {
  url: string;
  state: string;
  userCode?: string;
  pollIntervalSeconds?: number;
}

interface LlmProviderOAuthFlow {
  state: string;
  pollDelayMs: number;
}

interface LlmProviderOAuthAccountResponse extends CLIProxyOAuthAccountResponse {
  accountRef?: string;
  connectionText?: string;
}

interface LlmProviderCardView {
  accountRef: string;
  accountName: string;
  displayId: string;
  provider: string;
  source: "api" | "oauth" | "cloudflare";
  enabled: boolean;
  title: string;
  connectionText: string;
  description: string;
  model: string;
  apps: readonly AppDefinitionResponse[];
  embeddingModels: readonly string[];
  canManage: boolean;
}

interface LlmCloudflareProviderResponse {
  accountRef: "cloudflare:workers-ai";
  configured: boolean;
  runtime: "worker" | "workers-ai-rest" | "unconfigured";
  endpoint: string | null;
  aiModel: string | null;
  embeddingModels: string[];
}

interface AppConfigResponse {
  apps: AppDefinitionResponse[];
  defaultAppId: string | null;
  path?: string;
}

interface AppDefinitionResponse {
  id: string;
  name: string;
  mode: "chat" | "workflow" | "knowledge" | "hybrid";
  purpose: string;
  provider: string;
  accountRef: string;
  model: string;
  workflow: string;
  prompt: string;
  enabled: boolean;
  updatedAt: string;
}

interface AgentAccountOption {
  value: string;
  label: string;
  provider: string;
  model?: string;
  source?: "default" | "api" | "oauth";
  accountName?: string;
}

interface YtDlpStatusResponse {
  installed: boolean;
  source: "project" | "path" | "missing";
  path?: string;
  version?: string;
  message?: string;
}

interface XhsProgressResponse {
  current: number;
  total: number;
  percent: number;
}

interface XhsSyncStatusResponse {
  latestExtraction: { progress: XhsProgressResponse } | null;
  failures: Array<{ id: string; error: string }>;
}

interface XhsActionResponse {
  status: string;
  path?: string;
  progress?: XhsProgressResponse;
  error?: string;
}

interface XhsFavoritesSyncResponse extends XhsActionResponse {
  scanned: number;
  skipped: number;
  queued: number;
  message: string;
}

type ImportSource =
  | "xiaohongshu"
  | "wechat"
  | "flash-note"
  | "douyin"
  | "bilibili"
  | "xiaoyuzhou"
  | "rss"
  | "x";

const IMPORT_SOURCE_UNAVAILABLE_MESSAGE = "之后将支持，现在暂不开放。";

interface SyncRepoState {
  targetRepoPath: string;
  sourceRepoPaths: string[];
}

interface XiaohongshuImportState {
  cookie: string;
  importDirPath?: string;
  progress: number;
  status: "idle" | "saving" | "queued" | "importing" | "success" | "error";
  message?: string;
  taskId?: string;
}

interface DouyinCookieState {
  cookie: string;
  status: "idle" | "saving" | "success" | "error";
  message?: string;
  hasCookie?: boolean;
  path?: string;
}

interface SyncConfigResponse {
  targetRepoPath: string;
  sourceRepoPaths: string[];
}

interface XiaohongshuImportProgressResponse {
  taskId: string | null;
  progress: number;
  status: "idle" | "queued" | "importing" | "success" | "error";
  message: string;
  hasCookie: boolean;
  importDirPath: string;
}

interface XiaohongshuImportConfigResponse {
  importDirPath: string;
}

interface DouyinCookieStatusResponse {
  hasCookie: boolean;
  path: string;
}

type RunKind = "check" | "sync";
type RunStatus = "running" | "succeeded" | "failed" | "stopped";

interface RunLine {
  at: string;
  source: "stdout" | "stderr" | "system";
  text: string;
}

interface RunSnapshot {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  lines: RunLine[];
}

interface RunResponse {
  success?: boolean;
  data?: RunSnapshot | null;
  error?: string;
}

type SettingsSection =
  | "llm"
  | "app-config"
  | "automation"
  | "workspace-sync"
  | "plugins"
  | "shortcuts"
  | "user-guide"
  | "project-log";

type SettingsPluginKind = "core" | "third-party";

const SETTINGS_SECTION_VALUES = new Set<SettingsSection>([
  "llm",
  "app-config",
  "automation",
  "workspace-sync",
  "plugins",
  "shortcuts",
  "user-guide",
  "project-log",
]);

interface ProviderDefinition {
  id: string;
  name: string;
  endpoint: string;
  note: string;
}

const PROVIDERS: readonly ProviderDefinition[] = [
  { id: "anthropic", name: "Anthropic (Claude)", endpoint: "https://api.anthropic.com", note: "Official Claude API" },
  { id: "openai", name: "OpenAI (GPT)", endpoint: "https://api.openai.com/v1", note: "Official OpenAI API" },
  { id: "gemini", name: "Google (Gemini)", endpoint: "https://generativelanguage.googleapis.com", note: "Generative Language API" },
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", note: "DeepSeek API" },
  { id: "groq", name: "Groq", endpoint: "https://api.groq.com/openai/v1", note: "Groq API" },
  { id: "xai", name: "xAI (Grok)", endpoint: "https://api.x.ai/v1", note: "xAI API" },
  { id: "kimi-global", name: "Kimi (Moonshot)", endpoint: "https://api.moonshot.ai/v1", note: "Moonshot Global" },
  { id: "kimi-cn", name: "Kimi (Moonshot, \u4e2d\u56fd)", endpoint: "https://api.moonshot.cn/v1", note: "Moonshot China" },
  { id: "glm", name: "\u667a\u8c31 GLM (Zhipu)", endpoint: "https://open.bigmodel.cn/api/paas/v4", note: "Zhipu AI" },
  { id: "nvidia", name: "NVIDIA NIM", endpoint: "https://integrate.api.nvidia.com/v1", note: "NVIDIA API Catalog" },
  { id: "bailian-cn", name: "\u963f\u91cc\u4e91\u767e\u70bc\uff08\u4e2d\u56fd\u7ad9\uff09", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", note: "DashScope OpenAI compatible" },
  { id: "bailian-us", name: "\u963f\u91cc\u4e91\u767e\u70bc\uff08\u7f8e\u56fd\uff09", endpoint: "https://dashscope-us.aliyuncs.com/compatible-mode/v1", note: "DashScope OpenAI compatible" },
  { id: "bailian-intl", name: "\u963f\u91cc\u4e91\u767e\u70bc\uff08\u56fd\u9645\u7ad9\uff09", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", note: "DashScope OpenAI compatible" },
  { id: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", note: "OpenAI-compatible router" },
  { id: "perplexity", name: "Perplexity", endpoint: "https://api.perplexity.ai", note: "Sonar API" },
  { id: "mistral", name: "Mistral AI", endpoint: "https://api.mistral.ai/v1", note: "Mistral API" },
  { id: "morph", name: "Morph", endpoint: "https://api.morphllm.com/v1", note: "Morph API" },
  { id: "minimax", name: "MiniMax", endpoint: "https://api.minimax.io/anthropic", note: "MiniMax Anthropic Messages API" },
  { id: "ollama", name: "Ollama", endpoint: "http://localhost:11434/v1", note: "\u672c\u5730\u6a21\u578b" },
  { id: "lm-studio", name: "LM Studio", endpoint: "http://localhost:1234/v1", note: "\u672c\u5730 OpenAI-compatible" },
  { id: "custom", name: "\u81ea\u5b9a\u4e49 OpenAI-compatible", endpoint: "custom endpoint", note: "\u517c\u5bb9 /v1/chat/completions" },
  { id: "relay", name: "\u4e2d\u8f6c\u7ad9 API", endpoint: "OpenAI-compatible relay", note: "\u652f\u6301\u4f59\u989d\u67e5\u8be2\u63a5\u53e3" },
  { id: "codex-cli", name: "Codex CLI", endpoint: "local executable", note: "\u8bfb\u53d6\u672c\u673a Codex CLI \u767b\u5f55\u548c\u4f59\u989d\u72b6\u6001" },
  { id: "cloudflare", name: "Cloudflare Workers AI", endpoint: "Cloudflare Worker / Workers AI REST", note: "\u652f\u6301 Workers AI \u548c\u5d4c\u5165\u6a21\u578b" },
];

const MODEL_OPTIONS_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-latest"],
  openai: ["gpt-5-codex", "gpt-4o", "gpt-4.1", "o4-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-exp"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  groq: ["llama-3.3-70b-versatile", "qwen-qwq-32b", "deepseek-r1-distill-llama-70b"],
  xai: ["grok-4", "grok-3", "grok-3-mini"],
  "kimi-global": ["kimi-k2-0711-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
  "kimi-cn": ["kimi-k2-0711-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
  glm: ["glm-4.5", "glm-4.5-air", "glm-4.1v-thinking-flash"],
  nvidia: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "minimaxai/minimax-m2.7"],
  "bailian-cn": ["qwen-plus", "qwen-max", "qwen3-max"],
  "bailian-us": ["qwen-plus", "qwen-max", "qwen3-max"],
  "bailian-intl": ["qwen-plus", "qwen-max", "qwen3-max"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
  perplexity: ["sonar", "sonar-pro", "sonar-reasoning"],
  mistral: ["mistral-large-latest", "mistral-medium-latest", "codestral-latest"],
  morph: ["morph-v3-large", "morph-v3-fast"],
  minimax: ["MiniMax-M2.7", "MiniMax-M2.5"],
  ollama: ["llama3.1", "qwen2.5", "deepseek-r1:latest"],
  "lm-studio": ["local-model", "qwen2.5", "llama3.1"],
  relay: ["gpt-5-codex", "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro"],
  custom: ["gpt-5-codex", "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro"],
  "codex-cli": ["gpt-5-codex", "gpt-4.1", "o4-mini"],
  cloudflare: ["@cf/meta/llama-3.1-8b-instruct"],
};

const PRESET_PROVIDER_BY_LABEL: Readonly<Record<string, string>> = {
  OpenAI: "openai",
  "OpenAI (GPT)": "openai",
  Anthropic: "anthropic",
  "Anthropic (Claude)": "anthropic",
  Gemini: "gemini",
  "Google (Gemini)": "gemini",
  Groq: "groq",
  "xAI (Grok)": "xai",
  "NVIDIA NIM": "nvidia",
  "Alibaba Bailian CN": "bailian-cn",
  "Alibaba Bailian US": "bailian-us",
  "Alibaba Bailian Intl": "bailian-intl",
  "阿里百炼 Coding Plan": "custom",
  OpenRouter: "openrouter",
  Perplexity: "perplexity",
  Mistral: "mistral",
  Morph: "morph",
  MiniMax: "minimax",
  "MiniMax (Global)": "minimax",
  "MiniMax (中国)": "minimax",
  Ollama: "ollama",
  "Ollama (Local)": "ollama",
  "Ollama Cloud": "custom",
  "LM Studio": "lm-studio",
  DeepSeek: "deepseek",
  Moonshot: "kimi-global",
  "Kimi (Moonshot)": "kimi-global",
  "Kimi (Moonshot, 中国)": "kimi-cn",
  "智谱 GLM (Zhipu)": "glm",
  "小米 MiMo (Xiaomi)": "custom",
  "火山引擎 Ark (Volcengine)": "custom",
  "小马 / 神马中转": "relay",
  Custom: "custom",
};

const PRESET_LABEL_BY_PROVIDER: Readonly<Record<string, string>> = {
  openai: "OpenAI (GPT)",
  anthropic: "Anthropic (Claude)",
  gemini: "Google (Gemini)",
  groq: "Groq",
  xai: "xAI (Grok)",
  nvidia: "NVIDIA NIM",
  openrouter: "OpenRouter",
  minimax: "MiniMax (Global)",
  ollama: "Ollama (Local)",
  deepseek: "DeepSeek",
  "kimi-global": "Kimi (Moonshot)",
  "kimi-cn": "Kimi (Moonshot, 中国)",
  glm: "智谱 GLM (Zhipu)",
  relay: "Custom",
  custom: "Custom",
};

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

const IMPORT_SOURCE_DEFINITIONS: ReadonlyArray<{
  id: ImportSource;
  name: string;
  description: string;
  badge: string;
  badgeClass: string;
}> = [
  { id: "xiaohongshu", name: "小红书", description: "导入小红书笔记数据", badge: "红", badgeClass: "is-red" },
  { id: "wechat", name: "微信聊天记录", description: "导入微信聊天记录", badge: "微", badgeClass: "is-green" },
  { id: "flash-note", name: "闪念笔记", description: "导入外部闪念笔记导出数据", badge: "闪", badgeClass: "is-purple" },
  { id: "douyin", name: "抖音", description: "导入抖音作品数据", badge: "抖", badgeClass: "is-dark" },
  { id: "bilibili", name: "b站", description: "导入 B 站视频数据", badge: "B", badgeClass: "is-blue" },
  { id: "xiaoyuzhou", name: "小宇宙", description: "导入小宇宙播客数据", badge: "宙", badgeClass: "is-orange" },
  { id: "rss", name: "RSS", description: "导入 RSS 订阅内容", badge: "R", badgeClass: "is-purple" },
  { id: "x", name: "X (Twitter)", description: "导入 X 平台内容", badge: "X", badgeClass: "is-black" },
];

const appConfigState = new WeakMap<HTMLElement, AppConfigResponse>();
const agentEditSnapshotState = new WeakMap<HTMLElement, AppDefinitionResponse>();
const agentAccountOptionsState = new WeakMap<HTMLElement, AgentAccountOption[]>();
const llmConfigState = new WeakMap<HTMLElement, LlmProviderConfigResponse>();
const llmDefaultAccountOptionsState = new WeakMap<HTMLElement, AgentAccountOption[]>();
const llmAccountsState = new WeakMap<HTMLElement, LlmApiAccountResponse[]>();
const llmOAuthAccountsState = new WeakMap<HTMLElement, readonly LlmProviderOAuthAccountResponse[]>();
const llmCloudflareProviderState = new WeakMap<HTMLElement, LlmCloudflareProviderResponse | null>();
const workspaceSyncState = new WeakMap<HTMLElement, SyncRepoState>();
const xiaohongshuImportState = new WeakMap<HTMLElement, XiaohongshuImportState>();
const xiaohongshuImportPollers = new WeakMap<HTMLElement, number>();
const douyinCookieState = new WeakMap<HTMLElement, DouyinCookieState>();

type XiaohongshuProgressDraft = Parameters<typeof buildXiaohongshuProgressSnapshot>[1];
type DouyinCookieDraft = Parameters<typeof buildDouyinCookieSnapshot>[1];
type SettingsPageRoot = HTMLElement & { __dispose?: () => void };

interface SettingsPageRouteState {
  anchor?: string;
  automationPanel?: SettingsAutomationPanelState;
  isDialog?: boolean;
  pluginKind?: SettingsPluginKind;
  pluginId?: string;
}

interface SuccessDataPayload<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "codex_oauth_device_start_failed") {
    return "ChatGPT 授权码创建失败：OpenAI 当前没有返回设备授权码。通常是请求太频繁或网络被限制，请等 1-2 分钟后重新点击“授权并添加”。";
  }
  if (message.includes("Codex device code HTTP 429")) {
    return "ChatGPT 授权码创建太频繁，OpenAI 返回 429。请等 1-2 分钟后重新点击“授权并添加”。";
  }
  return message;
}

function setOptionalText(element: HTMLElement | null, text: string): void {
  if (element) {
    element.textContent = text;
  }
}

function readRequiredControlValue(
  control: HTMLInputElement | HTMLSelectElement | null,
  errorMessage: string,
): string {
  const value = control?.value.trim() ?? "";
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

async function readSuccessData<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = await readJsonPayload<SuccessDataPayload<T>>(response);
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? fallbackMessage);
  }
  return payload.data;
}

async function loadOptionalCliProxyOAuthAccounts(): Promise<readonly CLIProxyOAuthAccountResponse[]> {
  try {
    return await fetchCLIProxyOAuthAccounts(false);
  } catch {
    return [];
  }
}

async function loadOptionalAccountCodexOAuthAccounts(): Promise<readonly LlmProviderOAuthAccountResponse[]> {
  try {
    const response = await fetch("/api/account-ai/codex-quota");
    const payload = await readSuccessData<{ accounts?: CLIProxyOAuthAccountResponse[] }>(response, "Worker OAuth 账号读取失败");
    return (payload.accounts ?? []).map((account) => ({
      ...account,
      provider: "codex",
      accountRef: "oauth:codex:cloud-account",
      authIndex: "Worker OAuth",
      connectionText: account.email ? `已连接 · ${account.email}` : "已连接 · Worker OAuth",
    }));
  } catch {
    return [];
  }
}

function buildXiaohongshuImportDirState(
  state: XiaohongshuImportState | undefined,
  importDirPath: string,
): XiaohongshuImportState {
  return {
    cookie: state?.cookie ?? "",
    importDirPath,
    progress: state?.progress ?? 0,
    status: state?.status ?? "idle",
    message: state?.message,
    taskId: state?.taskId,
  };
}

function applyXiaohongshuImportDir(root: HTMLElement, importDirPath: string): void {
  const input = root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]");
  if (input) {
    input.value = importDirPath;
  }
  xiaohongshuImportState.set(
    root,
    buildXiaohongshuImportDirState(xiaohongshuImportState.get(root), importDirPath),
  );
}

function renderXiaohongshuImportProgressFields(
  root: HTMLElement,
  progress: XiaohongshuImportProgressResponse,
  nextImportDirPath: string,
): void {
  const percent = root.querySelector<HTMLElement>("[data-xhs-import-percent]");
  const bar = root.querySelector<HTMLElement>("[data-xhs-import-progress]");
  const status = root.querySelector<HTMLElement>("[data-xhs-import-status]");
  const importDirInput = root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]");
  setOptionalText(percent, `${progress.progress}%`);
  if (bar) {
    bar.style.width = `${progress.progress}%`;
  }
  setOptionalText(status, progress.message);
  if (importDirInput && nextImportDirPath && importDirInput.value !== nextImportDirPath) {
    importDirInput.value = nextImportDirPath;
  }
}

function buildXiaohongshuImportState(
  state: XiaohongshuImportState | undefined,
  progress: XiaohongshuImportProgressResponse,
): { nextImportDirPath: string; nextState: XiaohongshuImportState } {
  const nextImportDirPath = progress.importDirPath || state?.importDirPath || "";
  return {
    nextImportDirPath,
    nextState: {
      cookie: state?.cookie ?? "",
      importDirPath: nextImportDirPath,
      progress: progress.progress,
      status: progress.status,
      message: progress.message,
      taskId: progress.taskId ?? undefined,
    },
  };
}

function describeXhsSyncStatus(failureCount: number): string {
  return failureCount > 0
    ? `有 ${failureCount} 条小红书同步问题，已写入审查页。`
    : "小红书同步状态正常。";
}

function readSelectedLlmDefaultAccount(root: HTMLElement): string {
  return readRequiredControlValue(
    root.querySelector<HTMLSelectElement>("[data-llm-default-account]"),
    "请先从已有 OAuth 或 API 账号里选择默认模型。",
  );
}

export function renderSettingsPage(
  initialSection?: string,
  routeState: SettingsPageRouteState = {},
): HTMLElement {
  const activeSection = normalizeSettingsSection(initialSection);
  const root = document.createElement("section") as SettingsPageRoot;
  root.className = "settings-page settings-page--with-sidebar";
  root.innerHTML = `
    <aside class="settings-sidebar" data-settings-sidebar>
      <div class="settings-sidebar__header">
        <div class="eyebrow">SETTINGS</div>
        <h2 class="settings-page__title">&#x8bbe;&#x7f6e;</h2>
      </div>
      <nav class="settings-sidebar__nav">
        <div class="settings-sidebar__group">
          <p class="settings-sidebar__group-title">&#x9009;&#x9879;</p>
          ${renderSettingsNavItem("llm", "LLM &#x5927;&#x6a21;&#x578b;", "globe")}
          ${renderSettingsNavItem("app-config", "&#x5e94;&#x7528;", "archive")}
          ${renderSettingsNavItem("automation", "&#x81ea;&#x52a8;&#x5316;", "hammer")}
          ${renderSettingsNavItem("workspace-sync", "&#x4ed3;&#x5e93;&#x4e0e;&#x540c;&#x6b65;", "refresh-cw")}
          ${renderSettingsNavItem("plugins", "&#x7b2c;&#x4e09;&#x65b9;&#x63d2;&#x4ef6;", "plus", "third-party")}
          ${renderSettingsNavItem("shortcuts", "&#x5feb;&#x6377;&#x952e;", "settings")}
          ${renderSettingsNavItem("user-guide", "&#x4f7f;&#x7528;&#x8bf4;&#x660e;", "book-open-text")}
          ${renderSettingsNavItem("project-log", "&#x9879;&#x76ee;&#x65e5;&#x5fd7;", "clipboard-list")}
        </div>
        ${renderPluginSidebarGroups()}
      </nav>
    </aside>
    <div class="settings-sidebar-resize panel-resize-handle" data-settings-sidebar-resize></div>
      <main class="settings-content">
        ${renderLlmPanel()}
        ${renderAgentConfigPanel()}
        ${renderSettingsAutomationPanel()}
        ${renderWorkspaceSyncPanel()}
      ${renderPluginsPanel()}
      ${renderShortcutSection()}
      ${renderSettingsUserGuidePanel()}
      ${renderSettingsProjectLogPanel()}
      <p class="settings-page__status" data-settings-status></p>
    </main>
  `;
  root.querySelector<HTMLElement>("[data-settings-panel=\"app-config\"]")?.appendChild(renderAppPublishSection());
  bindSettingsPage(root, activeSection, routeState);
  root.__dispose = () => {
    disposeSettingsAutomationPanel(root);
    disposeSettingsUserGuidePanel(root);
    disposeSettingsProjectLogPanel(root);
  };
  return root;
}

function renderSettingsNavItem(
  section: SettingsSection,
  label: string,
  icon: string,
  pluginKind?: SettingsPluginKind,
): string {
  const pluginKindAttribute = pluginKind ? ` data-settings-plugin-kind="${pluginKind}"` : "";
  return `<button type="button" class="settings-sidebar__item" data-settings-nav="${section}" data-settings-section="${section}"${pluginKindAttribute} data-active="false">${renderIcon(icon, { size: 18 })}<span>${label}</span></button>`;
}

function renderLlmPanel(): string {
  return `
    <section class="settings-panel" data-settings-panel="llm">
      ${renderLlmProviderEmptyCard()}
      ${renderNetworkSearchProviderCard()}
      ${renderVectorSearchProviderCard()}
      ${renderLlmProviderDialog()}
    </section>
  `;
}

function renderLlmProviderEmptyCard(): string {
  return `
    <article class="settings-card settings-card--llm-provider-empty">
      <div class="settings-card__header">
        <div>
          <h2>&#x63d0;&#x4f9b;&#x5546;</h2>
          <p class="settings-card__hint" data-llm-provider-count>&#x5df2;&#x6dfb;&#x52a0; 0 &#x4e2a;&#x63d0;&#x4f9b;&#x5546;</p>
        </div>
        <button type="button" class="btn btn-primary" data-llm-provider-add>&#x6dfb;&#x52a0;&#x63d0;&#x4f9b;&#x5546;</button>
      </div>
      <div class="settings-llm-preset-grid" data-llm-preset-grid>
        ${LLM_PROVIDER_PRESETS.map(renderLlmProviderPresetButton).join("")}
      </div>
      <div class="settings-llm-provider-list" data-llm-provider-list></div>
      <p class="settings-llm-provider-status" data-llm-provider-list-status></p>
    </article>
  `;
}

function renderLlmProviderPresetButton(preset: LlmProviderPreset): string {
  return `
    <button type="button" class="settings-llm-preset" data-llm-provider-preset-open="${escapeHtml(preset.label)}">
      <strong>${escapeHtml(preset.label)}</strong>
      <small>${escapeHtml(preset.hint)}</small>
    </button>
  `;
}

function renderLlmProviderDialog(): string {
  return `
    <div class="settings-modal" data-llm-provider-dialog hidden>
      <button type="button" class="settings-modal__backdrop" data-llm-provider-close aria-label="关闭添加提供商"></button>
      <form class="settings-modal__dialog settings-modal__dialog--provider" data-llm-provider-form role="dialog" aria-modal="true" aria-labelledby="llm-provider-dialog-title">
        <div class="settings-modal__header settings-modal__header--provider">
          <h2 id="llm-provider-dialog-title">添加提供商</h2>
          <button type="button" class="settings-modal__close" data-llm-provider-close aria-label="关闭">×</button>
        </div>
        ${renderLlmProviderDialogRows()}
        ${renderLlmProviderOAuthDeviceCode()}
        <p class="settings-provider-dialog__status" data-llm-provider-status></p>
        <div class="settings-provider-dialog__footer">
          <button type="submit" class="btn btn-primary" data-llm-provider-submit>添加</button>
          <button type="button" class="btn btn-secondary" data-llm-provider-close>取消</button>
        </div>
      </form>
    </div>
  `;
}

function renderLlmProviderDialogRows(): string {
  return `
    ${renderProviderTextRow("ID *", "为此提供商指定一个用于设置中的 ID，仅供你自己区分使用。", "my-custom-provider", "id")}
    ${renderProviderSelectRow("Provider preset *", "preset", LLM_PROVIDER_PRESET_OPTIONS, "", "Custom")}
    ${renderProviderSelectRow("API type *", "apiType", LLM_PROVIDER_API_TYPE_OPTIONS)}
    ${renderProviderTextRow("API 密钥", "（如不需要可留空）", "输入你的 API 密钥", "apiKey", "password")}
    ${renderProviderTextRow("基础 URL *", "第三方服务的 API 端点地址，例如：https://api.example.com/v1 或 https://your-proxy.com/openai（使用默认值可留空）", "https://api.example.com", "baseUrl")}
    ${renderProviderModelRow()}
    ${renderProviderSwitchRow()}
    ${renderProviderSelectRow("请求传输模式", "transport", LLM_PROVIDER_TRANSPORT_OPTIONS, "自动模式会先尝试浏览器 fetch，再尝试桌面端 Node fetch，最后在 CORS/网络错误时回退到 Obsidian requestUrl。仅 Obsidian 模式下流式响应会被缓冲；Node 模式使用桌面端 Node fetch 获取真实流式。")}
    ${renderProviderHeaderRow()}
  `;
}

function renderProviderModelRow(): string {
  return `
    <label class="settings-provider-dialog__row settings-provider-dialog__row--model">
      <span><strong>模型 ID *</strong><small>选择常用模型，或直接输入服务商后台展示的真实模型 ID。</small></span>
      <div class="settings-provider-dialog__model-field">
        <input data-llm-provider-field="model" type="text" placeholder="openai/gpt-oss-120b" />
        <div class="settings-provider-dialog__model-chips" data-llm-provider-model-suggestions></div>
      </div>
    </label>
  `;
}

function renderLlmProviderOAuthDeviceCode(): string {
  return `
    <div class="settings-provider-dialog__oauth-code" data-llm-provider-oauth-code hidden>
      <div>
        <strong>授权码</strong>
        <small>这个码会同步显示在这里，填入打开的 ChatGPT 授权页即可。</small>
      </div>
      <code data-llm-provider-oauth-user-code></code>
      <div class="settings-provider-dialog__oauth-actions">
        <button type="button" class="btn btn-secondary" data-llm-provider-oauth-copy>复制</button>
        <a class="btn btn-secondary" data-llm-provider-oauth-link target="_blank" rel="noreferrer">打开授权页</a>
      </div>
    </div>
  `;
}

function renderProviderTextRow(label: string, hint: string, placeholder: string, field: string, type = "text"): string {
  return `
    <label class="settings-provider-dialog__row">
      <span><strong>${label}</strong><small>${hint}</small></span>
      <input data-llm-provider-field="${field}" type="${type}" placeholder="${placeholder}" />
    </label>
  `;
}

function renderProviderSelectRow(
  label: string,
  field: string,
  options: readonly string[],
  hint = "",
  selected = options[0] ?? "",
): string {
  return `
    <label class="settings-provider-dialog__row">
      <span><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ""}</span>
      <select data-llm-provider-field="${field}">
        ${options.map((option) => `<option value="${escapeHtml(option)}"${option === selected ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderProviderSwitchRow(): string {
  return `
    <label class="settings-provider-dialog__row">
      <span><strong>无 Stainless 请求头</strong><small>如果你遇到与 Stainless 请求头相关的 CORS 错误（x-stainless-os 等），请启用此选项</small></span>
      <input class="settings-provider-dialog__switch" data-llm-provider-field="noStainless" type="checkbox" />
    </label>
  `;
}

function renderProviderHeaderRow(): string {
  return `
    <div class="settings-provider-dialog__row">
      <span><strong>自定义请求头</strong><small>为此提供商发出的所有请求附加额外的 HTTP Header。</small></span>
      <button type="button" class="btn btn-secondary" data-llm-provider-header-add>添加请求头</button>
    </div>
    <div class="settings-provider-dialog__headers" data-llm-provider-headers></div>
  `;
}

function renderLlmDefaultCard(): string {
  return `
    <article class="settings-card settings-card--llm-default" data-llm-default-card>
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">DEFAULT MODEL</div>
          <h2>默认模型</h2>
          <p class="settings-card__hint">只从已有 API 或 OAuth 账号里选择默认运行来源。</p>
        </div>
      </div>
      <div class="settings-card__body">
        <label class="settings-field">
          <span>默认账号来源</span>
          <select data-llm-default-account>
            <option value="">暂无可用账号</option>
          </select>
        </label>
        <div class="settings-llm-default-meta">
          <div class="settings-llm-default-meta__item">
            <span>来源</span>
            <strong data-llm-default-source>暂无可用账号</strong>
          </div>
          <div class="settings-llm-default-meta__item">
            <span>Provider</span>
            <strong data-llm-default-provider>--</strong>
          </div>
          <div class="settings-llm-default-meta__item">
            <span>模型</span>
            <strong data-llm-default-model>--</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderLlmAccountSummaryCard(): string {
  return `
    <article class="settings-card settings-card--llm-accounts" data-llm-account-summary-card>
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">ACCOUNT POOL</div>
          <h2>已有 OAuth 和 API</h2>
          <p class="settings-card__hint">这里只显示当前可用的账号来源，不展示密钥和技术细节。</p>
        </div>
      </div>
      <div class="settings-card__body">
        <div class="settings-llm-account-summary" data-llm-account-summary-list>
          <span class="settings-source-empty">暂无可用账号</span>
        </div>
      </div>
    </article>
  `;
}

function renderLlmProvider(provider: ProviderDefinition): string {
  const relayStats = provider.id === "relay"
    ? `
      <div class="settings-provider-balance">
        <div class="settings-provider-balance__tile" data-relay-balance-current><span>&#x5f53;&#x524d;&#x4f59;&#x989d;</span><strong>--</strong></div>
        <div class="settings-provider-balance__tile" data-relay-balance-used><span>&#x5386;&#x53f2;&#x6d88;&#x8017;</span><strong>--</strong></div>
        <button type="button" class="btn btn-secondary btn-inline" data-relay-balance-refresh>&#x5237;&#x65b0;&#x4f59;&#x989d;</button>
      </div>
      <label class="settings-field"><span>&#x4f59;&#x989d;&#x67e5;&#x8be2; URL</span><input data-provider="${provider.id}:balanceUrl" type="text" /></label>
      <label class="settings-field"><span>&#x4f59;&#x989d;&#x5b57;&#x6bb5;&#x8def;&#x5f84;</span><input data-provider="${provider.id}:balancePath" type="text" placeholder="data.balance" /></label>
      <label class="settings-field"><span>&#x6d88;&#x8017;&#x5b57;&#x6bb5;&#x8def;&#x5f84;</span><input data-provider="${provider.id}:usedPath" type="text" placeholder="data.used" /></label>
    `
    : "";
  const codexStats = provider.id === "codex-cli"
    ? `
      <div class="settings-provider-balance">
        <div class="settings-provider-balance__tile" data-codex-cli-balance><span>Codex CLI &#x4f59;&#x989d;</span><strong>CLI &#x672a;&#x68c0;&#x6d4b;</strong></div>
        <div class="settings-provider-balance__tile"><span>CLI &#x72b6;&#x6001;</span><strong data-codex-cli-status>&#x672a;&#x68c0;&#x6d4b;</strong></div>
        <button type="button" class="btn btn-secondary btn-inline" data-codex-cli-refresh>&#x5237;&#x65b0;</button>
      </div>
    `
    : "";
  return `
    <article class="settings-provider-card" data-llm-provider="${provider.id}">
      <button type="button" class="settings-provider-card__summary" data-provider-toggle="${provider.id}">
        <span class="settings-provider-card__chevron">›</span>
        <span class="settings-provider-card__copy">
          <strong>${escapeHtml(provider.name)}</strong>
          <small>${escapeHtml(provider.note)} · ${escapeHtml(provider.endpoint)}</small>
        </span>
        <span class="settings-switch" data-provider-enabled="${provider.id}" role="switch" aria-checked="false"></span>
      </button>
      <div class="settings-provider-card__body" data-provider-body="${provider.id}" hidden>
        <div class="settings-provider-account-list" data-llm-account-list="${provider.id}">
        <div class="settings-account-row" data-llm-account="${provider.id}">
          <label class="settings-field"><span>&#x8d26;&#x6237;&#x540d;</span><input data-provider="${provider.id}:name" type="text" /></label>
          <label class="settings-field"><span>&#x5730;&#x5740;</span><input data-provider="${provider.id}:url" type="text" value="${escapeHtml(provider.endpoint)}" /></label>
          <label class="settings-field"><span>&#x5bc6;&#x94a5;</span><input data-provider="${provider.id}:key" type="password" /></label>
          <label class="settings-field"><span>&#x6a21;&#x578b;</span><select data-provider="${provider.id}:model">${renderModelOptions(provider.id)}</select></label>
          <button type="button" class="btn btn-secondary btn-inline" data-llm-account-test>&#x9a8c;&#x8bc1;</button>
          <button type="button" class="btn btn-primary btn-inline" data-llm-account-save>&#x4fdd;&#x5b58;</button>
          <button type="button" class="btn btn-secondary btn-inline" data-llm-account-delete>&#x5220;&#x9664;</button>
          <span class="settings-account-row__status" data-llm-account-status></span>
        </div>
        </div>
        ${relayStats}
        ${codexStats}
        <button type="button" class="btn btn-secondary" data-llm-account-add="${provider.id}">&#x65b0;&#x589e;&#x8d26;&#x6237;</button>
      </div>
    </article>
  `;
}

function renderAgentConfigPanel(): string {
  return `
    <section class="settings-panel" data-settings-panel="app-config" hidden>
      <div class="settings-page__header">
        <div class="settings-page__header-copy">
          <div class="eyebrow">APPS</div>
          <h1 class="settings-page__title">&#x5e94;&#x7528;</h1>
          <p>&#x5bf9;&#x8bdd;&#x3001;&#x5de5;&#x4f5c;&#x6d41;&#x3001;&#x77e5;&#x8bc6;&#x548c;&#x6df7;&#x5408;&#x5e94;&#x7528;&#x90fd;&#x5728;&#x8fd9;&#x91cc;&#x7edf;&#x4e00;&#x5b9a;&#x4e49;&#xff0c;&#x804a;&#x5929;&#x548c;&#x81ea;&#x52a8;&#x5316;&#x53ea;&#x7ed1;&#x5b9a;&#x5e94;&#x7528;&#xff0c;&#x4e0d;&#x76f4;&#x63a5;&#x9762;&#x5411;&#x6a21;&#x578b;&#x8d26;&#x53f7;&#x3002;</p>
          <p class="settings-page__status" data-agent-config-status>&#x6b63;&#x5728;&#x8bfb;&#x53d6;&#x5e94;&#x7528;&#x914d;&#x7f6e;...</p>
        </div>
        <div class="settings-run-panel__actions">
          <button type="button" class="btn btn-primary" data-agent-config-add>${renderIcon("plus", { size: 18 })}<span>&#x65b0;&#x5efa; Agent</span></button>
        </div>
      </div>
      <article class="settings-card settings-card--agent-config">
        <div class="settings-agent-config">
          <aside class="settings-agent-config__list">
              <div class="settings-card__header">
                <div>
                  <h2>Agents</h2>
                  <p class="settings-card__hint">&#x70b9;&#x51fb;&#x914d;&#x7f6e;&#x4ee5;&#x7f16;&#x8f91;&#x6bcf;&#x4e2a; Agent &#x7684;&#x8d44;&#x6599;&#x4e0e;&#x63d0;&#x793a;&#x8bcd;&#x3002;</p>
                </div>
              </div>
              <div class="settings-agent-config__items" data-agent-config-list>
                <div class="settings-source-empty">&#x6682;&#x672a;&#x8bfb;&#x53d6;&#x5e94;&#x7528;</div>
              </div>
              <button type="button" class="settings-agent-config__create" data-agent-config-add>
                <span>${renderIcon("plus", { size: 34 })}</span>
                <strong>&#x65b0;&#x5efa; Agent</strong>
              </button>
            </aside>
            <section class="settings-agent-config__editor" data-agent-config-editor data-agent-config-modal hidden>
              <button type="button" class="settings-agent-config__modal-backdrop" data-agent-config-close aria-label="Close agent editor"></button>
              <div class="settings-agent-config__modal-panel" role="dialog" aria-modal="true" aria-labelledby="agent-config-modal-title">
              <div class="settings-card__header">
                <div>
                  <div class="eyebrow">EDITOR</div>
                  <h2 id="agent-config-modal-title" data-agent-config-modal-title>Agent</h2>
                  <p class="settings-card__hint">&#x914d;&#x7f6e;&#x6b64; Agent &#x7684;&#x80fd;&#x529b;&#x3001;&#x6a21;&#x578b;&#x4e0e;&#x884c;&#x4e3a;&#x3002;</p>
                </div>
                <div class="settings-agent-config__editor-actions">
                  <button type="button" class="btn btn-secondary btn-inline" data-agent-config-delete>&#x5220;&#x9664;</button>
                  <button type="button" class="settings-modal__close" data-agent-config-close aria-label="Close agent editor">${renderIcon("x", { size: 24 })}</button>
                </div>
              </div>
              <div class="settings-agent-modal__tabs" aria-label="Agent sections">
                <button type="button" data-active="true">${renderIcon("settings", { size: 18 })}<span>&#x8d44;&#x6599;</span></button>
                <button type="button">${renderIcon("hammer", { size: 18 })}<span>&#x5de5;&#x5177;</span></button>
                <button type="button">${renderIcon("book-open-text", { size: 18 })}<span>&#x6280;&#x80fd;</span></button>
                <button type="button">${renderIcon("folder-open", { size: 18 })}<span>&#x5de5;&#x4f5c;&#x533a;</span></button>
              </div>
              <div class="settings-agent-config__form">
                <label class="settings-field"><span>App ID</span><input data-agent-config-field="id" type="text" readonly /></label>
                <label class="settings-field"><span>&#x540d;&#x79f0;</span><input data-agent-config-field="name" type="text" /></label>
                <label class="settings-field"><span>&#x5e94;&#x7528;&#x6a21;&#x5f0f;</span><select data-agent-config-field="mode">${renderAppModeOptions()}</select></label>
                <label class="settings-field"><span>&#x53ef;&#x4ee5;&#x89e3;&#x51b3;&#x5565;&#x9700;&#x6c42;</span><input data-agent-config-field="purpose" type="text" /></label>
                <label class="settings-field"><span>&#x63a5;&#x5165;&#x7684;&#x5927;&#x6a21;&#x578b;</span><select data-agent-config-field="provider">${renderAgentProviderOptions()}</select></label>
                <label class="settings-field"><span>账号 / 授权来源</span><select data-agent-config-field="accountRef"><option value="">跟随应用资源默认配置</option></select></label>
                <label class="settings-field"><span>&#x6a21;&#x578b;&#x540d;</span><select data-agent-config-field="model">${renderModelOptions("openai")}</select></label>
                <label class="settings-field settings-field--wide"><span>&#x5de5;&#x4f5c;&#x6d41;</span><textarea data-agent-config-field="workflow" rows="6"></textarea></label>
                <label class="settings-field settings-field--wide"><span>Prompt</span><textarea data-agent-config-field="prompt" rows="8"></textarea></label>
                <label class="settings-check-row"><input data-agent-config-field="enabled" type="checkbox" /> <span>&#x542f;&#x7528;&#x8fd9;&#x4e2a;&#x5e94;&#x7528;</span></label>
              </div>
              <div class="settings-agent-modal__footer">
                <span></span>
                <button type="button" class="btn btn-secondary" data-agent-config-close>&#x53d6;&#x6d88;</button>
                <button type="button" class="btn btn-primary" data-agent-config-save>&#x4fdd;&#x5b58;</button>
              </div>
              </div>
            </section>
          </div>
        </article>
      </section>
  `;
}

function renderAgentProviderOptions(): string {
  return PROVIDERS.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
}

function renderAppModeOptions(): string {
  return [
    { value: "chat", label: "对话" },
    { value: "workflow", label: "工作流" },
    { value: "knowledge", label: "知识" },
    { value: "hybrid", label: "混合" },
  ].map((mode) => `<option value="${mode.value}">${mode.label}</option>`).join("");
}

function renderModelOptions(provider: string, selected = ""): string {
  const models = MODEL_OPTIONS_BY_PROVIDER[provider] ?? [];
  return renderModelOptionsFromList(models, selected);
}

function renderModelOptionsFromList(models: readonly string[], selected = ""): string {
  const values = selected && !models.includes(selected) ? [selected, ...models] : [...models];
  const options = ['<option value="">未指定</option>'];
  for (const model of values) {
    options.push(`<option value="${escapeHtml(model)}"${model === selected ? " selected" : ""}>${escapeHtml(model)}</option>`);
  }
  return options.join("");
}

function renderWorkspaceSyncPanel(): string {
  return `
    <section class="settings-panel" data-settings-panel="workspace-sync" hidden>
      <div class="settings-workspace-sync">
        <section class="settings-sync-section" data-import-home>
          <div class="settings-sync-section__intro">
            <h1>数据导入</h1>
            <p>支持从多种来源导入数据，每个来源将以一个小卡片的形式展示。</p>
          </div>
          <div class="settings-sync-section__panel">
            <div class="settings-sync-section__panel-header">
              <div>
                <h2>1. 选择导入来源</h2>
              </div>
            </div>
            <div class="settings-import-grid">
              ${IMPORT_SOURCE_DEFINITIONS.map(renderImportSourceCard).join("")}
            </div>
          </div>
        </section>
        <section class="settings-sync-section" data-import-home>
          <div class="settings-sync-section__panel settings-sync-section__panel--sync">
            <div class="settings-sync-section__panel-header settings-sync-section__panel-header--actions">
              <div>
                <h2>2. 同步仓库</h2>
                <p>指定目标仓库和源仓库地址，点击地址位置可以直接跳转选择桌面文件夹位置并且支持多选。鼠标移到已经有的地址上面的时候，后面会有删除按钮。</p>
              </div>
              <div class="settings-sync-section__actions">
                <button type="button" class="btn btn-secondary" data-sync-config-refresh>同步仓库设置</button>
                <button type="button" class="btn btn-primary" data-sync-config-save>保存</button>
              </div>
            </div>
            <div class="settings-sync-form">
              <div class="settings-path-row" data-sync-target-row>
                <label class="settings-path-row__label" for="settings-sync-target-input">目标仓库</label>
                <div class="settings-path-row__field">
                  <input id="settings-sync-target-input" data-sync-target-input type="text" placeholder="请选择目标仓库地址" />
                  <button type="button" class="settings-path-row__icon" data-sync-target-pick aria-label="选择目标仓库">${renderIcon("folder-open", { size: 18 })}</button>
                  <button type="button" class="settings-path-row__clear" data-sync-target-clear aria-label="清空目标仓库">删除</button>
                </div>
              </div>
              <div class="settings-path-row settings-path-row--source" data-sync-source-row>
                <label class="settings-path-row__label" for="settings-sync-source-input">源仓库</label>
                <div class="settings-path-row__field">
                  <input id="settings-sync-source-input" data-sync-source-input type="text" placeholder="请选择源仓库地址" />
                  <button type="button" class="settings-path-row__add" data-sync-source-add>添加路径</button>
                  <button type="button" class="settings-path-row__icon" data-sync-source-pick aria-label="选择源仓库">${renderIcon("folder-open", { size: 18 })}</button>
                </div>
              </div>
              <div class="settings-source-paths" data-sync-source-paths></div>
            </div>
          </div>
        </section>
        ${renderRssImportPanel()}
        ${renderFlashNoteImportPanel()}
        ${renderXiaohongshuImportModal()}
        ${renderDouyinCookieModal()}
      </div>
    </section>
  `;
}

function renderImportSourceCard(source: {
  id: ImportSource;
  name: string;
  description: string;
  badge: string;
  badgeClass: string;
}): string {
  return `
    <button type="button" class="settings-import-card" data-import-source="${source.id}">
      <span class="settings-import-card__badge ${source.badgeClass}">${escapeHtml(source.badge)}</span>
      <span class="settings-import-card__copy">
        <strong>${escapeHtml(source.name)}</strong>
        <small>${escapeHtml(source.description)}</small>
      </span>
      <span class="settings-import-card__arrow">›</span>
    </button>
  `;
}

function renderXiaohongshuImportModal(): string {
  return `
    <div class="settings-modal" data-xhs-import-modal hidden>
      <button type="button" class="settings-modal__backdrop" data-xhs-import-close aria-label="关闭小红书导入"></button>
      <div class="settings-modal__dialog settings-modal__dialog--xhs" role="dialog" aria-modal="true" aria-labelledby="settings-xhs-import-title">
        <div class="settings-modal__header">
          <h2 id="settings-xhs-import-title">小红书导入</h2>
          <button type="button" class="settings-modal__close" data-xhs-import-close aria-label="关闭">×</button>
        </div>
        <div class="settings-modal__body">
          <div class="settings-xhs-import">
            <label class="settings-field settings-field--wide">
              <span>cookie填写地址</span>
              <div class="settings-xhs-import__cookie-row">
                <textarea data-xhs-cookie-input rows="4" placeholder="请粘贴小红书 Cookie"></textarea>
                <button type="button" class="btn btn-secondary" data-xhs-login-open>打开小红书登录</button>
                <button type="button" class="btn btn-secondary" data-xhs-cookie-import>一键导入小红书 Cookie</button>
                <button type="button" class="btn btn-primary" data-xhs-cookie-save>保存</button>
              </div>
            </label>
            <label class="settings-field settings-field--wide">
              <span>导入文件夹地址</span>
              <div class="settings-xhs-import__path-row">
                <input data-xhs-import-dir-input type="text" placeholder="请选择导入文件夹地址" />
                <button type="button" class="btn btn-secondary" data-xhs-import-dir-pick>选择</button>
                <button type="button" class="btn btn-secondary" data-xhs-import-dir-clear>删除</button>
                <button type="button" class="btn btn-primary" data-xhs-import-dir-save>保存</button>
              </div>
            </label>
            <div class="settings-xhs-import__sync-action">
              <button type="button" class="btn btn-primary" data-xhs-import-sync>一键同步</button>
            </div>
            <div class="settings-xhs-import__progress">
              <div class="settings-xhs-import__progress-row">
                <span>导入进度</span>
                <strong data-xhs-import-percent>0%</strong>
              </div>
              <div class="settings-xhs-import__bar" aria-label="小红书导入进度">
                <span data-xhs-import-progress style="width:0%"></span>
              </div>
              <p data-xhs-import-status>未开始</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDouyinCookieModal(): string {
  return `
    <div class="settings-modal" data-douyin-cookie-modal hidden>
      <button type="button" class="settings-modal__backdrop" data-douyin-cookie-close aria-label="关闭抖音 Cookie 导入"></button>
      <div class="settings-modal__dialog settings-modal__dialog--xhs" role="dialog" aria-modal="true" aria-labelledby="settings-douyin-cookie-title">
        <div class="settings-modal__header">
          <h2 id="settings-douyin-cookie-title">抖音 Cookie 导入</h2>
          <button type="button" class="settings-modal__close" data-douyin-cookie-close aria-label="关闭">×</button>
        </div>
        <div class="settings-modal__body">
          <div class="settings-xhs-import">
            <label class="settings-field settings-field--wide">
              <span>cookie 填写地址</span>
              <div class="settings-xhs-import__cookie-row">
                <textarea data-douyin-cookie-input rows="4" placeholder="请粘贴抖音 Cookie"></textarea>
                <button type="button" class="btn btn-secondary" data-douyin-login-open>打开抖音登录</button>
                <button type="button" class="btn btn-secondary" data-douyin-cookie-import>一键导入抖音 Cookie</button>
                <button type="button" class="btn btn-primary" data-douyin-cookie-save>保存</button>
              </div>
            </label>
            <div class="settings-xhs-import__progress">
              <div class="settings-xhs-import__progress-row">
                <span>项目级 fallback</span>
                <strong data-douyin-cookie-light>未读取</strong>
              </div>
              <p data-douyin-cookie-status>未开始</p>
              <p data-douyin-cookie-path></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderShortcutSection(): string {
  return `
    <section class="settings-panel" data-settings-panel="shortcuts" hidden>
      ${renderShortcutPanel()}
    </section>
  `;
}

function renderVaultPanel(): string {
  return `
    <article class="settings-card settings-card--vault">
      <div class="settings-card__header"><div><div class="eyebrow">WORKSPACE</div><h2>&#x4ed3;&#x5e93;&#x4e0e;&#x540c;&#x6b65;</h2></div><span class="settings-card__badge">&#x672c;&#x5730;&#x6587;&#x4ef6;</span></div>
      <label class="settings-field"><span>&#x76ee;&#x6807;&#x4ed3;&#x5e93;</span><div class="settings-input-row"><input data-settings-target type="text" /><button type="button" class="btn btn-secondary" data-settings-choose-target>&#x9009;&#x62e9;</button></div></label>
      <div class="settings-field"><span>&#x540c;&#x6b65;&#x6e90;&#x6587;&#x4ef6;&#x5939;</span><div class="settings-source-toolbar"><p>&#x53ef;&#x6dfb;&#x52a0;&#x591a;&#x4e2a;&#x539f;&#x59cb;&#x8d44;&#x6599;&#x76ee;&#x5f55;&#x3002;</p><button type="button" class="btn btn-secondary" data-settings-add-source>&#x6dfb;&#x52a0;&#x6587;&#x4ef6;&#x5939;</button></div><ul class="settings-source-list" data-settings-sources></ul></div>
    </article>
  `;
}

function renderYtDlpPanel(): string {
  return `
    <article class="settings-card settings-card--yt-dlp">
      <div class="settings-card__header">
        <div><div class="eyebrow">LINK CLIPPING</div><h2>yt-dlp</h2></div>
        <span class="settings-card__badge" data-yt-dlp-light>&#x672a;&#x68c0;&#x6d4b;</span>
      </div>
      <p data-yt-dlp-status>&#x8fdb;&#x5165;&#x4ed3;&#x5e93;&#x4e0e;&#x540c;&#x6b65;&#x540e;&#x68c0;&#x6d4b; yt-dlp&#x3002;</p>
      <div class="settings-run-panel__actions">
        <button type="button" class="btn btn-secondary" data-yt-dlp-refresh>&#x68c0;&#x6d4b;</button>
        <button type="button" class="btn btn-secondary" data-yt-dlp-install>&#x5b89;&#x88c5;&#x5230;&#x9879;&#x76ee;</button>
      </div>
    </article>
  `;
}

function renderXhsSyncPanel(): string {
  return `
    <article class="settings-card settings-card--xhs-sync" data-xhs-sync-card>
      <div class="settings-card__header">
        <div><div class="eyebrow">LINK CLIPPING</div><h2>小红书同步</h2></div>
        <span class="settings-card__badge">rednote-to-obsidian</span>
      </div>
      <p data-xhs-sync-status>识别到小红书链接后，会优先走小红书专用流程；失败会写入审查页。</p>
      <label class="settings-field settings-field--wide">
        <span>链接 / 链接列表</span>
        <textarea data-xhs-sync-input rows="4" placeholder="粘贴单个小红书链接，或多行链接"></textarea>
      </label>
      <div class="settings-run-panel__actions">
        <button type="button" class="btn btn-secondary" data-xhs-extract>提取单个帖子</button>
        <button type="button" class="btn btn-secondary" data-xhs-batch>批量提取多个帖子</button>
        <button type="button" class="btn btn-secondary" data-xhs-refresh>刷新</button>
      </div>
      <div class="settings-run-panel">
        <div class="settings-run-panel__row"><span>提取进度</span><strong data-xhs-extract-meta>0 / 0</strong></div>
        <div class="settings-run-panel__bar"><span data-xhs-extract-progress style="width:0%"></span></div>
      </div>
    </article>
  `;
}

function renderShortcutPanel(): string {
  const rows = SETTINGS_SHORTCUTS.map(renderShortcutRow).join("");
  return `
    <article class="settings-card settings-card--shortcuts">
      <div class="settings-card__header"><div><div class="eyebrow">SHORTCUTS</div><h2>&#x5feb;&#x6377;&#x952e;</h2></div><span class="settings-card__badge">&#x53ef;&#x7f16;&#x8f91;</span></div>
      ${rows}
      <p class="settings-shortcut-status" data-shortcut-status></p>
    </article>
  `;
}

function renderShortcutRow(shortcut: ShortcutDefinition): string {
  return `
    <div class="settings-shortcut-row">
      <div class="settings-shortcut-row__copy"><strong>${escapeHtml(shortcut.title)}</strong><span>${escapeHtml(shortcut.description)}</span></div>
      <div class="settings-shortcut-row__control"><input data-shortcut-id="${shortcut.id}" type="text" value="${escapeHtml(DEFAULT_SHORTCUTS[shortcut.id])}" readonly /><button type="button" class="btn btn-secondary" data-shortcut-save="${shortcut.id}">&#x4fdd;&#x5b58;&#x5feb;&#x6377;&#x952e;</button></div>
    </div>
  `;
}

function renderCloudSyncCard(): string {
  return `
    <article class="settings-card settings-card--cloud-sync">
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">REMOTE BRAIN</div>
          <h2>&#x540c;&#x6b65;&#x7ed3;&#x679c;</h2>
        </div>
      </div>
      <p>&#x5168;&#x5c40;&#x5bfc;&#x822a;&#x680f;&#x91cc;&#x70b9;&#x51fb;&#x201c;&#x540c;&#x6b65;&#x201d;&#x540e;&#xff0c;&#x8fd0;&#x884c;&#x8fdb;&#x5ea6;&#x3001;&#x6700;&#x65b0;&#x65e5;&#x5fd7;&#x548c;&#x7ed3;&#x679c;&#x4f1a;&#x76f4;&#x63a5;&#x843d;&#x5230;&#x8fd9;&#x91cc;&#x3002;</p>
      <div class="settings-run-panel" data-sync-run-panel>
        <div class="settings-run-panel__row">
          <span>&#x540c;&#x6b65;&#x72b6;&#x6001;</span>
          <strong data-sync-run-status>&#x5f85;&#x8fd0;&#x884c;</strong>
        </div>
        <div class="settings-run-panel__meta" data-sync-run-meta>&#x8fd8;&#x6ca1;&#x6709;&#x8fd0;&#x884c;&#x4e2d;&#x7684;&#x540c;&#x6b65;&#x4efb;&#x52a1;&#x3002;</div>
        <div class="settings-run-panel__bar"><span data-sync-run-progress style="width:0%"></span></div>
        <div class="settings-run-panel__summary" data-sync-run-summary>
          <span class="settings-run-panel__chip">&#x672a;&#x542f;&#x52a8;</span>
        </div>
        <pre class="settings-run-panel__log" data-sync-run-log>&#x6682;&#x65e0;&#x8fd0;&#x884c;&#x8f93;&#x51fa;</pre>
        <div class="settings-run-panel__actions">
          <button type="button" class="btn btn-secondary" data-sync-run-pause disabled>&#x6682;&#x505c;</button>
          <button type="button" class="btn btn-secondary" data-sync-run-cancel disabled>&#x53d6;&#x6d88;</button>
          <button type="button" class="btn btn-secondary" data-sync-run-refresh>&#x5237;&#x65b0;</button>
        </div>
      </div>
    </article>
  `;
}

function renderCompileRunCard(): string {
  return `
    <article class="settings-card settings-card--cloud-sync">
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">COMPILE</div>
          <h2>&#x7f16;&#x8bd1;&#x60c5;&#x51b5;</h2>
        </div>
      </div>
      <p>&#x8fd9;&#x91cc;&#x53ea;&#x805a;&#x7126; compile \u9636\u6bb5\uff0c\u663e;&#x793a;&#x767e;&#x5206;&#x6bd4;&#x3001;&#x8fdb;&#x5ea6;&#x6761;&#x548c;&#x7f16;&#x8bd1;&#x65e5;&#x5fd7;&#x3002;</p>
      <div class="settings-run-panel" data-compile-run-panel>
        <div class="settings-run-panel__row">
          <span>&#x7f16;&#x8bd1;&#x72b6;&#x6001;</span>
          <strong data-compile-run-status>&#x5f85;&#x8fd0;&#x884c;</strong>
        </div>
        <div class="settings-run-panel__meta" data-compile-run-meta>&#x8fd8;&#x6ca1;&#x6709;&#x68c0;&#x6d4b;&#x5230; compile \u8fdb;&#x5ea6\u3002;</div>
        <div class="settings-run-panel__bar"><span data-compile-run-progress style="width:0%"></span></div>
        <div class="settings-run-panel__summary" data-compile-run-summary>
          <span class="settings-run-panel__chip">&#x672a;&#x542f;&#x52a8;</span>
        </div>
        <pre class="settings-run-panel__log" data-compile-run-log>&#x6682;&#x65e0;&#x7f16;&#x8bd1;&#x8f93;&#x51fa;</pre>
        <div class="settings-run-panel__actions">
          <button type="button" class="btn btn-secondary" data-compile-run-refresh>&#x5237;&#x65b0;</button>
        </div>
      </div>
    </article>
  `;
}

function bindSettingsPage(
  root: HTMLElement,
  initialSection: SettingsSection,
  routeState: SettingsPageRouteState,
): void {
  bindSettingsNavigation(root);
  bindWorkspaceSyncPanel(root);
  bindProviderCards(root);
  bindProviderStatusControls(root);
  bindSettingsSidebarResize(root);
  bindLegacySettingsControls(root);
  bindLlmProviderDraftControls(root);
  bindLlmProviderConfig(root);
  bindAgentConfigControls(root);
  bindSyncRunPanel(root);
  bindNetworkSearchPanel(root);
  bindPluginsPanel(root);
  selectSettingsSection(root, initialSection, routeState);
}

function bindLlmProviderDraftControls(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-llm-provider-preset-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openLlmProviderDialog(root, button.dataset.llmProviderPresetOpen);
    });
  });
  root.querySelector<HTMLButtonElement>("[data-llm-provider-add]")?.addEventListener("click", () => {
    openLlmProviderDialog(root);
    void hydrateLlmProviderDraftAccounts(root, true);
  });
  root.querySelector<HTMLSelectElement>("[data-llm-provider-field=\"preset\"]")?.addEventListener("change", () => {
    applyLlmProviderPreset(root, readLlmProviderField(root, "preset"), { overwriteId: false });
    clearLlmProviderOAuthDeviceCode(root);
    syncLlmProviderDraftMode(root, true);
    syncLlmProviderDraftModelDefault(root, { overwrite: true });
    syncLlmProviderModelSuggestions(root);
    maybeStartLlmProviderOAuthFromSelection(root);
  });
  root.querySelector<HTMLInputElement>("[data-llm-provider-field=\"baseUrl\"]")?.addEventListener("input", () => {
    syncLlmProviderDraftModelDefault(root, { overwrite: false });
  });
  root.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]")?.addEventListener("input", (event) => {
    delete (event.currentTarget as HTMLInputElement).dataset.llmProviderAutoModel;
  });
  root.querySelector<HTMLInputElement>("[data-llm-provider-field=\"id\"]")?.addEventListener("input", () => {
    syncLlmProviderDraftMode(root, false);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-llm-provider-close]").forEach((button) => {
    button.addEventListener("click", () => closeLlmProviderDialog(root));
  });
  root.querySelector<HTMLButtonElement>("[data-llm-provider-header-add]")?.addEventListener("click", () => {
    appendLlmProviderHeaderRow(root);
  });
  root.querySelector<HTMLButtonElement>("[data-llm-provider-oauth-copy]")?.addEventListener("click", () => {
    void copyLlmProviderOAuthDeviceCode(root);
  });
  root.querySelector<HTMLElement>("[data-llm-provider-model-suggestions]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-llm-provider-model-chip]");
    if (!button) return;
    writeLlmProviderField(root, "model", button.dataset.llmProviderModelChip ?? "");
    delete root.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]")?.dataset.llmProviderAutoModel;
  });
  root.querySelector<HTMLFormElement>("[data-llm-provider-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitLlmProviderDraft(root, event.currentTarget as HTMLFormElement);
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const collapseButton = target.closest<HTMLButtonElement>("[data-llm-provider-card-collapse]");
    if (collapseButton) {
      toggleLlmProviderCard(collapseButton);
      return;
    }
    const configureButton = target.closest<HTMLButtonElement>("[data-llm-provider-card-configure]");
    if (configureButton) {
      configureLlmProviderCard(root, configureButton);
      return;
    }
    const startButton = target.closest<HTMLButtonElement>("[data-llm-provider-card-start]");
    if (startButton) {
      void startLlmProviderCard(root, startButton);
      return;
    }
    const removeButton = target.closest<HTMLButtonElement>("[data-llm-provider-card-remove], [data-llm-provider-card-disconnect]");
    if (removeButton) {
      void removeLlmProviderCard(root, removeButton);
      return;
    }
    const addChatButton = target.closest<HTMLButtonElement>("[data-llm-provider-add-chat]");
    if (addChatButton) {
      void createLlmProviderChatApp(root, addChatButton);
      return;
    }
    const chatAppButton = target.closest<HTMLButtonElement>("[data-llm-provider-chat-app]");
    if (chatAppButton) {
      openLlmProviderChatApp(root, chatAppButton);
    }
  });
  syncLlmProviderModelSuggestions(root);
  void hydrateLlmProviderDraftAccounts(root, false);
}

function openLlmProviderDialog(root: HTMLElement, presetLabel?: string): void {
  const dialog = root.querySelector<HTMLElement>("[data-llm-provider-dialog]");
  if (!dialog) return;
  clearLlmProviderOAuthDeviceCode(root);
  if (presetLabel) {
    resetLlmProviderDraft(root);
    applyLlmProviderPreset(root, presetLabel, { overwriteId: true });
  }
  syncLlmProviderDraftMode(root, false);
  syncLlmProviderDraftModelDefault(root, { overwrite: false });
  syncLlmProviderModelSuggestions(root);
  dialog.hidden = false;
  root.querySelector<HTMLInputElement>("[data-llm-provider-field=\"id\"]")?.focus();
}

function closeLlmProviderDialog(root: HTMLElement): void {
  const dialog = root.querySelector<HTMLElement>("[data-llm-provider-dialog]");
  if (dialog) dialog.hidden = true;
}

function appendLlmProviderHeaderRow(root: HTMLElement): void {
  const headers = root.querySelector<HTMLElement>("[data-llm-provider-headers]");
  headers?.insertAdjacentHTML("beforeend", `
    <div class="settings-provider-dialog__header-row">
      <input type="text" placeholder="Header" />
      <input type="text" placeholder="Value" />
    </div>
  `);
}

function resetLlmProviderDraft(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  if (!form) return;
  form.reset();
  delete form.dataset.llmProviderExistingId;
  delete form.dataset.llmProviderExistingName;
  delete form.dataset.llmProviderExistingProvider;
  delete form.dataset.llmProviderExistingModel;
  const headers = form.querySelector<HTMLElement>("[data-llm-provider-headers]");
  if (headers) headers.innerHTML = "";
}

function applyLlmProviderPreset(root: HTMLElement, label: string, options: { overwriteId: boolean }): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  const preset = LLM_PROVIDER_PRESET_BY_LABEL[label];
  if (!form || !preset) return;
  writeLlmProviderField(form, "preset", preset.label);
  writeLlmProviderField(form, "apiType", preset.apiType);
  writeLlmProviderField(form, "baseUrl", preset.baseUrl);
  writeLlmProviderField(form, "model", preset.defaultModel);
  const model = form.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]");
  if (model) model.dataset.llmProviderAutoModel = "true";
  if (options.overwriteId && preset.label !== "Custom") {
    writeLlmProviderField(form, "id", preset.label);
  }
  setLlmProviderDraftStatus(root, `${preset.label} 已套用：${preset.hint}`);
}

function syncLlmProviderDraftMode(root: HTMLElement, showHint: boolean): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  if (!form) return;
  const isOAuth = isLlmProviderOAuthDraft(form);
  setLlmProviderApiRowsHidden(form, isOAuth);
  const submit = form.querySelector<HTMLButtonElement>("[data-llm-provider-submit]");
  if (submit) submit.textContent = isOAuth ? "授权并添加" : "添加";
  form.toggleAttribute("data-llm-provider-oauth-mode", isOAuth);
  if (!isOAuth) clearLlmProviderOAuthDeviceCode(root);
  if (!showHint || !isOAuth) return;
  const provider = oauthProviderFromPreset(readLlmProviderField(form, "preset"));
  setLlmProviderDraftStatus(
    root,
    provider
      ? "OAuth 会打开浏览器认证；认证成功后会自动新增 provider。"
      : "这个 OAuth provider 后端暂未支持。",
  );
}

function setLlmProviderApiRowsHidden(form: HTMLElement, hidden: boolean): void {
  ["apiType", "apiKey", "baseUrl", "model", "noStainless", "transport"].forEach((field) => {
    const row = form
      .querySelector<HTMLElement>(`[data-llm-provider-field="${field}"]`)
      ?.closest<HTMLElement>(".settings-provider-dialog__row");
    if (row) row.hidden = hidden;
  });
  const headerButtonRow = form
    .querySelector<HTMLElement>("[data-llm-provider-header-add]")
    ?.closest<HTMLElement>(".settings-provider-dialog__row");
  if (headerButtonRow) headerButtonRow.hidden = hidden;
  const headers = form.querySelector<HTMLElement>("[data-llm-provider-headers]");
  if (headers) headers.hidden = hidden;
}

function syncLlmProviderDraftModelDefault(root: HTMLElement, options: { overwrite: boolean }): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  const model = form?.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]");
  if (!form || !model) return;
  if (!options.overwrite && model.value.trim() && model.dataset.llmProviderAutoModel !== "true") return;
  model.value = modelForLlmProviderDraft(form, resolveLlmProviderDraftProvider(form));
  model.dataset.llmProviderAutoModel = "true";
}

function syncLlmProviderModelSuggestions(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  const container = form?.querySelector<HTMLElement>("[data-llm-provider-model-suggestions]");
  if (!form || !container) return;
  const preset = LLM_PROVIDER_PRESET_BY_LABEL[readLlmProviderField(form, "preset")];
  const provider = resolveLlmProviderDraftProvider(form);
  const models = preset?.suggestedModels.length ? preset.suggestedModels : MODEL_OPTIONS_BY_PROVIDER[provider] ?? [];
  container.innerHTML = models.map(renderLlmProviderModelChip).join("");
}

function renderLlmProviderModelChip(model: string): string {
  return `<button type="button" data-llm-provider-model-chip="${escapeHtml(model)}">${escapeHtml(model)}</button>`;
}

function maybeStartLlmProviderOAuthFromSelection(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  if (!form || !isLlmProviderOAuthDraft(form)) return;
  if (form.dataset.llmProviderSubmitting === "true") return;
  const hasDisplayId = Boolean(readLlmProviderField(form, "id"));
  const provider = oauthProviderFromPreset(readLlmProviderField(form, "preset"));
  if (!hasDisplayId || !provider) return;
  void submitLlmProviderDraft(root, form);
}

async function hydrateLlmProviderDraftAccounts(root: HTMLElement, prefill: boolean): Promise<void> {
  if (typeof fetch !== "function") return;
  let accounts: LlmApiAccountResponse[] = [];
  let oauthAccounts: readonly LlmProviderOAuthAccountResponse[] = [];
  let cloudflareProvider: LlmCloudflareProviderResponse | null = null;
  try {
    const response = await fetch("/api/llm/accounts");
    const payload = await readJsonPayload<{ success?: boolean; data?: LlmApiAccountsResponse }>(response);
    accounts = response.ok && payload.success && Array.isArray(payload.data?.accounts) ? payload.data.accounts : [];
  } catch {
    accounts = [];
  }
  oauthAccounts = [
    ...await loadOptionalAccountCodexOAuthAccounts(),
    ...await loadOptionalCliProxyOAuthAccounts(),
  ];
  cloudflareProvider = await loadOptionalCloudflareProvider();
  llmAccountsState.set(root, accounts);
  llmOAuthAccountsState.set(root, oauthAccounts);
  llmCloudflareProviderState.set(root, cloudflareProvider);
  renderLlmProviderCards(root, accounts, oauthAccounts, cloudflareProvider);
  if (prefill) prefillLlmProviderDraft(root, accounts[0]);
}

async function loadOptionalCloudflareProvider(): Promise<LlmCloudflareProviderResponse | null> {
  try {
    const response = await fetch("/api/llm/cloudflare-provider");
    const payload = await readJsonPayload<{ success?: boolean; data?: LlmCloudflareProviderResponse }>(response);
    if (!response.ok || !payload.success || !payload.data?.accountRef) return null;
    return payload.data;
  } catch {
    return null;
  }
}

function renderLlmProviderDraftCount(root: HTMLElement, count: number): void {
  setOptionalText(root.querySelector("[data-llm-provider-count]"), `已添加 ${count} 个提供商`);
}

function renderLlmProviderCards(
  root: HTMLElement,
  accounts: readonly LlmApiAccountResponse[],
  oauthAccounts: readonly LlmProviderOAuthAccountResponse[],
  cloudflareProvider: LlmCloudflareProviderResponse | null,
): void {
  const apiAccounts = Array.isArray(accounts) ? accounts : [];
  const oauthProviderAccounts = Array.isArray(oauthAccounts) ? oauthAccounts : [];
  const apps = appConfigState.get(root)?.apps ?? [];
  const cards = [
    ...apiAccounts.map((account) => toApiProviderCardView(account, apps)),
    ...oauthProviderAccounts.map((account) => toOAuthProviderCardView(account, apps)),
    ...(cloudflareProvider?.configured
      ? [toCloudflareProviderCardView(cloudflareProvider, apps)]
      : []),
  ];
  renderLlmProviderDraftCount(root, cards.length);
  const list = root.querySelector<HTMLElement>("[data-llm-provider-list]");
  if (!list) return;
  list.innerHTML = cards.map(renderLlmProviderCard).join("");
}

function toApiProviderCardView(account: LlmApiAccountResponse, apps: readonly AppDefinitionResponse[]): LlmProviderCardView {
  const accountRef = `api:${account.id}`;
  const title = presetLabelFromApiAccount(account);
  return {
    accountRef,
    accountName: account.name,
    displayId: readLlmProviderDisplayLabel(accountRef, account.name),
    provider: account.provider,
    source: "api",
    enabled: account.enabled !== false,
    title,
    connectionText: account.keyConfigured
      ? `${account.enabled === false ? "已停用" : "已连接"} · ${readHost(account.url) ?? account.url}`
      : "已保存 · 未配置密钥",
    description: `${title} 支持流式传输；自动模式会在可用请求通道之间选择。`,
    model: account.model,
    apps: apps.filter((app) => app.accountRef === accountRef),
    embeddingModels: [],
    canManage: true,
  };
}

function toOAuthProviderCardView(
  account: LlmProviderOAuthAccountResponse,
  apps: readonly AppDefinitionResponse[],
): LlmProviderCardView {
  const accountRef = account.accountRef ?? `oauth:${account.provider}:${account.name}`;
  const title = oauthTitleFromProvider(account.provider);
  return {
    accountRef,
    accountName: account.name,
    displayId: readLlmProviderDisplayLabel(accountRef, account.email ?? account.name),
    provider: providerFromOAuthAccount(account.provider),
    source: "oauth",
    enabled: account.enabled !== false,
    title,
    connectionText: account.enabled === false
      ? `已停用 · ${account.email ?? account.authIndex ?? account.name}`
      : account.connectionText ?? `已连接 · ${account.authIndex ?? account.name}`,
    description: `${title} 支持流式传输；使用 Obsidian requestUrl 时会退化为缓冲输出，桌面端 Node fetch 可提供实时流式。`,
    model: "",
    apps: apps.filter((app) => app.accountRef === accountRef),
    embeddingModels: [],
    canManage: true,
  };
}

function toCloudflareProviderCardView(
  provider: LlmCloudflareProviderResponse,
  apps: readonly AppDefinitionResponse[],
): LlmProviderCardView {
  const endpoint = provider.endpoint ? readHost(provider.endpoint) ?? provider.endpoint : "Cloudflare Workers AI";
  return {
    accountRef: provider.accountRef,
    accountName: "cloudflare-workers-ai",
    displayId: "Cloudflare Workers AI",
    provider: "cloudflare",
    source: "cloudflare",
    enabled: true,
    title: "Cloudflare Workers AI",
    connectionText: `已配置 · ${endpoint}`,
    description: provider.runtime === "worker"
      ? "通过 Cloudflare Worker /embed 接入嵌入模型；token 只保存在本地环境变量中。"
      : "通过 Cloudflare Workers AI REST 接入嵌入模型；API token 只保存在本地环境变量中。",
    model: provider.aiModel ?? "",
    apps: apps.filter((app) => app.accountRef === provider.accountRef),
    embeddingModels: provider.embeddingModels,
    canManage: false,
  };
}

function renderLlmProviderCard(card: LlmProviderCardView): string {
  const tools = renderLlmProviderCardTools(card);
  const toplineActions = renderLlmProviderCardToplineActions(card);
  return `
    <section
      class="settings-llm-provider-item"
      data-llm-provider-card="${escapeHtml(card.accountRef)}"
      data-llm-provider-source="${escapeHtml(card.source)}"
      data-llm-provider-provider="${escapeHtml(card.provider)}"
      data-llm-provider-account-name="${escapeHtml(card.accountName)}"
      data-llm-provider-model="${escapeHtml(card.model)}"
      data-llm-provider-display-id="${escapeHtml(card.displayId)}"
      data-llm-provider-enabled="${card.enabled ? "true" : "false"}"
    >
      <div class="settings-llm-provider-item__header">
        <div class="settings-llm-provider-item__title">
          <span class="settings-llm-provider-item__grip" aria-hidden="true">⠿</span>
          <button type="button" class="settings-llm-provider-item__chevron" data-llm-provider-card-collapse aria-expanded="false" aria-label="展开或收起 provider">›</button>
          <strong data-llm-provider-card-id>${escapeHtml(card.displayId)}</strong>
        </div>
        <div class="settings-llm-provider-item__tools">${tools}</div>
      </div>
      <div class="settings-llm-provider-item__body" data-llm-provider-card-body hidden>
        <div class="settings-llm-provider-item__topline">
          <h3>${escapeHtml(card.title)}</h3>
          ${toplineActions}
        </div>
        <p class="settings-llm-provider-item__connection">${escapeHtml(card.connectionText)}</p>
        <p class="settings-llm-provider-item__description">${escapeHtml(card.description)}</p>
        ${renderLlmProviderChatAppsSection(card)}
        ${renderLlmProviderEmbeddingSection(card)}
      </div>
    </section>
  `;
}

function renderLlmProviderCardTools(card: LlmProviderCardView): string {
  return [
    `<span class="settings-llm-provider-item__pill">${card.apps.length} 聊天模型 · ${card.embeddingModels.length} 嵌入模型</span>`,
    card.enabled ? "" : `<span class="settings-llm-provider-item__pill">已停用</span>`,
    card.canManage ? `<button type="button" class="btn btn-secondary btn-inline" data-llm-provider-card-start>启动</button>` : "",
    card.canManage ? `<button type="button" data-llm-provider-card-configure aria-label="配置 provider">${renderIcon("settings", { size: 22 })}</button>` : "",
    card.canManage ? `<button type="button" data-llm-provider-card-remove aria-label="删除 provider">⌫</button>` : "",
  ].join("");
}

function renderLlmProviderCardToplineActions(card: LlmProviderCardView): string {
  if (!card.canManage) return "";
  return [
    `<button type="button" class="btn btn-secondary btn-inline" data-llm-provider-card-start>启动 provider</button>`,
    `<button type="button" class="btn btn-secondary btn-inline" data-llm-provider-card-disconnect>删除 provider</button>`,
  ].join("");
}

function renderLlmProviderChatAppsSection(card: LlmProviderCardView): string {
  return `
    <div class="settings-llm-provider-models">
      <div class="settings-llm-provider-models__header">
        <h4>聊天模型</h4>
        <button type="button" class="btn btn-secondary btn-inline" data-llm-provider-add-chat>+ 添加聊天模型</button>
      </div>
      ${card.apps.length > 0
        ? `<div class="settings-llm-provider-apps">${card.apps.map(renderLlmProviderChatApp).join("")}</div>`
        : `<p>未配置聊天模型</p>`}
    </div>
  `;
}

function renderLlmProviderChatApp(app: AppDefinitionResponse): string {
  return `
    <button type="button" class="settings-llm-provider-app" data-llm-provider-chat-app="${escapeHtml(app.id)}">
      <strong>${escapeHtml(app.name)}</strong>
      <small>${escapeHtml([app.model, formatAppModeLabel(app.mode), app.enabled ? "已启用" : "已停用"].filter(Boolean).join(" · "))}</small>
    </button>
  `;
}

function renderLlmProviderEmbeddingSection(card: LlmProviderCardView): string {
  return `
    <div class="settings-llm-provider-models">
      <div class="settings-llm-provider-models__header">
        <h4>嵌入模型</h4>
      </div>
      ${card.embeddingModels.length > 0
        ? `<div class="settings-llm-provider-embeddings">${card.embeddingModels.map(renderLlmProviderEmbeddingModel).join("")}</div>`
        : `<p>未配置嵌入模型</p>`}
    </div>
  `;
}

function renderLlmProviderEmbeddingModel(model: string): string {
  return `
    <div class="settings-llm-provider-embedding">
      <strong>${escapeHtml(model)}</strong>
      <small>可用 · Cloudflare Workers AI</small>
    </div>
  `;
}

function toggleLlmProviderCard(button: HTMLButtonElement): void {
  const card = button.closest<HTMLElement>("[data-llm-provider-card]");
  const body = card?.querySelector<HTMLElement>("[data-llm-provider-card-body]");
  if (!body) return;
  body.hidden = !body.hidden;
  button.setAttribute("aria-expanded", body.hidden ? "false" : "true");
  button.textContent = body.hidden ? "›" : "⌄";
}

function configureLlmProviderCard(root: HTMLElement, button: HTMLButtonElement): void {
  const card = button.closest<HTMLElement>("[data-llm-provider-card]");
  if (!card) return;
  const accountRef = card.dataset.llmProviderCard ?? "";
  if (accountRef.startsWith("api:")) {
    const account = findApiAccountByRef(root, accountRef);
    if (!account) return;
    openLlmProviderDialog(root);
    prefillLlmProviderDraft(root, account, true);
    return;
  }
  openLlmProviderDialog(root);
  writeLlmProviderField(root, "id", card.dataset.llmProviderDisplayId ?? "");
  writeLlmProviderField(root, "preset", oauthPresetFromAccountRef(accountRef));
  setLlmProviderDraftStatus(root, "OAuth provider 会重新授权并更新显示 ID。");
}

async function removeLlmProviderCard(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const card = button.closest<HTMLElement>("[data-llm-provider-card]");
  if (!card) return;
  const accountRef = card.dataset.llmProviderCard ?? "";
  setLlmProviderListStatus(root, "正在删除 provider...");
  try {
    if (accountRef.startsWith("api:")) {
      await deleteLlmProviderApiAccount(accountRef);
    } else {
      await deleteLlmProviderOAuthAccount(card);
    }
    removeLlmProviderDisplayLabel(accountRef);
    await hydrateLlmProviderDraftAccounts(root, false);
    setLlmProviderListStatus(root, "Provider 已删除。");
  } catch (error) {
    setLlmProviderListStatus(root, readErrorMessage(error));
  }
}

async function startLlmProviderCard(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const card = button.closest<HTMLElement>("[data-llm-provider-card]");
  if (!card) return;
  const accountRef = card.dataset.llmProviderCard ?? "";
  setLlmProviderListStatus(root, "正在启动 provider...");
  try {
    if (accountRef.startsWith("api:")) {
      await startLlmProviderApiAccount(accountRef);
    } else {
      await setLlmProviderOAuthAccountEnabled(card, true);
      await saveLlmProviderDefaultAccount(accountRef);
    }
    await hydrateLlmProviderDraftAccounts(root, false);
    setLlmProviderListStatus(root, "Provider 已启动。");
  } catch (error) {
    setLlmProviderListStatus(root, readErrorMessage(error));
  }
}

async function createLlmProviderChatApp(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const card = button.closest<HTMLElement>("[data-llm-provider-card]");
  if (!card) return;
  await ensureAgentConfigLoaded(root);
  const config = appConfigState.get(root) ?? { apps: [], defaultAppId: null };
  const agent = createClientAgent();
  agent.name = `${card.dataset.llmProviderDisplayId ?? "Provider"} 聊天`;
  agent.purpose = "聊天模型";
  agent.provider = card.dataset.llmProviderProvider ?? "openai";
  agent.accountRef = card.dataset.llmProviderCard ?? "";
  agent.model = card.dataset.llmProviderModel ?? "";
  config.apps = [...config.apps, agent];
  config.defaultAppId = agent.id;
  renderAgentConfig(root, config);
  openAgentConfigModal(root, agent.id);
  setAgentConfigStatus(root, "聊天模型应用已创建，请保存后生效。");
  rerenderLlmProviderCards(root);
}

function openLlmProviderChatApp(root: HTMLElement, button: HTMLButtonElement): void {
  const appId = button.dataset.llmProviderChatApp;
  if (!appId) return;
  const config = appConfigState.get(root);
  if (config) {
    config.defaultAppId = appId;
    renderAgentConfig(root, config);
  }
  openAgentConfigModal(root, appId);
}

async function ensureAgentConfigLoaded(root: HTMLElement): Promise<void> {
  if (appConfigState.has(root)) return;
  await hydrateAgentConfig(root);
  await hydrateAgentAccountOptions(root);
}

function findApiAccountByRef(root: HTMLElement, accountRef: string): LlmApiAccountResponse | undefined {
  const accountId = accountRef.startsWith("api:") ? accountRef.slice(4) : accountRef;
  return (llmAccountsState.get(root) ?? []).find((account) => account.id === accountId);
}

async function deleteLlmProviderApiAccount(accountRef: string): Promise<void> {
  const response = await fetch("/api/llm/accounts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: accountRef.slice(4) }),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Provider 删除失败");
  }
}

async function startLlmProviderApiAccount(accountRef: string): Promise<void> {
  const response = await fetch("/api/llm/accounts/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: accountRef.slice(4) }),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Provider 启动失败");
  }
}

async function deleteLlmProviderOAuthAccount(card: HTMLElement): Promise<void> {
  const accountName = card.dataset.llmProviderAccountName;
  if (!accountName) throw new Error("OAuth 账号名称缺失。");
  const response = await fetch("/api/cliproxy/accounts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: accountName }),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "OAuth 账号删除失败");
  }
}

async function setLlmProviderOAuthAccountEnabled(card: HTMLElement, enabled: boolean): Promise<void> {
  const accountName = card.dataset.llmProviderAccountName;
  if (!accountName) throw new Error("OAuth 账号名称缺失。");
  const response = await fetch("/api/cliproxy/accounts/enabled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: accountName, enabled }),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? (enabled ? "OAuth 账号启用失败" : "OAuth 账号断开失败"));
  }
}

function rerenderLlmProviderCards(root: HTMLElement): void {
  renderLlmProviderCards(
    root,
    llmAccountsState.get(root) ?? [],
    llmOAuthAccountsState.get(root) ?? [],
    llmCloudflareProviderState.get(root) ?? null,
  );
}

function prefillLlmProviderDraft(root: HTMLElement, account?: LlmApiAccountResponse, force = false): void {
  const form = root.querySelector<HTMLFormElement>("[data-llm-provider-form]");
  if (!form || !account || (!force && !isLlmProviderDraftEmpty(form))) return;
  form.dataset.llmProviderExistingId = account.id;
  form.dataset.llmProviderExistingName = account.name;
  form.dataset.llmProviderExistingProvider = account.provider;
  form.dataset.llmProviderExistingModel = account.model;
  writeLlmProviderField(form, "id", account.name);
  writeLlmProviderField(form, "preset", presetFromSavedProvider(account.provider));
  writeLlmProviderField(form, "apiType", apiTypeFromSavedProvider(account.provider));
  writeLlmProviderField(form, "baseUrl", account.url);
  writeLlmProviderField(form, "model", account.model);
  delete form.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]")?.dataset.llmProviderAutoModel;
  const suffix = account.keyConfigured ? "，已保存的密钥会继续沿用" : "";
  setLlmProviderDraftStatus(root, `已载入旧账号：${account.name}${suffix}。`);
}

function isLlmProviderDraftEmpty(form: HTMLElement): boolean {
  return !readLlmProviderField(form, "id") && !readLlmProviderField(form, "baseUrl");
}

async function submitLlmProviderDraft(root: HTMLElement, form: HTMLFormElement): Promise<void> {
  if (form.dataset.llmProviderSubmitting === "true") return;
  form.dataset.llmProviderSubmitting = "true";
  const button = root.querySelector<HTMLButtonElement>("[data-llm-provider-submit]");
  if (button) button.disabled = true;
  setLlmProviderDraftStatus(root, "正在处理提供商...");
  try {
    if (isLlmProviderOAuthDraft(form)) {
      await submitLlmProviderOAuthDraft(root, form);
    } else {
      await submitLlmProviderApiDraft(root, form);
    }
  } catch (error) {
    setLlmProviderDraftStatus(root, readErrorMessage(error));
  } finally {
    delete form.dataset.llmProviderSubmitting;
    if (button) button.disabled = false;
  }
}

async function submitLlmProviderApiDraft(root: HTMLElement, form: HTMLFormElement): Promise<void> {
  const input = readLlmProviderApiDraft(form);
  const account = await saveLlmProviderDraftAccount(input);
  writeLlmProviderDisplayLabel(`api:${account.id}`, input.name);
  await saveLlmProviderDefaultAccount(`api:${account.id}`);
  const test = await testLlmProviderDefaultAccount(`api:${account.id}`);
  await hydrateLlmProviderDraftAccounts(root, false);
  const prefix = test.ok ? "已保存并验证成功" : "已保存，但验证失败";
  setLlmProviderDraftStatus(root, `${prefix}：${test.message}`);
}

async function submitLlmProviderOAuthDraft(root: HTMLElement, form: HTMLFormElement): Promise<void> {
  const displayId = readRequiredControlValue(
    form.querySelector<HTMLInputElement>("[data-llm-provider-field=\"id\"]"),
    "请填写 provider ID。",
  );
  const oauthProvider = oauthProviderFromPreset(readLlmProviderField(form, "preset"));
  if (!oauthProvider) throw new Error("这个 OAuth provider 后端暂未支持。");
  const flow = await requestLlmProviderOAuth(root, oauthProvider);
  await waitForLlmProviderOAuth(root, oauthProvider, flow);
  const account = await findLlmProviderOAuthAccount(oauthProvider);
  const accountRef = account.accountRef ?? `oauth:${account.provider}:${account.name}`;
  writeLlmProviderDisplayLabel(accountRef, displayId);
  await saveLlmProviderDefaultAccount(accountRef);
  await hydrateLlmProviderDraftAccounts(root, false);
  const test = await tryTestLlmProviderDefaultAccount(accountRef);
  const providerName = formatCLIProxyProvider(oauthProvider);
  const prefix = test.ok ? `${providerName} OAuth 已接入并验证可用` : `${providerName} OAuth 已接入，但连通测试失败`;
  setLlmProviderDraftStatus(root, `${prefix}：${test.message}`);
}

function readLlmProviderApiDraft(form: HTMLFormElement): LlmProviderDraftInput {
  const name = readRequiredControlValue(
    form.querySelector<HTMLInputElement>("[data-llm-provider-field=\"id\"]"),
    "请填写 provider ID。",
  );
  const provider = resolveLlmProviderDraftProvider(form);
  const existingId = existingLlmProviderAccountId(form, name);
  return {
    ...(existingId ? { id: existingId } : {}),
    name,
    provider,
    url: readLlmProviderField(form, "baseUrl"),
    key: readLlmProviderField(form, "apiKey"),
    model: readLlmProviderApiDraftModel(form, provider),
    enabled: true,
  };
}

function readLlmProviderApiDraftModel(form: HTMLFormElement, provider: string): string {
  const model = form.querySelector<HTMLInputElement>("[data-llm-provider-field=\"model\"]");
  if (!model) return modelForLlmProviderDraft(form, provider);
  if (model.dataset.llmProviderAutoModel === "true") {
    return modelForLlmProviderDraft(form, provider);
  }
  return model.value.trim() || modelForLlmProviderDraft(form, provider);
}

function existingLlmProviderAccountId(form: HTMLFormElement, name: string): string | undefined {
  return form.dataset.llmProviderExistingName === name ? form.dataset.llmProviderExistingId : undefined;
}

function isLlmProviderOAuthDraft(form: HTMLElement): boolean {
  return readLlmProviderField(form, "preset").includes("OAuth");
}

async function saveLlmProviderDraftAccount(input: LlmProviderDraftInput): Promise<LlmApiAccountResponse> {
  const response = await fetch("/api/llm/accounts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readSuccessData<LlmApiAccountResponse>(response, "Provider 保存失败");
}

async function saveLlmProviderDefaultAccount(accountRef: string): Promise<void> {
  const response = await fetch("/api/llm/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountRef }),
  });
  await readSuccessData<LlmProviderConfigResponse>(response, "默认账号保存失败");
}

async function testLlmProviderDefaultAccount(accountRef: string): Promise<LlmProviderTestResponse> {
  const response = await fetch("/api/llm/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountRef }),
  });
  return readSuccessData<LlmProviderTestResponse>(response, "Provider 连通测试失败");
}

async function tryTestLlmProviderDefaultAccount(accountRef: string): Promise<LlmProviderTestResponse> {
  try {
    return await testLlmProviderDefaultAccount(accountRef);
  } catch (error) {
    return {
      ok: false,
      provider: "oauth",
      endpoint: accountRef,
      message: readErrorMessage(error),
    };
  }
}

async function requestLlmProviderOAuth(root: HTMLElement, provider: string): Promise<LlmProviderOAuthFlow> {
  setLlmProviderDraftStatus(root, "正在创建 OAuth 登录链接...");
  if (provider === "codex") {
    return requestAccountLlmProviderOAuth(root);
  }
  const response = await fetch("/api/cliproxy/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const data = await readSuccessData<{ url: string; state: string }>(response, "OAuth 登录链接创建失败");
  await openLlmProviderOAuthUrl(data.url);
  setLlmProviderDraftStatus(root, `OAuth 已打开，等待 ${formatCLIProxyProvider(provider)} 登录完成...`);
  return { state: data.state, pollDelayMs: LLM_PROVIDER_OAUTH_POLL_DELAY_MS };
}

async function requestAccountLlmProviderOAuth(root: HTMLElement): Promise<LlmProviderOAuthFlow> {
  const response = await fetch("/api/account-ai/codex-oauth/start", { method: "POST" });
  const data = await readSuccessData<LlmProviderOAuthStartResponse>(response, "Worker OAuth 登录链接创建失败");
  await openLlmProviderOAuthUrl(data.url);
  showLlmProviderOAuthDeviceCode(root, data);
  const suffix = data.userCode ? "，授权码已同步到上方" : "";
  setLlmProviderDraftStatus(root, `OAuth 已打开${suffix}，授权完成后会自动接入。`);
  return {
    state: data.state,
    pollDelayMs: resolveLlmProviderOAuthPollDelayMs(data.pollIntervalSeconds),
  };
}

async function waitForLlmProviderOAuth(root: HTMLElement, provider: string, flow: LlmProviderOAuthFlow): Promise<void> {
  for (let attempt = 0; attempt < LLM_PROVIDER_OAUTH_POLL_ATTEMPTS; attempt += 1) {
    const status = provider === "codex"
      ? await readAccountLlmProviderOAuthStatus(flow.state)
      : await readLlmProviderOAuthStatus(flow.state);
    if (status.status === "ok") return;
    if (status.status === "error") throw new Error(status.error ?? "OAuth 登录失败");
    setLlmProviderDraftStatus(root, `等待 ${formatCLIProxyProvider(provider)} 登录完成...`);
    await delay(flow.pollDelayMs);
  }
  throw new Error("OAuth 登录超时，请重新点击添加。");
}

function resolveLlmProviderOAuthPollDelayMs(intervalSeconds: number | undefined): number {
  if (!Number.isFinite(intervalSeconds) || !intervalSeconds || intervalSeconds <= 0) {
    return LLM_PROVIDER_OAUTH_POLL_DELAY_MS;
  }
  return Math.max(LLM_PROVIDER_OAUTH_MIN_POLL_DELAY_MS, Math.round(intervalSeconds * 1000));
}

function showLlmProviderOAuthDeviceCode(root: HTMLElement, data: LlmProviderOAuthStartResponse): void {
  const panel = root.querySelector<HTMLElement>("[data-llm-provider-oauth-code]");
  if (!panel || !data.userCode) return;
  panel.hidden = false;
  setOptionalText(panel.querySelector("[data-llm-provider-oauth-user-code]"), data.userCode);
  const link = panel.querySelector<HTMLAnchorElement>("[data-llm-provider-oauth-link]");
  if (link) link.href = data.url;
}

function clearLlmProviderOAuthDeviceCode(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>("[data-llm-provider-oauth-code]");
  if (!panel) return;
  panel.hidden = true;
  setOptionalText(panel.querySelector("[data-llm-provider-oauth-user-code]"), "");
  const link = panel.querySelector<HTMLAnchorElement>("[data-llm-provider-oauth-link]");
  if (link) link.removeAttribute("href");
}

async function copyLlmProviderOAuthDeviceCode(root: HTMLElement): Promise<void> {
  const code = root.querySelector("[data-llm-provider-oauth-user-code]")?.textContent?.trim();
  if (!code) return;
  await navigator.clipboard?.writeText(code);
  setLlmProviderDraftStatus(root, "授权码已复制。");
}

async function readLlmProviderOAuthStatus(state: string): Promise<LlmProviderOAuthStatusResponse> {
  const response = await fetch(`/api/cliproxy/oauth/status?state=${encodeURIComponent(state)}`);
  return readSuccessData<LlmProviderOAuthStatusResponse>(response, "OAuth 状态读取失败");
}

async function readAccountLlmProviderOAuthStatus(state: string): Promise<LlmProviderOAuthStatusResponse> {
  const response = await fetch(`/api/account-ai/codex-oauth/status?state=${encodeURIComponent(state)}`);
  return readSuccessData<LlmProviderOAuthStatusResponse>(response, "Worker OAuth 状态读取失败");
}

async function findLlmProviderOAuthAccount(provider: string): Promise<LlmProviderOAuthAccountResponse> {
  if (provider === "codex") {
    const accounts = await loadOptionalAccountCodexOAuthAccounts();
    const account = accounts[0];
    if (!account) throw new Error("OAuth 已完成，但没有读取到 Worker 账号。");
    return account;
  }
  const accounts = await fetchCLIProxyOAuthAccounts(false);
  const account = accounts.find((item) => item.provider === provider);
  if (!account) throw new Error("OAuth 已完成，但没有读取到账号。");
  return account;
}

async function openLlmProviderOAuthUrl(url: string): Promise<void> {
  if (window.llmWikiDesktop?.openExternal) {
    await window.llmWikiDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function resolveLlmProviderDraftProvider(form: HTMLFormElement): string {
  const preset = readLlmProviderField(form, "preset");
  const apiType = readLlmProviderField(form, "apiType");
  const existingProvider = form.dataset.llmProviderExistingProvider;
  if (existingProvider && preset === presetFromSavedProvider(existingProvider)) {
    return existingProvider;
  }
  if (apiType === "Anthropic API") return "anthropic";
  if (apiType === "Gemini API") return "gemini";
  const presetProvider = providerFromLlmPreset(preset);
  return inferOpenAICompatibleProvider(form, presetProvider);
}

function inferOpenAICompatibleProvider(form: HTMLFormElement, presetProvider: string): string {
  if (presetProvider !== "openai" && presetProvider !== "custom") {
    return presetProvider;
  }
  return providerFromLlmBaseUrl(readLlmProviderField(form, "baseUrl")) ?? presetProvider;
}

// fallow-ignore-next-line complexity
function providerFromLlmPreset(preset: string): string {
  return LLM_PROVIDER_PRESET_BY_LABEL[preset]?.provider ?? PRESET_PROVIDER_BY_LABEL[preset] ?? "custom";
}

// fallow-ignore-next-line complexity
function providerFromLlmBaseUrl(value: string): string | null {
  const host = readHost(value)?.toLowerCase() ?? "";
  return PROVIDER_BY_HOST[host] ?? null;
}

function oauthProviderFromPreset(preset: string): string | null {
  if (preset === "ChatGPT OAuth") return "codex";
  if (preset === "Gemini OAuth") return "gemini-cli";
  return null;
}

function oauthPresetFromAccountRef(accountRef: string): string {
  if (accountRef.startsWith("oauth:gemini-cli:") || accountRef.startsWith("oauth:gemini:")) {
    return "Gemini OAuth";
  }
  return "ChatGPT OAuth";
}

function oauthTitleFromProvider(provider: string): string {
  if (provider === "codex") return "ChatGPT OAuth";
  if (provider === "gemini-cli" || provider === "gemini") return "Gemini OAuth";
  if (provider === "anthropic") return "Claude OAuth";
  if (provider === "kimi") return "Kimi OAuth";
  return `${formatCLIProxyProvider(provider)} OAuth`;
}

// fallow-ignore-next-line complexity
function presetFromSavedProvider(provider: string): string {
  return PRESET_LABEL_BY_PROVIDER[provider] ?? "OpenAI Compatible";
}

function presetLabelFromApiAccount(account: LlmApiAccountResponse): string {
  const urlPreset = LLM_PROVIDER_PRESETS.find((preset) => preset.baseUrl && sameProviderUrl(preset.baseUrl, account.url));
  return urlPreset?.label ?? presetFromSavedProvider(account.provider);
}

function sameProviderUrl(left: string, right: string): boolean {
  return left.replace(/\/+$/, "").toLowerCase() === right.replace(/\/+$/, "").toLowerCase();
}

function readLlmProviderDisplayLabel(accountRef: string, fallback: string): string {
  return readLlmProviderDisplayLabels()[accountRef] ?? fallback;
}

function writeLlmProviderDisplayLabel(accountRef: string, label: string): void {
  const labels = { ...readLlmProviderDisplayLabels(), [accountRef]: label };
  try {
    window.localStorage.setItem(LLM_PROVIDER_LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Display labels are non-critical metadata.
  }
}

function removeLlmProviderDisplayLabel(accountRef: string): void {
  const labels = { ...readLlmProviderDisplayLabels() };
  delete labels[accountRef];
  try {
    window.localStorage.setItem(LLM_PROVIDER_LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Display labels are non-critical metadata.
  }
}

function readLlmProviderDisplayLabels(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LLM_PROVIDER_LABELS_STORAGE_KEY) ?? "{}") as unknown;
    return isStringRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function apiTypeFromSavedProvider(provider: string): string {
  if (provider === "anthropic") return "Anthropic API";
  if (provider === "gemini") return "Gemini API";
  if (provider === "minimax") return "Anthropic API";
  return "OpenAI Compatible";
}

function modelForLlmProviderDraft(form: HTMLFormElement, provider: string): string {
  if (form.dataset.llmProviderExistingProvider === provider && form.dataset.llmProviderExistingModel) {
    return form.dataset.llmProviderExistingModel;
  }
  const preset = LLM_PROVIDER_PRESET_BY_LABEL[readLlmProviderField(form, "preset")];
  if (preset && preset.label !== "Custom" && preset.provider === provider) return preset.defaultModel;
  return MODEL_OPTIONS_BY_PROVIDER[provider]?.[0] ?? MODEL_OPTIONS_BY_PROVIDER.custom[0] ?? "gpt-4o";
}

function readLlmProviderField(root: HTMLElement, field: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-llm-provider-field="${field}"]`)?.value.trim() ?? "";
}

function writeLlmProviderField(root: HTMLElement, field: string, value: string): void {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-llm-provider-field="${field}"]`);
  if (control) control.value = value;
}

function setLlmProviderDraftStatus(root: HTMLElement, text: string): void {
  setOptionalText(root.querySelector("[data-llm-provider-status]"), text);
}

function setLlmProviderListStatus(root: HTMLElement, text: string): void {
  setOptionalText(root.querySelector("[data-llm-provider-list-status]"), text);
}

function bindSettingsNavigation(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-settings-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.settingsNav as SettingsSection | undefined;
      if (!section) {
        return;
      }
      selectSettingsSection(root, section, readSettingsRouteState(button));
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-plugin-kind-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      syncSettingsNavActive(root, "plugins", {
        kind: readSettingsPluginKind(button.dataset.pluginKindFilter),
      });
    });
  });
}

function selectSettingsSection(
  root: HTMLElement,
  section: SettingsSection,
  routeState: SettingsPageRouteState,
): void {
  root.dataset.settingsActiveSection = section;
  const pluginTarget = section === "plugins" ? readSettingsPluginTarget(root, routeState) : undefined;
  syncSettingsNavActive(root, section, pluginTarget);
  root.querySelectorAll<HTMLElement>("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
  if (section === "plugins") {
    selectPluginPanelTarget(root, pluginTarget ?? { kind: "third-party" });
  }
  syncSettingsEmbeddedPanels(root, section, routeState);
  if (section === "workspace-sync") {
    void hydrateWorkspaceSyncPanel(root);
  }
  if (section === "app-config") {
    hydrateAppPublishSection(root);
  }
}

function syncSettingsNavActive(
  root: HTMLElement,
  section: SettingsSection,
  pluginTarget?: PluginPanelTarget,
): void {
  if (section === "plugins") {
    root.dataset.settingsActivePluginKind = pluginTarget?.kind ?? "third-party";
    root.dataset.settingsActivePluginId = pluginTarget?.pluginId ?? "";
  }
  root.querySelectorAll<HTMLButtonElement>("[data-settings-nav]").forEach((item) => {
    const sectionMatches = item.dataset.settingsNav === section;
    const pluginMatches = section !== "plugins" || settingsPluginNavMatches(item, pluginTarget);
    item.dataset.active = sectionMatches && pluginMatches ? "true" : "false";
  });
}

function readSettingsRouteState(button: HTMLButtonElement): SettingsPageRouteState {
  const pluginId = button.dataset.settingsPluginId;
  if (!button.dataset.settingsPluginKind && !pluginId) {
    return {};
  }
  return {
    pluginKind: readSettingsPluginKind(button.dataset.settingsPluginKind),
    pluginId,
  };
}

function readSettingsPluginTarget(
  root: HTMLElement,
  routeState: SettingsPageRouteState,
): PluginPanelTarget {
  const hasRoutePluginTarget = routeState.pluginKind !== undefined || routeState.pluginId !== undefined;
  const storedKind = root.dataset.settingsActivePluginKind
    ? readSettingsPluginKind(root.dataset.settingsActivePluginKind)
    : "third-party";
  const storedPluginId = root.dataset.settingsActivePluginId || undefined;
  return {
    kind: routeState.pluginKind ?? storedKind,
    pluginId: hasRoutePluginTarget ? routeState.pluginId : storedPluginId,
  };
}

function settingsPluginNavMatches(
  item: HTMLButtonElement,
  pluginTarget: PluginPanelTarget | undefined,
): boolean {
  const target = pluginTarget ?? { kind: "third-party" };
  const itemPluginId = item.dataset.settingsPluginId;
  if (target.pluginId || itemPluginId) {
    return itemPluginId === target.pluginId;
  }
  return readSettingsPluginKind(item.dataset.settingsPluginKind) === target.kind;
}

function readSettingsPluginKind(value: string | undefined): SettingsPluginKind {
  return value === "third-party" ? "third-party" : "core";
}

function syncSettingsEmbeddedPanels(
  root: HTMLElement,
  section: SettingsSection,
  routeState: SettingsPageRouteState,
): void {
  if (section === "automation") {
    mountSettingsAutomationPanel(root, routeState.automationPanel ?? {});
  } else {
    disposeSettingsAutomationPanel(root);
  }
  if (section === "project-log") {
    mountSettingsProjectLogPanel(root);
  } else {
    disposeSettingsProjectLogPanel(root);
  }
  if (section === "user-guide") {
    mountSettingsUserGuidePanel(root, routeState.anchor);
  } else {
    disposeSettingsUserGuidePanel(root);
  }
}

function normalizeSettingsSection(value: string | undefined): SettingsSection {
  return value && SETTINGS_SECTION_VALUES.has(value as SettingsSection)
    ? value as SettingsSection
    : "llm";
}

function bindProviderCards(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-provider-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".settings-switch")) {
        return;
      }
      const id = button.dataset.providerToggle ?? "";
      const body = root.querySelector<HTMLElement>(`[data-provider-body="${cssEscape(id)}"]`);
      if (body) body.hidden = !body.hidden;
    });
  });
  root.querySelectorAll<HTMLElement>("[data-provider-enabled]").forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const checked = toggle.getAttribute("aria-checked") === "true";
      toggle.setAttribute("aria-checked", checked ? "false" : "true");
      toggle.classList.toggle("is-on", !checked);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-llm-account-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const providerId = button.dataset.llmAccountAdd ?? "";
      const list = root.querySelector<HTMLElement>(`[data-llm-account-list="${cssEscape(providerId)}"]`);
      list?.insertAdjacentHTML("beforeend", renderLlmAccountRow(providerId));
    });
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const testButton = target.closest<HTMLButtonElement>("[data-llm-account-test]");
    if (testButton) {
      void testLlmAccountRow(testButton);
      return;
    }
    const saveButton = target.closest<HTMLButtonElement>("[data-llm-account-save]");
    if (saveButton) {
      void saveLlmAccountRow(root, saveButton);
      return;
    }
    const deleteButton = target.closest<HTMLButtonElement>("[data-llm-account-delete]");
    if (deleteButton) {
      void deleteLlmAccountRow(root, deleteButton);
    }
  });
}

function bindProviderStatusControls(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-relay-balance-refresh]")) {
      void refreshRelayBalance(root);
      return;
    }
    if (target.closest("[data-codex-cli-refresh]")) {
      void refreshCodexCliStatus(root);
      return;
    }
    if (target.closest("[data-yt-dlp-refresh]")) {
      void hydrateYtDlpStatus(root);
      return;
    }
    if (target.closest("[data-yt-dlp-install]")) {
      void installYtDlp(root).catch((error) => {
        const status = root.querySelector<HTMLElement>("[data-yt-dlp-status]");
        if (status) status.textContent = error instanceof Error ? error.message : String(error);
      });
      return;
    }
    if (target.closest("[data-xhs-refresh]")) {
      void hydrateXhsSyncStatus(root);
      return;
    }
    if (target.closest("[data-xhs-extract]")) {
      void runXhsAction(root, "extract");
      return;
    }
    if (target.closest("[data-xhs-batch]")) {
      void runXhsAction(root, "batch");
      return;
    }
  });
}

async function hydrateYtDlpStatus(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-yt-dlp-status]");
  const light = root.querySelector<HTMLElement>("[data-yt-dlp-light]");
  if (!status || !light) return;
  status.textContent = "\u6b63\u5728\u68c0\u6d4b yt-dlp...";
  try {
    const response = await fetch("/api/clips/yt-dlp");
    const payload = (await response.json()) as { success?: boolean; data?: YtDlpStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "yt-dlp status load failed");
    }
    renderYtDlpStatus(status, light, payload.data);
  } catch (error) {
    light.textContent = "\u5931\u8d25";
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function installYtDlp(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-yt-dlp-status]");
  if (status) status.textContent = "\u6b63\u5728\u5b89\u88c5 yt-dlp...";
  const response = await fetch("/api/clips/yt-dlp/install", { method: "POST" });
  const payload = (await response.json()) as { success?: boolean; data?: YtDlpStatusResponse; error?: string };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "yt-dlp install failed");
  }
  renderYtDlpStatus(
    root.querySelector<HTMLElement>("[data-yt-dlp-status]")!,
    root.querySelector<HTMLElement>("[data-yt-dlp-light]")!,
    payload.data,
  );
}

function renderYtDlpStatus(status: HTMLElement, light: HTMLElement, data: YtDlpStatusResponse): void {
  light.textContent = data.installed ? "\u53ef\u7528" : "\u672a\u5b89\u88c5";
  status.textContent = data.installed
    ? `${data.version ?? "yt-dlp"} · ${data.source}${data.path ? ` · ${data.path}` : ""}`
    : data.message ?? "\u672a\u68c0\u6d4b\u5230 yt-dlp";
}

async function hydrateXhsSyncStatus(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-xhs-sync-status]");
  if (!status) return;
  setOptionalText(status, "正在读取小红书同步状态...");
  try {
    const response = await fetch("/api/xhs-sync/status");
    const data = await readSuccessData<XhsSyncStatusResponse>(response, "小红书同步状态读取失败");
    renderXhsProgress(root, "extract", data.latestExtraction?.progress ?? emptyXhsProgress());
    setOptionalText(status, describeXhsSyncStatus(data.failures.length));
  } catch (error) {
    setOptionalText(status, readErrorMessage(error));
  }
}

function resolveXhsActionRequest(
  action: "extract" | "batch",
  inputValue: string,
): { body: { body: string; url: string } | { text: string }; endpoint: string } {
  if (action === "extract") {
    return {
      endpoint: "/api/xhs-sync/extract",
      body: { url: readFirstXhsUrl(inputValue), body: inputValue },
    };
  }
  return {
    endpoint: "/api/xhs-sync/batch",
    body: { text: inputValue },
  };
}

async function readXhsActionData(response: Response): Promise<XhsActionResponse> {
  const payload = await readJsonPayload<{ success?: boolean; data?: XhsActionResponse; error?: string }>(response);
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? payload.data?.error ?? "小红书同步失败");
  }
  return payload.data;
}

function resolveXhsActionProgress(data: XhsActionResponse): XhsProgressResponse {
  if (data.progress) {
    return data.progress;
  }
  return {
    current: 1,
    total: 1,
    percent: data.status === "failed" ? 0 : 100,
  };
}

function describeXhsActionStatus(data: XhsActionResponse): string {
  if (data.path) {
    return `已完成：${data.path}`;
  }
  return "小红书同步任务已完成。";
}

async function runXhsAction(root: HTMLElement, action: "extract" | "batch"): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-xhs-sync-status]");
  const input = root.querySelector<HTMLTextAreaElement>("[data-xhs-sync-input]");
  const request = resolveXhsActionRequest(action, input?.value ?? "");
  setOptionalText(status, "正在执行小红书提取...");
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const data = await readXhsActionData(response);
    renderXhsProgress(root, "extract", resolveXhsActionProgress(data));
    setOptionalText(status, describeXhsActionStatus(data));
  } catch (error) {
    setOptionalText(status, readErrorMessage(error));
  }
}

function renderXhsProgress(root: HTMLElement, kind: "extract", progress: XhsProgressResponse): void {
  const bar = root.querySelector<HTMLElement>("[data-xhs-extract-progress]");
  const meta = root.querySelector<HTMLElement>("[data-xhs-extract-meta]");
  if (bar) bar.style.width = `${clamp(progress.percent, 0, 100)}%`;
  if (meta) meta.textContent = `${progress.current} / ${progress.total}`;
}

function emptyXhsProgress(): XhsProgressResponse {
  return { current: 0, total: 0, percent: 0 };
}

function readFirstXhsUrl(value: string): string {
  return value.match(/https?:\/\/[^\s,，]+/i)?.[0] ?? "";
}

interface RelayBalanceResponseData {
  ok?: boolean;
  currentBalance?: string | null;
  usedBalance?: string | null;
  message?: string;
}

function renderRelayBalanceLoading(current: HTMLElement, used: HTMLElement): void {
  current.textContent = "\u8bfb\u53d6\u4e2d...";
  used.textContent = "\u8bfb\u53d6\u4e2d...";
}

function readRelayBalanceRequestBody(root: HTMLElement): Record<string, string> {
  return {
    url: readProviderInput(root, "relay:balanceUrl"),
    key: readProviderInput(root, "relay:key"),
    balancePath: readProviderInput(root, "relay:balancePath"),
    usedPath: readProviderInput(root, "relay:usedPath"),
  };
}

async function readRelayBalanceResponse(response: Response): Promise<RelayBalanceResponseData> {
  const payload = (await response.json()) as {
    success?: boolean;
    data?: RelayBalanceResponseData;
    error?: string;
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "\u4f59\u989d\u8bfb\u53d6\u5931\u8d25");
  }
  return payload.data;
}

function renderRelayBalanceSuccess(
  current: HTMLElement,
  used: HTMLElement,
  data: RelayBalanceResponseData,
): void {
  current.textContent = data.currentBalance ?? "--";
  used.textContent = data.usedBalance ?? "--";
  if (!data.ok && data.message) {
    used.textContent = data.message;
  }
}

async function refreshRelayBalance(root: HTMLElement): Promise<void> {
  const current = root.querySelector<HTMLElement>("[data-relay-balance-current] strong");
  const used = root.querySelector<HTMLElement>("[data-relay-balance-used] strong");
  if (!current || !used) return;
  renderRelayBalanceLoading(current, used);
  try {
    const response = await fetch("/api/providers/relay/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readRelayBalanceRequestBody(root)),
    });
    renderRelayBalanceSuccess(current, used, await readRelayBalanceResponse(response));
  } catch (error) {
    current.textContent = "\u5931\u8d25";
    used.textContent = readErrorMessage(error);
  }
}

interface CodexCliStatusData {
  ok?: boolean;
  installed?: boolean;
  version?: string | null;
  balance?: string | null;
  message?: string;
}

async function readCodexCliStatusData(response: Response): Promise<CodexCliStatusData> {
  const payload = (await response.json()) as {
    success?: boolean;
    data?: CodexCliStatusData;
    error?: string;
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "Codex CLI 状态读取失败");
  }
  return payload.data;
}

function renderCodexCliStatusLoading(balance: HTMLElement, status: HTMLElement): void {
  balance.textContent = "检测中...";
  status.textContent = "检测中...";
}

function renderCodexCliStatusSuccess(
  balance: HTMLElement,
  status: HTMLElement,
  data: CodexCliStatusData,
): void {
  status.textContent = data.version ?? (data.installed ? "Codex CLI" : "未安装");
  balance.textContent = data.balance ?? data.message ?? "--";
}

function renderCodexCliStatusFailure(balance: HTMLElement, status: HTMLElement, error: unknown): void {
  status.textContent = "失败";
  balance.textContent = readErrorMessage(error);
}

async function refreshCodexCliStatus(root: HTMLElement): Promise<void> {
  const balance = root.querySelector<HTMLElement>("[data-codex-cli-balance] strong");
  const status = root.querySelector<HTMLElement>("[data-codex-cli-status]");
  if (!balance || !status) return;

  renderCodexCliStatusLoading(balance, status);
  try {
    const response = await fetch("/api/providers/codex-cli/status");
    renderCodexCliStatusSuccess(balance, status, await readCodexCliStatusData(response));
  } catch (error) {
    renderCodexCliStatusFailure(balance, status, error);
  }
}

function bindSettingsSidebarResize(root: HTMLElement): void {
  const sidebar = root.querySelector<HTMLElement>("[data-settings-sidebar]");
  const handle = root.querySelector<HTMLElement>("[data-settings-sidebar-resize]");
  if (!sidebar || !handle) return;
  const storedWidth = Number(window.localStorage?.getItem(SETTINGS_SIDEBAR_WIDTH_KEY));
  if (Number.isFinite(storedWidth) && storedWidth >= 180) {
    root.style.setProperty("--settings-sidebar-width", `${storedWidth}px`);
  }
  attachResizeHandle({
    handle,
    onMove(event) {
      const rect = root.getBoundingClientRect();
      const width = clamp(event.clientX - rect.left, 180, 320);
      root.style.setProperty("--settings-sidebar-width", `${width}px`);
      window.localStorage?.setItem(SETTINGS_SIDEBAR_WIDTH_KEY, String(width));
    },
  });
}

function bindWorkspaceSyncPanel(root: HTMLElement): void {
  workspaceSyncState.set(root, { targetRepoPath: "", sourceRepoPaths: [] });
  xiaohongshuImportState.set(root, { cookie: "", progress: 0, status: "idle", message: "未开始" });
  douyinCookieState.set(root, { cookie: "", status: "idle", message: "未开始", hasCookie: false, path: "" });
  bindRssImportPanel(root);
  bindFlashNoteImportPanel(root);

  root.querySelectorAll<HTMLButtonElement>("[data-import-source]").forEach((button) => {
    button.addEventListener("click", () => {
      const sourceName = button.querySelector("strong")?.textContent?.trim() || "该来源";
      updateSettingsStatus(root, `${sourceName}：${IMPORT_SOURCE_UNAVAILABLE_MESSAGE}`);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-xhs-import-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeXiaohongshuImportModal(root);
    });
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-import-dir-pick]")?.addEventListener("click", () => {
    void chooseXiaohongshuImportDir(root);
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-import-dir-save]")?.addEventListener("click", () => {
    void saveXiaohongshuImportDir(root);
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-import-dir-clear]")?.addEventListener("click", () => {
    void clearXiaohongshuImportDir(root);
  });
  root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]")?.addEventListener("click", () => {
    if (!window.llmWikiDesktop) return;
    void chooseXiaohongshuImportDir(root);
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-import-sync]")?.addEventListener("click", () => {
    void syncXiaohongshuFavorites(root);
  });
  root.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]")?.addEventListener("input", (event) => {
    const input = event.currentTarget;
    const state = xiaohongshuImportState.get(root) ?? { cookie: "", progress: 0, status: "idle" as const };
    xiaohongshuImportState.set(root, { ...state, cookie: input.value });
  });

  root.querySelector<HTMLButtonElement>("[data-xhs-cookie-save]")?.addEventListener("click", () => {
    void saveXiaohongshuCookieAndStart(root);
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-login-open]")?.addEventListener("click", () => {
    void openXiaohongshuLoginWindow(root);
  });
  root.querySelector<HTMLButtonElement>("[data-xhs-cookie-import]")?.addEventListener("click", () => {
    void importXiaohongshuCookieFromBrowser(root);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-douyin-cookie-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeDouyinCookieModal(root);
    });
  });
  root.querySelector<HTMLTextAreaElement>("[data-douyin-cookie-input]")?.addEventListener("input", (event) => {
    const input = event.currentTarget;
    const state = douyinCookieState.get(root) ?? { cookie: "", status: "idle" as const };
    douyinCookieState.set(root, { ...state, cookie: input.value });
  });
  root.querySelector<HTMLButtonElement>("[data-douyin-cookie-save]")?.addEventListener("click", () => {
    void saveDouyinCookie(root);
  });
  root.querySelector<HTMLButtonElement>("[data-douyin-login-open]")?.addEventListener("click", () => {
    void openDouyinLoginWindow(root);
  });
  root.querySelector<HTMLButtonElement>("[data-douyin-cookie-import]")?.addEventListener("click", () => {
    void importDouyinCookieFromBrowser(root);
  });

  root.querySelector<HTMLButtonElement>("[data-sync-config-refresh]")?.addEventListener("click", () => {
    void hydrateWorkspaceSyncPanel(root);
  });
  root.querySelector<HTMLButtonElement>("[data-sync-config-save]")?.addEventListener("click", () => {
    void saveWorkspaceSyncConfig(root);
  });
  root.querySelector<HTMLButtonElement>("[data-sync-target-pick]")?.addEventListener("click", () => {
    void chooseWorkspaceTarget(root);
  });
  root.querySelector<HTMLButtonElement>("[data-sync-source-pick]")?.addEventListener("click", () => {
    void chooseWorkspaceSources(root);
  });
  root.querySelector<HTMLButtonElement>("[data-sync-source-add]")?.addEventListener("click", () => {
    addManualWorkspaceSource(root);
  });
  root.querySelector<HTMLButtonElement>("[data-sync-target-clear]")?.addEventListener("click", () => {
    setWorkspaceSyncState(root, { ...readWorkspaceSyncState(root), targetRepoPath: "" });
  });

  root.querySelector<HTMLInputElement>("[data-sync-target-input]")?.addEventListener("input", (event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setWorkspaceSyncState(root, { ...readWorkspaceSyncState(root), targetRepoPath: value });
  });
  root.querySelector<HTMLInputElement>("[data-sync-source-input]")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addManualWorkspaceSource(root);
  });

  root.querySelector<HTMLInputElement>("[data-sync-target-input]")?.addEventListener("click", () => {
    if (window.llmWikiDesktop) {
      void chooseWorkspaceTarget(root);
    }
  });
  root.querySelector<HTMLInputElement>("[data-sync-source-input]")?.addEventListener("click", () => {
    if (window.llmWikiDesktop) {
      void chooseWorkspaceSources(root);
    }
  });

  root.addEventListener("click", (event) => {
    const removeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sync-remove-source]");
    if (removeButton) {
      event.preventDefault();
      removeWorkspaceSource(root, removeButton.dataset.syncRemoveSource ?? "");
    }
  });
}

async function hydrateWorkspaceSyncPanel(root: HTMLElement): Promise<void> {
  await Promise.all([
    hydrateWorkspaceSyncConfig(root),
    hydrateXiaohongshuImportProgress(root),
  ]);
}

async function hydrateWorkspaceSyncConfig(root: HTMLElement): Promise<void> {
  const targetInput = root.querySelector<HTMLInputElement>("[data-sync-target-input]");
  const sourceInput = root.querySelector<HTMLInputElement>("[data-sync-source-input]");
  if (!targetInput || !sourceInput) return;
  try {
    const config = await loadWorkspaceSyncConfig();
    workspaceSyncState.set(root, config);
    targetInput.readOnly = Boolean(window.llmWikiDesktop);
    sourceInput.readOnly = Boolean(window.llmWikiDesktop);
    renderWorkspaceSyncState(root);
  } catch (error) {
    updateSettingsStatus(root, error instanceof Error ? error.message : String(error));
  }
}

async function readDesktopWorkspaceSyncConfig(): Promise<SyncRepoState | null> {
  if (!window.llmWikiDesktop) {
    return null;
  }
  const bootstrap = await window.llmWikiDesktop.getAppBootstrap();
  const desktopState: SyncRepoState = {
    targetRepoPath: bootstrap.appConfig?.targetRepoPath ?? bootstrap.desktopConfig.targetVault ?? "",
    sourceRepoPaths: bootstrap.appConfig?.sourceFolders ?? [],
  };
  if (!desktopState.targetRepoPath && desktopState.sourceRepoPaths.length === 0) {
    return null;
  }
  return normalizeWorkspaceSyncState(desktopState);
}

async function readApiWorkspaceSyncConfig(): Promise<SyncRepoState> {
  const response = await fetch("/api/sync/config");
  const data = await readSuccessData<SyncConfigResponse>(response, "同步配置读取失败");
  return normalizeWorkspaceSyncState(data);
}

async function loadWorkspaceSyncConfig(): Promise<SyncRepoState> {
  const desktopState = await readDesktopWorkspaceSyncConfig();
  if (desktopState) {
    return desktopState;
  }
  return readApiWorkspaceSyncConfig();
}

function finalizeWorkspaceSyncState(root: HTMLElement): SyncRepoState {
  const sourceInput = root.querySelector<HTMLInputElement>("[data-sync-source-input]");
  if (sourceInput?.value.trim() && !sourceInput.readOnly) {
    addManualWorkspaceSource(root);
  }
  return normalizeWorkspaceSyncState(readWorkspaceSyncState(root));
}

function hasWorkspaceSyncConfig(state: SyncRepoState): boolean {
  return Boolean(state.targetRepoPath) && state.sourceRepoPaths.length > 0;
}

async function persistWorkspaceSyncConfig(state: SyncRepoState): Promise<void> {
  if (window.llmWikiDesktop) {
    const accountIdentifier = await readDesktopAccountIdentifier();
    await window.llmWikiDesktop.saveDesktopConfig(state.targetRepoPath);
    await window.llmWikiDesktop.saveAppConfig({
      accountIdentifier,
      targetRepoPath: state.targetRepoPath,
      sourceFolders: state.sourceRepoPaths,
    });
    return;
  }
  const response = await fetch("/api/sync/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "同步配置保存失败");
  }
}

async function readDesktopAccountIdentifier(): Promise<string> {
  const bootstrap = await window.llmWikiDesktop?.getAppBootstrap();
  const accountIdentifier = bootstrap?.appConfig?.accountIdentifier?.trim() ?? "";
  if (!accountIdentifier) {
    throw new Error("需要先配置账号标识。");
  }
  return accountIdentifier;
}

async function saveWorkspaceSyncConfig(root: HTMLElement): Promise<void> {
  const state = finalizeWorkspaceSyncState(root);
  if (!hasWorkspaceSyncConfig(state)) {
    updateSettingsStatus(root, "需要先填写目标仓库和至少一个源仓库。");
    return;
  }
  try {
    await persistWorkspaceSyncConfig(state);
    setWorkspaceSyncState(root, state);
    updateSettingsStatus(root, "同步配置已保存。");
  } catch (error) {
    updateSettingsStatus(root, readErrorMessage(error));
  }
}

async function chooseWorkspaceTarget(root: HTMLElement): Promise<void> {
  if (!window.llmWikiDesktop) return;
  const selected = await window.llmWikiDesktop.chooseTargetVault();
  if (!selected) return;
  setWorkspaceSyncState(root, { ...readWorkspaceSyncState(root), targetRepoPath: selected });
}

async function chooseWorkspaceSources(root: HTMLElement): Promise<void> {
  if (!window.llmWikiDesktop) return;
  const selected = await window.llmWikiDesktop.chooseSourceFolders();
  if (!selected || selected.length === 0) return;
  setWorkspaceSyncState(root, {
    ...readWorkspaceSyncState(root),
    sourceRepoPaths: [...readWorkspaceSyncState(root).sourceRepoPaths, ...selected],
  });
}

function addManualWorkspaceSource(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("[data-sync-source-input]");
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;
  setWorkspaceSyncState(root, {
    ...readWorkspaceSyncState(root),
    sourceRepoPaths: [...readWorkspaceSyncState(root).sourceRepoPaths, value],
  });
  input.value = "";
}

function removeWorkspaceSource(root: HTMLElement, sourcePath: string): void {
  if (!sourcePath) return;
  setWorkspaceSyncState(root, {
    ...readWorkspaceSyncState(root),
    sourceRepoPaths: readWorkspaceSyncState(root).sourceRepoPaths.filter((item) => item !== sourcePath),
  });
}

function readWorkspaceSyncState(root: HTMLElement): SyncRepoState {
  return workspaceSyncState.get(root) ?? { targetRepoPath: "", sourceRepoPaths: [] };
}

function setWorkspaceSyncState(root: HTMLElement, state: SyncRepoState): void {
  workspaceSyncState.set(root, normalizeWorkspaceSyncState(state));
  renderWorkspaceSyncState(root);
}

function normalizeWorkspaceSyncState(state: SyncRepoState): SyncRepoState {
  return {
    targetRepoPath: state.targetRepoPath.trim(),
    sourceRepoPaths: [...new Set(state.sourceRepoPaths.map((item) => item.trim()).filter(Boolean))],
  };
}

function renderWorkspaceSyncState(root: HTMLElement): void {
  const state = readWorkspaceSyncState(root);
  const targetInput = root.querySelector<HTMLInputElement>("[data-sync-target-input]");
  const sourceInput = root.querySelector<HTMLInputElement>("[data-sync-source-input]");
  const sourcePaths = root.querySelector<HTMLElement>("[data-sync-source-paths]");
  const clearButton = root.querySelector<HTMLButtonElement>("[data-sync-target-clear]");
  if (targetInput) targetInput.value = state.targetRepoPath;
  if (sourceInput?.readOnly) sourceInput.value = formatWorkspaceSourceInputValue(state.sourceRepoPaths);
  if (clearButton) clearButton.hidden = !state.targetRepoPath;
  if (!sourcePaths) return;
  if (state.sourceRepoPaths.length === 0) {
    sourcePaths.innerHTML = `<div class="settings-source-paths__empty">尚未添加源仓库路径</div>`;
    return;
  }
  sourcePaths.innerHTML = state.sourceRepoPaths.map((sourcePath) => `
    <div class="settings-source-path" data-source-path="${escapeHtml(sourcePath)}">
      <span>${escapeHtml(sourcePath)}</span>
      <button type="button" class="settings-source-path__delete" data-sync-remove-source="${escapeHtml(sourcePath)}">删除</button>
    </div>
  `).join("");
}

function formatWorkspaceSourceInputValue(sourceRepoPaths: string[]): string {
  return sourceRepoPaths.join("; ");
}

function openXiaohongshuImportModal(root: HTMLElement): void {
  const modal = root.querySelector<HTMLElement>("[data-xhs-import-modal]");
  if (!modal) return;
  modal.hidden = false;
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]");
  if (cookieInput) {
    const state = xiaohongshuImportState.get(root);
    if (!cookieInput.value && state?.cookie) {
      cookieInput.value = state.cookie;
    }
    cookieInput.focus();
  }
  void hydrateXiaohongshuImportConfig(root);
  void hydrateXiaohongshuImportProgress(root);
}

function closeXiaohongshuImportModal(root: HTMLElement): void {
  const modal = root.querySelector<HTMLElement>("[data-xhs-import-modal]");
  if (modal) modal.hidden = true;
  stopXiaohongshuImportPolling(root);
}

function openDouyinCookieModal(root: HTMLElement): void {
  const modal = root.querySelector<HTMLElement>("[data-douyin-cookie-modal]");
  if (!modal) return;
  modal.hidden = false;
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-douyin-cookie-input]");
  if (cookieInput) {
    const state = douyinCookieState.get(root);
    if (!cookieInput.value && state?.cookie) {
      cookieInput.value = state.cookie;
    }
    cookieInput.focus();
  }
  void hydrateDouyinCookieStatus(root);
}

function closeDouyinCookieModal(root: HTMLElement): void {
  const modal = root.querySelector<HTMLElement>("[data-douyin-cookie-modal]");
  if (modal) modal.hidden = true;
}

function renderXiaohongshuProgress(root: HTMLElement, progress: XiaohongshuProgressDraft): void {
  renderXiaohongshuImportState(
    root,
    buildXiaohongshuProgressSnapshot(xiaohongshuImportState.get(root), progress),
  );
}

function renderDouyinCookieSnapshot(root: HTMLElement, draft: DouyinCookieDraft): void {
  renderDouyinCookieState(root, buildDouyinCookieSnapshot(douyinCookieState.get(root), draft));
}

function currentXiaohongshuImportDir(root: HTMLElement): string {
  return xiaohongshuImportState.get(root)?.importDirPath
    ?? root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]")?.value.trim()
    ?? "";
}

async function saveXiaohongshuCookie(cookie: string): Promise<string> {
  const response = await fetch("/api/import/xiaohongshu/cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie }),
  });
  const payload = await readJsonPayload<{ success?: boolean; message?: string; error?: string }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Cookie 保存失败");
  }
  return payload.message ?? "Cookie 保存成功，正在启动导入任务";
}

async function startXiaohongshuImportTask(): Promise<string> {
  const response = await fetch("/api/import/xiaohongshu/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await readJsonPayload<{ success?: boolean; taskId?: string; error?: string }>(response);
  if (!response.ok || !payload.success || !payload.taskId) {
    throw new Error(payload.error ?? "小红书导入任务启动失败");
  }
  return payload.taskId;
}

async function resolveXiaohongshuFavoritesRequest(): Promise<{ endpoint: string; requestBody: string }> {
  if (!window.llmWikiDesktop?.fetchXiaohongshuFavorites) {
    return { endpoint: "/api/xhs-sync/favorites", requestBody: "{}" };
  }
  const favorites = await window.llmWikiDesktop.fetchXiaohongshuFavorites();
  if (!favorites?.ok) {
    throw new Error(favorites?.message ?? "小红书收藏读取失败");
  }
  return {
    endpoint: "/api/xhs-sync/batch",
    requestBody: JSON.stringify({ urls: favorites.urls }),
  };
}

async function requestXiaohongshuFavoritesSync(
  endpoint: string,
  requestBody: string,
): Promise<XhsFavoritesSyncResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  });
  const payload = await readJsonPayload<{ success?: boolean; data?: XhsFavoritesSyncResponse; error?: string }>(response);
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? payload.data?.error ?? "小红书一键同步失败");
  }
  return payload.data;
}

async function saveXiaohongshuCookieAndStart(root: HTMLElement): Promise<void> {
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]");
  if (!cookieInput) return;
  const cookie = cookieInput.value.trim();
  const state = xiaohongshuImportState.get(root);
  if (!cookie) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "error",
      message: "请先粘贴 Cookie",
    });
    return;
  }
  xiaohongshuImportState.set(root, {
    cookie,
    importDirPath: state?.importDirPath,
    progress: 0,
    status: "saving",
    message: "正在保存 Cookie",
  });
  renderXiaohongshuProgress(root, {
    taskId: null,
    progress: 0,
    status: "importing",
    message: "正在保存 Cookie",
  });
  try {
    const message = await saveXiaohongshuCookie(cookie);
    const taskId = await startXiaohongshuImportTask();
    const nextState: XiaohongshuImportState = {
      cookie,
      importDirPath: state?.importDirPath,
      progress: 0,
      status: "queued",
      message,
      taskId,
    };
    xiaohongshuImportState.set(root, nextState);
    await hydrateXiaohongshuImportProgress(root, taskId);
    startXiaohongshuImportPolling(root, taskId);
  } catch (error) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function importXiaohongshuCookieFromBrowser(root: HTMLElement): Promise<void> {
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-xhs-cookie-input]");
  if (!cookieInput) return;
  if (!window.llmWikiDesktop?.importXiaohongshuCookie) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "error",
      message: "当前环境不支持从浏览器自动读取小红书 Cookie。",
    });
    return;
  }
  try {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "importing",
      message: "正在从浏览器读取小红书 Cookie",
    });
    const result = await window.llmWikiDesktop.importXiaohongshuCookie();
    if (!result.ok || !result.cookie.trim()) {
      throw new Error(result.message || "没有读取到小红书 Cookie");
    }
    cookieInput.value = result.cookie;
    updateSettingsStatus(root, result.message);
    await saveXiaohongshuCookieAndStart(root);
  } catch (error) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readDouyinCookieStatus(): Promise<DouyinCookieStatusResponse> {
  const response = await fetch("/api/import/douyin/cookie");
  return readSuccessData<DouyinCookieStatusResponse>(response, "抖音 cookie 状态读取失败");
}

function renderHydratedDouyinCookieStatus(root: HTMLElement, status: DouyinCookieStatusResponse): void {
  renderDouyinCookieState(root, {
    cookie: douyinCookieState.get(root)?.cookie ?? "",
    status: status.hasCookie ? "success" : "idle",
    message: status.hasCookie ? "已检测到项目级抖音 fallback cookie。" : "当前还没有保存项目级抖音 fallback cookie。",
    hasCookie: status.hasCookie,
    path: status.path,
  });
}

function renderDouyinCookieStatusFailure(root: HTMLElement, error: unknown): void {
  renderDouyinCookieState(root, {
    cookie: douyinCookieState.get(root)?.cookie ?? "",
    status: "error",
    message: readErrorMessage(error),
    hasCookie: false,
    path: "",
  });
}

async function hydrateDouyinCookieStatus(root: HTMLElement): Promise<void> {
  try {
    renderHydratedDouyinCookieStatus(root, await readDouyinCookieStatus());
  } catch (error) {
    renderDouyinCookieStatusFailure(root, error);
  }
}

async function persistDouyinCookie(
  cookie: string,
): Promise<{ message: string; status: DouyinCookieStatusResponse }> {
  const response = await fetch("/api/import/douyin/cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie }),
  });
  const payload = await readJsonPayload<{
    success?: boolean;
    data?: DouyinCookieStatusResponse;
    message?: string;
    error?: string;
  }>(response);
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "抖音 cookie 保存失败");
  }
  return {
    message: payload.message ?? "抖音 cookie 已保存",
    status: payload.data,
  };
}

async function saveDouyinCookie(root: HTMLElement): Promise<void> {
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-douyin-cookie-input]");
  if (!cookieInput) return;
  let cookie = "";
  try {
    cookie = readRequiredControlValue(cookieInput, "请先粘贴抖音 Cookie");
  } catch (error) {
    renderDouyinCookieSnapshot(root, {
      status: "error",
      message: readErrorMessage(error),
    });
    return;
  }
  renderDouyinCookieSnapshot(root, {
    cookie,
    status: "saving",
    message: "正在保存抖音 Cookie",
  });
  try {
    const result = await persistDouyinCookie(cookie);
    renderDouyinCookieSnapshot(root, {
      cookie,
      status: "success",
      message: result.message,
      hasCookie: result.status.hasCookie,
      path: result.status.path,
    });
  } catch (error) {
    renderDouyinCookieSnapshot(root, {
      cookie,
      status: "error",
      message: readErrorMessage(error),
    });
  }
}

async function importDouyinCookieFromBrowser(root: HTMLElement): Promise<void> {
  const cookieInput = root.querySelector<HTMLTextAreaElement>("[data-douyin-cookie-input]");
  if (!cookieInput) return;
  if (!window.llmWikiDesktop?.importDouyinCookie) {
    renderDouyinCookieSnapshot(root, {
      status: "error",
      message: "当前环境不支持从浏览器自动读取抖音 Cookie。",
    });
    return;
  }
  try {
    renderDouyinCookieSnapshot(root, {
      status: "saving",
      message: "正在从浏览器读取抖音 Cookie",
    });
    const result = await window.llmWikiDesktop.importDouyinCookie();
    if (!result.ok || !result.cookie.trim()) {
      throw new Error(result.message || "没有读取到抖音 Cookie");
    }
    cookieInput.value = result.cookie;
    updateSettingsStatus(root, result.message);
    await saveDouyinCookie(root);
  } catch (error) {
    renderDouyinCookieSnapshot(root, {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openDouyinLoginWindow(root: HTMLElement): Promise<void> {
  if (!window.llmWikiDesktop?.openDouyinLogin) {
    renderDouyinCookieSnapshot(root, {
      status: "error",
      message: "当前环境不支持打开抖音登录窗口。",
    });
    return;
  }
  try {
    const result = await window.llmWikiDesktop.openDouyinLogin();
    renderDouyinCookieSnapshot(root, {
      status: result.ok ? (douyinCookieState.get(root)?.status ?? "idle") : "error",
      message: result.message,
    });
    updateSettingsStatus(root, result.message);
  } catch (error) {
    renderDouyinCookieSnapshot(root, {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openXiaohongshuLoginWindow(root: HTMLElement): Promise<void> {
  if (!window.llmWikiDesktop?.openXiaohongshuLogin) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: xiaohongshuImportState.get(root)?.progress ?? 0,
      status: "error",
      message: "当前环境不支持打开小红书登录窗口。",
    });
    return;
  }

  try {
    const result = await window.llmWikiDesktop.openXiaohongshuLogin();
    const state = xiaohongshuImportState.get(root);
    renderXiaohongshuProgress(root, buildXiaohongshuLoginProgress(state, result.ok, result.message));
    updateSettingsStatus(root, result.message);
  } catch (error) {
    renderXiaohongshuProgress(
      root,
      buildXiaohongshuLoginErrorProgress(xiaohongshuImportState.get(root), readErrorMessage(error)),
    );
  }
}

function buildXiaohongshuLoginProgress(
  state: XiaohongshuImportState | undefined,
  ok: boolean,
  message: string,
): XiaohongshuProgressDraft {
  return {
    taskId: state?.taskId ?? null,
    progress: state?.progress ?? 0,
    status: ok ? (state?.status ?? "idle") : "error",
    message,
  };
}

function buildXiaohongshuLoginErrorProgress(
  state: XiaohongshuImportState | undefined,
  message: string,
): XiaohongshuProgressDraft {
  return {
    taskId: null,
    progress: state?.progress ?? 0,
    status: "error",
    message,
  };
}

async function hydrateXiaohongshuImportConfig(root: HTMLElement): Promise<void> {
  const input = root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]");
  if (!input) return;
  try {
    const response = await fetch("/api/import/xiaohongshu/config");
    const data = await readSuccessData<XiaohongshuImportConfigResponse>(response, "小红书导入目录读取失败");
    applyXiaohongshuImportDir(root, data.importDirPath);
  } catch {
    input.value = "";
  }
}

async function chooseXiaohongshuImportDir(root: HTMLElement): Promise<void> {
  if (!window.llmWikiDesktop) return;
  const selected = await window.llmWikiDesktop.chooseTargetVault();
  if (!selected) return;
  applyXiaohongshuImportDir(root, selected);
}

async function saveXiaohongshuImportDir(root: HTMLElement): Promise<void> {
  const input = root.querySelector<HTMLInputElement>("[data-xhs-import-dir-input]");
  if (!input) return;
  try {
    const importDirPath = readRequiredControlValue(input, "请先选择导入文件夹地址");
    const response = await fetch("/api/import/xiaohongshu/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importDirPath }),
    });
    const payload = await readJsonPayload<{ success?: boolean; data?: XiaohongshuImportConfigResponse; error?: string; message?: string }>(response);
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "导入文件夹保存失败");
    }
    applyXiaohongshuImportDir(root, payload.data.importDirPath);
    updateSettingsStatus(root, payload.message ?? "导入文件夹已保存");
  } catch (error) {
    updateSettingsStatus(root, readErrorMessage(error));
  }
}

async function clearXiaohongshuImportDir(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/import/xiaohongshu/config", {
      method: "DELETE",
    });
    const payload = await readJsonPayload<{ success?: boolean; error?: string; message?: string }>(response);
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "导入文件夹删除失败");
    }
    applyXiaohongshuImportDir(root, "");
    updateSettingsStatus(root, payload.message ?? "导入文件夹已删除");
  } catch (error) {
    updateSettingsStatus(root, readErrorMessage(error));
  }
}

async function syncXiaohongshuFavorites(root: HTMLElement): Promise<void> {
  renderXiaohongshuProgress(root, {
    taskId: xiaohongshuImportState.get(root)?.taskId ?? null,
    progress: 0,
    status: "importing",
    message: "正在读取小红书收藏并批量同步...",
    importDirPath: currentXiaohongshuImportDir(root),
  });
  try {
    const { endpoint, requestBody } = await resolveXiaohongshuFavoritesRequest();
    const payload = await requestXiaohongshuFavoritesSync(endpoint, requestBody);
    const progress = payload.progress ?? { current: payload.queued, total: payload.queued, percent: 100 };
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: progress.percent,
      status: payload.status === "failed" ? "error" : "success",
      message: payload.message,
      importDirPath: currentXiaohongshuImportDir(root),
    });
    renderXhsProgress(root, "extract", progress);
  } catch (error) {
    renderXiaohongshuProgress(root, {
      taskId: null,
      progress: 0,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function hydrateXiaohongshuImportProgress(root: HTMLElement, taskId?: string): Promise<void> {
  const state = xiaohongshuImportState.get(root);
  try {
    const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const response = await fetch(`/api/import/xiaohongshu/progress${suffix}`);
    const payload = await readJsonPayload<XiaohongshuImportProgressResponse & { success?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "小红书导入进度读取失败");
    }
    renderXiaohongshuImportState(root, payload);
  } catch (error) {
    renderXiaohongshuImportState(root, {
      taskId: taskId ?? null,
      progress: 0,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      hasCookie: Boolean(state?.cookie.trim()),
      importDirPath: state?.importDirPath ?? "",
    });
  }
}

function renderXiaohongshuImportState(root: HTMLElement, progress: XiaohongshuImportProgressResponse): void {
  const next = buildXiaohongshuImportState(xiaohongshuImportState.get(root), progress);
  xiaohongshuImportState.set(root, next.nextState);
  renderXiaohongshuImportProgressFields(root, progress, next.nextImportDirPath);
  updateSettingsStatus(root, progress.message);
}

function renderDouyinCookieState(root: HTMLElement, state: DouyinCookieState): void {
  douyinCookieState.set(root, state);
  const light = root.querySelector<HTMLElement>("[data-douyin-cookie-light]");
  const status = root.querySelector<HTMLElement>("[data-douyin-cookie-status]");
  const path = root.querySelector<HTMLElement>("[data-douyin-cookie-path]");
  if (light) {
    light.textContent = state.hasCookie ? "已保存" : "未保存";
  }
  if (status) {
    status.textContent = state.message ?? "未开始";
  }
  if (path) {
    path.textContent = state.path ? `保存位置：${state.path}` : "";
  }
  updateSettingsStatus(root, state.message ?? "未开始");
}

function startXiaohongshuImportPolling(root: HTMLElement, taskId: string): void {
  stopXiaohongshuImportPolling(root);
  const poll = async () => {
    await hydrateXiaohongshuImportProgress(root, taskId);
    const state = xiaohongshuImportState.get(root);
    if (!state || state.taskId !== taskId) return;
    if (state.status === "success" || state.status === "error") {
      stopXiaohongshuImportPolling(root);
      return;
    }
    const handle = window.setTimeout(() => {
      void poll();
    }, 1200);
    xiaohongshuImportPollers.set(root, handle);
  };
  void poll();
}

function stopXiaohongshuImportPolling(root: HTMLElement): void {
  const handle = xiaohongshuImportPollers.get(root);
  if (typeof handle === "number") {
    window.clearTimeout(handle);
    xiaohongshuImportPollers.delete(root);
  }
}

function updateSettingsStatus(root: HTMLElement, message: string): void {
  const status = root.querySelector<HTMLElement>("[data-settings-status]");
  if (status) status.textContent = message;
}

function bindLegacySettingsControls(root: HTMLElement): void {
  bindShortcutSettingsControls(root);
  const targetInput = root.querySelector<HTMLInputElement>("[data-settings-target]");
  const sourceList = root.querySelector<HTMLUListElement>("[data-settings-sources]");
  const status = root.querySelector<HTMLElement>("[data-settings-status]");
  if (!targetInput || !sourceList || !status) return;

  root.querySelector<HTMLButtonElement>("[data-settings-choose-target]")?.addEventListener("click", async () => {
    const selected = await window.llmWikiDesktop?.chooseTargetVault();
    if (selected) targetInput.value = selected;
  });

  root.querySelector<HTMLButtonElement>("[data-settings-add-source]")?.addEventListener("click", async () => {
    const selected = await window.llmWikiDesktop?.chooseSourceFolders();
    if (!selected || selected.length === 0) return;
    renderSources(sourceList, [...new Set([...readSources(sourceList), ...selected])]);
  });

  root.querySelector<HTMLButtonElement>("[data-settings-save]")?.addEventListener("click", async () => {
    const target = targetInput.value.trim();
    const sources = readSources(sourceList);
    if (!target || sources.length === 0) {
      status.textContent = "\u9700\u8981\u5148\u586b\u5199\u76ee\u6807\u4ed3\u5e93\u548c\u81f3\u5c11\u4e00\u4e2a\u540c\u6b65\u6e90\u3002";
      return;
    }
    try {
      const accountIdentifier = await readDesktopAccountIdentifier();
      await window.llmWikiDesktop?.saveDesktopConfig(target);
      await window.llmWikiDesktop?.saveAppConfig({ accountIdentifier, targetRepoPath: target, sourceFolders: sources });
      status.textContent = "\u5df2\u4fdd\u5b58\u3002";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  void hydrateSettings(targetInput, sourceList, status);
}

function bindShortcutSettingsControls(root: HTMLElement): void {
  const shortcutInputs = [...root.querySelectorAll<HTMLInputElement>("[data-shortcut-id]")];
  const shortcutStatus = root.querySelector<HTMLElement>("[data-shortcut-status]");
  if (shortcutInputs.length === 0 || !shortcutStatus) return;
  shortcutInputs.forEach((input) => bindShortcutCaptureInput(input, shortcutStatus));
  root.querySelectorAll<HTMLButtonElement>("[data-shortcut-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const shortcutId = readShortcutId(button.dataset.shortcutSave);
      const shortcutInput = shortcutInputs.find((input) => input.dataset.shortcutId === shortcutId);
      if (!shortcutId || !shortcutInput) return;
      void saveShortcutValue(shortcutId, shortcutInput, shortcutInputs, shortcutStatus);
    });
  });
  void hydrateShortcutSettings(shortcutInputs, shortcutStatus);
}

function bindShortcutCaptureInput(input: HTMLInputElement, status: HTMLElement): void {
  input.addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const accelerator = acceleratorFromKeyboardEvent(event);
    if (!accelerator) return;
    input.value = accelerator;
    status.textContent = "\u5df2\u6355\u83b7\u5feb\u6377\u952e\uff0c\u70b9\u51fb\u4fdd\u5b58\u751f\u6548\u3002";
  });
  input.addEventListener("focus", () => input.select());
}

function readShortcutId(value: string | undefined): ShortcutId | null {
  return SETTINGS_SHORTCUTS.some((shortcut) => shortcut.id === value) ? value as ShortcutId : null;
}

async function saveShortcutValue(
  shortcutId: ShortcutId,
  shortcutInput: HTMLInputElement,
  shortcutInputs: readonly HTMLInputElement[],
  shortcutStatus: HTMLElement,
): Promise<void> {
  if (!window.llmWikiDesktop || typeof window.llmWikiDesktop.saveShortcut !== "function") {
    shortcutStatus.textContent = "\u5feb\u6377\u952e\u53ea\u80fd\u5728 Electron \u684c\u9762\u7aef\u4fee\u6539\u3002";
    return;
  }
  try {
    const result = await window.llmWikiDesktop.saveShortcut({
      id: shortcutId,
      accelerator: shortcutInput.value.trim(),
    });
    applyShortcutInputValues(shortcutInputs, result.shortcuts);
    setClientKeyboardShortcuts(result.shortcuts);
    shortcutStatus.textContent = describeShortcutSaveResult(shortcutId, result, shortcutInput.value);
  } catch (error) {
    shortcutStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

function describeShortcutSaveResult(
  shortcutId: ShortcutId,
  result: { readonly registered: boolean; readonly error?: string },
  fallback: string,
): string {
  if (shortcutId === "pageTextSearch" || shortcutId === "workspaceSave") {
    return "\u5feb\u6377\u952e\u5df2\u4fdd\u5b58\u5e76\u751f\u6548\u3002";
  }
  return result.registered
    ? "\u5feb\u6377\u952e\u5df2\u4fdd\u5b58\u5e76\u6ce8\u518c\u3002"
    : `\u5df2\u4fdd\u5b58\uff0c\u4f46\u6ce8\u518c\u5931\u8d25\uff1a${result.error ?? fallback}`;
}

function applyShortcutInputValues(inputs: readonly HTMLInputElement[], shortcuts: AppShortcuts): void {
  inputs.forEach((input) => {
    const shortcutId = readShortcutId(input.dataset.shortcutId);
    if (shortcutId) input.value = shortcuts[shortcutId];
  });
}

interface SyncRunPanelElements {
  statusNode: HTMLElement;
  metaNode: HTMLElement;
  progressNode: HTMLElement;
  summaryNode: HTMLElement;
  logNode: HTMLElement;
  pauseButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  compileStatusNode: HTMLElement;
  compileMetaNode: HTMLElement;
  compileProgressNode: HTMLElement;
  compileSummaryNode: HTMLElement;
  compileLogNode: HTMLElement;
  compileRefreshButton: HTMLButtonElement;
}

interface SyncRunPanelState {
  currentRunId: string | null;
  currentRun: RunSnapshot | null;
  eventSource: EventSource | null;
}

function readSyncRunPanelElements(root: HTMLElement): SyncRunPanelElements | null {
  const statusNode = root.querySelector<HTMLElement>("[data-sync-run-status]");
  const metaNode = root.querySelector<HTMLElement>("[data-sync-run-meta]");
  const progressNode = root.querySelector<HTMLElement>("[data-sync-run-progress]");
  const summaryNode = root.querySelector<HTMLElement>("[data-sync-run-summary]");
  const logNode = root.querySelector<HTMLElement>("[data-sync-run-log]");
  const pauseButton = root.querySelector<HTMLButtonElement>("[data-sync-run-pause]");
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-sync-run-cancel]");
  const refreshButton = root.querySelector<HTMLButtonElement>("[data-sync-run-refresh]");
  const compileStatusNode = root.querySelector<HTMLElement>("[data-compile-run-status]");
  const compileMetaNode = root.querySelector<HTMLElement>("[data-compile-run-meta]");
  const compileProgressNode = root.querySelector<HTMLElement>("[data-compile-run-progress]");
  const compileSummaryNode = root.querySelector<HTMLElement>("[data-compile-run-summary]");
  const compileLogNode = root.querySelector<HTMLElement>("[data-compile-run-log]");
  const compileRefreshButton = root.querySelector<HTMLButtonElement>("[data-compile-run-refresh]");
  const elements = [
    statusNode,
    metaNode,
    progressNode,
    summaryNode,
    logNode,
    pauseButton,
    cancelButton,
    refreshButton,
    compileStatusNode,
    compileMetaNode,
    compileProgressNode,
    compileSummaryNode,
    compileLogNode,
    compileRefreshButton,
  ];
  if (elements.some((element) => !element)) {
    return null;
  }
  return {
    statusNode: statusNode!,
    metaNode: metaNode!,
    progressNode: progressNode!,
    summaryNode: summaryNode!,
    logNode: logNode!,
    pauseButton: pauseButton!,
    cancelButton: cancelButton!,
    refreshButton: refreshButton!,
    compileStatusNode: compileStatusNode!,
    compileMetaNode: compileMetaNode!,
    compileProgressNode: compileProgressNode!,
    compileSummaryNode: compileSummaryNode!,
    compileLogNode: compileLogNode!,
    compileRefreshButton: compileRefreshButton!,
  };
}

function closeSyncRunStream(state: SyncRunPanelState): void {
  state.eventSource?.close();
  state.eventSource = null;
}

function formatRunLogLines(lines: readonly RunLine[], emptyText: string): string {
  return lines.length > 0
    ? lines.map((line) => `[${formatTime(line.at)}] ${line.source}: ${line.text}`).join("\n")
    : emptyText;
}

function renderIdleSyncRun(elements: SyncRunPanelElements, state: SyncRunPanelState): void {
  state.currentRunId = null;
  elements.statusNode.textContent = "\u5f85\u8fd0\u884c";
  elements.metaNode.textContent = "\u8fd8\u6ca1\u6709\u68c0\u6d4b\u5230 sync run \u8bb0\u5f55\u3002";
  elements.progressNode.style.width = "0%";
  elements.summaryNode.innerHTML = `<span class="settings-run-panel__chip">\u672a\u542f\u52a8</span>`;
  elements.logNode.textContent = "\u6682\u65e0\u8fd0\u884c\u8f93\u51fa";
  elements.compileStatusNode.textContent = "\u5f85\u8fd0\u884c";
  elements.compileMetaNode.textContent = "\u8fd8\u6ca1\u6709\u68c0\u6d4b\u5230; compile \u8fdb\u5ea6\u3002";
  elements.compileProgressNode.style.width = "0%";
  elements.compileSummaryNode.innerHTML = `<span class="settings-run-panel__chip">\u672a\u542f\u52a8</span>`;
  elements.compileLogNode.textContent = "\u6682\u65e0\u7f16\u8bd1\u8f93\u51fa";
  elements.pauseButton.disabled = true;
  elements.cancelButton.disabled = true;
}

function renderSyncRunSnapshot(
  elements: SyncRunPanelElements,
  state: SyncRunPanelState,
  run: RunSnapshot | null,
): void {
  state.currentRun = run;
  if (!run || run.kind !== "sync") {
    renderIdleSyncRun(elements, state);
    return;
  }

  state.currentRunId = run.id;
  const progress = deriveSyncProgress(run);
  const compileProgress = deriveCompileProgress(run);
  const compileLines = filterCompileLines(run);
  elements.statusNode.textContent = formatRunStatus(run.status);
  elements.metaNode.textContent = formatRunMeta(run);
  elements.progressNode.style.width = `${progress.percent}%`;
  elements.summaryNode.innerHTML = renderRunSummary(progress);
  elements.logNode.textContent = formatRunLogLines(run.lines, "\u6682\u65e0\u8fd0\u884c\u8f93\u51fa");
  elements.compileStatusNode.textContent = formatRunStatus(run.status);
  elements.compileMetaNode.textContent = formatCompileMeta(run, compileLines.length);
  elements.compileProgressNode.style.width = `${compileProgress.percent}%`;
  elements.compileSummaryNode.innerHTML = renderRunSummary(compileProgress);
  elements.compileLogNode.textContent = formatRunLogLines(compileLines, "\u6682\u65e0\u7f16\u8bd1\u8f93\u51fa");
  elements.pauseButton.disabled = run.status !== "running";
  elements.cancelButton.disabled = run.status !== "running";
}

function attachSyncRunStream(
  elements: SyncRunPanelElements,
  state: SyncRunPanelState,
  runId: string,
): void {
  closeSyncRunStream(state);
  state.eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  state.eventSource.addEventListener("status", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { run?: RunSnapshot };
    if (!payload.run) {
      return;
    }
    renderSyncRunSnapshot(elements, state, payload.run);
    if (payload.run.status !== "running") {
      closeSyncRunStream(state);
    }
  });
  state.eventSource.addEventListener("line", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { line?: RunLine };
    if (!payload.line || !state.currentRun || state.currentRun.id !== runId) {
      return;
    }
    renderSyncRunSnapshot(elements, state, {
      ...state.currentRun,
      lines: [...state.currentRun.lines, payload.line],
    });
  });
  state.eventSource.onerror = () => {
    closeSyncRunStream(state);
  };
}

async function readCurrentSyncRunSnapshot(): Promise<RunSnapshot | null> {
  const response = await fetch("/api/runs/current");
  const payload = (await response.json()) as RunResponse;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error ?? "sync run status load failed");
  }
  return payload.data && payload.data.kind === "sync" ? payload.data : null;
}

function renderSyncRunLoadFailure(
  elements: SyncRunPanelElements,
  state: SyncRunPanelState,
  message: string,
): void {
  closeSyncRunStream(state);
  elements.statusNode.textContent = "\u8bfb\u53d6\u5931\u8d25";
  elements.metaNode.textContent = message;
  elements.progressNode.style.width = "0%";
  elements.summaryNode.innerHTML = `<span class="settings-run-panel__chip is-error">\u8bfb\u53d6\u5931\u8d25</span>`;
  elements.logNode.textContent = "\u6682\u65e0\u8fd0\u884c\u8f93\u51fa";
  elements.pauseButton.disabled = true;
  elements.cancelButton.disabled = true;
}

async function refreshSyncRunPanel(
  elements: SyncRunPanelElements,
  state: SyncRunPanelState,
): Promise<void> {
  elements.refreshButton.disabled = true;
  try {
    const run = await readCurrentSyncRunSnapshot();
    renderSyncRunSnapshot(elements, state, run);
    if (run?.status === "running") {
      attachSyncRunStream(elements, state, run.id);
    } else {
      closeSyncRunStream(state);
    }
  } catch (error) {
    renderSyncRunLoadFailure(elements, state, readErrorMessage(error));
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function stopCurrentSyncRun(
  elements: SyncRunPanelElements,
  state: SyncRunPanelState,
  button: HTMLButtonElement,
): Promise<void> {
  if (!state.currentRunId) {
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(state.currentRunId)}/stop`, { method: "POST" });
    const payload = (await response.json()) as RunResponse;
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error ?? "stop run failed");
    }
    renderSyncRunSnapshot(elements, state, payload.data && payload.data.kind === "sync" ? payload.data : null);
    closeSyncRunStream(state);
  } catch (error) {
    elements.metaNode.textContent = readErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}

function bindSyncRunPanel(root: HTMLElement): void {
  const elements = readSyncRunPanelElements(root);
  if (!elements) {
    return;
  }
  const state: SyncRunPanelState = {
    currentRunId: null,
    currentRun: null,
    eventSource: null,
  };

  elements.pauseButton.addEventListener("click", () => {
    void stopCurrentSyncRun(elements, state, elements.pauseButton);
  });
  elements.cancelButton.addEventListener("click", () => {
    void stopCurrentSyncRun(elements, state, elements.cancelButton);
  });
  elements.refreshButton.addEventListener("click", () => {
    void refreshSyncRunPanel(elements, state);
  });
  elements.compileRefreshButton.addEventListener("click", () => {
    void refreshSyncRunPanel(elements, state);
  });
  document.addEventListener("llmwiki:run-started", ((event: Event) => {
    const detail = (event as CustomEvent<{ kind?: RunKind }>).detail;
    if (detail?.kind === "sync") {
      void refreshSyncRunPanel(elements, state);
    }
  }) as EventListener);
  void refreshSyncRunPanel(elements, state);
}

interface SyncRunProgress {
  percent: number;
  chips: string[];
}

interface ProgressStep {
  chip: string;
  keywords: readonly string[];
  percent: number;
}

interface SyncStatusCounts {
  synced: number;
  compiled: number;
  notSynced: number;
  notCompiled: number;
}

const SYNC_PROGRESS_STEPS: readonly ProgressStep[] = [
  { percent: 12, chip: "\u5f00\u59cb\u626b\u63cf", keywords: ["starting sync"] },
  { percent: 28, chip: "\u540c\u6b65\u6e90\u6599", keywords: ["sources_full", "synced markdown", "markdown", "assets"] },
  { percent: 56, chip: "Phase 1", keywords: ["phase 1", "claims"] },
  { percent: 78, chip: "Phase 2", keywords: ["phase 2", "procedures"] },
  { percent: 95, chip: "\u6574\u7406\u6700\u7ec8\u7ed3\u679c", keywords: ["final result:"] },
];

const COMPILE_PROGRESS_STEPS: readonly ProgressStep[] = [
  { percent: 12, chip: "\u542f\u52a8 compile", keywords: ["compile"] },
  { percent: 36, chip: "\u6982\u5ff5\u62bd\u53d6", keywords: ["phase 1", "claims"] },
  { percent: 56, chip: "\u5408\u5e76\u6e90\u6599", keywords: ["late affected", "claim"] },
  { percent: 76, chip: "\u751f\u6210 wiki", keywords: ["phase 2", "procedure", "concept"] },
  { percent: 92, chip: "\u91cd\u5efa\u5bfc\u822a", keywords: ["interlink", "index", "moc", "final result"] },
];

const COMPILE_LINE_KEYWORDS = [
  "compile",
  "phase 1",
  "phase 2",
  "claim",
  "procedure",
  "interlink",
  "index",
  "moc",
  "late affected",
  "final result",
  "frozen",
  "orphan",
  "wiki/",
] as const;

function includesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function deriveProgressFromSteps(
  text: string,
  basePercent: number,
  steps: readonly ProgressStep[],
): SyncRunProgress {
  let percent = basePercent;
  const chips: string[] = [];
  for (const step of steps) {
    if (!includesAnyKeyword(text, step.keywords)) {
      continue;
    }
    percent = Math.max(percent, step.percent);
    chips.push(step.chip);
  }
  return { percent, chips };
}

function finalizeRunProgress(
  run: RunSnapshot,
  progress: SyncRunProgress,
  labels: { failed: string; running: string; stopped: string; succeeded: string },
): SyncRunProgress {
  if (run.status === "succeeded") {
    return { percent: 100, chips: [...progress.chips, labels.succeeded] };
  }
  if (run.status === "failed") {
    return { percent: 100, chips: [...progress.chips, labels.failed] };
  }
  if (run.status === "stopped") {
    return { percent: progress.percent, chips: [...progress.chips, labels.stopped] };
  }
  if (progress.chips.length === 0) {
    return { percent: progress.percent, chips: [labels.running] };
  }
  return progress;
}

function deriveSyncProgress(run: RunSnapshot): SyncRunProgress {
  const joined = run.lines.map((line) => line.text.toLowerCase()).join("\n");
  const progress = deriveProgressFromSteps(joined, 8, SYNC_PROGRESS_STEPS);
  const statusCounts = extractStatusCounts(joined);
  if (statusCounts) {
    progress.chips.push(`已同步 ${statusCounts.synced}`);
    progress.chips.push(`已编译 ${statusCounts.compiled}`);
    progress.chips.push(`未同步 ${statusCounts.notSynced}`);
    progress.chips.push(`未编译 ${statusCounts.notCompiled}`);
  }
  const finalized = finalizeRunProgress(run, progress, {
    succeeded: "\u5df2\u5b8c\u6210",
    failed: "\u8fd0\u884c\u5931\u8d25",
    stopped: "\u5df2\u53d6\u6d88",
    running: "\u8fd0\u884c\u4e2d",
  });
  return {
    percent: clamp(finalized.percent, 0, 100),
    chips: Array.from(new Set(finalized.chips)),
  };
}

function extractStatusCounts(text: string): SyncStatusCounts | null {
  const match = text.match(/status counts:\s*synced\s+(\d+),\s*compiled\s+(\d+),\s*not synced\s+(\d+),\s*not compiled\s+(\d+)/i);
  if (!match) return null;
  return {
    synced: Number(match[1]),
    compiled: Number(match[2]),
    notSynced: Number(match[3]),
    notCompiled: Number(match[4]),
  };
}

function filterCompileLines(run: RunSnapshot): RunLine[] {
  const matched = run.lines.filter((line) => {
    const text = line.text.toLowerCase();
    return includesAnyKeyword(text, COMPILE_LINE_KEYWORDS);
  });
  return matched.length > 0 ? matched : run.lines;
}

function deriveCompileProgress(run: RunSnapshot): SyncRunProgress {
  const joined = filterCompileLines(run).map((line) => line.text.toLowerCase()).join("\n");
  const progress = deriveProgressFromSteps(joined, 6, COMPILE_PROGRESS_STEPS);
  const finalized = finalizeRunProgress(run, progress, {
    succeeded: "\u7f16\u8bd1\u5b8c\u6210",
    failed: "\u7f16\u8bd1\u5931\u8d25",
    stopped: "\u5df2\u53d6\u6d88",
    running: "\u7f16\u8bd1\u7b49\u5f85\u4e2d",
  });
  return {
    percent: clamp(finalized.percent, 0, 100),
    chips: Array.from(new Set(finalized.chips)),
  };
}

function renderRunSummary(progress: SyncRunProgress): string {
  return progress.chips
    .map((chip) => `<span class="settings-run-panel__chip">${escapeHtml(chip)}</span>`)
    .join("");
}

function formatRunStatus(status: RunStatus): string {
  switch (status) {
    case "running":
      return "\u8fd0\u884c\u4e2d";
    case "succeeded":
      return "\u5df2\u5b8c\u6210";
    case "failed":
      return "\u5931\u8d25";
    case "stopped":
      return "\u5df2\u53d6\u6d88";
    default:
      return status;
  }
}

function formatRunMeta(run: RunSnapshot): string {
  const parts = [
    `ID ${run.id.slice(0, 8)}`,
    `\u542f\u52a8 ${formatTime(run.startedAt)}`,
  ];
  if (run.endedAt) {
    parts.push(`\u7ed3\u675f ${formatTime(run.endedAt)}`);
  }
  if (typeof run.exitCode === "number") {
    parts.push(`exit ${run.exitCode}`);
  }
  return parts.join(" · ");
}

function formatCompileMeta(run: RunSnapshot, compileLineCount: number): string {
  const parts = [
    `ID ${run.id.slice(0, 8)}`,
    `\u542f\u52a8 ${formatTime(run.startedAt)}`,
    `\u65e5\u5fd7 ${compileLineCount} \u6761`,
  ];
  if (run.endedAt) {
    parts.push(`\u7ed3\u675f ${formatTime(run.endedAt)}`);
  }
  if (typeof run.exitCode === "number") {
    parts.push(`exit ${run.exitCode}`);
  }
  return parts.join(" · ");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function bindLlmProviderConfig(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>("[data-settings-panel=\"llm\"]");
  if (!panel?.querySelector("[data-llm-default-account], [data-llm-account], [data-settings-save]")) {
    return;
  }
  root.querySelector<HTMLButtonElement>("[data-settings-save]")?.addEventListener("click", () => {
    void saveLlmProviderConfigFromPage(root);
  });
  root.querySelector<HTMLSelectElement>("[data-llm-default-account]")?.addEventListener("change", () => {
    renderLlmDefaultAccountSelection(root);
  });
  void hydrateLlmProviderConfig(root);
  void hydrateLlmProviderAccounts(root);
}

async function hydrateLlmProviderConfig(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-llm-config-status]");
  try {
    const response = await fetch("/api/llm/config");
    const data = await readSuccessData<LlmProviderConfigResponse>(response, "LLM config load failed");
    renderLlmProviderConfig(root, data);
    setOptionalText(status, describeLlmProviderStatus({
      config: data,
      emptyText: "LLM OpenAI-compatible 尚未配置。",
      prefix: "LLM OpenAI-compatible 已配置：",
      resolveHost: readHost,
    }));
  } catch (error) {
    setOptionalText(status, readErrorMessage(error));
  }
}

async function hydrateLlmProviderAccounts(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/llm/accounts");
    const payload = await readJsonPayload<{ success?: boolean; data?: LlmApiAccountsResponse; error?: string }>(response);
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "LLM accounts load failed");
    }
    llmAccountsState.set(root, payload.data.accounts);
    renderLlmApiAccounts(root, payload.data.accounts);
    void hydrateLlmDefaultAccountOptions(root);
  } catch {
    llmAccountsState.set(root, []);
    void hydrateLlmDefaultAccountOptions(root);
  }
}

async function saveLlmProviderConfigFromPage(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-llm-config-status]");
  setOptionalText(status, "正在保存 LLM 配置...");
  try {
    const response = await fetch("/api/llm/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountRef: readSelectedLlmDefaultAccount(root),
      }),
    });
    const data = await readSuccessData<LlmProviderConfigResponse>(response, "LLM config save failed");
    renderLlmProviderConfig(root, data);
    setOptionalText(status, describeLlmProviderStatus({
      config: data,
      emptyText: "已保存，LLM OpenAI-compatible 地址已清空。",
      prefix: "已保存：",
      resolveHost: readHost,
    }));
  } catch (error) {
    setOptionalText(status, readErrorMessage(error));
  }
}

async function persistLlmAccountRow(row: HTMLElement): Promise<LlmApiAccountResponse> {
  const response = await fetch("/api/llm/accounts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readLlmAccountRow(row)),
  });
  return readSuccessData<LlmApiAccountResponse>(response, "LLM config save failed");
}

function renderSavingLlmAccountStatus(status: HTMLElement | null, button: HTMLButtonElement): void {
  if (status) {
    status.textContent = "正在保存...";
  }
  button.disabled = true;
}

function renderSavedLlmAccountStatus(
  row: HTMLElement,
  status: HTMLElement | null,
  account: LlmApiAccountResponse,
): void {
  row.dataset.llmAccountId = account.id;
  if (status) {
    status.textContent = account.url ? `已保存：${readHost(account.url) ?? account.url}` : "已保存";
  }
}

function renderFailedLlmAccountStatus(status: HTMLElement | null, error: unknown): void {
  if (status) {
    status.textContent = readErrorMessage(error);
  }
}

async function saveLlmAccountRow(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const row = button.closest<HTMLElement>("[data-llm-account]");
  if (!row) return;
  const status = row.querySelector<HTMLElement>("[data-llm-account-status]");
  renderSavingLlmAccountStatus(status, button);
  try {
    renderSavedLlmAccountStatus(row, status, await persistLlmAccountRow(row));
    await hydrateLlmProviderAccounts(root);
  } catch (error) {
    renderFailedLlmAccountStatus(status, error);
  } finally {
    button.disabled = false;
  }
}

async function testLlmAccountRow(button: HTMLButtonElement): Promise<void> {
  const row = button.closest<HTMLElement>("[data-llm-account]");
  if (!row) return;
  const status = row.querySelector<HTMLElement>("[data-llm-account-status]");
  setOptionalText(status, "正在验证...");
  button.disabled = true;
  try {
    const response = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readLlmAccountRow(row)),
    });
    const data = await readSuccessData<LlmProviderTestResponse>(response, "LLM provider test failed");
    setOptionalText(status, data.message);
  } catch (error) {
    setOptionalText(status, readErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

function readLlmAccountRow(row: HTMLElement): { id?: string; name: string; provider: string; url: string; key: string; model: string } {
  const provider = row.dataset.llmAccount ?? "openai";
  const id = row.dataset.llmAccountId;
  return {
    ...(id ? { id } : {}),
    name: readProviderInput(row, `${provider}:name`) || provider,
    provider,
    url: readProviderInput(row, `${provider}:url`),
    key: readProviderInput(row, `${provider}:key`),
    model: readProviderInput(row, `${provider}:model`),
  };
}

function renderLlmProviderConfig(root: HTMLElement, config: LlmProviderConfigResponse): void {
  llmConfigState.set(root, config);
  const provider = config.provider || "openai";
  const row = root.querySelector<HTMLElement>(`[data-llm-account="${cssEscape(provider)}"]`) ?? root;
  const urlInput = row.querySelector<HTMLInputElement>(`[data-provider="${cssEscape(provider)}:url"]`);
  const keyInput = row.querySelector<HTMLInputElement>(`[data-provider="${cssEscape(provider)}:key"]`);
  const modelInput = row.querySelector<HTMLSelectElement>(`[data-provider="${cssEscape(provider)}:model"]`);
  if (urlInput) {
    urlInput.value = config.url;
  }
  if (keyInput) {
    keyInput.value = "";
    keyInput.placeholder = config.keyConfigured ? "已保存密钥，重新输入可覆盖" : "";
  }
  if (modelInput) {
    modelInput.innerHTML = renderModelOptions(provider, config.model);
    modelInput.value = config.model;
  }
  renderLlmDefaultAccountSelection(root);
}

function renderLlmApiAccounts(root: HTMLElement, accounts: readonly LlmApiAccountResponse[]): void {
  for (const provider of PROVIDERS) {
    const list = root.querySelector<HTMLElement>(`[data-llm-account-list="${cssEscape(provider.id)}"]`);
    if (!list) continue;
    const providerAccounts = accounts.filter((account) => account.provider === provider.id);
    list.innerHTML = providerAccounts.length > 0
      ? providerAccounts.map((account) => renderLlmAccountRow(provider.id, account)).join("")
      : renderLlmAccountRow(provider.id);
  }
}

async function hydrateLlmDefaultAccountOptions(
  root: HTMLElement,
  oauthAccounts?: readonly LlmProviderOAuthAccountResponse[],
): Promise<void> {
  const apiAccounts = llmAccountsState.get(root) ?? [];
  const resolvedOAuthAccounts = oauthAccounts ?? [
    ...await loadOptionalAccountCodexOAuthAccounts(),
    ...await loadOptionalCliProxyOAuthAccounts(),
  ];
  llmDefaultAccountOptionsState.set(root, dedupeAgentAccountOptions(buildLlmDefaultAccountOptions({
    apiAccounts,
    oauthAccounts: resolvedOAuthAccounts,
    getProviderDisplayName,
    formatOAuthProvider: formatCLIProxyProvider,
    providerFromOAuthAccount,
  })));
  renderLlmDefaultAccountOptions(root);
  renderLlmAccountSummary(root);
}

function renderLlmDefaultAccountOptions(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("[data-llm-default-account]");
  if (!select) return;
  const rendered = resolveRenderedLlmDefaultOptions({
    options: llmDefaultAccountOptionsState.get(root) ?? [],
    preferredValue: select.value.trim() || llmConfigState.get(root)?.accountRef?.trim() || "",
    fallbackProvider: llmConfigState.get(root)?.provider ?? "openai",
  });
  if (rendered.disabled) {
    select.innerHTML = `<option value="">暂无可用账号</option>`;
    select.value = "";
    select.disabled = true;
    renderLlmDefaultAccountSelection(root);
    return;
  }
  select.disabled = false;
  select.innerHTML = rendered.options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
  select.value = rendered.selectedValue;
  renderLlmDefaultAccountSelection(root);
}

function renderLlmDefaultAccountSelection(root: HTMLElement): void {
  const source = root.querySelector<HTMLElement>("[data-llm-default-source]");
  const provider = root.querySelector<HTMLElement>("[data-llm-default-provider]");
  const model = root.querySelector<HTMLElement>("[data-llm-default-model]");
  const select = root.querySelector<HTMLSelectElement>("[data-llm-default-account]");
  const summary = describeLlmDefaultSelection({
    options: llmDefaultAccountOptionsState.get(root) ?? [],
    config: llmConfigState.get(root) ?? null,
    selectedValue: select?.value.trim() || "",
  });
  if (source) source.textContent = summary.sourceText;
  if (provider) provider.textContent = getProviderDisplayName(summary.providerId);
  if (model) model.textContent = summary.modelText;
}

function renderLlmAccountSummary(root: HTMLElement): void {
  const container = root.querySelector<HTMLElement>("[data-llm-account-summary-list]");
  if (!container) return;
  const options = llmDefaultAccountOptionsState.get(root) ?? [];
  if (options.length === 0) {
    container.innerHTML = `<span class="settings-source-empty">暂无可用账号</span>`;
    return;
  }
  container.innerHTML = options.map((option) => `
    <article class="settings-llm-account-pill">
      <strong>${escapeHtml(option.accountName ?? option.label)}</strong>
      <small>${escapeHtml([
        option.source === "oauth" ? "OAuth" : "API",
        getProviderDisplayName(option.provider),
        option.model,
      ].filter(Boolean).join(" · "))}</small>
    </article>
  `).join("");
}

function renderLlmAccountRow(providerId: string, account?: Partial<LlmApiAccountResponse>): string {
  const rowView = describeLlmAccountRowView(defaultProviderEndpoint(providerId), account);
  return `
    <div class="settings-account-row" data-llm-account="${escapeHtml(providerId)}"${rowView.accountId ? ` data-llm-account-id="${escapeHtml(rowView.accountId)}"` : ""}>
      <label class="settings-field"><span>&#x8d26;&#x6237;&#x540d;</span><input data-provider="${escapeHtml(providerId)}:name" type="text" value="${escapeHtml(rowView.nameValue)}" /></label>
      <label class="settings-field"><span>&#x5730;&#x5740;</span><input data-provider="${escapeHtml(providerId)}:url" type="text" value="${escapeHtml(rowView.urlValue)}" /></label>
      <label class="settings-field"><span>&#x5bc6;&#x94a5;</span><input data-provider="${escapeHtml(providerId)}:key" type="password" placeholder="${rowView.keyPlaceholder}" /></label>
      <label class="settings-field"><span>&#x6a21;&#x578b;</span><select data-provider="${escapeHtml(providerId)}:model">${renderModelOptions(providerId, rowView.modelValue)}</select></label>
      <button type="button" class="btn btn-secondary btn-inline" data-llm-account-test>&#x9a8c;&#x8bc1;</button>
      <button type="button" class="btn btn-primary btn-inline" data-llm-account-save>&#x4fdd;&#x5b58;</button>
      <button type="button" class="btn btn-secondary btn-inline" data-llm-account-delete>&#x5220;&#x9664;</button>
      <span class="settings-account-row__status" data-llm-account-status></span>
    </div>
  `;
}

async function deleteLlmAccountRow(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const row = button.closest<HTMLElement>("[data-llm-account]");
  if (!row) return;
  const accountId = row.dataset.llmAccountId;
  if (!accountId) {
    row.remove();
    return;
  }
  const response = await fetch("/api/llm/accounts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: accountId }),
  });
  const payload = await readJsonPayload<{ success?: boolean; error?: string }>(response);
  if (!response.ok || !payload.success) {
    const status = row.querySelector<HTMLElement>("[data-llm-account-status]");
    if (status) status.textContent = payload.error ?? "删除失败";
    return;
  }
  row.remove();
  await hydrateLlmProviderAccounts(root);
}

function bindAgentConfigControls(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-agent-config-add]").forEach((button) => {
    button.addEventListener("click", () => {
    syncAgentFormToState(root);
    const config = appConfigState.get(root) ?? { apps: [], defaultAppId: null };
    const agent = createClientAgent();
    config.apps = [...config.apps, agent];
    config.defaultAppId = agent.id;
    renderAgentConfig(root, config);
    openAgentConfigModal(root, agent.id);
    setAgentConfigStatus(root, "\u65b0\u5e94\u7528\u5df2\u6dfb\u52a0\uff0c\u8bf7\u8865\u5145\u540e\u4fdd\u5b58\u3002");
    });
  });
  root.querySelector<HTMLButtonElement>("[data-agent-config-save]")?.addEventListener("click", () => {
    void saveAgentConfigFromPage(root);
  });
  root.querySelector<HTMLButtonElement>("[data-agent-config-delete]")?.addEventListener("click", () => {
    deleteSelectedAgent(root);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-agent-config-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeAgentConfigModal(root, { restore: true });
    });
  });
  root.querySelector<HTMLElement>("[data-agent-config-editor]")?.addEventListener("input", () => {
    syncAgentFormToState(root);
  });
  root.querySelector<HTMLElement>("[data-agent-config-editor]")?.addEventListener("change", () => {
    syncAgentFormToState(root);
  });
  root.querySelector<HTMLSelectElement>("[data-agent-config-field=\"provider\"]")?.addEventListener("change", () => {
    syncAgentAccountSelection(root);
    void hydrateAgentModelOptions(root);
  });
  root.querySelector<HTMLSelectElement>("[data-agent-config-field=\"accountRef\"]")?.addEventListener("change", () => {
    applySelectedAgentAccount(root);
    syncAgentFormToState(root);
  });
  void hydrateAgentConfig(root);
  void hydrateAgentAccountOptions(root);
}

async function hydrateAgentConfig(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/app-config");
    const payload = (await response.json()) as { success?: boolean; data?: AppConfigResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "App config load failed");
    }
    renderAgentConfig(root, payload.data);
    setAgentConfigStatus(root, payload.data.path ? `\u5e94\u7528\u914d\u7f6e\u5df2\u8bfb\u53d6\uff1a${payload.data.path}` : "\u5e94\u7528\u914d\u7f6e\u5df2\u8bfb\u53d6\u3002");
  } catch (error) {
    setAgentConfigStatus(root, error instanceof Error ? error.message : String(error));
  }
}

// fallow-ignore-next-line complexity
async function hydrateAgentAccountOptions(root: HTMLElement): Promise<void> {
  const options: AgentAccountOption[] = [{ value: "", label: "跟随应用资源默认配置", provider: "openai" }];
  try {
    const response = await fetch("/api/llm/accounts");
    const payload = await readJsonPayload<{ success?: boolean; data?: LlmApiAccountsResponse; error?: string }>(response);
    if (response.ok && payload.success && payload.data) {
      for (const account of payload.data.accounts) {
        options.push({
          value: `api:${account.id}`,
          label: `API · ${getProviderDisplayName(account.provider)} · ${account.name}`,
          provider: account.provider,
          model: account.model,
          source: "api",
          accountName: account.name,
        });
      }
    }
  } catch {
    // API accounts are optional for agent configuration.
  }
  try {
    const accounts = [
      ...await loadOptionalAccountCodexOAuthAccounts(),
      ...await fetchCLIProxyOAuthAccounts(false),
    ];
    for (const account of accounts) {
      const value = account.accountRef ?? `oauth:${account.provider}:${account.name}`;
      options.push({
        value,
        label: `OAuth · ${formatCLIProxyProvider(account.provider)} · ${account.email ?? account.name}`,
        provider: providerFromOAuthAccount(account.provider),
        source: "oauth",
        accountName: account.name,
      });
    }
  } catch {
    // OAuth accounts are optional for agent configuration.
  }
  try {
    const cloudflareProvider = await loadOptionalCloudflareProvider();
    if (cloudflareProvider?.configured) {
      options.push({
        value: cloudflareProvider.accountRef,
        label: "Cloudflare · Workers AI",
        provider: "cloudflare",
        model: cloudflareProvider.aiModel ?? undefined,
        source: "api",
        accountName: "cloudflare-workers-ai",
      });
    }
  } catch {
    // Cloudflare Workers AI is optional for agent configuration.
  }
  agentAccountOptionsState.set(root, dedupeAgentAccountOptions(options));
  syncAgentAccountSelection(root);
  await hydrateAgentModelOptions(root);
}

function renderAgentAccountOptions(root: HTMLElement, selected: string): void {
  const select = root.querySelector<HTMLSelectElement>("[data-agent-config-field=\"accountRef\"]");
  if (!select) return;
  const options = visibleAgentAccountOptions(root);
  const hasSelected = options.some((option) => option.value === selected);
  const fullOptions = hasSelected || !selected
    ? options
    : [...options, { value: selected, label: `已保存账号 · ${selected}`, provider: "openai" }];
  select.innerHTML = fullOptions
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
  select.value = selected;
}

function applySelectedAgentAccount(root: HTMLElement): void {
  const selected = readAgentField(root, "accountRef");
  const option = (agentAccountOptionsState.get(root) ?? []).find((item) => item.value === selected);
  if (!option || !selected) return;
  setAgentField(root, "provider", option.provider);
  syncAgentAccountSelection(root);
  void hydrateAgentModelOptions(root, option.model);
}

async function loadAgentModelOptions(
  provider: string,
  accountRef: string,
  accountName?: string,
): Promise<string[]> {
  const models = [...(MODEL_OPTIONS_BY_PROVIDER[provider] ?? [])];
  if (!accountRef.startsWith("oauth:") || !accountName) {
    return models;
  }
  try {
    const oauthModels = await fetchCLIProxyAccountModels(accountName);
    return oauthModels.length > 0 ? oauthModels : models;
  } catch {
    return models;
  }
}

function resolveAgentModelSelection(
  preferredModel: string | undefined,
  currentModel: string,
  accountModel?: string,
): string {
  if (preferredModel) {
    return preferredModel;
  }
  if (currentModel) {
    return currentModel;
  }
  return accountModel ?? "";
}

async function hydrateAgentModelOptions(root: HTMLElement, preferredModel?: string): Promise<void> {
  const provider = readAgentField(root, "provider") || "openai";
  const accountRef = readAgentField(root, "accountRef");
  const select = root.querySelector<HTMLSelectElement>("[data-agent-config-field=\"model\"]");
  if (!select) return;
  const selectedAccount = (agentAccountOptionsState.get(root) ?? []).find((item) => item.value === accountRef);
  const models = await loadAgentModelOptions(provider, accountRef, selectedAccount?.accountName);
  const selected = resolveAgentModelSelection(
    preferredModel,
    readAgentField(root, "model"),
    selectedAccount?.model,
  );
  select.innerHTML = renderModelOptionsFromList(models, selected);
  if (selected && [...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function dedupeAgentAccountOptions(options: AgentAccountOption[]): AgentAccountOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function syncAgentAccountSelection(root: HTMLElement): void {
  const nextSelected = resolveAgentAccountSelection(root);
  renderAgentAccountOptions(root, nextSelected);
  setAgentField(root, "accountRef", nextSelected);
}

function visibleAgentAccountOptions(root: HTMLElement): AgentAccountOption[] {
  const options = agentAccountOptionsState.get(root) ?? [{ value: "", label: "跟随应用资源默认配置", provider: "openai" }];
  return [...options];
}

function resolveAgentAccountSelection(root: HTMLElement): string {
  const provider = readAgentField(root, "provider") || "openai";
  const selected = readAgentField(root, "accountRef");
  const visibleOptions = visibleAgentAccountOptions(root);
  if (selected && visibleOptions.some((option) => option.value === selected)) {
    return selected;
  }
  const matchingOptions = visibleOptions.filter((option) => option.value !== "" && option.provider === provider);
  if (matchingOptions.length === 1) {
    return matchingOptions[0]?.value ?? "";
  }
  return "";
}

function getProviderDisplayName(providerId: string): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function defaultProviderEndpoint(providerId: string): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.endpoint ?? "";
}

function providerFromOAuthAccount(provider: string): string {
  switch (provider) {
    case "gemini-cli":
    case "gemini":
      return "gemini";
    case "anthropic":
      return "anthropic";
    case "codex":
      return "codex-cli";
    case "kimi":
      return "kimi-global";
    default:
      return provider;
  }
}

async function saveAgentConfigFromPage(root: HTMLElement): Promise<void> {
  syncAgentFormToState(root);
  const config = appConfigState.get(root) ?? { apps: [], defaultAppId: null };
  setAgentConfigStatus(root, "\u6b63\u5728\u4fdd\u5b58\u5e94\u7528\u914d\u7f6e...");
  try {
    const response = await fetch("/api/app-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = (await response.json()) as { success?: boolean; data?: AppConfigResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "App config save failed");
    }
    renderAgentConfig(root, payload.data);
    closeAgentConfigModal(root, { restore: false });
    setAgentConfigStatus(root, payload.data.path ? `\u5df2\u4fdd\u5b58\uff1a${payload.data.path}` : "\u5df2\u4fdd\u5b58\u5e94\u7528\u914d\u7f6e\u3002");
  } catch (error) {
    setAgentConfigStatus(root, error instanceof Error ? error.message : String(error));
  }
}

function renderAgentConfig(root: HTMLElement, config: AppConfigResponse): void {
  const normalized = normalizeClientAgentConfig(config);
  appConfigState.set(root, normalized);
  const list = root.querySelector<HTMLElement>("[data-agent-config-list]");
  if (list) {
    list.innerHTML = normalized.apps.length > 0
      ? normalized.apps.map((agent) => renderAgentListItem(agent, agent.id === normalized.defaultAppId)).join("")
      : `<div class="settings-source-empty">\u6682\u65e0\u5e94\u7528\uff0c\u70b9\u51fb\u201c\u65b0\u589e\u5e94\u7528\u201d\u521b\u5efa\u3002</div>`;
    list.querySelectorAll<HTMLButtonElement>("[data-agent-config-select]").forEach((button) => {
      button.addEventListener("click", () => {
        syncAgentFormToState(root);
        const state = appConfigState.get(root);
        if (!state) return;
        const selectedId = button.dataset.agentConfigSelect ?? null;
        state.defaultAppId = selectedId;
        renderAgentConfig(root, state);
        if (selectedId) {
          openAgentConfigModal(root, selectedId);
        }
      });
    });
  }
  renderAgentEditor(root, normalized.apps.find((agent) => agent.id === normalized.defaultAppId) ?? null);
  rerenderLlmProviderCards(root);
}

function openAgentConfigModal(root: HTMLElement, agentId: string): void {
  const config = appConfigState.get(root);
  const agent = config?.apps.find((item) => item.id === agentId) ?? null;
  if (!agent) return;
  agentEditSnapshotState.set(root, cloneAgent(agent));
  const modal = root.querySelector<HTMLElement>("[data-agent-config-modal]");
  if (!modal) return;
  modal.hidden = false;
  root.querySelector<HTMLInputElement>("[data-agent-config-field=\"name\"]")?.focus();
}

function closeAgentConfigModal(root: HTMLElement, options: { restore: boolean }): void {
  if (options.restore) {
    restoreAgentEditSnapshot(root);
  }
  agentEditSnapshotState.delete(root);
  const modal = root.querySelector<HTMLElement>("[data-agent-config-modal]");
  if (modal) {
    modal.hidden = true;
  }
}

function restoreAgentEditSnapshot(root: HTMLElement): void {
  const snapshot = agentEditSnapshotState.get(root);
  const config = appConfigState.get(root);
  if (!snapshot || !config) return;
  const index = config.apps.findIndex((agent) => agent.id === snapshot.id);
  if (index < 0) return;
  config.apps[index] = cloneAgent(snapshot);
  config.defaultAppId = snapshot.id;
  renderAgentConfig(root, config);
}

function cloneAgent(agent: AppDefinitionResponse): AppDefinitionResponse {
  return { ...agent };
}

function renderAgentListItem(agent: AppDefinitionResponse, active: boolean): string {
  return `
    <button type="button" class="settings-agent-config__item" data-agent-config-select="${escapeHtml(agent.id)}" data-active="${active ? "true" : "false"}">
      <span>${agent.enabled ? "\u25cf" : "\u25cb"}</span>
      <strong>${escapeHtml(agent.name)}</strong>
      <small>${escapeHtml(`${formatAppModeLabel(agent.mode)} · ${agent.purpose || "\u672a\u586b\u5199\u7528\u9014"}`)}</small>
    </button>
  `;
}

function readAgentEditorFields(agent: AppDefinitionResponse | null): Array<[string, string]> {
  if (!agent) {
    return [
      ["id", ""],
      ["name", ""],
      ["mode", "chat"],
      ["purpose", ""],
      ["provider", "openai"],
      ["workflow", ""],
      ["prompt", ""],
    ];
  }
  return [
    ["id", agent.id],
    ["name", agent.name],
    ["mode", agent.mode],
    ["purpose", agent.purpose],
    ["provider", agent.provider],
    ["workflow", agent.workflow],
    ["prompt", agent.prompt],
  ];
}

// fallow-ignore-next-line complexity
function renderAgentEditor(root: HTMLElement, agent: AppDefinitionResponse | null): void {
  for (const [key, value] of readAgentEditorFields(agent)) {
    setAgentField(root, key, value);
  }
  const title = root.querySelector<HTMLElement>("[data-agent-config-modal-title]");
  if (title) title.textContent = agent?.name || "Agent";
  renderAgentAccountOptions(root, agent?.accountRef ?? "");
  void hydrateAgentModelOptions(root, agent?.model ?? "");
  const enabled = root.querySelector<HTMLInputElement>("[data-agent-config-field=\"enabled\"]");
  if (enabled) enabled.checked = agent?.enabled ?? false;
}

function syncAgentFormToState(root: HTMLElement): void {
  const config = appConfigState.get(root);
  if (!config) return;
  const editorAgentId = readAgentField(root, "id");
  const activeAgentId = editorAgentId || config.defaultAppId;
  if (!activeAgentId) return;
  const index = config.apps.findIndex((agent) => agent.id === activeAgentId);
  if (index < 0) return;
  config.defaultAppId = activeAgentId;
  config.apps[index] = {
    ...config.apps[index]!,
    name: readAgentField(root, "name") || config.apps[index]!.name,
    mode: normalizeAppMode(readAgentField(root, "mode")),
    purpose: readAgentField(root, "purpose"),
    provider: readAgentField(root, "provider") || "openai",
    accountRef: readAgentField(root, "accountRef"),
    model: readAgentField(root, "model"),
    workflow: readAgentField(root, "workflow"),
    prompt: readAgentField(root, "prompt"),
    enabled: root.querySelector<HTMLInputElement>("[data-agent-config-field=\"enabled\"]")?.checked ?? false,
    updatedAt: new Date().toISOString(),
  };
}

function deleteSelectedAgent(root: HTMLElement): void {
  const config = appConfigState.get(root);
  if (!config?.defaultAppId) return;
  config.apps = config.apps.filter((agent) => agent.id !== config.defaultAppId);
  config.defaultAppId = config.apps.find((agent) => agent.enabled)?.id ?? config.apps[0]?.id ?? null;
  renderAgentConfig(root, config);
  closeAgentConfigModal(root, { restore: false });
  setAgentConfigStatus(root, "\u5df2\u79fb\u9664\u5e94\u7528\uff0c\u8bf7\u4fdd\u5b58\u540e\u751f\u6548\u3002");
}

function createClientAgent(): AppDefinitionResponse {
  const now = new Date().toISOString();
  return {
    id: `app-${Date.now()}`,
    name: "\u65b0\u5e94\u7528",
    mode: "chat",
    purpose: "",
    provider: "openai",
    accountRef: "",
    model: "",
    workflow: "",
    prompt: "",
    enabled: true,
    updatedAt: now,
  };
}

function normalizeClientAgentConfig(config: AppConfigResponse): AppConfigResponse {
  const defaultAppId = config.defaultAppId && config.apps.some((agent) => agent.id === config.defaultAppId)
    ? config.defaultAppId
    : config.apps.find((agent) => agent.enabled)?.id ?? config.apps[0]?.id ?? null;
  return {
    ...config,
    apps: config.apps.map((agent) => ({ ...agent, mode: normalizeAppMode(agent.mode), accountRef: agent.accountRef ?? "" })),
    defaultAppId,
  };
}

function normalizeAppMode(value: string): AppDefinitionResponse["mode"] {
  return value === "workflow" || value === "knowledge" || value === "hybrid" ? value : "chat";
}

function formatAppModeLabel(mode: AppDefinitionResponse["mode"]): string {
  switch (mode) {
    case "workflow":
      return "工作流";
    case "knowledge":
      return "知识";
    case "hybrid":
      return "混合";
    default:
      return "对话";
  }
}

function setAgentField(root: HTMLElement, key: string, value: string): void {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-agent-config-field="${cssEscape(key)}"]`);
  if (field) field.value = value;
}

function readAgentField(root: HTMLElement, key: string): string {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-agent-config-field="${cssEscape(key)}"]`)?.value.trim() ?? "";
}

function setAgentConfigStatus(root: HTMLElement, text: string): void {
  const status = root.querySelector<HTMLElement>("[data-agent-config-status]");
  if (status) status.textContent = text;
}

function readHost(value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

async function hydrateSettings(
  targetInput: HTMLInputElement,
  sourceList: HTMLUListElement,
  status: HTMLElement,
): Promise<void> {
  if (!window.llmWikiDesktop) {
    status.textContent = "\u5f53\u524d\u662f\u6d4f\u89c8\u5668\u9884\u89c8\u6a21\u5f0f\uff0c\u672c\u5730\u6587\u4ef6\u9009\u62e9\u53ea\u5728 Electron \u5e94\u7528\u4e2d\u53ef\u7528\u3002";
    renderSources(sourceList, []);
    return;
  }
  const bootstrap = await window.llmWikiDesktop.getAppBootstrap();
  targetInput.value = bootstrap.appConfig?.targetRepoPath ?? bootstrap.desktopConfig.targetVault ?? "";
  renderSources(sourceList, bootstrap.appConfig?.sourceFolders ?? []);
}

async function hydrateShortcutSettings(
  shortcutInputs: readonly HTMLInputElement[],
  shortcutStatus: HTMLElement,
): Promise<void> {
  if (!window.llmWikiDesktop || typeof window.llmWikiDesktop.getShortcuts !== "function") {
    shortcutStatus.textContent = "\u5f53\u524d\u662f\u6d4f\u89c8\u5668\u9884\u89c8\u6a21\u5f0f\uff0c\u5feb\u6377\u952e\u4fee\u6539\u53ea\u5728 Electron \u5e94\u7528\u4e2d\u751f\u6548\u3002";
    return;
  }
  const shortcuts = await window.llmWikiDesktop.getShortcuts();
  applyShortcutInputValues(shortcutInputs, shortcuts.shortcuts);
  setClientKeyboardShortcuts(shortcuts.shortcuts);
  shortcutStatus.textContent = shortcuts.registered
    ? "\u5f53\u524d\u5feb\u6377\u952e\u5df2\u6ce8\u518c\u3002"
    : `\u5f53\u524d\u5feb\u6377\u952e\u672a\u6ce8\u518c\uff1a${shortcuts.error ?? shortcuts.shortcuts.flashDiaryCapture}`;
}

function renderSources(list: HTMLUListElement, sources: string[]): void {
  if (sources.length === 0) {
    list.innerHTML = `<li class="settings-source-empty">\u6682\u672a\u6dfb\u52a0</li>`;
    return;
  }
  list.innerHTML = sources.map((source) => `
    <li class="settings-source-item" data-source="${escapeHtml(source)}">
      <span>${escapeHtml(source)}</span>
      <button type="button" class="btn btn-secondary btn-inline" data-remove-source>\u5220\u9664</button>
    </li>
  `).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-remove-source]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest("li")?.remove();
      if (readSources(list).length === 0) renderSources(list, []);
    });
  });
}

function readSources(list: HTMLUListElement): string[] {
  return Array.from(list.querySelectorAll<HTMLLIElement>("[data-source]"))
    .map((item) => item.dataset.source ?? "")
    .filter(Boolean);
}

function readProviderInput(root: HTMLElement, key: string): string {
  const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-provider]"));
  return controls.find((input) => input.dataset.provider === key)?.value.trim() ?? "";
}

async function readJsonPayload<T>(response: Response): Promise<T> {
  return readSettingsJsonPayload<T>(response);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function cssEscape(value: string): string {
  if (typeof window.CSS?.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
