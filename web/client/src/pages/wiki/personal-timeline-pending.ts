/**
 * Adds review controls to the pending personal-timeline fact table.
 *
 * Pending rows are not final facts. They are diary or memory snippets that may
 * become timeline facts after the user confirms, deletes, or supplements them.
 */

type PendingTimelineAction = "confirm" | "delete" | "supplement";

export function enhancePendingTimelineFacts(article: HTMLElement): void {
  const table = findPendingTimelineTable(article);
  if (!table) return;
  normalizePendingHeader(table);
  table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => enhancePendingRow(article, row));
}

function findPendingTimelineTable(article: HTMLElement): HTMLTableElement | null {
  const heading = Array.from(article.querySelectorAll<HTMLHeadingElement>("h2"))
    .find((item) => (item.textContent ?? "").replace(/^§\s*/u, "").trim() === "待确认时间线事实");
  return heading?.nextElementSibling?.nextElementSibling instanceof HTMLTableElement
    ? heading.nextElementSibling.nextElementSibling
    : heading?.nextElementSibling instanceof HTMLTableElement ? heading.nextElementSibling : null;
}

function normalizePendingHeader(table: HTMLTableElement): void {
  const header = table.querySelector<HTMLTableRowElement>("thead tr");
  if (!header) return;
  header.innerHTML = [
    "<th>事件时间</th>",
    "<th>记录时间</th>",
    "<th>候选片段</th>",
    "<th>领域</th>",
    "<th>项目</th>",
    "<th>来源</th>",
    "<th>操作</th>",
  ].join("");
}

function enhancePendingRow(article: HTMLElement, row: HTMLTableRowElement): void {
  const cells = Array.from(row.cells);
  if (cells.length < 4 || isPlaceholderRow(cells)) return;
  const sourceIndex = sourceCellIndexForPendingRow(cells);
  const sourceCell = cells[sourceIndex]!;
  const sourceTarget = sourceTargetFromCell(sourceCell);
  const visibleCells = visiblePendingCells(cells, sourceIndex);
  row.innerHTML = "";
  visibleCells.forEach((cell) => row.appendChild(cell));
  row.appendChild(renderActionCell(article, row, sourceTarget));
}

function sourceCellIndexForPendingRow(cells: HTMLTableCellElement[]): number {
  const linkedIndex = cells.findIndex(isSourceLikeCell);
  if (linkedIndex !== -1) return linkedIndex;
  if (cells.length >= 7) return 6;
  if (cells.length >= 6) return 5;
  return 3;
}

function visiblePendingCells(
  cells: HTMLTableCellElement[],
  sourceIndex: number,
): HTMLTableCellElement[] {
  if (cells.length >= 7) return [cells[0]!, cells[1]!, cells[2]!, cells[3]!, cells[4]!, cells[sourceIndex]!];
  if (cells.length >= 6 && sourceIndex === 5) return cells.slice(0, 6);
  return [cells[0]!, cells[1]!, cells[2]!, cells[sourceIndex]!];
}

function isSourceLikeCell(cell: HTMLTableCellElement): boolean {
  const text = (cell.textContent ?? "").trim();
  return Boolean(cell.querySelector("a")) || /^\[\[.+\]\]$/u.test(text) || text.startsWith("raw/");
}

function renderActionCell(article: HTMLElement, row: HTMLTableRowElement, sourceTarget: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "pending-timeline-actions";
  for (const [action, label] of [["confirm", "确认写入"], ["delete", "删除"], ["supplement", "补充"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.pendingTimelineAction = action;
    button.addEventListener("click", () => handlePendingAction(article, row, sourceTarget, action));
    cell.appendChild(button);
  }
  return cell;
}

function handlePendingAction(
  article: HTMLElement,
  row: HTMLTableRowElement,
  sourceTarget: string,
  action: PendingTimelineAction,
): void {
  if (action === "supplement") {
    openSupplementModal(article, row, sourceTarget);
    return;
  }
  void submitPendingMutation(action, sourceTarget).then((ok) => {
    if (ok) row.remove();
  });
}

function openSupplementModal(article: HTMLElement, row: HTMLTableRowElement, sourceTarget: string): void {
  const modal = supplementModal(article);
  modal.hidden = false;
  const input = modal.querySelector<HTMLTextAreaElement>("[data-pending-timeline-supplement-input]");
  if (input) input.value = "";
  modal.querySelector<HTMLButtonElement>("[data-pending-timeline-supplement-save]")!.onclick = () => {
    const note = input?.value.trim() ?? "";
    void submitPendingMutation("supplement", sourceTarget, note).then((ok) => {
      if (!ok) return;
      appendSupplementNote(row, note);
      modal.hidden = true;
    });
  };
}

function supplementModal(article: HTMLElement): HTMLElement {
  const existing = article.querySelector<HTMLElement>("[data-pending-timeline-supplement-modal]");
  if (existing) return existing;
  const modal = document.createElement("section");
  modal.className = "pending-timeline-modal";
  modal.dataset.pendingTimelineSupplementModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="pending-timeline-modal__dialog" role="dialog" aria-modal="true" aria-label="补充候选片段">
      <header><strong>补充候选片段</strong><button type="button" data-pending-timeline-supplement-close>关闭</button></header>
      <textarea data-pending-timeline-supplement-input placeholder="写下你希望 AI 补充判断的说明"></textarea>
      <footer><button type="button" data-pending-timeline-supplement-save>确认</button></footer>
    </div>`;
  modal.querySelector<HTMLButtonElement>("[data-pending-timeline-supplement-close]")!.onclick = () => {
    modal.hidden = true;
  };
  article.appendChild(modal);
  return modal;
}

async function submitPendingMutation(
  action: PendingTimelineAction,
  sourceTarget: string,
  note = "",
): Promise<boolean> {
  const response = await fetch("/api/wiki/personal-timeline/pending-fact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sourceTarget, note }),
  });
  return response.ok;
}

function sourceTargetFromCell(cell: HTMLTableCellElement): string {
  const link = cell.querySelector<HTMLAnchorElement>("a");
  if (!link) return (cell.textContent ?? "").replace(/^\[\[/u, "").replace(/\]\]$/u, "").trim();
  const url = new URL(link.getAttribute("href") ?? "", window.location.href);
  const page = url.searchParams.get("page") ?? (link.textContent ?? "").trim();
  return `${page}${url.hash ? `#${decodeURIComponent(url.hash.slice(1))}` : ""}`;
}

function appendSupplementNote(row: HTMLTableRowElement, note: string): void {
  const cell = row.cells[2];
  if (!cell || !note) return;
  cell.textContent = `${cell.textContent ?? ""}；补充说明：${note}`;
}

function isPlaceholderRow(cells: HTMLTableCellElement[]): boolean {
  return cells.every((cell) => (cell.textContent ?? "").trim() === "待填写");
}
