/**
 * Desktop quick-capture window markup.
 *
 * Builds the data-url page used by the global shortcut. The window keeps diary
 * capture fast while giving clipping mode separate fields for link parsing and
 * the user's own comment or follow-up note.
 */
export function buildFlashDiaryCaptureHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>\u95ea\u5ff5\u65e5\u8bb0</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
      body { margin: 0; height: 100vh; overflow: hidden; background: #f9f8fe; color: #1a1a1a; }
      main { box-sizing: border-box; height: 100vh; padding: 16px; display: grid; }
      .card {
        display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto auto;
        gap: 12px; height: 100%; overflow: hidden; padding: 18px; border: 1px solid #e8e5f0;
        border-radius: 20px; background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 18px 50px rgba(124, 92, 252, 0.10);
      }
      .card.is-dragging { border-color: #7c5cfc; box-shadow: 0 0 0 4px rgba(124, 92, 252, 0.12); }
      label { display: grid; gap: 8px; color: #333333; font-weight: 700; }
      textarea, input {
        width: 100%; box-sizing: border-box;
        border: 1px solid #e8e5f0; border-radius: 16px; padding: 12px 14px;
        outline: none; background: #fff; font: inherit; font-weight: 400;
      }
      textarea { min-height: 0; resize: none; }
      input { min-height: 48px; }
      textarea:focus, input:focus { border-color: #7c5cfc; box-shadow: 0 0 0 4px rgba(124, 92, 252, 0.12); }
      #diary-panel, #clip-panel { min-height: 0; }
      #flash-diary-text { height: 100%; }
      .clip-layout { display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: 1fr; gap: 12px; min-height: 0; }
      .clip-layout label { min-height: 0; }
      .clip-layout label:last-child { grid-template-rows: auto minmax(0, 1fr); }
      #clip-comment { min-height: 0; height: 100%; }
      [hidden] { display: none !important; }
      .toolbar, .actions { display: flex; gap: 12px; flex-wrap: wrap; }
      .toolbar { align-items: center; justify-content: space-between; }
      .actions { justify-content: flex-end; }
      .target-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .target-switch button { min-height: 42px; border-color: #e8e5f0; background: #fcfbff; color: #555555; }
      .target-switch button.active { border-color: #7c5cfc; background: #f3f0ff; color: #7c5cfc; }
      .media-list { display: grid; gap: 8px; width: min(100%, 360px); max-height: 48px; overflow: hidden; }
      .media-item, .media-empty {
        padding: 10px 12px; border-radius: 14px; border: 1px solid #e8e5f0;
        background: #fcfbff; color: #555555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      button {
        min-height: 42px; padding: 0 16px; border-radius: 14px; border: 1px solid #e8e5f0;
        background: #fff; color: #1a1a1a; font: inherit; font-weight: 700; cursor: pointer;
      }
      button.primary { border-color: #7c5cfc; background: #7c5cfc; color: white; }
      .status { min-height: 18px; font-size: 13px; color: #555555; }
      .status.error { color: #b12727; }
      @media (max-width: 520px) { main { padding: 12px; } .card { padding: 14px; } .toolbar { gap: 8px; } }
    </style>
  </head>
  <body>
    <main>
      <section class="card" id="capture-card">
        <div class="target-switch" role="group" aria-label="\u4fdd\u5b58\u76ee\u6807">
          <button type="button" class="active" data-target="flash-diary">\u8bb0\u5165\u65e5\u8bb0</button>
          <button type="button" data-target="clipping">\u8bb0\u5165\u526a\u85cf</button>
        </div>
        <div id="diary-panel">
          <textarea id="flash-diary-text" placeholder="\u5199\u4e0b\u8fd9\u4e00\u523b\u60f3\u5230\u7684\u5185\u5bb9..."></textarea>
        </div>
        <div id="clip-panel" class="clip-layout" hidden>
          <label>
            <span>\u89e3\u6790\u94fe\u63a5</span>
            <input id="clip-url" type="url" placeholder="\u7c98\u8d34\u9700\u8981\u89e3\u6790\u7684\u7f51\u9875\u6216\u89c6\u9891\u94fe\u63a5..." />
          </label>
          <label>
            <span>\u8bc4\u8bba / \u8ffd\u52a0</span>
            <textarea id="clip-comment" placeholder="\u5199\u4e0b\u4f60\u6253\u7b97\u600e\u4e48\u7528\u8fd9\u4e2a\u94fe\u63a5\u3001\u89c6\u9891\u6216\u7d20\u6750..."></textarea>
          </label>
        </div>
        <div class="toolbar">
          <button type="button" id="choose-media">\u9009\u62e9\u56fe\u7247 / \u89c6\u9891</button>
          <div id="media-list" class="media-list"></div>
        </div>
        <div id="status" class="status"></div>
        <div class="actions">
          <button type="button" id="cancel">\u53d6\u6d88</button>
          <button type="button" class="primary" id="submit">\u63d0\u4ea4</button>
        </div>
      </section>
    </main>
    <script>
      const card = document.getElementById("capture-card");
      const diaryPanel = document.getElementById("diary-panel");
      const clipPanel = document.getElementById("clip-panel");
      const diaryText = document.getElementById("flash-diary-text");
      const clipUrl = document.getElementById("clip-url");
      const clipComment = document.getElementById("clip-comment");
      const mediaList = document.getElementById("media-list");
      const status = document.getElementById("status");
      const selectedMedia = [];
      let target = "flash-diary";

      function escapeHtml(value) {
        return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
      }

      function renderMedia() {
        mediaList.innerHTML = selectedMedia.length
          ? selectedMedia.map((file) => '<div class="media-item">' + escapeHtml(displayName(file)) + '</div>').join("")
          : '<div class="media-empty">\u672a\u9009\u62e9\u9644\u4ef6\uff0c\u4e5f\u53ef\u76f4\u63a5\u7c98\u8d34\u6216\u62d6\u5165\u56fe\u7247 / \u89c6\u9891</div>';
      }

      function displayName(filePath) {
        return String(filePath).split(/[\\\\/]/).filter(Boolean).pop() || String(filePath);
      }

      function setStatus(message, isError = false) {
        status.textContent = message;
        status.classList.toggle("error", isError);
      }

      function renderTargetPanel() {
        const isClipping = target === "clipping";
        diaryPanel.hidden = isClipping;
        clipPanel.hidden = !isClipping;
        (isClipping ? clipUrl : diaryText).focus();
      }

      function addMediaPaths(paths) {
        for (const filePath of paths) {
          if (filePath && !selectedMedia.includes(filePath)) selectedMedia.push(filePath);
        }
        renderMedia();
      }

      function supportedFiles(fileList) {
        return Array.from(fileList || []).filter((file) =>
          file.type.startsWith("image/") || file.type.startsWith("video/") || /\\.(png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
        );
      }

      async function addMediaFiles(fileList) {
        const files = supportedFiles(fileList);
        if (files.length === 0) return false;
        setStatus("\u6b63\u5728\u8bfb\u53d6\u9644\u4ef6...");
        for (const file of files) {
          addMediaPaths([await resolveMediaPath(file)]);
        }
        setStatus("\u5df2\u6dfb\u52a0 " + files.length + " \u4e2a\u9644\u4ef6\u3002");
        return true;
      }

      async function resolveMediaPath(file) {
        if (typeof file.path === "string" && file.path) return file.path;
        if (!window.llmWikiDesktop.saveFlashDiaryMedia) throw new Error("\u5f53\u524d\u7248\u672c\u4e0d\u652f\u6301\u7c98\u8d34\u5a92\u4f53");
        return window.llmWikiDesktop.saveFlashDiaryMedia({
          fileName: file.name || "pasted-media",
          mimeType: file.type || "application/octet-stream",
          dataUrl: await readAsDataUrl(file),
        });
      }

      function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error || new Error("\u9644\u4ef6\u8bfb\u53d6\u5931\u8d25"));
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        });
      }

      document.getElementById("choose-media").addEventListener("click", async () => {
        addMediaPaths(await window.llmWikiDesktop.chooseFlashDiaryMedia());
      });

      document.querySelectorAll("[data-target]").forEach((button) => {
        button.addEventListener("click", () => {
          target = button.dataset.target === "clipping" ? "clipping" : "flash-diary";
          document.querySelectorAll("[data-target]").forEach((item) => item.classList.toggle("active", item === button));
          renderTargetPanel();
        });
      });

      card.addEventListener("paste", async (event) => {
        try {
          if (await addMediaFiles(event.clipboardData && event.clipboardData.files)) event.preventDefault();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-dragging"));
      card.addEventListener("drop", async (event) => {
        event.preventDefault();
        card.classList.remove("is-dragging");
        try {
          await addMediaFiles(event.dataTransfer && event.dataTransfer.files);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      });

      document.getElementById("cancel").addEventListener("click", () => window.close());
      document.getElementById("submit").addEventListener("click", () => {
        window.llmWikiDesktop.submitFlashDiaryEntry({
          target,
          text: target === "clipping" ? clipComment.value : diaryText.value,
          clippingUrl: clipUrl.value,
          clippingComment: clipComment.value,
          mediaPaths: selectedMedia,
        });
        window.close();
      });

      renderMedia();
      renderTargetPanel();
    </script>
  </body>
</html>`;
}

export function buildFlashDiaryCaptureDataUrl(): string {
  const html = buildFlashDiaryCaptureHtml();
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}
