/**
 * Renders the personal timeline historical-memory supplement dialog.
 *
 * Historical memory supplements are appended to a dedicated wiki page instead of being
 * stored in local browser state, so the existing source refresh flow can hash
 * that page and detect changed content.
 */

interface PageRawPayload {
  raw?: string;
}

const ENTRY_MARKER = "<!-- timeline-manual-entries -->";

export function openManualSupplementDialog(article: HTMLElement, pagePath: string): void {
  const editor = article.querySelector<HTMLElement>("[data-personal-timeline-source-editor]");
  if (!editor) return;
  editor.hidden = false;
  editor.innerHTML = renderManualSupplementDialog();
  bindManualSupplementDialog(editor, pagePath);
}

function renderManualSupplementDialog(): string {
  return `
    <section class="personal-timeline__source-dialog" role="dialog" aria-modal="true" aria-label="历史回忆">
      <header>
        <strong>历史回忆</strong>
        <button type="button" data-personal-timeline-manual-close>关闭</button>
      </header>
      <textarea
        rows="8"
        placeholder="输入要补进个人时间线的历史回忆。可以写大致时间、事件、来源和不确定性。"
        data-personal-timeline-manual-input
      ></textarea>
      <div>
        <button type="button" data-personal-timeline-manual-save>追记到历史回忆页</button>
      </div>
      <p class="personal-timeline__source-editor-status" data-personal-timeline-source-editor-status></p>
    </section>
  `;
}

function bindManualSupplementDialog(editor: HTMLElement, pagePath: string): void {
  editor.onclick = (event) => {
    if (event.target === editor) editor.hidden = true;
  };
  editor.querySelector<HTMLElement>(".personal-timeline__source-dialog")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  editor.querySelector<HTMLButtonElement>("[data-personal-timeline-manual-close]")?.addEventListener("click", () => {
    editor.hidden = true;
  });
  editor.querySelector<HTMLButtonElement>("[data-personal-timeline-manual-save]")?.addEventListener("click", () => {
    void saveManualSupplement(editor, pagePath);
  });
}

async function saveManualSupplement(editor: HTMLElement, pagePath: string): Promise<void> {
  const input = editor.querySelector<HTMLTextAreaElement>("[data-personal-timeline-manual-input]");
  const text = input?.value.trim() ?? "";
  if (!text) {
    showManualStatus(editor, "先输入要补录的历史回忆。");
    return;
  }

  showManualStatus(editor, "正在追记...");
  try {
    const raw = await loadPageRaw(pagePath);
    await savePageRaw(pagePath, prependManualEntry(raw, text, new Date()));
    if (input) input.value = "";
    showManualStatus(editor, "已追记到历史回忆。点击刷新会检测这页的新内容。");
  } catch {
    showManualStatus(editor, "追记失败，请稍后重试。");
  }
}

async function loadPageRaw(pagePath: string): Promise<string> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(pagePath)}&raw=1`);
  if (!response.ok) throw new Error("load manual supplement failed");
  const payload = await response.json() as PageRawPayload;
  return typeof payload.raw === "string" ? payload.raw : "";
}

async function savePageRaw(pagePath: string, raw: string): Promise<void> {
  const response = await fetch("/api/page", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: pagePath, raw }),
  });
  if (!response.ok) throw new Error("save manual supplement failed");
}

function prependManualEntry(raw: string, text: string, date: Date): string {
  const entry = `\n\n## ${formatEntryTime(date)}\n\n${normalizeEntryText(text)}\n`;
  const markerIndex = raw.indexOf(ENTRY_MARKER);
  if (markerIndex >= 0) {
    const insertAt = markerIndex + ENTRY_MARKER.length;
    return `${raw.slice(0, insertAt)}${entry}${raw.slice(insertAt).trimStart()}`;
  }
  return `${raw.trimEnd()}${entry}`;
}

function formatEntryTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function normalizeEntryText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function showManualStatus(editor: HTMLElement, message: string): void {
  const status = editor.querySelector<HTMLElement>("[data-personal-timeline-source-editor-status]");
  if (status) status.textContent = message;
}
