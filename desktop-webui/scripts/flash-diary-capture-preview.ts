/**
 * Browser preview server for the desktop flash-diary quick-capture window.
 *
 * The production capture window is loaded through an Electron data URL. This
 * small server exposes the same HTML at a normal localhost URL so the page can
 * be inspected and designed in a browser without invoking Electron.
 */
import http from "node:http";
import { buildFlashDiaryCaptureHtml } from "../src/flash-diary-capture.js";

const DEFAULT_PREVIEW_PORT = 4187;
const PREVIEW_HOST = "127.0.0.1";

const port = readPreviewPort();

const server = http.createServer(handleRequest);

server.listen(port, PREVIEW_HOST, () => {
  console.log(`flash diary capture preview: http://${PREVIEW_HOST}:${port}/?target=clipping`);
});

function readPreviewPort(): number {
  const value = Number(process.env.FLASH_DIARY_CAPTURE_PREVIEW_PORT ?? DEFAULT_PREVIEW_PORT);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PREVIEW_PORT;
}

function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
  if (isPreviewRequest(request.url ?? "/")) {
    sendPreview(response);
    return;
  }
  sendNotFound(response);
}

function isPreviewRequest(requestUrl: string): boolean {
  const pathname = new URL(requestUrl, "http://preview.local").pathname;
  return pathname === "/" || pathname === "/flash-diary-capture";
}

function sendPreview(response: http.ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(buildPreviewHtml());
}

function sendNotFound(response: http.ServerResponse): void {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function buildPreviewHtml(): string {
  return buildFlashDiaryCaptureHtml().replace("</body>", `${buildPreviewScript()}</body>`);
}

function buildPreviewScript(): string {
  return `<script>
window.llmWikiDesktop = window.llmWikiDesktop || {
  chooseFlashDiaryMedia: async () => [],
  saveFlashDiaryMedia: async (payload) => payload.fileName || "preview-media",
  submitFlashDiaryEntry: async (payload) => {
    console.log("preview submit", payload);
    const status = document.getElementById("status");
    if (status) status.textContent = "\\u9884\\u89c8\\u6a21\\u5f0f\\uff1a\\u4e0d\\u4f1a\\u771f\\u5b9e\\u63d0\\u4ea4";
  }
};
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("target") === "clipping") {
    document.querySelector('[data-target="clipping"]')?.click();
  }
});
</script>`;
}
