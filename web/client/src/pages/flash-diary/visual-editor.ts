/**
 * Flash-diary visual editor controller.
 *
 * Provides a mixed text/media diary editor with drag-drop upload, clipboard
 * paste support, thumbnail preview, and markdown serialization back to the
 * existing save pipeline.
 */
import type { FlashDiaryPageResponse } from "./view-helpers.js";
import {
  buildDiaryMediaUrl,
  createDiaryEditorHtml,
  isDiaryVideoPath,
  isEditorTopLevelBlock,
  resolveDiaryMediaLogicalPath,
  serializeDiaryEditor,
  toDiaryRelativeMediaPath,
} from "./visual-editor-markdown.js";

interface FlashDiaryVisualEditorController {
  clear(): void;
  dispose(): void;
  focus(): void;
  getMarkdown(): string;
  hasSelectionImage(): boolean;
  load(page: FlashDiaryPageResponse): void;
  setOnChange(listener: () => void): void;
}

interface UploadedDiaryMedia {
  readonly mediaPath: string;
  readonly mediaUrl: string;
}

interface PreviewState {
  readonly alt: string;
  readonly src: string;
}

// fallow-ignore-next-line complexity
export function createFlashDiaryVisualEditor(host: HTMLElement): FlashDiaryVisualEditorController {
  const root = document.createElement("div");
  root.className = "flash-diary-visual-editor";
  root.dataset.flashDiaryVisualEditor = "true";
  root.contentEditable = "true";
  root.spellcheck = false;
  const preview = createPreviewLayer();
  host.append(root, preview.overlay);
  let currentPath = "";
  let selectedMedia: HTMLElement | null = null;
  let onChange: (() => void) | null = null;

  root.addEventListener("input", () => emitChange(onChange));
  root.addEventListener("click", (event) => handleEditorClick(event, preview, clearSelectedImage, setSelectedImage));
  root.addEventListener("keydown", (event) => {
    if (removeSelectedImage(event, selectedMedia, clearSelectedImage)) {
      emitChange(onChange);
    }
  });
  root.addEventListener("paste", (event) => {
    void handlePaste(event, root, currentPath, clearSelectedImage, onChange);
  });
  root.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  root.addEventListener("drop", (event) => {
    void handleDrop(event, root, currentPath, clearSelectedImage, onChange);
  });
  document.addEventListener("click", handleOutsideClick, true);

  return {
    clear,
    dispose,
    focus() {
      root.focus();
    },
    getMarkdown() {
      return serializeDiaryEditor(root);
    },
    hasSelectionImage() {
      return selectedMedia !== null;
    },
    load(page) {
      currentPath = page.path;
      root.innerHTML = createDiaryEditorHtml(page.raw, page.html, page.path);
      if (!root.childNodes.length) {
        root.innerHTML = "<p><br></p>";
      }
      clearSelectedImage();
    },
    setOnChange(listener) {
      onChange = listener;
    },
  };

  function clear(): void {
    currentPath = "";
    root.innerHTML = "";
    clearSelectedImage();
    closePreview(preview);
  }

  function dispose(): void {
    document.removeEventListener("click", handleOutsideClick, true);
    closePreview(preview);
    preview.overlay.remove();
    root.remove();
  }

  function clearSelectedImage(): void {
    if (selectedMedia) {
      selectedMedia.classList.remove("is-selected");
    }
    selectedMedia = null;
  }

  function setSelectedImage(next: HTMLElement | null): void {
    clearSelectedImage();
    selectedMedia = next;
    selectedMedia?.classList.add("is-selected");
  }

  function handleOutsideClick(event: MouseEvent): void {
    if (root.contains(event.target as Node) || preview.overlay.contains(event.target as Node)) {
      return;
    }
    clearSelectedImage();
  }
}

function handleEditorClick(
  event: MouseEvent,
  preview: ReturnType<typeof createPreviewLayer>,
  clearSelectedImage: () => void,
  setSelectedImage: (element: HTMLElement | null) => void,
): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const mediaBlock = target?.closest<HTMLElement>("[data-flash-diary-media-block]");
  if (!mediaBlock) {
    clearSelectedImage();
    return;
  }
  setSelectedImage(mediaBlock);
  const image = mediaBlock.querySelector<HTMLImageElement>("[data-flash-diary-image-thumb]");
  if (image && mediaBlock.dataset.flashDiaryMediaKind === "image") {
    openPreview(preview, { alt: image.alt || "图片", src: image.src });
  }
}

function removeSelectedImage(
  event: KeyboardEvent,
  selectedImage: HTMLElement | null,
  clearSelectedImage: () => void,
): boolean {
  if (!selectedImage || (event.key !== "Backspace" && event.key !== "Delete")) {
    return false;
  }
  event.preventDefault();
  const nextFocusTarget = selectedImage.nextElementSibling ?? selectedImage.previousElementSibling;
  selectedImage.remove();
  clearSelectedImage();
  if (nextFocusTarget instanceof HTMLElement) {
    placeCaretAtStart(nextFocusTarget);
  }
  return true;
}

async function handlePaste(
  event: ClipboardEvent,
  root: HTMLElement,
  currentPath: string,
  clearSelectedImage: () => void,
  onChange: (() => void) | null,
): Promise<void> {
  const files = readSupportedMediaFiles(event.clipboardData?.files);
  if (files.length === 0 || !currentPath) {
    return;
  }
  event.preventDefault();
  clearSelectedImage();
  await insertUploadedMedia(root, currentPath, files, null);
  emitChange(onChange);
}

async function handleDrop(
  event: DragEvent,
  root: HTMLElement,
  currentPath: string,
  clearSelectedImage: () => void,
  onChange: (() => void) | null,
): Promise<void> {
  const files = readSupportedMediaFiles(event.dataTransfer?.files);
  if (files.length === 0 || !currentPath) {
    return;
  }
  event.preventDefault();
  clearSelectedImage();
  const range = rangeFromPoint(event.clientX, event.clientY);
  await insertUploadedMedia(root, currentPath, files, range);
  emitChange(onChange);
}

async function insertUploadedMedia(
  root: HTMLElement,
  currentPath: string,
  files: readonly File[],
  range: Range | null,
): Promise<void> {
  const reference = resolveInsertionReference(root, range);
  let currentReference = reference;
  for (const file of files) {
    const uploaded = await uploadDiaryMedia(currentPath, file);
    const block = createInsertedMediaFigure(currentPath, uploaded, file);
    root.insertBefore(block, currentReference);
    currentReference = block.nextSibling;
  }
  ensureEditableTrailingParagraph(root, currentReference);
}

function resolveInsertionReference(root: HTMLElement, range: Range | null): ChildNode | null {
  if (!range || !root.contains(range.startContainer)) {
    return null;
  }
  const directChild = resolveTopLevelChild(root, range.startContainer);
  if (!isEditorTopLevelBlock(directChild, root)) {
    return directChild?.nextSibling ?? null;
  }
  return splitTopLevelBlock(root, directChild, range);
}

function resolveTopLevelChild(root: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node instanceof Text ? node.parentElement : node;
  while (current instanceof HTMLElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current instanceof HTMLElement ? current : null;
}

function splitTopLevelBlock(root: HTMLElement, block: HTMLElement, range: Range): ChildNode | null {
  if (block.matches("[data-flash-diary-media-block]")) {
    return block.nextSibling;
  }
  const trailing = block.cloneNode(false) as HTMLElement;
  const tailRange = document.createRange();
  tailRange.selectNodeContents(block);
  tailRange.setStart(range.startContainer, range.startOffset);
  const fragment = tailRange.extractContents();
  trailing.append(fragment);
  if (hasMeaningfulContent(trailing)) {
    block.after(trailing);
    return trailing;
  }
  if (!hasMeaningfulContent(block)) {
    block.innerHTML = "<br>";
  }
  return block.nextSibling;
}

function hasMeaningfulContent(element: HTMLElement): boolean {
  return (element.textContent?.trim().length ?? 0) > 0 || Boolean(element.querySelector("img,video,br"));
}

function ensureEditableTrailingParagraph(root: HTMLElement, reference: ChildNode | null): void {
  if (reference instanceof HTMLElement && reference.tagName === "P") {
    placeCaretAtStart(reference);
    return;
  }
  const paragraph = document.createElement("p");
  paragraph.innerHTML = "<br>";
  root.insertBefore(paragraph, reference);
  placeCaretAtStart(paragraph);
}

// fallow-ignore-next-line complexity
function createInsertedMediaFigure(currentPath: string, uploaded: UploadedDiaryMedia, file: File): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "flash-diary-visual-editor__image-block";
  figure.contentEditable = "false";
  const isVideo = file.type.startsWith("video/") || isDiaryVideoPath(uploaded.mediaPath);
  figure.dataset.flashDiaryMediaBlock = "true";
  figure.dataset.flashDiaryMediaKind = isVideo ? "video" : "image";
  figure.dataset.flashDiaryLogicalPath = uploaded.mediaPath;
  figure.dataset.flashDiaryMarkdownPath = toDiaryRelativeMediaPath(currentPath, uploaded.mediaPath);
  if (isVideo) {
    figure.dataset.flashDiaryVideoBlock = "true";
    figure.dataset.flashDiaryMarkdownLabel = `视频：${file.name || "视频"}`;
    const video = document.createElement("video");
    video.className = "flash-diary-visual-editor__video-thumb";
    video.dataset.flashDiaryVideoThumb = "true";
    video.src = uploaded.mediaUrl || buildDiaryMediaUrl(uploaded.mediaPath);
    video.controls = true;
    video.preload = "metadata";
    figure.append(video);
  } else {
    figure.dataset.flashDiaryImageBlock = "true";
    const image = document.createElement("img");
    image.className = "flash-diary-visual-editor__image-thumb";
    image.dataset.flashDiaryImageThumb = "true";
    image.src = uploaded.mediaUrl || buildDiaryMediaUrl(uploaded.mediaPath);
    image.alt = file.name || "图片";
    figure.append(image);
  }
  const caption = document.createElement("figcaption");
  caption.textContent = isVideo ? `视频：${file.name || "视频"}` : "点击查看原图";
  figure.append(caption);
  return figure;
}

async function uploadDiaryMedia(currentPath: string, file: File): Promise<UploadedDiaryMedia> {
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch("/api/flash-diary/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: currentPath,
      fileName: file.name,
      dataUrl,
    }),
  });
  const payload = (await response.json()) as {
    success?: boolean;
    data?: UploadedDiaryMedia;
    error?: string;
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "媒体上传失败");
  }
  return payload.data;
}

function readSupportedMediaFiles(fileList: FileList | null | undefined): File[] {
  return Array.from(fileList ?? []).filter((file) =>
    file.type.startsWith("image/") || file.type.startsWith("video/") || isDiaryVideoPath(file.name),
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("媒体读取失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function rangeFromPoint(clientX: number, clientY: number): Range | null {
  const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange) {
    return caretRange;
  }
  const position = document.caretPositionFromPoint?.(clientX, clientY);
  if (!position) {
    return null;
  }
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function placeCaretAtStart(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createPreviewLayer() {
  const overlay = document.createElement("div");
  overlay.className = "flash-diary-image-preview";
  overlay.dataset.flashDiaryImagePreview = "true";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="flash-diary-image-preview__backdrop" data-flash-diary-image-preview-close></div>
    <div class="flash-diary-image-preview__dialog" role="dialog" aria-modal="true">
      <button type="button" class="flash-diary-image-preview__close" data-flash-diary-image-preview-close>关闭</button>
      <img alt="" class="flash-diary-image-preview__image" data-flash-diary-image-preview-image>
    </div>
  `;
  overlay.querySelectorAll<HTMLElement>("[data-flash-diary-image-preview-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closePreview({ overlay, image: overlay.querySelector("[data-flash-diary-image-preview-image]") as HTMLImageElement });
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      closePreview({ overlay, image: overlay.querySelector("[data-flash-diary-image-preview-image]") as HTMLImageElement });
    }
  });
  return {
    overlay,
    image: overlay.querySelector("[data-flash-diary-image-preview-image]") as HTMLImageElement,
  };
}

function openPreview(preview: ReturnType<typeof createPreviewLayer>, state: PreviewState): void {
  preview.image.src = state.src;
  preview.image.alt = state.alt;
  preview.overlay.hidden = false;
}

function closePreview(preview: ReturnType<typeof createPreviewLayer>): void {
  preview.overlay.hidden = true;
  preview.image.removeAttribute("src");
}

function emitChange(listener: (() => void) | null): void {
  listener?.();
}
