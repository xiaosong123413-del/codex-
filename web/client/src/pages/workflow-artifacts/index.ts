/**
 * Workflow artifact management page.
 *
 * The page deliberately separates long-term wiki folders from runtime queues:
 * folders are destinations, while runtime files are pending work produced by
 * the recorder and diary event pipeline.
 */
interface WorkflowArtifactsPayload {
  folders: ArtifactFolder[];
  runtimeFiles: RuntimeFile[];
  events: unknown[];
  pendingConfirm: unknown[];
  pendingArchive: unknown[];
  resources: unknown[];
  validations: unknown[];
  methods: unknown[];
}

interface ArtifactFolder {
  title: string;
  path: string;
  indexPath: string;
  exists: boolean;
}

interface RuntimeFile {
  title: string;
  path: string;
  count: number;
}

export function renderWorkflowArtifactsPage(): HTMLElement {
  const page = document.createElement("section");
  page.className = "workflow-artifacts-page full-page";
  page.innerHTML = `
    <header class="workflow-artifacts-page__header">
      <div>
        <p class="eyebrow">WORKFLOW ARTIFACTS</p>
        <h1>执行沉淀</h1>
        <p>区分长期文件夹和运行时队列，查看执行记录器与日记产生的待处理沉淀。</p>
      </div>
      <button type="button" class="btn btn-secondary" data-workflow-artifacts-refresh>刷新</button>
    </header>
    <div class="workflow-artifacts-page__content" data-workflow-artifacts-content>正在读取...</div>
  `;
  page.querySelector<HTMLButtonElement>("[data-workflow-artifacts-refresh]")?.addEventListener("click", () => {
    void loadWorkflowArtifacts(page);
  });
  void loadWorkflowArtifacts(page);
  return page;
}

async function loadWorkflowArtifacts(page: HTMLElement): Promise<void> {
  const content = page.querySelector<HTMLElement>("[data-workflow-artifacts-content]");
  if (!content) return;
  content.textContent = "正在读取...";
  try {
    const response = await fetch("/api/workflow-artifacts");
    const payload = await response.json() as { success?: boolean; data?: WorkflowArtifactsPayload; error?: string };
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "读取失败");
    content.innerHTML = renderWorkflowArtifacts(payload.data);
  } catch (error) {
    content.textContent = error instanceof Error ? error.message : "读取失败";
  }
}

function renderWorkflowArtifacts(data: WorkflowArtifactsPayload): string {
  return [
    renderFolderSection(data.folders),
    renderRuntimeSection(data.runtimeFiles),
    renderQueueSection("待确认队列", data.pendingConfirm),
    renderQueueSection("待归档队列", data.pendingArchive),
    renderQueueSection("Workflow Event 事件池", data.events),
    renderQueueSection("资源与工具候选", data.resources),
    renderQueueSection("资料验证候选", data.validations),
    renderQueueSection("方法候选", data.methods),
  ].join("");
}

function renderFolderSection(folders: ArtifactFolder[]): string {
  return `
    <section class="workflow-artifacts-page__section">
      <h2>长期文件夹</h2>
      <div class="workflow-artifacts-page__grid">
        ${folders.map(renderFolderCard).join("")}
      </div>
    </section>
  `;
}

function renderFolderCard(folder: ArtifactFolder): string {
  return `
    <article class="workflow-artifacts-page__card">
      <strong>${escapeHtml(folder.title)}</strong>
      <span>${folder.exists ? "已创建" : "未创建"}</span>
      <code>${escapeHtml(folder.path)}</code>
      <a href="#/wiki/${encodeURIComponent(folder.indexPath)}">打开索引</a>
    </article>
  `;
}

function renderRuntimeSection(files: RuntimeFile[]): string {
  return `
    <section class="workflow-artifacts-page__section">
      <h2>运行时文件</h2>
      <div class="workflow-artifacts-page__grid">
        ${files.map(renderRuntimeCard).join("")}
      </div>
    </section>
  `;
}

function renderRuntimeCard(file: RuntimeFile): string {
  return `
    <article class="workflow-artifacts-page__card">
      <strong>${escapeHtml(file.title)}</strong>
      <span>${file.count} 条</span>
      <code>${escapeHtml(file.path)}</code>
    </article>
  `;
}

function renderQueueSection(title: string, items: unknown[]): string {
  return `
    <section class="workflow-artifacts-page__section">
      <h2>${escapeHtml(title)} <span>${items.length}</span></h2>
      <div class="workflow-artifacts-page__list">
        ${items.length > 0 ? items.slice(0, 12).map(renderQueueItem).join("") : "<p>暂无记录</p>"}
      </div>
    </section>
  `;
}

function renderQueueItem(item: unknown): string {
  const record = isRecord(item) ? item : {};
  const title = readText(record.raw_input) || readText(record.text) || readText(record.id) || "未命名记录";
  const meta = readText(record.confidence) || readText(record.eventId) || readText(record.event_id) || "待处理";
  return `
    <article class="workflow-artifacts-page__row">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(meta)}</span>
    </article>
  `;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
