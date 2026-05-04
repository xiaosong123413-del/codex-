/**
 * Work-log block editor helpers.
 *
 * The workspace work log uses rendered Markdown as a live editable surface.
 * This module keeps the Obsidian-like block controls and HTML-to-Markdown
 * serialization scoped to that surface, so the rest of the workspace page does
 * not need to know about individual block formats.
 */
import { renderIcon } from "../../components/icon.js";

interface WorkLogEditorBindings {
  onChanged: (editor: HTMLElement) => void;
}

type WorkLogBlockCommand = "text" | "title" | "list" | "task" | "quote" | "code" | "link" | "image";

const WORK_LOG_COMMANDS: readonly Array<{
  command: WorkLogBlockCommand;
  label: string;
  icon: string;
}> = [
  { command: "text", label: "文本", icon: "pilcrow" },
  { command: "title", label: "标题", icon: "heading-2" },
  { command: "list", label: "列表", icon: "list" },
  { command: "task", label: "任务", icon: "list-checks" },
  { command: "quote", label: "引用", icon: "quote" },
  { command: "code", label: "代码块", icon: "square-code" },
  { command: "link", label: "链接", icon: "link" },
  { command: "image", label: "图片", icon: "image" },
];

export function renderWorkLogBlockToolbar(): string {
  return `
    <div class="workspace-work-log-toolbar" data-workspace-work-log-toolbar aria-label="工作日志编辑工具">
      ${WORK_LOG_COMMANDS.map((item) => `
        <button
          type="button"
          class="workspace-work-log-toolbar__button"
          data-workspace-block-command="${item.command}"
          aria-label="${escapeHtml(item.label)}"
          title="${escapeHtml(item.label)}"
        >${renderIcon(item.icon, { size: 16 })}</button>
      `).join("")}
    </div>
  `;
}

export function bindWorkLogBlockEditor(root: HTMLElement, bindings: WorkLogEditorBindings): void {
  root.querySelectorAll<HTMLButtonElement>("[data-workspace-block-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const editor = root.querySelector<HTMLElement>("[data-workspace-doc-editor]");
      const command = readWorkLogBlockCommand(button.dataset.workspaceBlockCommand);
      if (!editor || !command) {
        return;
      }
      applyWorkLogBlockCommand(editor, command);
      bindings.onChanged(editor);
    });
  });
}

export function serializeWorkLogEditorHtml(html: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return renderMarkdownBlocks(Array.from(wrapper.childNodes)).trim();
}

function applyWorkLogBlockCommand(editor: HTMLElement, command: WorkLogBlockCommand): void {
  editor.focus();
  if (command === "link") {
    insertWorkLogLink();
    return;
  }
  if (command === "image") {
    insertWorkLogImage();
    return;
  }
  if (command === "task") {
    insertHtml("<ul><li><input type=\"checkbox\"> 新任务</li></ul>");
    return;
  }
  runDocumentCommand(toDocumentCommand(command));
}

function toDocumentCommand(command: Exclude<WorkLogBlockCommand, "link" | "image" | "task">): {
  name: string;
  value?: string;
} {
  if (command === "text") return { name: "formatBlock", value: "p" };
  if (command === "title") return { name: "formatBlock", value: "h2" };
  if (command === "list") return { name: "insertUnorderedList" };
  if (command === "quote") return { name: "formatBlock", value: "blockquote" };
  return { name: "formatBlock", value: "pre" };
}

function insertWorkLogLink(): void {
  const url = window.prompt("链接地址");
  if (!url?.trim()) {
    return;
  }
  const label = window.getSelection()?.toString().trim() || url.trim();
  insertHtml(`<a href="${escapeHtml(url.trim())}">${escapeHtml(label)}</a>`);
}

function insertWorkLogImage(): void {
  const url = window.prompt("图片地址");
  if (!url?.trim()) {
    return;
  }
  const alt = window.prompt("图片描述")?.trim() || "图片";
  insertHtml(`<p><img src="${escapeHtml(url.trim())}" alt="${escapeHtml(alt)}"></p>`);
}

function runDocumentCommand(command: { name: string; value?: string }): void {
  document.execCommand(command.name, false, command.value);
}

function insertHtml(html: string): void {
  document.execCommand("insertHTML", false, html);
}

function readWorkLogBlockCommand(value: string | undefined): WorkLogBlockCommand | null {
  return WORK_LOG_COMMANDS.some((item) => item.command === value) ? value as WorkLogBlockCommand : null;
}

function renderMarkdownBlocks(nodes: readonly ChildNode[]): string {
  return nodes
    .map((node) => renderMarkdownNode(node))
    .join("")
    .replace(/\n{3,}/gu, "\n\n");
}

function renderMarkdownNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  const renderer = MARKDOWN_RENDERERS[node.tagName.toLowerCase()];
  return renderer ? renderer(node) : renderInlineMarkdown(Array.from(node.childNodes));
}

const MARKDOWN_RENDERERS: Record<string, (node: HTMLElement) => string> = {
  article: (node) => renderMarkdownContainer(node),
  blockquote: (node) => renderMarkdownBlockquote(node),
  div: (node) => renderMarkdownContainer(node),
  h1: (node) => renderMarkdownHeading(node, "#"),
  h2: (node) => renderMarkdownHeading(node, "##"),
  h3: (node) => renderMarkdownHeading(node, "###"),
  h4: (node) => renderMarkdownHeading(node, "####"),
  h5: (node) => renderMarkdownHeading(node, "#####"),
  h6: (node) => renderMarkdownHeading(node, "######"),
  hr: () => "---\n\n",
  img: (node) => renderMarkdownImage(node),
  ol: (node) => renderMarkdownList(node, true),
  p: (node) => renderMarkdownParagraph(node),
  pre: (node) => `\`\`\`\n${node.textContent?.trim() ?? ""}\n\`\`\`\n\n`,
  section: (node) => renderMarkdownContainer(node),
  ul: (node) => renderMarkdownList(node, false),
};

function renderMarkdownParagraph(node: HTMLElement): string {
  return `${renderInlineMarkdown(Array.from(node.childNodes)).trim()}\n\n`;
}

function renderMarkdownHeading(node: HTMLElement, prefix: string): string {
  return `${prefix} ${renderInlineMarkdown(Array.from(node.childNodes)).trim()}\n\n`;
}

function renderMarkdownList(node: HTMLElement, ordered: boolean): string {
  const lines = Array.from(node.children).map((child, index) => renderMarkdownListItem(child, index, ordered));
  return `${lines.join("\n")}\n\n`;
}

function renderMarkdownListItem(node: Element, index: number, ordered: boolean): string {
  const prefix = ordered ? `${index + 1}.` : "-";
  const checkbox = node.querySelector<HTMLInputElement>("input[type='checkbox']");
  const marker = checkbox ? `[${checkbox.checked ? "x" : " "}] ` : "";
  return `${prefix} ${marker}${renderInlineMarkdown(Array.from(node.childNodes)).trim()}`;
}

function renderMarkdownBlockquote(node: HTMLElement): string {
  const content = renderInlineMarkdown(Array.from(node.childNodes)).trim();
  return `${content.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
}

function renderMarkdownContainer(node: HTMLElement): string {
  const content = renderMarkdownBlocks(Array.from(node.childNodes));
  return /\n\n$/u.test(content) ? content : `${content}\n\n`;
}

function renderMarkdownImage(node: HTMLElement): string {
  const image = node instanceof HTMLImageElement ? node : node.querySelector("img");
  if (!image) {
    return "";
  }
  return `![${image.getAttribute("alt") ?? "图片"}](${image.getAttribute("src") ?? ""})\n\n`;
}

function renderInlineMarkdown(nodes: readonly ChildNode[]): string {
  return nodes.map((node) => renderInlineNode(node)).join("");
}

function renderInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node instanceof HTMLInputElement && node.type === "checkbox") {
    return "";
  }
  if (node instanceof HTMLImageElement) {
    return renderMarkdownImage(node).trim();
  }
  const renderer = INLINE_RENDERERS[node.tagName.toLowerCase()];
  return renderer ? renderer(node) : renderInlineMarkdown(Array.from(node.childNodes));
}

const INLINE_RENDERERS: Record<string, (node: HTMLElement) => string> = {
  a: (node) => `[${renderInlineMarkdown(Array.from(node.childNodes))}](${node.getAttribute("href") ?? ""})`,
  b: (node) => `**${renderInlineMarkdown(Array.from(node.childNodes))}**`,
  br: () => "\n",
  code: (node) => `\`${node.textContent ?? ""}\``,
  em: (node) => `*${renderInlineMarkdown(Array.from(node.childNodes))}*`,
  i: (node) => `*${renderInlineMarkdown(Array.from(node.childNodes))}*`,
  strong: (node) => `**${renderInlineMarkdown(Array.from(node.childNodes))}**`,
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return "&quot;";
    }
  });
}
