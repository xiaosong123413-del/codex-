/**
 * Intake sync detection client.
 *
 * The desktop shell calls this before a sync run so the user can see which raw
 * queues were detected and whether there is a batch compile plan to confirm.
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface IntakePlanRow {
  file: string;
  suggestedLocation: string;
  action: string;
  reason: string;
}

interface IntakeScanItem {
  kind: "clipping" | "flash" | "source" | "inbox";
  channel?: string;
  title: string;
}

interface IntakeScan {
  items: IntakeScanItem[];
  plan: IntakePlanRow[];
}

export async function loadIntakeScan(): Promise<IntakeScan> {
  const response = await fetch("/api/intake/scan");
  const payload = (await response.json()) as ApiResponse<IntakeScan>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "intake scan failed");
  }
  return payload.data;
}

export function showIntakeDetectionDialog(root: HTMLElement, scan: IntakeScan): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "intake-dialog";
    overlay.innerHTML = `
      <section class="intake-dialog__panel">
        <div class="intake-dialog__header">
          <div>
            <div class="eyebrow">NEW SOURCES</div>
            <h2>\u65b0\u6e90\u6599\u68c0\u6d4b</h2>
          </div>
          <button type="button" class="btn btn-secondary btn-inline" data-intake-cancel>\u5173\u95ed</button>
        </div>
        <div class="intake-dialog__summary">
          \u68c0\u6d4b\u5230 ${scan.items.length} \u4e2a\u5f85\u5904\u7406\u6e90\u6599\u3002
        </div>
        <div class="intake-dialog__items">
          ${scan.items.map(renderScanItem).join("")}
        </div>
        ${scan.plan.length > 0 ? renderPlanTable(scan.plan) : renderInboxOnlyNotice()}
        <div class="intake-dialog__footer">
          <span>${scan.plan.length > 0 ? "\u786e\u8ba4\u540e\u5f00\u59cb\u6279\u91cf\u540c\u6b65\u7f16\u8bd1\u3002" : "\u8bf7\u5728\u5ba1\u67e5\u9875\u5904\u7406 inbox \u5f85\u5f55\u5165\u9879\u3002"}</span>
          <button type="button" class="btn btn-primary" data-intake-confirm ${scan.plan.length === 0 ? "disabled" : ""}>
            ${scan.plan.length > 0 ? "\u5f00\u59cb\u540c\u6b65\u7f16\u8bd1" : "\u6682\u65e0\u53ef\u6279\u91cf\u9879"}
          </button>
        </div>
      </section>
    `;
    root.appendChild(overlay);
    bindIntakeDialog(overlay, resolve);
  });
}

function renderScanItem(item: IntakeScanItem): string {
  return `
    <div class="intake-source-item">
      <span class="intake-source-item__kind">${formatKind(item)}</span>
      <span class="intake-source-item__title">${escapeHtml(item.title)}</span>
    </div>
  `;
}

function renderPlanTable(plan: IntakePlanRow[]): string {
  return `
    <div class="intake-dialog__table-wrap">
      <table class="intake-plan-table">
        <thead><tr><th>\u6587\u4ef6</th><th>\u5efa\u8bae\u653e\u54ea</th><th>\u600e\u4e48\u5904\u7406</th><th>\u4e3a\u4ec0\u4e48</th></tr></thead>
        <tbody>${plan.map(renderPlanRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderInboxOnlyNotice(): string {
  return `
    <div class="intake-dialog__empty">
      \u672c\u6b21\u53ea\u68c0\u6d4b\u5230 inbox \u5f85\u5904\u7406\u9879\uff0c\u4e0d\u4f1a\u76f4\u63a5\u542f\u52a8\u6279\u91cf\u7f16\u8bd1\u3002
    </div>
  `;
}

function renderPlanRow(row: IntakePlanRow): string {
  return `
    <tr>
      <td>${escapeHtml(row.file)}</td>
      <td>${escapeHtml(row.suggestedLocation)}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>
  `;
}

function bindIntakeDialog(overlay: HTMLElement, resolve: (value: boolean) => void): void {
  overlay.querySelector("[data-intake-cancel]")?.addEventListener("click", () => {
    overlay.remove();
    resolve(false);
  });
  overlay.querySelector("[data-intake-confirm]")?.addEventListener("click", () => {
    overlay.remove();
    resolve(true);
  });
}

function formatKind(item: IntakeScanItem): string {
  const labels: Record<IntakeScanItem["kind"], string> = {
    clipping: "\u526a\u85cf",
    flash: "\u95ea\u5ff5\u65e5\u8bb0",
    source: item.channel?.trim() || "\u540c\u6b65\u6e90",
    inbox: "inbox",
  };
  return escapeHtml(labels[item.kind]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return escaped[character] ?? character;
  });
}
