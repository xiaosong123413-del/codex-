/**
 * Network search and supporting settings panels.
 *
 * These helpers keep the main settings page focused on page composition while
 * this module owns the network-search status wiring and the adjacent static
 * support panels.
 */

interface SearchStatusResponse {
  local: {
    configured: boolean;
  };
  web: {
    configured: boolean;
    endpointHost: string | null;
  };
  vector?: {
    enabled: boolean;
    configured: boolean;
    endpointHost: string | null;
    model: string;
  };
}

interface SearchProviderConfigResponse {
  url: string;
  keyConfigured: boolean;
  model: string;
}

interface SearchProviderTestResponse {
  success?: boolean;
  data?: {
    ok?: boolean;
    message?: string;
  };
  error?: string;
}

interface VectorSearchConfigResponse {
  enabled: boolean;
  source: EmbeddingSource;
  endpoint: string;
  apiKeyConfigured: boolean;
  model: string;
  maxChunkChars: number;
  overlapChunkChars: number;
}

type EmbeddingSource = "api" | "local";

interface EmbeddingServicesResponse {
  services: EmbeddingServiceOption[];
}

interface EmbeddingServiceOption {
  id: string;
  name: string;
  source: EmbeddingSource;
  endpoint: string;
  model: string;
  status: "available" | "unavailable" | "not_checked";
  description: string;
  managedByApp: boolean;
  managedRunning: boolean;
}

interface VectorIndexStatusResponse {
  enabled: boolean;
  configured: boolean;
  dbExists: boolean;
  tableExists: boolean;
  chunkCount: number;
  pageCount: number;
  sizeBytes: number;
  updatedAt: string | null;
}

interface SearchBenchmarkResponse {
  queryCount: number;
  documentCount: number;
  k: number;
  baseline: SearchBenchmarkMetrics;
  current: SearchBenchmarkMetrics;
}

interface SearchBenchmarkMetrics {
  precision: number;
  recall: number;
  mrr: number;
  ndcg: number;
}

export function renderNetworkSearchProviderCard(): string {
  return `
    <article class="settings-card settings-card--network-search">
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">PROVIDER</div>
          <h2>&#x7f51;&#x7edc;&#x641c;&#x7d22; API</h2>
        </div>
        <span class="settings-status-light" data-search-provider-light></span>
      </div>
      <p data-search-provider-status>&#x6b63;&#x5728;&#x68c0;&#x67e5; /api/search/status...</p>
      <div class="settings-provider-fields">
        <label class="settings-field"><span>&#x5730;&#x5740;</span><input data-provider="search:url" type="text" /></label>
        <label class="settings-field"><span>&#x5bc6;&#x94a5;</span><input data-provider="search:key" type="password" /></label>
        <label class="settings-field"><span>Provider / &#x6a21;&#x578b;</span><input data-provider="search:model" type="text" /></label>
      </div>
      <div class="settings-run-panel__actions settings-network-search-actions">
        <button type="button" class="btn btn-secondary" data-search-provider-save>&#x4fdd;&#x5b58;</button>
        <button type="button" class="btn btn-primary" data-search-provider-test>&#x5237;&#x65b0; / &#x6d4b;&#x8bd5;</button>
      </div>
    </article>
  `;
}

export function renderVectorSearchProviderCard(): string {
  return `
    <article class="settings-card settings-card--network-search">
      <div class="settings-card__header">
        <div>
          <div class="eyebrow">LOCAL RETRIEVAL</div>
          <h2>&#x672c;&#x5730;&#x5411;&#x91cf;&#x68c0;&#x7d22;</h2>
        </div>
        <div class="settings-vector-header-actions">
          <button type="button" class="btn btn-secondary settings-vector-enable" data-vector-enable-toggle>&#x542f;&#x7528;</button>
          <span class="settings-status-light" data-vector-provider-light></span>
        </div>
      </div>
      <p data-vector-provider-status>&#x6b63;&#x5728;&#x8bfb;&#x53d6;&#x5411;&#x91cf;&#x68c0;&#x7d22;&#x914d;&#x7f6e;...</p>
      <input data-provider="vector:enabled" type="checkbox" hidden />
      <label class="settings-field">
        <span>Embedding &#x6765;&#x6e90;</span>
        <select data-provider="vector:source">
          <option value="api">&#x7f51;&#x7edc; / &#x4e2d;&#x8f6c; API</option>
          <option value="local">&#x672c;&#x673a; embedding &#x670d;&#x52a1;</option>
        </select>
      </label>
      <div class="settings-embedding-services">
        <div class="settings-embedding-services__header">
          <button type="button" class="settings-embedding-services__toggle" data-embedding-services-toggle aria-expanded="false">
            <span data-embedding-services-arrow>&#x25b8;</span>
            <strong>&#x53ef;&#x9009; embedding &#x670d;&#x52a1;</strong>
          </button>
          <button type="button" class="btn btn-secondary" data-embedding-services-refresh>&#x5237;&#x65b0;</button>
        </div>
        <div class="settings-embedding-services__list" data-embedding-services-list hidden>
          <span class="settings-run-panel__chip">&#x672a;&#x8bfb;&#x53d6;</span>
        </div>
      </div>
      <div class="settings-provider-fields">
        <label class="settings-field"><span>Embedding endpoint / Base URL</span><input data-provider="vector:endpoint" type="text" placeholder="https://api.whatai.cc 或 https://api.example.com/v1/embeddings" /></label>
        <label class="settings-field"><span>API Key</span><input data-provider="vector:key" type="password" /></label>
        <label class="settings-field"><span>Embedding model</span><input data-provider="vector:model" type="text" placeholder="text-embedding-3-small" /></label>
        <label class="settings-field"><span>Chunk &#x5b57;&#x7b26;&#x6570;</span><input data-provider="vector:maxChunkChars" type="number" min="200" max="8000" /></label>
        <label class="settings-field"><span>Overlap &#x5b57;&#x7b26;&#x6570;</span><input data-provider="vector:overlapChunkChars" type="number" min="0" max="4000" /></label>
      </div>
      <div class="settings-run-panel__actions settings-network-search-actions">
        <button type="button" class="btn btn-secondary" data-vector-provider-save>&#x4fdd;&#x5b58;</button>
        <button type="button" class="btn btn-primary" data-vector-provider-test>&#x6d4b;&#x8bd5; embedding</button>
        <button type="button" class="btn btn-secondary" data-vector-provider-rebuild>&#x91cd;&#x5efa;&#x5411;&#x91cf;&#x7d22;&#x5f15;</button>
        <button type="button" class="btn btn-secondary" data-search-benchmark-run>&#x8fd0;&#x884c;&#x68c0;&#x7d22;&#x8bc4;&#x6d4b;</button>
      </div>
      <div class="settings-run-panel__summary" data-vector-index-status>
        <span class="settings-run-panel__chip">&#x5411;&#x91cf;&#x5e93;&#x72b6;&#x6001;&#x672a;&#x8bfb;&#x53d6;</span>
      </div>
      <div class="settings-run-panel__summary" data-search-benchmark-status>
        <span class="settings-run-panel__chip">&#x672a;&#x8fd0;&#x884c;&#x68c0;&#x7d22;&#x8bc4;&#x6d4b;</span>
      </div>
    </article>
  `;
}

export function bindNetworkSearchPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-search-provider-save]")?.addEventListener("click", () => {
    void saveSearchProviderConfig(root);
  });
  root.querySelector<HTMLButtonElement>("[data-search-provider-test]")?.addEventListener("click", () => {
    void testSearchProvider(root);
  });
  bindVectorSearchPanel(root);
  void hydrateSearchStatus(root);
}

function bindVectorSearchPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-vector-provider-save]")?.addEventListener("click", () => {
    void saveVectorSearchConfig(root);
  });
  root.querySelector<HTMLButtonElement>("[data-vector-provider-test]")?.addEventListener("click", () => {
    void testVectorSearchConfig(root);
  });
  root.querySelector<HTMLButtonElement>("[data-vector-provider-rebuild]")?.addEventListener("click", () => {
    void rebuildVectorIndex(root);
  });
  root.querySelector<HTMLButtonElement>("[data-search-benchmark-run]")?.addEventListener("click", () => {
    void runSearchBenchmark(root);
  });
  root.querySelector<HTMLButtonElement>("[data-vector-enable-toggle]")?.addEventListener("click", () => {
    toggleVectorEnabled(root);
  });
  root.querySelector<HTMLButtonElement>("[data-embedding-services-toggle]")?.addEventListener("click", () => {
    toggleEmbeddingServices(root);
  });
  root.querySelector<HTMLButtonElement>("[data-embedding-services-refresh]")?.addEventListener("click", () => {
    setEmbeddingServicesExpanded(root, true);
    void hydrateEmbeddingServices(root);
  });
  root.querySelector<HTMLElement>("[data-embedding-services-list]")?.addEventListener("click", (event) => {
    if (handleLocalEmbeddingAction(root, event.target)) return;
    applyEmbeddingService(root, event.target);
  });
}

async function hydrateSearchStatus(root: HTMLElement): Promise<void> {
  const badge = root.querySelector<HTMLElement>("[data-search-provider-light]");
  const status = root.querySelector<HTMLElement>("[data-search-provider-status]");
  if (!badge || !status) return;
  await hydrateSearchProviderConfig(root);
  try {
    const response = await fetch("/api/search/status");
    const payload = await response.json() as { success?: boolean; data?: SearchStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "\u641c\u7d22\u72b6\u6001\u8bfb\u53d6\u5931\u8d25");
    }
    renderSearchStatus(badge, status, payload.data.web.configured, payload.data.web.endpointHost);
    renderVectorStatusFromSearchStatus(root, payload.data.vector);
  } catch (error) {
    badge.className = "settings-status-light is-error";
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderVectorStatusFromSearchStatus(root: HTMLElement, vector: SearchStatusResponse["vector"]): void {
  const badge = root.querySelector<HTMLElement>("[data-vector-provider-light]");
  const status = root.querySelector<HTMLElement>("[data-vector-provider-status]");
  if (!badge || !status || !vector) return;
  badge.className = vector.enabled ? "settings-status-light is-ok" : "settings-status-light is-muted";
  status.textContent = vector.enabled
    ? `\u5411\u91cf\u68c0\u7d22\u5df2\u542f\u7528\uff1a${vector.endpointHost ?? vector.model}`
    : "\u5411\u91cf\u68c0\u7d22\u5df2\u5173\u95ed\uff0c\u5f53\u524d\u4ec5\u4f7f\u7528 token \u68c0\u7d22 + \u56fe\u6269\u5c55\u3002";
}

function setSearchProviderStatus(
  badge: HTMLElement,
  status: HTMLElement,
  tone: "error" | "loading",
  message: string,
): void {
  badge.className = `settings-status-light is-${tone}`;
  status.textContent = message;
}

function setVectorProviderStatus(root: HTMLElement, tone: "error" | "loading" | "ok" | "muted", message: string): void {
  const badge = root.querySelector<HTMLElement>("[data-vector-provider-light]");
  const status = root.querySelector<HTMLElement>("[data-vector-provider-status]");
  if (!badge || !status) return;
  badge.className = `settings-status-light is-${tone}`;
  status.textContent = message;
}

async function readSearchProviderConfigData(response: Response): Promise<SearchProviderConfigResponse> {
  const payload = await response.json() as { success?: boolean; data?: SearchProviderConfigResponse; error?: string };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "\u4fdd\u5b58\u5931\u8d25");
  }
  return payload.data;
}

function describeSavedSearchProviderStatus(config: SearchProviderConfigResponse): string {
  if (!config.url) {
    return "\u5df2\u6e05\u7a7a\u7f51\u7edc\u641c\u7d22\u914d\u7f6e\u3002";
  }
  return `\u5df2\u4fdd\u5b58\uff1a${readHost(config.url) ?? config.url}`;
}

async function readSearchProviderTestMessage(response: Response): Promise<string> {
  const payload = await response.json() as SearchProviderTestResponse;
  if (!response.ok || !payload.success || !payload.data?.ok) {
    throw new Error(payload.error ?? payload.data?.message ?? "\u6d4b\u8bd5\u5931\u8d25");
  }
  return payload.data.message ?? "\u7f51\u7edc\u641c\u7d22 API \u53ef\u7528\u3002";
}

function renderSearchProviderTestSuccess(badge: HTMLElement, status: HTMLElement, message: string): void {
  renderSearchStatus(badge, status, true, readHost(""));
  status.textContent = message;
}

async function saveSearchProviderConfig(root: HTMLElement): Promise<void> {
  const badge = root.querySelector<HTMLElement>("[data-search-provider-light]");
  const status = root.querySelector<HTMLElement>("[data-search-provider-status]");
  if (!badge || !status) return;
  setSearchProviderStatus(badge, status, "loading", "\u6b63\u5728\u4fdd\u5b58\u7f51\u7edc\u641c\u7d22\u914d\u7f6e...");
  try {
    const response = await fetch("/api/search/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: readSearchInput(root, "search:url"),
        key: readSearchInput(root, "search:key"),
        model: readSearchInput(root, "search:model"),
      }),
    });
    const data = await readSearchProviderConfigData(response);
    renderSearchProviderConfig(root, data);
    renderSearchStatus(badge, status, Boolean(data.url), readHost(data.url));
    status.textContent = describeSavedSearchProviderStatus(data);
  } catch (error) {
    setSearchProviderStatus(
      badge,
      status,
      "error",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function testSearchProvider(root: HTMLElement): Promise<void> {
  const badge = root.querySelector<HTMLElement>("[data-search-provider-light]");
  const status = root.querySelector<HTMLElement>("[data-search-provider-status]");
  if (!badge || !status) return;
  setSearchProviderStatus(badge, status, "loading", "\u6b63\u5728\u6d4b\u8bd5\u7f51\u7edc\u641c\u7d22 API...");
  try {
    const response = await fetch("/api/search/test", { method: "POST" });
    renderSearchProviderTestSuccess(badge, status, await readSearchProviderTestMessage(response));
  } catch (error) {
    setSearchProviderStatus(
      badge,
      status,
      "error",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function hydrateSearchProviderConfig(root: HTMLElement): Promise<void> {
  await Promise.all([hydrateNetworkSearchProviderConfig(root), hydrateVectorSearchConfig(root)]);
}

async function hydrateNetworkSearchProviderConfig(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/search/config");
    const payload = await response.json() as { success?: boolean; data?: SearchProviderConfigResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "\u641c\u7d22\u914d\u7f6e\u8bfb\u53d6\u5931\u8d25");
    }
    renderSearchProviderConfig(root, payload.data);
  } catch {
    // Keep empty inputs when config cannot be loaded.
  }
}

async function hydrateVectorSearchConfig(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/search/vector-config");
    const payload = await response.json() as { success?: boolean; data?: VectorSearchConfigResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u5411\u91cf\u914d\u7f6e\u8bfb\u53d6\u5931\u8d25");
    renderVectorSearchConfig(root, payload.data);
    await hydrateEmbeddingServices(root);
    await hydrateVectorIndexStatus(root);
  } catch {
    // Keep empty inputs when config cannot be loaded.
  }
}

async function hydrateEmbeddingServices(root: HTMLElement): Promise<void> {
  renderEmbeddingServices(root, null);
  try {
    const response = await fetch("/api/search/embedding-services");
    const payload = await response.json() as { success?: boolean; data?: EmbeddingServicesResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u670d\u52a1\u5217\u8868\u8bfb\u53d6\u5931\u8d25");
    renderEmbeddingServices(root, payload.data.services);
  } catch (error) {
    renderEmbeddingServicesError(root, error instanceof Error ? error.message : String(error));
  }
}

async function hydrateVectorIndexStatus(root: HTMLElement): Promise<void> {
  try {
    const response = await fetch("/api/search/vector-status");
    const payload = await response.json() as { success?: boolean; data?: VectorIndexStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u5411\u91cf\u5e93\u72b6\u6001\u8bfb\u53d6\u5931\u8d25");
    renderVectorIndexStatus(root, payload.data);
  } catch (error) {
    renderVectorPanelMessage(root, "[data-vector-index-status]", error instanceof Error ? error.message : String(error));
  }
}

async function saveVectorSearchConfig(root: HTMLElement): Promise<void> {
  setVectorProviderStatus(root, "loading", "\u6b63\u5728\u4fdd\u5b58\u672c\u5730\u5411\u91cf\u68c0\u7d22\u914d\u7f6e...");
  try {
    const data = await putVectorSearchConfig(root);
    renderVectorSearchConfig(root, data);
    setVectorProviderStatus(root, data.enabled ? "ok" : "muted", describeSavedVectorStatus(data));
  } catch (error) {
    setVectorProviderStatus(root, "error", error instanceof Error ? error.message : String(error));
  }
}

async function putVectorSearchConfig(root: HTMLElement): Promise<VectorSearchConfigResponse> {
  const response = await fetch("/api/search/vector-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readVectorConfigInput(root)),
  });
  const payload = await response.json() as { success?: boolean; data?: VectorSearchConfigResponse; error?: string };
  if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u4fdd\u5b58\u5931\u8d25");
  return payload.data;
}

async function testVectorSearchConfig(root: HTMLElement): Promise<void> {
  setVectorProviderStatus(root, "loading", "\u6b63\u5728\u6d4b\u8bd5 embedding endpoint...");
  try {
    const data = await putVectorSearchConfig(root);
    renderVectorSearchConfig(root, data);
    const message = await readVectorTestMessage(await fetch("/api/search/vector-test", { method: "POST" }));
    setVectorProviderStatus(root, "ok", message);
  } catch (error) {
    setVectorProviderStatus(root, "error", error instanceof Error ? error.message : String(error));
  }
}

async function rebuildVectorIndex(root: HTMLElement): Promise<void> {
  renderVectorPanelMessage(root, "[data-vector-index-status]", "\u6b63\u5728\u91cd\u5efa\u5411\u91cf\u7d22\u5f15...");
  try {
    const response = await fetch("/api/search/vector-rebuild", { method: "POST" });
    const payload = await response.json() as { success?: boolean; data?: VectorIndexStatusResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u91cd\u5efa\u5931\u8d25");
    renderVectorIndexStatus(root, payload.data);
  } catch (error) {
    renderVectorPanelMessage(root, "[data-vector-index-status]", error instanceof Error ? error.message : String(error));
  }
}

async function runSearchBenchmark(root: HTMLElement): Promise<void> {
  renderVectorPanelMessage(root, "[data-search-benchmark-status]", "\u6b63\u5728\u8fd0\u884c\u68c0\u7d22\u8bc4\u6d4b...");
  try {
    const response = await fetch("/api/search/benchmark", { method: "POST" });
    const payload = await response.json() as { success?: boolean; data?: SearchBenchmarkResponse; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "\u8bc4\u6d4b\u5931\u8d25");
    renderSearchBenchmark(root, payload.data);
  } catch (error) {
    renderVectorPanelMessage(root, "[data-search-benchmark-status]", error instanceof Error ? error.message : String(error));
  }
}

function renderSearchProviderConfig(root: HTMLElement, config: SearchProviderConfigResponse): void {
  const urlInput = root.querySelector<HTMLInputElement>("[data-provider=\"search:url\"]");
  const keyInput = root.querySelector<HTMLInputElement>("[data-provider=\"search:key\"]");
  const modelInput = root.querySelector<HTMLInputElement>("[data-provider=\"search:model\"]");
  if (urlInput) {
    urlInput.value = config.url;
  }
  if (keyInput) {
    keyInput.value = "";
    keyInput.placeholder = config.keyConfigured ? "\u5df2\u4fdd\u5b58\u5bc6\u94a5\uff0c\u91cd\u65b0\u8f93\u5165\u53ef\u8986\u76d6" : "";
  }
  if (modelInput) {
    modelInput.value = config.model;
  }
}

function renderVectorSearchConfig(root: HTMLElement, config: VectorSearchConfigResponse): void {
  const enabledInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:enabled\"]");
  const sourceInput = root.querySelector<HTMLSelectElement>("[data-provider=\"vector:source\"]");
  const endpointInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:endpoint\"]");
  const keyInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:key\"]");
  const modelInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:model\"]");
  const maxChunkInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:maxChunkChars\"]");
  const overlapInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:overlapChunkChars\"]");
  if (enabledInput) enabledInput.checked = config.enabled;
  renderVectorEnabledButton(root, config.enabled);
  if (sourceInput) sourceInput.value = config.source;
  if (endpointInput) endpointInput.value = config.endpoint;
  if (modelInput) modelInput.value = config.model;
  if (maxChunkInput) maxChunkInput.value = String(config.maxChunkChars);
  if (overlapInput) overlapInput.value = String(config.overlapChunkChars);
  renderVectorKeyPlaceholder(keyInput, config.apiKeyConfigured);
}

function renderEmbeddingServices(root: HTMLElement, services: EmbeddingServiceOption[] | null): void {
  const list = root.querySelector<HTMLElement>("[data-embedding-services-list]");
  if (!list) return;
  if (!services) {
    list.innerHTML = `<span class="settings-run-panel__chip">\u6b63\u5728\u8bfb\u53d6 embedding \u670d\u52a1...</span>`;
    return;
  }
  list.innerHTML = services.map(renderEmbeddingServiceOption).join("");
}

function renderVectorEnabledButton(root: HTMLElement, enabled: boolean): void {
  const button = root.querySelector<HTMLButtonElement>("[data-vector-enable-toggle]");
  if (!button) return;
  button.dataset.enabled = String(enabled);
  button.textContent = enabled ? "\u5df2\u542f\u7528" : "\u542f\u7528";
}

function renderEmbeddingServiceOption(service: EmbeddingServiceOption): string {
  const tone = service.status === "available" ? " is-ok" : service.status === "unavailable" ? " is-error" : "";
  const action = renderEmbeddingServiceAction(service);
  return `
    <div class="settings-embedding-service" data-embedding-service="${escapeAttr(service.id)}" data-source="${service.source}" data-endpoint="${escapeAttr(service.endpoint)}" data-model="${escapeAttr(service.model)}">
      <span class="settings-run-panel__chip${tone}">${serviceStatusText(service.status)}</span>
      <strong>${escapeHtml(service.name)}</strong>
      <small>${escapeHtml(service.endpoint)} · ${escapeHtml(service.model || "\u672a\u586b\u6a21\u578b")}</small>
      <small>${escapeHtml(service.description)}</small>
      ${action}
    </div>
  `;
}

function renderEmbeddingServiceAction(service: EmbeddingServiceOption): string {
  if (!service.managedByApp) return "";
  const action = service.managedRunning ? "stop" : "start";
  const label = service.managedRunning ? "\u505c\u6b62" : "\u542f\u52a8";
  return `<button type="button" class="btn btn-secondary settings-embedding-service__action" data-local-embedding-action="${action}">${label}</button>`;
}

function renderEmbeddingServicesError(root: HTMLElement, message: string): void {
  const list = root.querySelector<HTMLElement>("[data-embedding-services-list]");
  if (list) list.innerHTML = `<span class="settings-run-panel__chip is-error">${escapeHtml(message)}</span>`;
}

function renderVectorIndexStatus(root: HTMLElement, status: VectorIndexStatusResponse): void {
  renderVectorPanelMessage(root, "[data-vector-index-status]", [
    status.tableExists ? `${status.pageCount} pages` : "\u672a\u5efa\u8868",
    `${status.chunkCount} chunks`,
    `${formatBytes(status.sizeBytes)}`,
    status.updatedAt ? `updated ${formatDateTime(status.updatedAt)}` : "\u672a\u540c\u6b65",
  ].join(" · "));
}

function renderSearchBenchmark(root: HTMLElement, result: SearchBenchmarkResponse): void {
  renderVectorPanelMessage(root, "[data-search-benchmark-status]", [
    `${result.queryCount} queries / ${result.documentCount} docs`,
    `Recall@${result.k}: ${formatMetric(result.baseline.recall)} → ${formatMetric(result.current.recall)}`,
    `MRR: ${formatMetric(result.baseline.mrr)} → ${formatMetric(result.current.mrr)}`,
    `nDCG@${result.k}: ${formatMetric(result.baseline.ndcg)} → ${formatMetric(result.current.ndcg)}`,
  ].join(" · "));
}

function renderVectorPanelMessage(root: HTMLElement, selector: string, message: string): void {
  const container = root.querySelector<HTMLElement>(selector);
  if (container) container.innerHTML = `<span class="settings-run-panel__chip">${escapeHtml(message)}</span>`;
}

function renderVectorKeyPlaceholder(input: HTMLInputElement | null, configured: boolean): void {
  if (!input) return;
  input.value = "";
  input.placeholder = configured ? "\u5df2\u4fdd\u5b58\u5bc6\u94a5\uff0c\u91cd\u65b0\u8f93\u5165\u53ef\u8986\u76d6" : "";
}

function readVectorConfigInput(root: HTMLElement): Record<string, string | boolean> {
  return {
    enabled: root.querySelector<HTMLInputElement>("[data-provider=\"vector:enabled\"]")?.checked ?? false,
    source: readEmbeddingSource(root),
    endpoint: readSearchInput(root, "vector:endpoint"),
    apiKey: readSearchInput(root, "vector:key"),
    model: readSearchInput(root, "vector:model"),
    maxChunkChars: readSearchInput(root, "vector:maxChunkChars"),
    overlapChunkChars: readSearchInput(root, "vector:overlapChunkChars"),
  };
}

function readEmbeddingSource(root: HTMLElement): EmbeddingSource {
  const value = root.querySelector<HTMLSelectElement>("[data-provider=\"vector:source\"]")?.value;
  return value === "local" ? "local" : "api";
}

function describeSavedVectorStatus(config: VectorSearchConfigResponse): string {
  if (!config.enabled) return "\u5df2\u5173\u95ed\u672c\u5730\u5411\u91cf\u68c0\u7d22\u3002";
  const label = config.source === "local" ? "\u672c\u673a\u670d\u52a1" : "\u7f51\u7edc API";
  return `\u5df2\u542f\u7528 ${label}\uff1a${readHost(config.endpoint) ?? config.endpoint} / ${config.model}`;
}

function applyEmbeddingService(root: HTMLElement, target: EventTarget | null): void {
  const card = target instanceof Element ? target.closest<HTMLElement>("[data-embedding-service]") : null;
  if (!card) return;
  setInputValue(root, "vector:endpoint", card.dataset.endpoint ?? "");
  setInputValue(root, "vector:model", card.dataset.model ?? "");
  setVectorEnabled(root, true);
  const sourceInput = root.querySelector<HTMLSelectElement>("[data-provider=\"vector:source\"]");
  if (sourceInput) sourceInput.value = card.dataset.source === "local" ? "local" : "api";
}

function toggleVectorEnabled(root: HTMLElement): void {
  const enabledInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:enabled\"]");
  setVectorEnabled(root, !(enabledInput?.checked ?? false));
}

function setVectorEnabled(root: HTMLElement, enabled: boolean): void {
  const enabledInput = root.querySelector<HTMLInputElement>("[data-provider=\"vector:enabled\"]");
  if (enabledInput) enabledInput.checked = enabled;
  renderVectorEnabledButton(root, enabled);
}

function toggleEmbeddingServices(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>("[data-embedding-services-list]");
  setEmbeddingServicesExpanded(root, Boolean(list?.hidden));
}

function setEmbeddingServicesExpanded(root: HTMLElement, expanded: boolean): void {
  const list = root.querySelector<HTMLElement>("[data-embedding-services-list]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-embedding-services-toggle]");
  const arrow = root.querySelector<HTMLElement>("[data-embedding-services-arrow]");
  if (list) list.hidden = !expanded;
  if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
  if (arrow) arrow.textContent = expanded ? "\u25be" : "\u25b8";
}

function handleLocalEmbeddingAction(root: HTMLElement, target: EventTarget | null): boolean {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>("[data-local-embedding-action]") : null;
  if (!button) return false;
  void runLocalEmbeddingAction(root, button.dataset.localEmbeddingAction === "stop" ? "stop" : "start");
  return true;
}

async function runLocalEmbeddingAction(root: HTMLElement, action: "start" | "stop"): Promise<void> {
  setVectorProviderStatus(root, "loading", action === "start" ? "\u6b63\u5728\u542f\u52a8\u672c\u673a embedding \u670d\u52a1..." : "\u6b63\u5728\u505c\u6b62\u672c\u673a embedding \u670d\u52a1...");
  try {
    const response = await fetch(`/api/search/local-embedding/${action}`, { method: "POST" });
    const payload = await response.json() as { success?: boolean; data?: { message?: string }; error?: string };
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "\u672c\u673a embedding \u670d\u52a1\u64cd\u4f5c\u5931\u8d25");
    setVectorProviderStatus(root, "ok", payload.data?.message ?? "\u672c\u673a embedding \u670d\u52a1\u72b6\u6001\u5df2\u66f4\u65b0\u3002");
    await hydrateEmbeddingServices(root);
  } catch (error) {
    setVectorProviderStatus(root, "error", error instanceof Error ? error.message : String(error));
  }
}

function setInputValue(root: HTMLElement, key: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`[data-provider="${key}"]`);
  if (input) input.value = value;
}

function serviceStatusText(status: EmbeddingServiceOption["status"]): string {
  if (status === "available") return "\u53ef\u8fde\u63a5";
  if (status === "unavailable") return "\u672a\u8fd0\u884c";
  return "\u9700\u914d\u7f6e";
}

async function readVectorTestMessage(response: Response): Promise<string> {
  const payload = await response.json() as SearchProviderTestResponse;
  if (!response.ok || !payload.success || !payload.data?.ok) {
    throw new Error(payload.error ?? payload.data?.message ?? "\u6d4b\u8bd5\u5931\u8d25");
  }
  return payload.data.message ?? "\u672c\u5730\u5411\u91cf\u68c0\u7d22\u53ef\u7528\u3002";
}

function renderSearchStatus(light: HTMLElement, status: HTMLElement, configured: boolean, endpointHost: string | null): void {
  light.className = configured ? "settings-status-light is-ok" : "settings-status-light is-muted";
  status.textContent = configured
    ? `\u7f51\u7edc\u641c\u7d22 API \u5df2\u914d\u7f6e\uff1a${endpointHost ?? "\u5df2\u914d\u7f6e endpoint"}`
    : "\u672a\u914d\u7f6e CLOUDFLARE_SEARCH_ENDPOINT\uff0cscope=web \u4f1a\u8fd4\u56de\u7a7a\u7ed3\u679c\u3002";
}

function readSearchInput(root: HTMLElement, key: string): string {
  return root.querySelector<HTMLInputElement>(`[data-provider="${key}"]`)?.value.trim() ?? "";
}

function readHost(value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatMetric(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
