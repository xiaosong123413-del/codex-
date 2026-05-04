interface RemoteBrainStatusPayload {
  provider: "cloudflare";
  mode: "cloudflare-unconfigured" | "cloudflare-connected" | "cloudflare-error";
  connected: boolean;
  endpoint: string | null;
  pushSupported: boolean;
  pullSupported: boolean;
  publishSupported: boolean;
  cloudflare: {
    provider: "cloudflare";
    enabled: boolean;
    workerUrl: string | null;
    accountId: string | null;
    d1DatabaseId: string | null;
    r2Bucket: string | null;
    vectorizeIndex: string | null;
    tokenConfigured: boolean;
  };
  flashDiarySync: {
    mode: string;
    lastSyncedAt: string | null;
    queueSize: number;
  };
  workerResponse?: unknown;
  error?: {
    type: string;
    message: string;
    endpoint: string | null;
    status?: number;
  };
}

interface RemoteBrainActionPayload {
  provider: "cloudflare";
  action: "push" | "pull" | "publish";
  mode: "cloudflare-unconfigured" | "cloudflare-connected" | "cloudflare-error";
  queued: false;
  network: boolean;
  endpoint: string | null;
  cloudflare: RemoteBrainStatusPayload["cloudflare"];
  workerResponse?: unknown;
  error?: RemoteBrainStatusPayload["error"];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: unknown;
}

type RemoteBrainAction = "push" | "pull" | "publish";

interface RemoteBrainSectionElement extends HTMLElement {
  __dispose?: () => void;
  __refreshRemoteBrainStatus?: () => Promise<void>;
}

export function renderAppPublishSection(): HTMLElement {
  const root = document.createElement("article");
  root.className = "settings-card settings-card--app-publish";
  root.id = "publish";
  root.dataset.appPublishSection = "true";
  root.innerHTML = `
    <div class="settings-card__header">
      <div>
        <div class="eyebrow">APP PUBLISH</div>
        <h2>应用发布</h2>
        <p>Remote Brain 是项目级统一出口，应用与自动化复用同一条发布和接入通道。</p>
      </div>
    </div>
    ${renderRemoteBrainPanelBody()}
  `;
  bindRemoteBrainSection(root, false);
  return root;
}

export function hydrateAppPublishSection(root: HTMLElement): void {
  const section = root.querySelector<RemoteBrainSectionElement>("[data-app-publish-section]");
  if (!section || section.dataset.publishLoaded === "true") {
    return;
  }
  section.dataset.publishLoaded = "true";
  void section.__refreshRemoteBrainStatus?.();
}

function renderRemoteBrainPanelBody(): string {
  return `
    <section class="publish-card">
      <div class="publish-card__header">
        <div>
          <div class="eyebrow">REMOTE BRAIN</div>
          <h2>Cloudflare 通道</h2>
        </div>
        <span class="publish-card__status" data-publish-connection>未连接</span>
      </div>
      <dl class="publish-grid">
        <div class="publish-grid__item">
          <dt>Worker URL</dt>
          <dd data-publish-worker-url>未配置</dd>
        </div>
        <div class="publish-grid__item">
          <dt>Account ID</dt>
          <dd data-publish-account-id>未配置</dd>
        </div>
        <div class="publish-grid__item">
          <dt>D1 Database</dt>
          <dd data-publish-d1-id>未配置</dd>
        </div>
        <div class="publish-grid__item">
          <dt>R2 Bucket</dt>
          <dd data-publish-r2-bucket>未配置</dd>
        </div>
        <div class="publish-grid__item">
          <dt>Vectorize Index</dt>
          <dd data-publish-vectorize>未配置</dd>
        </div>
        <div class="publish-grid__item">
          <dt>Flash Diary Sync</dt>
          <dd data-publish-flash-diary>local</dd>
        </div>
      </dl>
      <div class="publish-card__hint" data-publish-hint>需要设置 CLOUDFLARE_WORKER_URL 和 CLOUDFLARE_REMOTE_TOKEN。</div>
      <div class="publish-card__actions">
        <button type="button" class="btn btn-secondary" data-publish-action="push">推送</button>
        <button type="button" class="btn btn-secondary" data-publish-action="pull">拉取</button>
        <button type="button" class="btn btn-primary" data-publish-action="publish">发布</button>
      </div>
    </section>
    <section class="publish-result">
      <div class="publish-result__header">
        <div>
          <div class="eyebrow">RESULT</div>
          <h2>运行结果</h2>
        </div>
      </div>
      <pre class="publish-result__body" data-publish-result>等待读取 Remote Brain 状态...</pre>
    </section>
  `;
}

// fallow-ignore-next-line complexity
function bindRemoteBrainSection(root: RemoteBrainSectionElement, autoload: boolean): void {
  const mode = root.querySelector<HTMLElement>("[data-publish-mode]");
  const endpoint = root.querySelector<HTMLElement>("[data-publish-endpoint]");
  const connection = root.querySelector<HTMLElement>("[data-publish-connection]");
  const workerUrl = root.querySelector<HTMLElement>("[data-publish-worker-url]");
  const accountId = root.querySelector<HTMLElement>("[data-publish-account-id]");
  const d1Id = root.querySelector<HTMLElement>("[data-publish-d1-id]");
  const r2Bucket = root.querySelector<HTMLElement>("[data-publish-r2-bucket]");
  const vectorize = root.querySelector<HTMLElement>("[data-publish-vectorize]");
  const flashDiary = root.querySelector<HTMLElement>("[data-publish-flash-diary]");
  const hint = root.querySelector<HTMLElement>("[data-publish-hint]");
  const result = root.querySelector<HTMLElement>("[data-publish-result]");
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-publish-action]"));
  if (!connection || !workerUrl || !accountId || !d1Id || !r2Bucket || !vectorize || !flashDiary || !hint || !result) {
    return;
  }

  let currentStatus: RemoteBrainStatusPayload | null = null;
  let busy = false;
  let disposed = false;

  root.__dispose = () => {
    disposed = true;
  };
  root.__refreshRemoteBrainStatus = refreshStatus;

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const action = button.dataset.publishAction as RemoteBrainAction | undefined;
      if (!action) {
        return;
      }
      void runAction(action);
    });
  }

  if (autoload) {
    void refreshStatus();
  }

  // fallow-ignore-next-line complexity
  async function refreshStatus(): Promise<void> {
    try {
      const response = await fetch("/api/remote-brain/status");
      const payload = (await response.json()) as ApiResponse<RemoteBrainStatusPayload>;
      if (disposed) {
        return;
      }
      const status = payload.data ?? null;
      currentStatus = status;
      if (status) {
        renderStatus(status);
        if (!payload.success && payload.error) {
          renderResult(payload.error);
        }
        return;
      }
      renderResult(payload.error ?? "Remote Brain 状态不可用。");
      setDisabled(true);
    } catch (error) {
      if (disposed) {
        return;
      }
      currentStatus = null;
      renderResult(error instanceof Error ? error.message : String(error));
      setDisabled(true);
    }
  }

  // fallow-ignore-next-line complexity
  async function runAction(action: RemoteBrainAction): Promise<void> {
    if (busy) {
      return;
    }
    if (!currentStatus || currentStatus.mode !== "cloudflare-connected") {
      renderResult("Cloudflare Remote Brain 未配置，请先设置 CLOUDFLARE_WORKER_URL 和 CLOUDFLARE_REMOTE_TOKEN。");
      return;
    }

    busy = true;
    setDisabled(true);
    renderResult(`正在执行 ${action}...`);
    try {
      const response = await fetch(`/api/remote-brain/${action}`, { method: "POST" });
      const payload = (await response.json()) as ApiResponse<RemoteBrainActionPayload>;
      if (disposed) {
        return;
      }
      if (!response.ok || !payload.success || !payload.data) {
        renderResult(payload.error ?? `Remote Brain ${action} 失败。`);
        await refreshStatus();
        return;
      }
      renderResult(payload.data);
      await refreshStatus();
    } catch (error) {
      if (disposed) {
        return;
      }
      renderResult(error instanceof Error ? error.message : String(error));
      await refreshStatus();
    } finally {
      busy = false;
      if (!disposed) {
        setDisabled(!currentStatus || currentStatus.mode !== "cloudflare-connected");
      }
    }
  }

  // fallow-ignore-next-line complexity
  function renderStatus(status: RemoteBrainStatusPayload): void {
    if (mode) {
      mode.textContent = status.mode;
    }
    if (endpoint) {
      endpoint.textContent = status.endpoint ?? "未配置";
    }
    connection.textContent = status.connected ? "已连接" : "未连接";
    workerUrl.textContent = status.cloudflare.workerUrl ?? "未配置";
    accountId.textContent = status.cloudflare.accountId ?? "未配置";
    d1Id.textContent = status.cloudflare.d1DatabaseId ?? "未配置";
    r2Bucket.textContent = status.cloudflare.r2Bucket ?? "未配置";
    vectorize.textContent = status.cloudflare.vectorizeIndex ?? "未配置";
    flashDiary.textContent = `mode=${status.flashDiarySync.mode} · queue=${status.flashDiarySync.queueSize}`;
    hint.textContent = status.mode === "cloudflare-unconfigured"
      ? "需要设置 CLOUDFLARE_WORKER_URL 和 CLOUDFLARE_REMOTE_TOKEN。"
      : status.mode === "cloudflare-error"
        ? status.error?.message ?? "Cloudflare Remote Brain 请求失败。"
        : `使用 ${status.endpoint ?? "Cloudflare Worker"} 作为统一 Remote Brain 出口。`;
    setDisabled(status.mode !== "cloudflare-connected");
  }

  function renderResult(payload: unknown): void {
    result.textContent = stringifyPayload(payload);
  }

  function setDisabled(disabled: boolean): void {
    for (const button of buttons) {
      button.disabled = disabled;
    }
  }
}

function stringifyPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
