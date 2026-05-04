/**
 * Shared state-derivation helpers for the settings page.
 * These helpers stay focused on the pieces still shared across multiple
 * settings panels: import progress snapshots and default-account summaries.
 */

interface XiaohongshuImportLikeState {
  cookie: string;
  importDirPath?: string;
}

interface XiaohongshuProgressLike {
  taskId: string | null;
  progress: number;
  status: "idle" | "queued" | "importing" | "success" | "error";
  message: string;
  hasCookie?: boolean;
  importDirPath?: string;
}

interface XiaohongshuImportStoredState extends XiaohongshuImportLikeState {
  progress: number;
  status: "idle" | "saving" | "queued" | "importing" | "success" | "error";
  message?: string;
  taskId?: string;
}

interface DouyinCookieLikeState {
  cookie?: string;
  hasCookie?: boolean;
  path?: string;
}

interface DouyinCookieLikeSnapshot {
  cookie?: string;
  status: "idle" | "saving" | "success" | "error";
  message?: string;
  hasCookie?: boolean;
  path?: string;
}

interface AgentAccountOptionLike {
  value: string;
  label: string;
  provider: string;
  model?: string;
  source?: "default" | "api" | "oauth";
  accountName?: string;
}

interface LlmConfigLikeState {
  provider: string;
  accountRef?: string;
  model: string;
  url?: string;
}

interface LlmApiAccountLike {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled?: boolean;
}

interface OAuthAccountLike {
  name: string;
  provider: string;
  email?: string;
  enabled?: boolean;
  accountRef?: string;
}

interface LlmDefaultSelectionArgs {
  readonly options: readonly AgentAccountOptionLike[];
  readonly config: LlmConfigLikeState | null;
  readonly selectedValue: string;
}

interface RenderedLlmDefaultOptionsArgs {
  readonly options: readonly AgentAccountOptionLike[];
  readonly preferredValue: string;
  readonly fallbackProvider: string;
}

interface LlmDefaultSelectionSummary {
  sourceText: string;
  providerId: string;
  modelText: string;
}

interface RenderedLlmDefaultOptions {
  disabled: boolean;
  selectedValue: string;
  options: AgentAccountOptionLike[];
}

interface LlmProviderStatusArgs {
  readonly config: LlmConfigLikeState;
  readonly emptyText: string;
  readonly prefix: string;
  readonly resolveHost: (url: string) => string | null;
}

interface BuildLlmDefaultAccountOptionsArgs {
  readonly apiAccounts: readonly LlmApiAccountLike[];
  readonly oauthAccounts: readonly OAuthAccountLike[];
  readonly getProviderDisplayName: (providerId: string) => string;
  readonly formatOAuthProvider: (providerId: string) => string;
  readonly providerFromOAuthAccount: (providerId: string) => string;
}

interface LlmAccountRowLike {
  id?: string;
  name?: string;
  url?: string;
  model?: string;
  keyConfigured?: boolean;
}

interface LlmAccountRowView {
  accountId?: string;
  keyPlaceholder: string;
  modelValue: string;
  nameValue: string;
  urlValue: string;
}

export function buildXiaohongshuProgressSnapshot(
  state: XiaohongshuImportLikeState | undefined,
  progress: XiaohongshuProgressLike,
): XiaohongshuProgressLike {
  return {
    ...progress,
    hasCookie: progress.hasCookie ?? Boolean(state?.cookie.trim()),
    importDirPath: progress.importDirPath ?? state?.importDirPath ?? "",
  };
}

export function buildXiaohongshuImportState(
  state: XiaohongshuImportStoredState | undefined,
  progress: XiaohongshuProgressLike,
): { nextImportDirPath: string; nextState: XiaohongshuImportStoredState } {
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

export function buildXiaohongshuImportDirState(
  state: XiaohongshuImportStoredState | undefined,
  importDirPath: string,
): XiaohongshuImportStoredState {
  return {
    cookie: state?.cookie ?? "",
    importDirPath,
    progress: state?.progress ?? 0,
    status: state?.status ?? "idle",
    message: state?.message,
    taskId: state?.taskId,
  };
}

export function describeXhsSyncStatus(failureCount: number): string {
  if (failureCount > 0) {
    return `有 ${failureCount} 条小红书同步问题，已写入审查页。`;
  }
  return "小红书同步状态正常。";
}

export function buildDouyinCookieSnapshot(
  state: DouyinCookieLikeState | undefined,
  snapshot: DouyinCookieLikeSnapshot,
): DouyinCookieLikeSnapshot {
  return {
    cookie: snapshot.cookie ?? state?.cookie ?? "",
    status: snapshot.status,
    message: snapshot.message,
    hasCookie: snapshot.hasCookie ?? state?.hasCookie ?? false,
    path: snapshot.path ?? state?.path ?? "",
  };
}

export function describeLlmDefaultSelection(args: LlmDefaultSelectionArgs): LlmDefaultSelectionSummary {
  const selectedValue = args.selectedValue.trim() || args.config?.accountRef?.trim() || "";
  const selectedOption = args.options.find((option) => option.value === selectedValue);
  return {
    sourceText: describeSelectionSource(selectedValue, selectedOption),
    providerId: selectedOption?.provider ?? args.config?.provider ?? "openai",
    modelText: describeSelectionModel(selectedValue, selectedOption, args.config),
  };
}

export function describeLlmProviderStatus(args: LlmProviderStatusArgs): string {
  if (!args.config.url) {
    return args.emptyText;
  }
  return `${args.prefix}${args.resolveHost(args.config.url) ?? args.config.url}`;
}

export function buildLlmDefaultAccountOptions(
  args: BuildLlmDefaultAccountOptionsArgs,
): AgentAccountOptionLike[] {
  const options: AgentAccountOptionLike[] = [];
  appendEnabledApiAccountOptions(options, args.apiAccounts, args.getProviderDisplayName);
  appendEnabledOAuthAccountOptions(
    options,
    args.oauthAccounts,
    args.formatOAuthProvider,
    args.providerFromOAuthAccount,
  );
  return options;
}

export function resolveRenderedLlmDefaultOptions(
  args: RenderedLlmDefaultOptionsArgs,
): RenderedLlmDefaultOptions {
  if (!args.preferredValue) {
    return {
      disabled: args.options.length === 0,
      selectedValue: args.options[0]?.value ?? "",
      options: [...args.options],
    };
  }
  if (args.options.some((option) => option.value === args.preferredValue)) {
    return {
      disabled: false,
      selectedValue: args.preferredValue,
      options: [...args.options],
    };
  }
  return {
    disabled: false,
    selectedValue: args.preferredValue,
    options: [
      ...args.options,
      {
        value: args.preferredValue,
        label: `已保存账号 · ${args.preferredValue}`,
        provider: args.fallbackProvider,
      },
    ],
  };
}

function describeSelectionSource(
  selectedValue: string,
  option: AgentAccountOptionLike | undefined,
): string {
  if (!selectedValue) {
    return "暂无可用账号";
  }
  if (option?.source === "oauth") {
    return `OAuth · ${option.accountName ?? option.label}`;
  }
  if (option?.source === "api") {
    return `API · ${option.accountName ?? option.label}`;
  }
  return `已保存账号 · ${selectedValue}`;
}

function describeSelectionModel(
  selectedValue: string,
  option: AgentAccountOptionLike | undefined,
  config: LlmConfigLikeState | null,
): string {
  if (option?.model) {
    return option.model;
  }
  if (config?.accountRef === selectedValue && config.model) {
    return config.model;
  }
  return "保存后按账号模型运行";
}

function appendEnabledApiAccountOptions(
  options: AgentAccountOptionLike[],
  accounts: readonly LlmApiAccountLike[],
  getProviderDisplayName: (providerId: string) => string,
): void {
  for (const account of accounts) {
    if (account.enabled === false) {
      continue;
    }
    options.push({
      value: `api:${account.id}`,
      label: `${getProviderDisplayName(account.provider)} · ${account.name}`,
      provider: account.provider,
      model: account.model,
      source: "api",
      accountName: account.name,
    });
  }
}

function appendEnabledOAuthAccountOptions(
  options: AgentAccountOptionLike[],
  accounts: readonly OAuthAccountLike[],
  formatOAuthProvider: (providerId: string) => string,
  providerFromOAuthAccount: (providerId: string) => string,
): void {
  for (const account of accounts) {
    if (account.enabled === false) {
      continue;
    }
    options.push({
      value: account.accountRef ?? `oauth:${account.provider}:${account.name}`,
      label: `${formatOAuthProvider(account.provider)} · ${account.email ?? account.name}`,
      provider: providerFromOAuthAccount(account.provider),
      source: "oauth",
      accountName: account.email ?? account.name,
    });
  }
}

export function describeLlmAccountRowView(
  defaultEndpoint: string,
  account?: LlmAccountRowLike,
): LlmAccountRowView {
  const view: LlmAccountRowView = {
    keyPlaceholder: "",
    modelValue: "",
    nameValue: "",
    urlValue: defaultEndpoint,
  };
  if (!account) {
    return view;
  }
  if (account.id) {
    view.accountId = account.id;
  }
  if (account.keyConfigured) {
    view.keyPlaceholder = "已保存密钥，重新输入可覆盖";
  }
  if (account.model) {
    view.modelValue = account.model;
  }
  if (account.name) {
    view.nameValue = account.name;
  }
  if (account.url) {
    view.urlValue = account.url;
  }
  return view;
}
