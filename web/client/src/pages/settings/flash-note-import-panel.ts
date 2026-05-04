/**
 * Flash note import workspace for the settings data-import section.
 *
 * This panel represents an external "闪念笔记" app import entry. It is kept
 * separate from the in-app flash diary page so exported data can later be
 * parsed into `raw/闪念笔记` without mixing it with the daily editor workflow.
 */

import { renderIcon } from "../../components/icon.js";

/** Render the hidden flash note import workspace. */
export function renderFlashNoteImportPanel(): string {
  return `
    <section class="settings-rss-import settings-flash-note-import" data-flash-note-import-page hidden>
      <header class="settings-rss-import__header">
        <button type="button" class="icon-btn settings-rss-import__back" data-flash-note-import-back aria-label="返回数据导入">
          ${renderIcon("chevron-left", { size: 22 })}
        </button>
        <div class="settings-rss-import__title">
          <div class="eyebrow">FLASH NOTE IMPORT</div>
          <h1>闪念笔记导入</h1>
          <p>从外部“闪念笔记”应用导出的文件夹收录到本应用。</p>
        </div>
        <div class="settings-rss-import__stats" aria-label="闪念笔记导入状态">
          <span><strong>raw</strong><small>目标层级</small></span>
          <span><strong>闪念笔记</strong><small>目标目录</small></span>
          <span><strong>待接入</strong><small>解析器</small></span>
        </div>
      </header>
      <div class="settings-rss-import__workspace">
        <section class="settings-rss-import__console">
          <div class="settings-rss-import__panel-head">
            <div>${renderIcon("archive", { size: 22 })}<strong>选择导出内容</strong></div>
            <span>独立导入</span>
          </div>
          <label class="settings-rss-import__input">
            <span>闪念笔记导出文件夹</span>
            <input data-flash-note-import-path type="text" placeholder="选择或填写闪念笔记导出的文件夹路径" />
          </label>
          <div class="settings-rss-import__actions">
            <button type="button" class="btn btn-secondary" data-flash-note-import-pick>选择文件夹</button>
            <button type="button" class="btn btn-primary" data-flash-note-import-start>导入闪念笔记</button>
          </div>
          <p class="settings-rss-import__status" data-flash-note-import-status>等待选择闪念笔记导出目录。</p>
        </section>
        <aside class="settings-rss-import__pipeline" aria-label="闪念笔记导入流程">
          <h2>导入边界</h2>
          ${renderStep("1", "选择导出目录", "从外部闪念笔记应用导出的目录开始，不读取本应用日记页。", true)}
          ${renderStep("2", "解析导出文件", "后续根据真实导出格式接入 Markdown / JSON / TXT 解析。", false)}
          ${renderStep("3", "写入 raw/闪念笔记", "导入后进入源料层，后续再由同步编译流程处理。", false)}
        </aside>
      </div>
    </section>
  `;
}

/** Bind local UI behavior for the flash note import workspace. */
export function bindFlashNoteImportPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-flash-note-import-back]")?.addEventListener("click", () => {
    setFlashNotePanelOpen(root, false);
  });
  root.querySelector<HTMLButtonElement>("[data-flash-note-import-pick]")?.addEventListener("click", () => {
    void chooseFlashNoteExportFolder(root);
  });
  root.querySelector<HTMLButtonElement>("[data-flash-note-import-start]")?.addEventListener("click", () => {
    prepareFlashNoteImport(root);
  });
}

function renderStep(index: string, title: string, body: string, active: boolean): string {
  return `
    <div class="settings-rss-import__step${active ? " is-active" : ""}">
      <span>${index}</span>
      <div><strong>${title}</strong><p>${body}</p></div>
    </div>
  `;
}

function setFlashNotePanelOpen(root: HTMLElement, open: boolean): void {
  const panel = root.querySelector<HTMLElement>("[data-flash-note-import-page]");
  if (panel) {
    panel.hidden = !open;
  }
  root.querySelectorAll<HTMLElement>("[data-import-home]").forEach((section) => {
    section.hidden = open;
  });
}

async function chooseFlashNoteExportFolder(root: HTMLElement): Promise<void> {
  const input = root.querySelector<HTMLInputElement>("[data-flash-note-import-path]");
  if (!input) {
    return;
  }
  if (!window.llmWikiDesktop?.chooseSourceFolders) {
    setFlashNoteStatus(root, "当前环境不能打开文件夹选择器，请手动填写导出目录。");
    input.focus();
    return;
  }
  const selected = await window.llmWikiDesktop.chooseSourceFolders();
  if (selected[0]) {
    input.value = selected[0];
    setFlashNoteStatus(root, "已选择导出目录，等待导入。");
  }
}

function prepareFlashNoteImport(root: HTMLElement): void {
  const path = root.querySelector<HTMLInputElement>("[data-flash-note-import-path]")?.value.trim();
  if (!path) {
    setFlashNoteStatus(root, "请先选择或填写闪念笔记导出目录。");
    return;
  }
  setFlashNoteStatus(root, "已记录导出目录；下一步会接入真实导出格式解析并写入 raw/闪念笔记。");
}

function setFlashNoteStatus(root: HTMLElement, message: string): void {
  const status = root.querySelector<HTMLElement>("[data-flash-note-import-status]");
  if (status) {
    status.textContent = message;
  }
}
