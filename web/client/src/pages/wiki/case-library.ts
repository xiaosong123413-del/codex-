/**
 * Adds lightweight controls to the personal case-library wiki pages.
 *
 * Markdown remains the source of truth; this enhancer only provides refresh and
 * status actions so cases can be maintained from the reader.
 */
const CASE_INDEX_PATH = "wiki/专题/案例库/index.md";
const CASE_DIR_PREFIX = "wiki/专题/案例库/";

interface CaseRefreshPayload {
  status: "missing-entry" | "no-increment" | "written";
  message: string;
  changedFiles: number;
  changedCases: number;
}

export function enhanceCaseLibraryPage(article: HTMLElement, path: string): void {
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPath === CASE_INDEX_PATH) {
    enhanceCaseLibraryIndex(article);
    return;
  }
  if (normalizedPath.startsWith(CASE_DIR_PREFIX)) {
    enhanceCaseDetail(article, normalizedPath);
  }
}

function enhanceCaseLibraryIndex(article: HTMLElement): void {
  const title = article.querySelector("h1");
  if (!title || article.querySelector("[data-case-library-refresh]")) return;
  const panel = document.createElement("section");
  panel.className = "case-library-tools";
  panel.innerHTML = `
    <div>
      <strong>案例库刷新</strong>
      <span data-case-library-status>从日记、历史回忆、时间线和工作日志里检查新的问题解决案例。</span>
    </div>
    <button type="button" data-case-library-refresh>刷新案例库</button>
  `;
  title.after(panel);
  panel.querySelector<HTMLButtonElement>("[data-case-library-refresh]")?.addEventListener("click", () => {
    void refreshCaseLibrary(panel);
  });
}

function enhanceCaseDetail(article: HTMLElement, casePath: string): void {
  const title = article.querySelector("h1");
  if (!title || article.querySelector("[data-case-action]")) return;
  const panel = document.createElement("section");
  panel.className = "case-library-actions";
  panel.innerHTML = `
    <button type="button" data-case-action="mark-distilled">标记已沉淀</button>
    <button type="button" data-case-action="mark-rule">标记已写入规则</button>
    <button type="button" data-case-action="mark-ability">标记已转能力证据</button>
    <span data-case-action-status></span>
  `;
  title.after(panel);
  panel.querySelectorAll<HTMLButtonElement>("[data-case-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void mutateCase(casePath, button.dataset.caseAction ?? "confirm", panel);
    });
  });
}

async function refreshCaseLibrary(panel: HTMLElement): Promise<void> {
  const status = panel.querySelector<HTMLElement>("[data-case-library-status]");
  if (status) status.textContent = "正在检索新增内容…";
  try {
    const payloads = await Promise.all([
      requestCaseRefresh("日记", ["#/flash-diary"]),
      requestCaseRefresh("历史回忆", ["wiki/个人信息档案/历史回忆.md"]),
      requestCaseRefresh("个人时间线", ["wiki/个人信息档案/个人时间线.md"]),
    ]);
    const changedCases = payloads.reduce((total, payload) => total + payload.changedCases, 0);
    const changedFiles = payloads.reduce((total, payload) => total + payload.changedFiles, 0);
    if (status) status.textContent = `已检查 ${changedFiles} 个变更来源，新增案例 ${changedCases} 个。`;
  } catch {
    if (status) status.textContent = "刷新失败，已停止写入。";
  }
}

async function requestCaseRefresh(label: string, entries: string[]): Promise<CaseRefreshPayload> {
  const response = await fetch("/api/wiki/case-library/source-refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, entries }),
  });
  const payload = await response.json() as { success?: boolean; data?: CaseRefreshPayload; error?: string };
  if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "case refresh failed");
  return payload.data;
}

async function mutateCase(casePath: string, action: string, panel: HTMLElement): Promise<void> {
  const status = panel.querySelector<HTMLElement>("[data-case-action-status]");
  if (status) status.textContent = "正在更新…";
  const response = await fetch("/api/wiki/case-library/case-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, casePath }),
  });
  if (status) status.textContent = response.ok ? "已更新，刷新页面后生效。" : "更新失败。";
}
