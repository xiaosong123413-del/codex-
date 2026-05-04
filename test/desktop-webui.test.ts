import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const desktopRoot = path.join(root, "desktop-webui");

describe("desktop webui migration scaffold", () => {
  it("adds root scripts for the Electron desktop shell", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["desktop:webui:install"]).toBe(
      "npm --prefix desktop-webui install",
    );
    expect(packageJson.scripts?.["desktop:webui:dev"]).toContain(
      "npm --prefix desktop-webui run dev",
    );
    expect(packageJson.scripts?.["desktop:webui:start"]).toContain(
      "npm --prefix desktop-webui run start",
    );
    expect(packageJson.scripts?.["desktop:webui:build"]).toContain(
      "npm --prefix desktop-webui run build",
    );
    expect(packageJson.scripts?.["desktop:webui:launch"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-desktop-webui.ps1",
    );
  });

  it("defines an Electron app package instead of another WinForms entrypoint", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(desktopRoot, "package.json"), "utf8"),
    ) as {
      main?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.main).toBe("dist/main.js");
    expect(packageJson.scripts?.dev).toContain("tsx watch src/main.ts");
    expect(packageJson.scripts?.start).toContain("electron .");
    expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.json");
    expect(packageJson.devDependencies?.electron).toBeTruthy();
  });

  it("boots a BrowserWindow and starts the local wiki web server automatically", async () => {
    const mainSource = await readFile(path.join(desktopRoot, "src", "main.ts"), "utf8");
    const submitSource = await readFile(path.join(desktopRoot, "src", "flash-diary-submit.ts"), "utf8");

    expect(mainSource).toContain("import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, session, shell } from \"electron\";");
    expect(mainSource).toContain("createWindow()");
    expect(mainSource).toContain("new BrowserWindow(");
    expect(mainSource).toContain("startWebServer(");
    expect(mainSource).toContain("server/index.ts");
    expect(mainSource).toContain("\"--source-vault\"");
    expect(mainSource).toContain("\"--runtime-root\"");
    expect(mainSource).not.toContain("\"--wiki\"");
    expect(mainSource).toContain("fs.mkdirSync(serverRoots.runtimeRoot, { recursive: true });");
    expect(mainSource).toContain("loadURL(serverUrl)");
    expect(mainSource).toContain("icon: resolveDesktopIconPath()");
    expect(mainSource).toContain("sync-compile-config.json");
    expect(mainSource).toContain("chooseTargetVault");
    expect(mainSource).toContain("choosePersonalTimelineSourceEntry");
    expect(mainSource).toContain("whenReady()");
    expect(mainSource).toContain("requestSingleInstanceLock()");
    expect(mainSource).toContain("second-instance");
    expect(mainSource).toContain("clearCache()");
    expect(mainSource).toContain("clearStorageData(");
    expect(mainSource).toContain("desktop:instance-redirected");
    expect(mainSource).toContain("registerConfiguredShortcuts()");
    expect(mainSource).toContain("CommandOrControl+Shift+J");
    expect(mainSource).toContain("CommandOrControl+Shift+E");
    expect(mainSource).toContain("desktop:save-shortcut");
    expect(mainSource).toContain("desktop:flash-diary-capture");
    expect(mainSource).toContain("buildWorkflowRecorderCaptureDataUrl");
    expect(mainSource).toContain("desktop:open-workflow-recorder");
    expect(mainSource).toContain("desktop:submit-workflow-recorder");
    expect(mainSource).toContain("desktop:import-xiaohongshu-cookie");
    expect(mainSource).toContain("desktop:open-xiaohongshu-login");
    expect(mainSource).toContain("desktop:import-douyin-cookie");
    expect(mainSource).toContain("desktop:open-douyin-login");
    expect(mainSource).toContain("collectDouyinDesktopCapture");
    expect(mainSource).toContain("clipPageWithSmartClip");
    expect(mainSource).toContain("stopSmartClipMcpClient");
    expect(mainSource).toContain("desktop:open-browser-url");
    expect(mainSource).toContain("openBrowserUrl");
    expect(mainSource).toContain("windowsDefaultBrowserLaunchCandidate");
    expect(mainSource).toContain("UrlAssociations\\\\${protocol}\\\\UserChoice");
    expect(mainSource).toContain("parseWindowsBrowserArgs");
    expect(mainSource).toContain("%[1lL]");
    expect(mainSource).toContain("系统默认浏览器");
    expect(mainSource).toContain("chrome.exe");
    expect(mainSource).toContain("msedge.exe");
    expect(mainSource).toContain("desktop:fetch-xiaohongshu-favorites");
    expect(mainSource).toContain("persist:llm-wiki-xiaohongshu");
    expect(mainSource).toContain("persist:llm-wiki-douyin");
    expect(mainSource).toContain("session.fromPartition");
    expect(mainSource).toContain("document.cookie");
    expect(mainSource).toContain("douyinSession().cookies.get({})");
    expect(mainSource).toContain("含 HttpOnly");
    expect(mainSource).toContain("api/import/xiaohongshu/progress");
    expect(mainSource).toContain("findAvailablePort");
    expect(mainSource).toContain("await stopWebServer();");
    expect(mainSource).toContain("const restartPort = activeWebPort;");
    expect(mainSource).toContain("await waitForPortToClose(restartPort)");
    expect(mainSource).toContain("liveRestart && restartPort === DEFAULT_WEB_PORT");
    expect(mainSource).toContain("async function stopWebServer(): Promise<void>");
    expect(mainSource).toContain("buildFlashDiarySubmission");
    expect(submitSource).toContain("smartclip-mcp");
    expect(submitSource).not.toContain("api/clips");
    expect(submitSource).not.toContain("api/xhs-sync/extract");
  });

  it("keeps quick capture clipping fields and direct media drop/paste bindings", async () => {
    const captureSource = await readFile(path.join(desktopRoot, "src", "flash-diary-capture.ts"), "utf8");
    const preloadSource = await readFile(path.join(desktopRoot, "src", "preload.ts"), "utf8");

    expect(captureSource).toContain("id=\"clip-url\"");
    expect(captureSource).toContain("input id=\"clip-url\"");
    expect(captureSource).not.toContain("textarea id=\"clip-url\"");
    expect(captureSource).toContain("id=\"clip-comment\"");
    expect(captureSource).toContain("addEventListener(\"paste\"");
    expect(captureSource).toContain("addEventListener(\"drop\"");
    expect(captureSource).toContain("saveFlashDiaryMedia");
    expect(preloadSource).toContain("saveFlashDiaryMedia");
    expect(preloadSource).toContain("openBrowserUrl");
  });

  it("keeps the quick capture page compact without the header copy blocks", async () => {
    const captureSource = await readFile(path.join(desktopRoot, "src", "flash-diary-capture.ts"), "utf8");

    expect(captureSource).not.toContain("class=\"eyebrow\"");
    expect(captureSource).not.toContain("<h1>");
    expect(captureSource).not.toContain("class=\"target-copy\"");
    expect(captureSource).not.toContain("targetCopyTitle");
    expect(captureSource).toContain("body { margin: 0; height: 100vh; overflow: hidden;");
    expect(captureSource).toContain("main { box-sizing: border-box; height: 100vh;");
    expect(captureSource).toContain(".card {");
    expect(captureSource).toContain("height: 100%; overflow: hidden;");
    expect(captureSource).toContain("grid-template-rows:");
    expect(captureSource).toContain(".clip-layout { display: grid; grid-template-rows: auto minmax(0, 1fr);");
    expect(captureSource).toContain("grid-template-columns: 1fr;");
    expect(captureSource).toContain("#clip-comment { min-height: 0;");
  });

  it("defines a standalone workflow recorder shortcut window", async () => {
    const captureSource = await readFile(path.join(desktopRoot, "src", "workflow-recorder-capture.ts"), "utf8");
    const mainSource = await readFile(path.join(desktopRoot, "src", "main.ts"), "utf8");
    const preloadSource = await readFile(path.join(desktopRoot, "src", "preload.ts"), "utf8");

    expect(captureSource).toContain("执行记录器");
    expect(captureSource).toContain("一键记录刚刚做了什么");
    expect(captureSource).toContain("typeCard(\"normal\"");
    expect(captureSource).toContain("typeCard(\"issue\"");
    expect(captureSource).toContain("typeCard(\"resolved\"");
    expect(captureSource).toContain("typeCard(\"method\", \"可能的方法方案\"");
    expect(captureSource).toContain("getWorkflowRecorderTasks");
    expect(captureSource).toContain("searchWorkflowTasks");
    expect(captureSource).toContain("createWorkflowTask");
    expect(captureSource).toContain("submitWorkflowRecorder");
    expect(captureSource).toContain("-webkit-app-region: drag");
    expect(captureSource).toContain("绑定任务");
    expect(captureSource).toContain("搜索任务");
    expect(captureSource).toContain("新增任务");
    expect(captureSource).toContain("overflow-x: auto");
    expect(captureSource).toContain("data-task-id");
    expect(captureSource).toContain("taskId: state.taskId");
    expect(captureSource).not.toContain("+ 新增命名流程");
    expect(captureSource).not.toContain("window.prompt(\"输入新流程名称\"");
    expect(captureSource).not.toContain("data-task=\"\">不绑定");
    expect(captureSource).not.toContain("renderToolBar");
    expect(captureSource).not.toContain("chooseWorkflowRecorderAttachments");
    expect(mainSource).toContain("WORKFLOW_RECORDER_WINDOW_SIZE");
    expect(mainSource).toContain("height: 860");
    expect(mainSource).toContain("desktop:create-workflow-recorder-task");
    expect(preloadSource).toContain("createWorkflowRecorderTask");
  });

  it("provides a browser preview URL for designing the quick capture page", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const previewSource = await readFile(
      path.join(desktopRoot, "scripts", "flash-diary-capture-preview.ts"),
      "utf8",
    );

    expect(packageJson.scripts?.["preview:flash-diary-capture"]).toContain("flash-diary-capture-preview.ts");
    expect(previewSource).toContain("buildFlashDiaryCaptureHtml");
    expect(previewSource).toContain("FLASH_DIARY_CAPTURE_PREVIEW_PORT");
    expect(previewSource).toContain("target=clipping");
    expect(previewSource).toContain("window.llmWikiDesktop");
  });

  it("uses a preload bridge for desktop capabilities instead of Node integration in the page", async () => {
    const mainSource = await readFile(path.join(desktopRoot, "src", "main.ts"), "utf8");
    const preloadSource = await readFile(
      path.join(desktopRoot, "src", "preload.ts"),
      "utf8",
    );

    expect(mainSource).toContain("preload: path.join(__dirname, \"preload.js\")");
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld");
    expect(preloadSource).toContain("chooseTargetVault");
    expect(preloadSource).toContain("choosePersonalTimelineSourceEntry");
    expect(preloadSource).toContain("getDesktopConfig");
    expect(preloadSource).toContain("onInstanceRedirected");
    expect(preloadSource).toContain("onFlashDiaryCapture");
    expect(preloadSource).toContain("openWorkflowRecorder");
    expect(preloadSource).toContain("submitWorkflowRecorder");
    expect(preloadSource).toContain("chooseWorkflowRecorderAttachments");
    expect(preloadSource).toContain("submitFlashDiaryEntry");
    expect(preloadSource).toContain("chooseFlashDiaryMedia");
    expect(preloadSource).toContain("importXiaohongshuCookie");
    expect(preloadSource).toContain("openXiaohongshuLogin");
    expect(preloadSource).toContain("importDouyinCookie");
    expect(preloadSource).toContain("openDouyinLogin");
    expect(preloadSource).toContain("fetchXiaohongshuFavorites");
  });

  it("provides a hidden launcher script and a desktop double-click entry", async () => {
    const launcherSource = await readFile(
      path.join(root, "scripts", "start-desktop-webui.ps1"),
      "utf8",
    );

    expect(launcherSource).toContain("desktop-webui");
    expect(launcherSource).toContain("Start-Process");
    expect(launcherSource).toContain("npm.cmd");
    expect(launcherSource).toContain("WindowStyle Hidden");
    expect(launcherSource).toContain("E:\\electron");
    expect(launcherSource).toContain("CreateShortcut");
    expect(launcherSource).toContain("IconLocation");
    expect(launcherSource).toContain("LLM Wiki WebUI.lnk");
    expect(launcherSource).toContain("llm-wiki.ico");
  });
});
