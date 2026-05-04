/**
 * Small copy menu shared by Peiweipedia sidebars.
 *
 * Sidebar path nodes reveal an Obsidian-like context menu on context menu or
 * double-click. The copy path row opens a small submenu for relative and
 * desktop absolute paths without changing page navigation.
 */

const COPY_MENU_CLASS = "wiki-path-copy-menu";
const COPY_MENU_SELECTOR = `.${COPY_MENU_CLASS}`;

export function bindWikiPathCopy(root: HTMLElement): void {
  root.addEventListener("contextmenu", handlePathCopyRequest);
  root.addEventListener("dblclick", handlePathCopyRequest);
}

function handlePathCopyRequest(event: MouseEvent): void {
  const node = (event.target as HTMLElement).closest<HTMLElement>("[data-wiki-path-node]");
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  showCopyMenu(node, node.dataset.wikiPathNode ?? "", event);
}

function showCopyMenu(anchor: HTMLElement, relativePath: string, event: MouseEvent): void {
  closeCurrentCopyMenu();
  const menu = document.createElement("div");
  menu.className = COPY_MENU_CLASS;
  menu.innerHTML = renderCopyMenu();
  document.body.appendChild(menu);
  positionMenu(menu, anchor, event);
  bindCopyMenu(menu, relativePath);
  document.addEventListener("pointerdown", closeCopyMenuOnPointerDown, true);
}

function renderCopyMenu(): string {
  return `
    <button type="button" class="wiki-path-copy-menu__item" data-wiki-copy-parent>
      <span class="wiki-path-copy-menu__icon" aria-hidden="true"></span>
      <span>复制路径</span>
      <span class="wiki-path-copy-menu__arrow" aria-hidden="true">&gt;</span>
    </button>
    <div class="wiki-path-copy-menu__submenu">
      <button type="button" data-wiki-copy-mode="relative">基于库的相对路径</button>
      <button type="button" data-wiki-copy-mode="absolute">绝对路径</button>
      <span data-wiki-copy-status></span>
    </div>
  `;
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement, event: MouseEvent): void {
  const rect = anchor.getBoundingClientRect();
  const eventX = event.clientX || rect.left;
  const eventY = event.clientY || rect.bottom;
  menu.style.left = `${Math.max(8, Math.min(eventX, window.innerWidth - 300))}px`;
  menu.style.top = `${Math.max(8, Math.min(eventY, window.innerHeight - 160))}px`;
}

function bindCopyMenu(menu: HTMLElement, relativePath: string): void {
  menu.querySelectorAll<HTMLButtonElement>("[data-wiki-copy-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      void copySelectedPath(menu, relativePath, button.dataset.wikiCopyMode);
    });
  });
}

async function copySelectedPath(menu: HTMLElement, relativePath: string, mode: string | undefined): Promise<void> {
  const value = mode === "absolute" ? await buildAbsolutePath(relativePath) : relativePath;
  if (!value) {
    setCopyStatus(menu, "没有可用绝对路径");
    return;
  }
  await navigator.clipboard.writeText(value);
  setCopyStatus(menu, "已复制");
  closeCurrentCopyMenu();
}

async function buildAbsolutePath(relativePath: string): Promise<string> {
  const config = await window.llmWikiDesktop?.getDesktopConfig?.();
  const root = config?.targetVault?.trim();
  if (!root) return "";
  return `${root.replace(/[\\/]+$/u, "")}\\${relativePath.replace(/\//gu, "\\")}`;
}

function setCopyStatus(menu: HTMLElement, message: string): void {
  const status = menu.querySelector<HTMLElement>("[data-wiki-copy-status]");
  if (status) status.textContent = message;
}

function closeCopyMenuOnPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest(COPY_MENU_SELECTOR)) return;
  closeCurrentCopyMenu();
}

function closeCurrentCopyMenu(): void {
  document.removeEventListener("pointerdown", closeCopyMenuOnPointerDown, true);
  document.querySelector(COPY_MENU_SELECTOR)?.remove();
}
