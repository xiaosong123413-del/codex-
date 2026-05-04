/**
 * Embedded side-image controller for ordinary wiki article pages.
 *
 * The controller reads `side_image` and optional `side_image_caption` from
 * page frontmatter, mounts a Wikipedia-style floating media card inside the
 * article body, and keeps the existing upload/replace flow for editable pages.
 */

interface WikiPageSideImageDocument {
  path: string;
  frontmatter: Record<string, unknown> | null;
  sourceEditable?: boolean;
}

interface WikiPageSideImageRefs {
  article: HTMLElement;
}

interface WikiPageSideImageControllerOptions {
  refs: WikiPageSideImageRefs;
  onUploaded: () => Promise<void>;
}

interface WikiPageSideImageController {
  setDocument(document: WikiPageSideImageDocument | null): void;
}

interface SideImageElements {
  box: HTMLElement;
  preview: HTMLImageElement;
  placeholder: HTMLElement;
  caption: HTMLElement;
  hint: HTMLElement;
  uploadButton: HTMLButtonElement;
  uploadInput: HTMLInputElement;
}

export function createWikiPageSideImageController(
  options: WikiPageSideImageControllerOptions,
): WikiPageSideImageController {
  let currentDocument: WikiPageSideImageDocument | null = null;
  let uploading = false;
  let statusMessage = "";

  return {
    setDocument(document) {
      currentDocument = document;
      renderCurrentState();
    },
  };

  // fallow-ignore-next-line complexity
  function renderCurrentState(): void {
    removeExistingBox();
    const sideImagePath = readFrontmatterString(currentDocument?.frontmatter, "side_image");
    const editable = Boolean(currentDocument?.sourceEditable);
    if (!sideImagePath && !editable) {
      return;
    }
    const elements = createSideImageElements();
    const sideImageCaption = readFrontmatterString(currentDocument?.frontmatter, "side_image_caption");
    elements.uploadButton.disabled = uploading;
    elements.uploadButton.hidden = !editable;
    elements.uploadButton.textContent = uploading
      ? "正在上传..."
      : sideImagePath ? "更换图片" : "上传图片";
    elements.uploadInput.disabled = uploading;
    elements.caption.hidden = !sideImageCaption;
    elements.caption.textContent = sideImageCaption;
    elements.hint.textContent = statusMessage;
    if (sideImagePath) {
      elements.preview.hidden = false;
      elements.placeholder.hidden = true;
      elements.preview.src = buildSideImageUrl(sideImagePath);
      elements.preview.alt = `${currentDocument?.path ?? "wiki page"} side image`;
    }
    elements.uploadButton.addEventListener("click", () => {
      if (uploading || !editable) {
        return;
      }
      elements.uploadInput.click();
    });
    elements.uploadInput.addEventListener("change", () => {
      const nextFile = elements.uploadInput.files?.[0];
      if (!nextFile || !currentDocument?.sourceEditable || uploading) {
        elements.uploadInput.value = "";
        return;
      }
      void uploadNextFile(currentDocument.path, nextFile);
    });
    mountBox(elements.box);
  }

  async function uploadNextFile(pagePath: string, file: File): Promise<void> {
    uploading = true;
    statusMessage = "";
    renderCurrentState();
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await fetch("/api/page-side-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pagePath,
          fileName: file.name,
          dataUrl,
        }),
      });
      if (!response.ok) {
        throw new Error("upload failed");
      }
      await options.onUploaded();
      uploading = false;
      statusMessage = "";
      renderCurrentState();
    } catch {
      uploading = false;
      statusMessage = "上传失败，请刷新页面后再试。";
      renderCurrentState();
    }
  }

  function removeExistingBox(): void {
    options.refs.article.querySelector("[data-wiki-side-image-box]")?.remove();
  }

  function mountBox(box: HTMLElement): void {
    if (currentDocument?.path === "wiki/crm/人际关系总览.md") {
      const pageInfoHeading = findHeading("页面说明");
      if (pageInfoHeading) {
        pageInfoHeading.insertAdjacentElement("afterend", box);
        return;
      }
    }
    const firstHeading = options.refs.article.querySelector(":scope > h1");
    if (firstHeading?.parentElement === options.refs.article) {
      firstHeading.insertAdjacentElement("afterend", box);
      return;
    }
    options.refs.article.prepend(box);
  }

  function findHeading(text: string): HTMLElement | null {
    const headings = options.refs.article.querySelectorAll<HTMLElement>(":scope > h2");
    return Array.from(headings).find((heading) => heading.textContent?.includes(text)) ?? null;
  }
}

function createSideImageElements(): SideImageElements {
  const box = document.createElement("aside");
  box.className = "wiki-page__side-image-box";
  box.dataset.wikiSideImageBox = "true";
  box.innerHTML = `
    <img class="wiki-page__side-image-preview" data-wiki-side-image-preview alt="" hidden />
    <div class="wiki-page__side-image-placeholder" data-wiki-side-image-placeholder>
      这里可以放当前页面的右侧图片。
    </div>
    <p class="wiki-page__side-image-caption" data-wiki-side-image-caption hidden></p>
    <p class="wiki-page__side-image-hint" data-wiki-side-image-hint></p>
    <button type="button" class="wiki-page__tab-action wiki-page__side-image-upload" data-wiki-side-image-upload>上传图片</button>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-wiki-side-image-input hidden />
  `;
  return {
    box,
    preview: box.querySelector<HTMLImageElement>("[data-wiki-side-image-preview]")!,
    placeholder: box.querySelector<HTMLElement>("[data-wiki-side-image-placeholder]")!,
    caption: box.querySelector<HTMLElement>("[data-wiki-side-image-caption]")!,
    hint: box.querySelector<HTMLElement>("[data-wiki-side-image-hint]")!,
    uploadButton: box.querySelector<HTMLButtonElement>("[data-wiki-side-image-upload]")!,
    uploadInput: box.querySelector<HTMLInputElement>("[data-wiki-side-image-input]")!,
  };
}

function readFrontmatterString(
  frontmatter: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const candidate = frontmatter?.[key];
  if (typeof candidate !== "string") {
    return "";
  }
  return candidate.trim().replace(/^['"]|['"]$/gu, "");
}

function buildSideImageUrl(logicalPath: string): string {
  return `/api/page-side-image?path=${encodeURIComponent(logicalPath)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file read failed"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("file read failed"));
    };
    reader.readAsDataURL(file);
  });
}
