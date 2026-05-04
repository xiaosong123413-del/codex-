import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, session, shell } from "electron";
import type { OpenDialogOptions, Session } from "electron";
import fs from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { buildFlashDiaryCaptureDataUrl } from "./flash-diary-capture.js";
import { registerFlashDiaryMediaHandlers } from "./flash-diary-media.js";
import { buildFlashDiarySubmission } from "./flash-diary-submit.js";
import {
  clipPageWithSmartClip,
  stopSmartClipMcpClient,
  type SmartClipMcpClipResult,
} from "./smartclip-mcp-client.js";
import {
  normalizeDesktopSyncCompileConfig,
  type SyncCompileConfig,
} from "./sync-config.js";
import {
  WORKSPACE_METADATA_RELATIVE_PATH,
  ensureWorkspaceBinding,
  normalizeOwnerUserId,
  type WorkspaceMetadata,
} from "./workspace-identity.js";
import { buildWorkflowRecorderCaptureDataUrl } from "./workflow-recorder-capture.js";
import { selectWorkflowRecorderTasks, type WorkflowRecorderTask } from "./workflow-recorder-tasks.js";

type StartupState = "UNCONFIGURED" | "CONFIGURING" | "INITIALIZING" | "READY";

interface AppConfig {
  accountIdentifier: string;
  accountUserId: string;
  accountServiceUrl: string;
  accountSession: AccountSessionConfig;
  targetRepoPath: string;
  sourceFolders: string[];
  initialized: boolean;
  workspaceId?: string;
  keyboardShortcuts?: AppShortcuts;
  lastSyncAt?: string;
  lastCompileAt?: string;
}

interface AppShortcuts {
  flashDiaryCapture: string;
  pageTextSearch: string;
  workflowRecorder: string;
  workspaceSave: string;
}

interface AccountSessionConfig {
  accountId: string;
  token: string;
  expiresAt: string;
}

interface RuntimeConfig {
  projectRoot?: string;
}

interface DesktopConfig {
  projectRoot: string;
  targetVault: string;
  serverUrl: string;
  appConfigPath: string;
}

interface DesktopServerRoots {
  sourceVaultRoot: string;
  runtimeRoot: string;
}

interface AppBootstrap {
  startupState: StartupState;
  appConfig: AppConfig | null;
  desktopConfig: DesktopConfig;
  reason?: string;
}

interface InitializePayload {
  accountIdentifier: string;
  accountPassword?: string;
  authMode?: "login" | "register" | "wechat";
  targetRepoPath: string;
  sourceFolders: string[];
}

interface WeChatInitializePayload {
  targetRepoPath: string;
  sourceFolders: string[];
}

interface WeChatSessionInitializePayload extends WeChatInitializePayload {
  accountSession: AccountSessionConfig;
}

interface WeChatMiniLoginPollPayload {
  loginId: string;
  pollToken: string;
}

interface FlashDiaryEntryPayload {
  target?: "flash-diary" | "clipping";
  text: string;
  mediaPaths: string[];
  clippingUrl?: string;
  clippingComment?: string;
}

interface SmartClipSubmissionBody {
  url: string;
  body: string;
  now: string;
  mediaPaths: string[];
}

interface DesktopSubmissionResult {
  success: boolean;
  error?: string;
  data?: {
    path?: string;
    status?: string;
    warnings?: string[];
  };
}

type WorkflowRecorderMarker = "normal" | "issue" | "resolved" | "method" | "end-node";

interface WorkflowRecorderPayload {
  text: string;
  taskId?: string;
  attachments: string[];
  marker: WorkflowRecorderMarker;
}

interface WorkflowRecorderTaskCreatePayload {
  title?: string;
}

interface TaskPlanStateResponse {
  success?: boolean;
  data?: {
    state?: unknown;
  };
}

interface TaskPlanPoolSnapshot {
  items: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
}

const WORKFLOW_RECORDER_MARKERS = new Set<WorkflowRecorderMarker>([
  "normal",
  "issue",
  "resolved",
  "method",
  "end-node",
]);

interface ShortcutSavePayload {
  id: keyof AppShortcuts;
  accelerator: string;
}

interface ShortcutStatus {
  shortcuts: AppShortcuts;
  registered: boolean;
  error?: string;
}

interface BrowserOpenResult {
  ok: boolean;
  browser?: string;
  error?: string;
}

interface BrowserLaunchCandidate {
  name: string;
  command: string;
  args: string[];
}

interface ImportedCookieResult {
  ok: boolean;
  cookie: string;
  count: number;
  message: string;
}

interface DesktopActionResult {
  ok: boolean;
  message: string;
}

interface XiaohongshuFavoritesResult {
  ok: boolean;
  urls: string[];
  count: number;
  message: string;
}

interface DouyinDesktopCapture {
  localVideoPath: string;
  title: string;
  desc: string;
  author: string;
  date: string;
  durationSeconds?: number;
  videoSourceUrl: string;
}

interface DouyinCaptureProbeResult {
  title?: string;
  desc?: string;
  author?: string;
  canonicalUrl?: string;
  durationSeconds?: number;
  videoUrls: string[];
}

interface AppConfigValidation {
  valid: boolean;
  reason?: string;
  workspaceMetadata?: WorkspaceMetadata;
}

const DEFAULT_WEB_PORT = 4175;
const WEB_HOST = "127.0.0.1";
const APP_CONFIG_FILENAME = "app-config.json";
const RUNTIME_CONFIG_FILENAME = "desktop-runtime.json";
const LOG_FILENAME = "log.md";
const DESKTOP_DEBUG_LOG = path.join(os.tmpdir(), "llm-wiki-desktop.log");
const INSTANCE_REDIRECTED_CHANNEL = "desktop:instance-redirected";
const FLASH_DIARY_CAPTURE_CHANNEL = "desktop:flash-diary-capture";
const XIAOHONGSHU_SESSION_PARTITION = "persist:llm-wiki-xiaohongshu";
const DOUYIN_SESSION_PARTITION = "persist:llm-wiki-douyin";
const DOUYIN_CAPTURE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DEFAULT_SHORTCUTS: AppShortcuts = {
  flashDiaryCapture: "CommandOrControl+Shift+J",
  pageTextSearch: "Ctrl+F",
  workflowRecorder: "CommandOrControl+Shift+E",
  workspaceSave: "CommandOrControl+S",
};
const WORKFLOW_RECORDER_WINDOW_SIZE = {
  width: 960,
  height: 860,
  minWidth: 900,
  minHeight: 820,
} as const;

let cacheHeadersInstalled = false;
let activeWebPort = DEFAULT_WEB_PORT;
let serverUrl = buildServerUrl(activeWebPort);

let mainWindow: BrowserWindow | null = null;
let flashDiaryCaptureWindow: BrowserWindow | null = null;
let workflowRecorderWindow: BrowserWindow | null = null;
let xiaohongshuLoginWindow: BrowserWindow | null = null;
let douyinLoginWindow: BrowserWindow | null = null;
let webServerProcess: ChildProcess | null = null;
let desktopConfig: DesktopConfig;
let appBootstrap: AppBootstrap;
let activeStartupState: StartupState = "UNCONFIGURED";
let shortcutStatus: ShortcutStatus = {
  shortcuts: DEFAULT_SHORTCUTS,
  registered: false,
};

const singleInstanceLock = app.requestSingleInstanceLock();
debugLog(`boot lock=${singleInstanceLock}`);

if (!singleInstanceLock) {
  debugLog("quit: second instance without lock");
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(INSTANCE_REDIRECTED_CHANNEL);
  debugLog("focus:existing-window");
});

async function createWindow(): Promise<void> {
  debugLog("createWindow:start");
  desktopConfig = buildDesktopConfig();
  debugLog(`projectRoot=${desktopConfig.projectRoot}`);
  await configureDesktopNetwork(desktopConfig.projectRoot);
  appBootstrap = loadAppBootstrap(desktopConfig);
  activeStartupState = appBootstrap.startupState;
  debugLog(`startupState=${activeStartupState} targetVault=${desktopConfig.targetVault}`);
  await startWebServer(desktopConfig.targetVault, true);
  debugLog("webServer:ready");

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#FFFFFF",
    autoHideMenuBar: true,
    title: "LLM Wiki",
    icon: resolveDesktopIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    debugLog(`renderer:console level=${level} line=${line} source=${sourceId} message=${message}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    debugLog(`renderer:did-fail-load code=${errorCode} url=${validatedURL} description=${errorDescription}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    debugLog(`renderer:gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  await prepareRendererSession(mainWindow);
  await mainWindow.loadURL(serverUrl);
  debugLog("window:loaded");
  mainWindow.show();
  mainWindow.focus();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function showFlashDiaryCaptureWindow(): Promise<void> {
  if (flashDiaryCaptureWindow && !flashDiaryCaptureWindow.isDestroyed()) {
    flashDiaryCaptureWindow.show();
    flashDiaryCaptureWindow.focus();
    return;
  }

  flashDiaryCaptureWindow = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 520,
    minHeight: 560,
    resizable: false,
    autoHideMenuBar: true,
    title: "\u95ea\u5ff5\u65e5\u8bb0\u5feb\u901f\u8bb0\u5f55",
    icon: resolveDesktopIconPath(),
    backgroundColor: "#F9F8FE",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  flashDiaryCaptureWindow.on("closed", () => {
    flashDiaryCaptureWindow = null;
  });

  await prepareRendererSession(flashDiaryCaptureWindow);
  await flashDiaryCaptureWindow.loadURL(buildFlashDiaryCaptureDataUrl());
  flashDiaryCaptureWindow.show();
  flashDiaryCaptureWindow.focus();
}

async function showWorkflowRecorderCaptureWindow(): Promise<void> {
  if (workflowRecorderWindow && !workflowRecorderWindow.isDestroyed()) {
    workflowRecorderWindow.show();
    workflowRecorderWindow.focus();
    return;
  }

  workflowRecorderWindow = new BrowserWindow({
    width: WORKFLOW_RECORDER_WINDOW_SIZE.width,
    height: WORKFLOW_RECORDER_WINDOW_SIZE.height,
    minWidth: WORKFLOW_RECORDER_WINDOW_SIZE.minWidth,
    minHeight: WORKFLOW_RECORDER_WINDOW_SIZE.minHeight,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: "\u6267\u884c\u8bb0\u5f55\u5668",
    icon: resolveDesktopIconPath(),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  workflowRecorderWindow.on("closed", () => {
    workflowRecorderWindow = null;
  });

  await prepareRendererSession(workflowRecorderWindow);
  await workflowRecorderWindow.loadURL(buildWorkflowRecorderCaptureDataUrl());
  workflowRecorderWindow.show();
  workflowRecorderWindow.focus();
  debugLog("shortcut:workflow-recorder window-open");
}

async function prepareRendererSession(window: BrowserWindow): Promise<void> {
  const session = window.webContents.session;
  if (!cacheHeadersInstalled) {
    session.webRequest.onHeadersReceived((details, callback) => {
      if (!details.url.startsWith(serverUrl)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...(details.responseHeaders ?? {}),
          "Cache-Control": ["no-store, no-cache, must-revalidate, proxy-revalidate"],
          Pragma: ["no-cache"],
          Expires: ["0"],
        },
      });
    });
    cacheHeadersInstalled = true;
  }
  await session.clearCache();
  await session.clearStorageData({
    storages: ["cachestorage", "serviceworkers"],
  });
  debugLog("session:cache-cleared");
}

function debugLog(message: string): void {
  try {
    fs.appendFileSync(DESKTOP_DEBUG_LOG, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Debug logging must never block app startup.
  }
}

function buildDesktopConfig(): DesktopConfig {
  const projectRoot = resolveProjectRoot();
  const appConfigPath = path.join(app.getPath("userData"), APP_CONFIG_FILENAME);
  return {
    projectRoot,
    targetVault: projectRoot,
    serverUrl,
    appConfigPath,
  };
}

// fallow-ignore-next-line complexity
function loadAppBootstrap(config: DesktopConfig): AppBootstrap {
  const appConfig = readAppConfig(config.appConfigPath);
  const validation = validateAppConfig(appConfig);
  const startupState = resolveStartupState(appConfig, validation.valid);
  const effectiveTargetVault =
    startupState === "READY" && appConfig ? appConfig.targetRepoPath : config.projectRoot;

  config.targetVault = effectiveTargetVault;
  if (startupState === "READY" && appConfig && validation.workspaceMetadata) {
    saveDesktopSyncConfig(
      effectiveTargetVault,
      appConfig.sourceFolders,
      validation.workspaceMetadata,
      appConfig.accountUserId,
    );
    ensureAuditDirectories(effectiveTargetVault);
  }

  return {
    startupState,
    appConfig,
    desktopConfig: { ...config, targetVault: effectiveTargetVault },
    reason: validation.reason,
  };
}

function resolveStartupState(appConfig: AppConfig | null, isValid: boolean): StartupState {
  if (!appConfig) return "UNCONFIGURED";
  if (!isValid) return "UNCONFIGURED";
  // Re-open the workspace as soon as a persisted config is usable.
  // The background initialization flag should not bounce the desktop UI
  // back into onboarding on the next launch.
  return "READY";
}

function readAppConfig(appConfigPath: string): AppConfig | null {
  if (!fs.existsSync(appConfigPath)) {
    return null;
  }

  try {
    return normalizeAppConfig(JSON.parse(fs.readFileSync(appConfigPath, "utf8").replace(/^\uFEFF/, "")) as AppConfig);
  } catch {
    return null;
  }
}

function normalizeAppConfig(appConfig: AppConfig): AppConfig {
  return {
    ...appConfig,
    accountIdentifier: normalizeOwnerUserId(appConfig.accountIdentifier ?? ""),
    accountUserId: normalizeOwnerUserId(appConfig.accountUserId ?? ""),
    accountServiceUrl: String(appConfig.accountServiceUrl ?? "").trim().replace(/\/+$/, ""),
    accountSession: normalizeAccountSession(appConfig.accountSession),
    keyboardShortcuts: normalizeShortcuts(appConfig.keyboardShortcuts),
  };
}

// fallow-ignore-next-line complexity
function normalizeAccountSession(sessionConfig: AccountSessionConfig | undefined): AccountSessionConfig {
  return {
    accountId: normalizeOwnerUserId(sessionConfig?.accountId ?? ""),
    token: String(sessionConfig?.token ?? "").trim(),
    expiresAt: String(sessionConfig?.expiresAt ?? "").trim(),
  };
}

function normalizeShortcuts(shortcuts: Partial<AppShortcuts> | undefined): AppShortcuts {
  return {
    ...DEFAULT_SHORTCUTS,
    ...(shortcuts ?? {}),
  };
}

// fallow-ignore-next-line complexity
function validateAppConfig(appConfig: AppConfig | null): AppConfigValidation {
  if (!appConfig) {
    return { valid: false, reason: "missing-config" };
  }
  if (!appConfig.accountIdentifier) {
    return { valid: false, reason: "missing-account-identifier" };
  }
  if (!appConfig.accountUserId || !appConfig.accountSession.token) {
    return { valid: false, reason: "missing-account-session" };
  }
  if (appConfig.accountSession.expiresAt && appConfig.accountSession.expiresAt <= new Date().toISOString()) {
    return { valid: false, reason: "expired-account-session" };
  }
  if (!appConfig.targetRepoPath || !fs.existsSync(appConfig.targetRepoPath)) {
    return { valid: false, reason: "missing-target-repo" };
  }
  if (!Array.isArray(appConfig.sourceFolders)) {
    return { valid: false, reason: "invalid-source-folders" };
  }
  const binding = ensureWorkspaceBinding(appConfig.targetRepoPath, appConfig.accountUserId);
  if (!binding.ok) {
    return { valid: false, reason: binding.error };
  }
  return { valid: true, workspaceMetadata: binding.metadata };
}

function writeAppConfig(appConfigPath: string, appConfig: AppConfig): void {
  fs.mkdirSync(path.dirname(appConfigPath), { recursive: true });
  fs.writeFileSync(appConfigPath, `${JSON.stringify(normalizeAppConfig(appConfig), null, 2)}\n`, "utf8");
}

function resolveProjectRoot(): string {
  const runtimeProjectRoot = readRuntimeProjectRoot();
  if (runtimeProjectRoot) {
    return runtimeProjectRoot;
  }
  return path.resolve(__dirname, "..", "..");
}

// fallow-ignore-next-line complexity
function readRuntimeProjectRoot(): string | null {
  const runtimeConfigPath = resolveRuntimeConfigPath();
  if (!runtimeConfigPath || !fs.existsSync(runtimeConfigPath)) {
    return null;
  }

  try {
    const runtimeConfig = JSON.parse(
      fs.readFileSync(runtimeConfigPath, "utf8"),
    ) as RuntimeConfig;
    const projectRoot = runtimeConfig.projectRoot?.trim();
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      return null;
    }
    return projectRoot;
  } catch {
    return null;
  }
}

function resolveRuntimeConfigPath(): string | null {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, RUNTIME_CONFIG_FILENAME);
  }

  const localRuntimeConfig = path.resolve(__dirname, "..", RUNTIME_CONFIG_FILENAME);
  if (fs.existsSync(localRuntimeConfig)) {
    return localRuntimeConfig;
  }

  return path.resolve(__dirname, "..", "..", RUNTIME_CONFIG_FILENAME);
}

function resolveDesktopIconPath(): string {
  return path.resolve(__dirname, "..", "assets", "llm-wiki.ico");
}

function resolveNodeCommand(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

function ensureAuditDirectories(targetVault: string): void {
  fs.mkdirSync(path.join(targetVault, "audit", "resolved"), { recursive: true });
}

// fallow-ignore-next-line complexity
async function startWebServer(targetVault: string, forceRestart: boolean): Promise<void> {
  debugLog(`startWebServer:start forceRestart=${forceRestart} targetVault=${targetVault}`);
  const liveRestart = forceRestart && Boolean(mainWindow);
  const restartPort = activeWebPort;
  if (forceRestart) {
    await stopWebServer();
  }

  if (liveRestart) {
    const restartPortReleased = await waitForPortToClose(restartPort);
    if (!restartPortReleased) {
      debugLog(`startWebServer:live-restart-port-unavailable port=${restartPort}`);
      throw new Error(`Local LLM Wiki web server port ${restartPort} is unavailable during live restart.`);
    }
  }

  if (!forceRestart && await isServerCompatible(DEFAULT_WEB_PORT)) {
    setActiveWebPort(DEFAULT_WEB_PORT);
    debugLog("startWebServer:existing-compatible-server");
    return;
  }

  if (await isPortOpen(DEFAULT_WEB_PORT)) {
    if (liveRestart && restartPort === DEFAULT_WEB_PORT) {
      debugLog(`startWebServer:live-restart-port-conflict port=${DEFAULT_WEB_PORT}`);
      throw new Error(`Local LLM Wiki web server port ${DEFAULT_WEB_PORT} is unavailable during live restart.`);
    }
    const fallbackPort = await findAvailablePort(DEFAULT_WEB_PORT + 1);
    setActiveWebPort(fallbackPort);
    debugLog(`startWebServer:default-port-incompatible fallbackPort=${fallbackPort}`);
  } else {
    setActiveWebPort(DEFAULT_WEB_PORT);
  }

  if (!webServerProcess || webServerProcess.killed) {
    const webRoot = path.join(desktopConfig.projectRoot, "web");
    const tsxCli = path.join(webRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const serverRoots = resolveDesktopServerRoots();
    fs.mkdirSync(serverRoots.runtimeRoot, { recursive: true });
    debugLog(`startWebServer:spawn ${resolveNodeCommand()} ${tsxCli} cwd=${webRoot}`);
    const child = spawn(
      resolveNodeCommand(),
      [
        tsxCli,
        "server/index.ts",
        "--source-vault",
        serverRoots.sourceVaultRoot,
        "--runtime-root",
        serverRoots.runtimeRoot,
        "--port",
        String(activeWebPort),
        "--author",
        os.userInfo().username || "me",
      ],
      {
        cwd: webRoot,
        env: buildWebServerEnv(readAppConfig(desktopConfig.appConfigPath)),
        windowsHide: true,
        shell: false,
        stdio: "pipe",
      },
    );
    webServerProcess = child;

    child.stdout?.on("data", (chunk) => {
      debugLog(`server:stdout ${String(chunk).trim()}`);
      relayInitializationProgress("server", String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      debugLog(`server:stderr ${String(chunk).trim()}`);
      relayInitializationProgress("server", String(chunk));
    });
    child.on("error", (error) => {
      debugLog(`server:error ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (webServerProcess === child) {
        webServerProcess = null;
      }
      debugLog(`server:exit code=${code ?? "null"} signal=${signal ?? "null"}`);
    });
  }

  const ready = await waitForServerReady();
  if (!ready) {
    debugLog("startWebServer:failed-to-start");
    throw new Error("Local LLM Wiki web server failed to start.");
  }
  debugLog("startWebServer:ready");
}

function buildServerUrl(port: number): string {
  return `http://${WEB_HOST}:${port}/`;
}

function setActiveWebPort(port: number): void {
  activeWebPort = port;
  serverUrl = buildServerUrl(port);
  if (desktopConfig) {
    desktopConfig.serverUrl = serverUrl;
    appBootstrap = {
      ...appBootstrap,
      desktopConfig: { ...desktopConfig },
    };
  }
}

async function isServerCompatible(port: number): Promise<boolean> {
  const configReachable = await isServerReachable(port);
  if (!configReachable) return false;
  return isJsonEndpointReachable(port, "api/import/xiaohongshu/progress");
}

function isServerReachable(port = activeWebPort): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(`${buildServerUrl(port)}api/config`, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function isJsonEndpointReachable(port: number, endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(`${buildServerUrl(port)}${endpoint}`, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 500) {
          resolve(false);
          return;
        }
        try {
          JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });

    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: WEB_HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortToClose(
  port: number,
  attempts = 30,
  intervalMs = 150,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isPortOpen(port))) {
      return true;
    }
    await delay(intervalMs);
  }
  return false;
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (!(await isPortOpen(port))) {
      return port;
    }
  }
  throw new Error("No available local web server port found.");
}

async function waitForServerReady(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isServerCompatible(activeWebPort)) {
      return true;
    }
    await delay(1000);
  }
  return false;
}

async function stopWebServer(): Promise<void> {
  const child = webServerProcess;
  const portToRelease = activeWebPort;
  webServerProcess = null;

  if (!child || child.killed) {
    await waitForPortToClose(portToRelease, 5, 100);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.removeListener("exit", handleExit);
      child.removeListener("error", handleError);
      resolve();
    };
    const handleExit = (): void => finish();
    const handleError = (): void => finish();

    child.once("exit", handleExit);
    child.once("error", handleError);
    if (!child.kill()) {
      finish();
      return;
    }
    setTimeout(finish, 3000);
  });

  await waitForPortToClose(portToRelease);
}

async function chooseTargetVault(): Promise<string | null> {
  const filePaths = await showDesktopOpenDialog({
    title: "\u9009\u62e9\u76ee\u6807\u4ed3\u5e93",
    properties: ["openDirectory"],
  });
  return filePaths[0] ?? null;
}

async function chooseSourceFolders(): Promise<string[]> {
  return showDesktopOpenDialog({
    title: "\u9009\u62e9\u540c\u6b65\u6e90\u6587\u4ef6\u5939",
    properties: ["openDirectory", "multiSelections"],
  });
}

async function choosePersonalTimelineSourceEntry(): Promise<string | null> {
  const filePaths = await showDesktopOpenDialog({
    title: "\u9009\u62e9\u4e2a\u4eba\u65f6\u95f4\u7ebf\u8f93\u5165\u6765\u6e90",
    properties: ["openFile", "openDirectory"],
  });
  return filePaths[0] ?? null;
}

async function showDesktopOpenDialog(options: OpenDialogOptions): Promise<string[]> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  return result.filePaths;
}

async function importXiaohongshuCookie(): Promise<ImportedCookieResult> {
  let workerWindow: BrowserWindow | null = null;
  try {
    workerWindow = new BrowserWindow({
      show: false,
      width: 1180,
      height: 820,
      autoHideMenuBar: true,
      title: "小红书 Cookie 导入",
      backgroundColor: "#FFFFFF",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: XIAOHONGSHU_SESSION_PARTITION,
      },
    });
    await workerWindow.loadURL("https://www.xiaohongshu.com");
    const cookieHeader = await workerWindow.webContents.executeJavaScript(
      "document.cookie",
      true,
    ) as string;
    const validCookies = cookieHeader
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (validCookies.length === 0) {
      return {
        ok: false,
        cookie: "",
        count: 0,
        message: "没有读取到小红书可见 Cookie。请先在当前桌面端登录小红书后再导入。",
      };
    }
    return {
      ok: true,
      cookie: validCookies.join("; "),
      count: validCookies.length,
      message: `已按页面可见 Cookie 读取 ${validCookies.length} 项小红书 Cookie。`,
    };
  } finally {
    if (workerWindow && !workerWindow.isDestroyed()) {
      workerWindow.destroy();
    }
  }
}

async function importDouyinCookie(): Promise<ImportedCookieResult> {
  const imported = await douyinSession().cookies.get({});
  const validCookies = imported
    .filter((cookie) => isDouyinCookieDomain(cookie.domain ?? ""))
    .map((cookie) => `${cookie.name.trim()}=${cookie.value.trim()}`)
    .filter((cookie) => Boolean(cookie) && !cookie.endsWith("="));
  if (validCookies.length === 0) {
    return {
      ok: false,
      cookie: "",
      count: 0,
      message: "没有读取到抖音浏览器会话 Cookie。请先在当前桌面端登录抖音后再导入。",
    };
  }
  return {
    ok: true,
    cookie: validCookies.join("; "),
    count: validCookies.length,
    message: `已按浏览器会话读取 ${validCookies.length} 项抖音 Cookie（含 HttpOnly）。`,
  };
}

// fallow-ignore-next-line complexity
async function fetchXiaohongshuFavorites(): Promise<XiaohongshuFavoritesResult> {
  let workerWindow: BrowserWindow | null = null;
  try {
    workerWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      autoHideMenuBar: true,
      title: "小红书收藏同步",
      backgroundColor: "#FFFFFF",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: XIAOHONGSHU_SESSION_PARTITION,
      },
    });
    await workerWindow.loadURL("https://www.xiaohongshu.com/explore");
    const result = await workerWindow.webContents.executeJavaScript(`
      (async () => {
        const trimString = (value) => typeof value === "string" ? value.trim() : "";
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const uniqueUrls = (urls) => [...new Set(urls.map((url) => trimString(url)).filter((url) => /xiaohongshu\\.com/i.test(url)))];
        const resolveAbsoluteUrl = (value) => {
          const text = trimString(value);
          if (!text) return "";
          try {
            return new URL(text, location.origin).toString();
          } catch {
            return "";
          }
        };
        const readFavoriteUrlsFromDom = () => {
          const hrefs = Array.from(document.querySelectorAll("a[href]"))
            .map((node) => resolveAbsoluteUrl(node.getAttribute("href")))
            .filter((href) => /xiaohongshu\\.com\\/(explore|discovery\\/item)\\//i.test(href));
          return uniqueUrls(hrefs);
        };
        const hasCollectionSignals = () => {
          return Boolean(
            document.querySelector(".collection-list-wrapper, .collection-list-item-wrapper, [class*='collection-list']") ||
            Array.from(document.querySelectorAll("a,button,[role='tab'],div,span")).some((node) => {
              const text = trimString(node.textContent);
              const href = resolveAbsoluteUrl(node.getAttribute?.("href"));
              const className = typeof node.className === "string" ? node.className : "";
              return (
                text.includes("收藏") ||
                /collect|collection/i.test(href) ||
                /collect|collection/i.test(className)
              );
            })
          );
        };
        const openUserProfilePage = async () => {
          const candidates = Array.from(document.querySelectorAll("a[href]"));
          const target = candidates.find((node) => /\\/user\\/profile\\//i.test(trimString(node.getAttribute("href"))));
          if (!target) {
            return false;
          }
          window.location.href = resolveAbsoluteUrl(target.getAttribute("href"));
          await sleep(2200);
          return true;
        };
        const openCollectionTab = async () => {
          const candidates = Array.from(document.querySelectorAll("a,button,[role='tab'],div,span"));
          const target = candidates.find((node) => {
            const text = trimString(node.textContent);
            const href = resolveAbsoluteUrl(node.getAttribute?.("href"));
            const className = typeof node.className === "string" ? node.className : "";
            return (
              text === "收藏" ||
              text === "我的收藏" ||
              text.includes("收藏夹") ||
              /collect|collection/i.test(href) ||
              /collect|collection/i.test(className)
            );
          });
          if (!target) {
            return false;
          }
          if (target instanceof HTMLAnchorElement && target.href) {
            window.location.href = target.href;
          } else {
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          }
          await sleep(2200);
          return true;
        };
        if (!hasCollectionSignals()) {
          const openedProfile = await openUserProfilePage();
          if (!openedProfile) {
            throw new Error("没有找到当前账号的用户主页入口，请确认当前账号已登录。");
          }
        }
        if (!hasCollectionSignals()) {
          const openedCollection = await openCollectionTab();
          if (!openedCollection) {
            throw new Error("已经进入用户页，但没有定位到收藏 tab / 收藏列表。");
          }
        }
        if (!hasCollectionSignals()) {
          throw new Error("已经尝试进入收藏页，但页面里仍然没有收藏列表信号。");
        }
        let stableRounds = 0;
        let previousCount = 0;
        for (let round = 0; round < 30; round += 1) {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
          await sleep(1200);
          const count = readFavoriteUrlsFromDom().length;
          if (count === previousCount) {
            stableRounds += 1;
            if (stableRounds >= 3) break;
          } else {
            stableRounds = 0;
            previousCount = count;
          }
        }
        const unique = readFavoriteUrlsFromDom();
        return {
          ok: true,
          urls: unique,
          count: unique.length,
          message: unique.length > 0 ? \`已从收藏页读取 \${unique.length} 条小红书收藏。\` : "收藏页里没有检测到可同步的帖子链接。",
        };
      })();
    `, true) as XiaohongshuFavoritesResult;
    return result;
  } catch (error) {
    return {
      ok: false,
      urls: [],
      count: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (workerWindow && !workerWindow.isDestroyed()) {
      workerWindow.destroy();
    }
  }
}

function xiaohongshuSession(): Session {
  return session.fromPartition(XIAOHONGSHU_SESSION_PARTITION);
}

function douyinSession(): Session {
  return session.fromPartition(DOUYIN_SESSION_PARTITION);
}

function isDouyinCookieDomain(domain: string): boolean {
  const normalized = domain.trim().replace(/^\./, "").toLowerCase();
  return normalized === "douyin.com" || normalized.endsWith(".douyin.com");
}

async function openXiaohongshuLogin(): Promise<DesktopActionResult> {
  if (xiaohongshuLoginWindow && !xiaohongshuLoginWindow.isDestroyed()) {
    xiaohongshuLoginWindow.show();
    xiaohongshuLoginWindow.focus();
    return { ok: true, message: "小红书登录窗口已打开。" };
  }

  xiaohongshuLoginWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    autoHideMenuBar: true,
    title: "小红书登录",
    icon: resolveDesktopIconPath(),
    backgroundColor: "#FFFFFF",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: XIAOHONGSHU_SESSION_PARTITION,
    },
  });

  xiaohongshuLoginWindow.on("closed", () => {
    xiaohongshuLoginWindow = null;
  });

  await xiaohongshuLoginWindow.loadURL("https://www.xiaohongshu.com");
  xiaohongshuLoginWindow.show();
  xiaohongshuLoginWindow.focus();
  return { ok: true, message: "已打开小红书登录窗口。登录完成后回到导入弹窗读取 Cookie。" };
}

async function openDouyinLogin(): Promise<DesktopActionResult> {
  if (douyinLoginWindow && !douyinLoginWindow.isDestroyed()) {
    douyinLoginWindow.show();
    douyinLoginWindow.focus();
    return { ok: true, message: "抖音登录窗口已打开。" };
  }

  douyinLoginWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    autoHideMenuBar: true,
    title: "抖音登录",
    icon: resolveDesktopIconPath(),
    backgroundColor: "#FFFFFF",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: DOUYIN_SESSION_PARTITION,
    },
  });

  douyinLoginWindow.on("closed", () => {
    douyinLoginWindow = null;
  });

  douyinLoginWindow.webContents.setUserAgent(DOUYIN_CAPTURE_USER_AGENT);
  const blockLoginExternalProtocol = (event: Electron.Event, targetUrl: string) => {
    if (/^(?!https?:|file:|about:|data:|blob:)[a-z][a-z0-9+.\-]*:/i.test(targetUrl)) {
      event.preventDefault();
    }
  };
  douyinLoginWindow.webContents.on("will-navigate", blockLoginExternalProtocol);
  douyinLoginWindow.webContents.on("will-redirect", blockLoginExternalProtocol);
  douyinLoginWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) =>
    /^(?!https?:|file:|about:|data:|blob:)[a-z][a-z0-9+.\-]*:/i.test(targetUrl)
      ? { action: "deny" }
      : { action: "allow" },
  );

  await douyinLoginWindow.loadURL("https://www.douyin.com", { userAgent: DOUYIN_CAPTURE_USER_AGENT });
  douyinLoginWindow.show();
  douyinLoginWindow.focus();
  return { ok: true, message: "已打开抖音登录窗口。登录完成后回到导入弹窗读取 Cookie。" };
}

// fallow-ignore-next-line complexity
async function collectDouyinDesktopCapture(url: string, rawText: string): Promise<DouyinDesktopCapture & { canonicalUrl: string }> {
  let workerWindow: BrowserWindow | null = null;
  try {
    workerWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      autoHideMenuBar: true,
      title: "抖音采集",
      backgroundColor: "#FFFFFF",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: DOUYIN_SESSION_PARTITION,
      },
    });
    workerWindow.webContents.setUserAgent(DOUYIN_CAPTURE_USER_AGENT);
    workerWindow.webContents.setAudioMuted(true);
    const blockExternalProtocol = (event: Electron.Event, targetUrl: string) => {
      if (/^(?!https?:|file:|about:|data:|blob:)[a-z][a-z0-9+.\-]*:/i.test(targetUrl)) {
        event.preventDefault();
      }
    };
    workerWindow.webContents.on("will-navigate", blockExternalProtocol);
    workerWindow.webContents.on("will-redirect", blockExternalProtocol);
    workerWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) =>
      /^(?!https?:|file:|about:|data:|blob:)[a-z][a-z0-9+.\-]*:/i.test(targetUrl)
        ? { action: "deny" }
        : { action: "allow" },
    );
    await workerWindow.loadURL(url, { userAgent: DOUYIN_CAPTURE_USER_AGENT });
    const probe = await workerWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (value) => typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
        const absolute = (value) => {
          const text = clean(value);
          if (!text || /^blob:/i.test(text)) return "";
          try {
            return new URL(text, location.href).toString();
          } catch {
            return "";
          }
        };
        const collectUrls = () => {
          const videoUrls = Array.from(document.querySelectorAll("video"))
            .flatMap((node) => [node.currentSrc, node.src, node.getAttribute("src")])
            .map((value) => absolute(value))
            .filter(Boolean);
          const sourceUrls = Array.from(document.querySelectorAll("source[src]"))
            .map((node) => absolute(node.getAttribute("src")))
            .filter(Boolean);
          const resourceUrls = performance.getEntriesByType("resource")
            .map((entry) => absolute(entry.name))
            .filter(Boolean);
          return [...new Set([...videoUrls, ...sourceUrls, ...resourceUrls])];
        };
        const readMeta = (selector) => clean(document.querySelector(selector)?.getAttribute("content") || "");
        const readTitle = () => clean(
          document.querySelector("h1")?.textContent ||
          readMeta('meta[property="og:title"]') ||
          readMeta('meta[name="title"]') ||
          document.title
        );
        const readDesc = () => clean(
          readMeta('meta[property="og:description"]') ||
          readMeta('meta[name="description"]') ||
          ""
        );
        const readAuthor = () => clean(
          Array.from(document.querySelectorAll("a,span,div"))
            .map((node) => clean(node.textContent || ""))
            .find((text) => text.length > 0 && text.length <= 32 && !/^复制此链接/.test(text)) ||
          ""
        );
        let haveVideoSince = -1;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const videos = Array.from(document.querySelectorAll("video"));
          await Promise.all(videos.map((video) => video.play().catch(() => undefined)));
          const videoUrls = collectUrls();
          const durationSeconds = videos
            .map((video) => Number(video.duration))
            .find((duration) => Number.isFinite(duration) && duration > 0);
          const hasVideo = videoUrls.some((value) => /(mime_type=video_mp4|\\.mp4(?:$|\\?)|\\.m3u8(?:$|\\?)|douyinvod)/i.test(value));
          const hasAudio = videoUrls.some((value) => /(mime_type=audio|audio_mp4)/i.test(value));
          if (hasVideo && haveVideoSince < 0) haveVideoSince = attempt;
          const waitedAfterVideo = haveVideoSince >= 0 ? attempt - haveVideoSince : 0;
          if (hasVideo && (hasAudio || waitedAfterVideo >= 6)) {
            return {
              title: readTitle(),
              desc: readDesc(),
              author: readAuthor(),
              canonicalUrl: location.href,
              durationSeconds,
              videoUrls,
            };
          }
          await sleep(500);
        }
        return {
          title: readTitle(),
          desc: readDesc(),
          author: readAuthor(),
          canonicalUrl: location.href,
          durationSeconds: undefined,
          videoUrls: collectUrls(),
        };
      })()
    `, true) as DouyinCaptureProbeResult;
    const canonicalUrl = normalizeAbsoluteUrl(probe.canonicalUrl) || url;
    const videoSourceUrl = pickDouyinDesktopVideoUrl(probe.videoUrls);
    const audioSourceUrl = pickDouyinDesktopAudioUrl(probe.videoUrls);

    let localVideoPath: string | null = null;
    try {
      localVideoPath = await downloadDouyinWithYtDlp(canonicalUrl);
    } catch (error) {
      debugLog("yt-dlp download failed, falling back to DASH capture: " + (error instanceof Error ? error.message : String(error)));
    }
    if (!localVideoPath) {
      if (!videoSourceUrl) {
        throw new Error("桌面端未捕获到可下载的抖音视频地址");
      }
      localVideoPath = await downloadDouyinDesktopVideo(videoSourceUrl, audioSourceUrl);
    }
    return {
      canonicalUrl,
      localVideoPath,
      title: probe.title?.trim() || deriveDouyinTextTitle(rawText),
      desc: probe.desc?.trim() || rawText.trim(),
      author: probe.author?.trim() || "",
      date: new Date().toISOString().slice(0, 10),
      durationSeconds: probe.durationSeconds && probe.durationSeconds > 0 ? probe.durationSeconds : undefined,
      videoSourceUrl: videoSourceUrl ?? canonicalUrl,
    };
  } finally {
    if (workerWindow && !workerWindow.isDestroyed()) {
      workerWindow.destroy();
    }
  }
}

// fallow-ignore-next-line complexity
async function downloadDouyinWithYtDlp(canonicalUrl: string): Promise<string | null> {
  const ytDlpPath = resolveYtDlpBinary();
  if (!ytDlpPath) {
    debugLog("yt-dlp binary not found, skipping yt-dlp path");
    return null;
  }
  debugLog(`yt-dlp: using binary ${ytDlpPath} for ${canonicalUrl}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-ytdlp-"));
  const cookiesPath = path.join(tempRoot, "cookies.txt");
  let cookieCount = 0;
  try {
    cookieCount = await exportDouyinCookiesNetscape(cookiesPath);
    debugLog(`yt-dlp: exported ${cookieCount} cookies to ${cookiesPath}`);
  } catch (error) {
    debugLog("export douyin cookies failed: " + (error instanceof Error ? error.message : String(error)));
  }
  const outputTemplate = path.join(tempRoot, "capture.%(ext)s");
  const args: string[] = [
    "-f", "bv*+ba/b",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-part",
    "--user-agent", DOUYIN_CAPTURE_USER_AGENT,
    "--referer", "https://www.douyin.com/",
    "--add-header", "Accept-Language:zh-CN,zh;q=0.9",
    "-o", outputTemplate,
  ];
  if (fs.existsSync(cookiesPath) && cookieCount > 0) {
    args.push("--cookies", cookiesPath);
  }
  args.push(canonicalUrl);
  debugLog(`yt-dlp: args = ${JSON.stringify(args)}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ytDlpPath, args, { windowsHide: true, shell: false });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      debugLog(`yt-dlp: exit code=${code}\nstdout=${stdout.slice(-800)}\nstderr=${stderr.slice(-800)}`);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code ?? "unknown"}`));
    });
  });
  const downloaded = fs.readdirSync(tempRoot).find((name) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(name));
  if (!downloaded) {
    debugLog(`yt-dlp: exit 0 but no mp4 in ${tempRoot}, contents=${fs.readdirSync(tempRoot).join(",")}`);
    return null;
  }
  debugLog(`yt-dlp: downloaded ${downloaded}`);
  return path.join(tempRoot, downloaded);
}

function resolveYtDlpBinary(): string | null {
  const candidates = [
    path.join(desktopConfig.projectRoot, "tools", "yt-dlp.exe"),
    path.join(desktopConfig.projectRoot, "tools", "yt-dlp"),
    path.join(desktopConfig.projectRoot, "bin", "yt-dlp.exe"),
    path.join(desktopConfig.projectRoot, "bin", "yt-dlp"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

// fallow-ignore-next-line complexity
async function exportDouyinCookiesNetscape(filePath: string): Promise<number> {
  const cookies = await douyinSession().cookies.get({});
  const lines = ["# Netscape HTTP Cookie File", ""];
  let count = 0;
  for (const cookie of cookies) {
    const domain = cookie.domain ?? "";
    if (!domain) continue;
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const cookiePath = cookie.path || "/";
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = cookie.session || !cookie.expirationDate
      ? "0"
      : String(Math.floor(cookie.expirationDate));
    lines.push([domain, includeSubdomains, cookiePath, secure, expires, cookie.name, cookie.value].join("\t"));
    count += 1;
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
  return count;
}

// fallow-ignore-next-line complexity
function pickDouyinDesktopVideoUrl(urls: readonly string[]): string | null {
  const candidates = [...new Set(urls.map((value) => normalizeAbsoluteUrl(value)).filter(Boolean))];
  let bestUrl = "";
  let bestScore = -1;
  for (const candidate of candidates) {
    let score = 0;
    if (/douyinvod|bytevod|video\/tos/i.test(candidate)) {
      score += 6;
    }
    if (/mime_type=video_mp4|\.mp4(?:$|\?)/i.test(candidate)) {
      score += 10;
    }
    if (/\.m3u8(?:$|\?)/i.test(candidate)) {
      score += 4;
    }
    if (/mime_type=audio|audio_mp4|\.jpg(?:$|\?)|\.jpeg(?:$|\?)|\.png(?:$|\?)|\.gif(?:$|\?)|\.webp(?:$|\?)|\.js(?:$|\?)|\.css(?:$|\?)/i.test(candidate)) {
      score -= 12;
    }
    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidate;
    }
  }
  return bestScore > 0 ? bestUrl : null;
}

// fallow-ignore-next-line complexity
function pickDouyinDesktopAudioUrl(urls: readonly string[]): string | null {
  const candidates = [...new Set(urls.map((value) => normalizeAbsoluteUrl(value)).filter(Boolean))];
  let bestUrl = "";
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!/mime_type=audio|audio_mp4/i.test(candidate)) continue;
    let score = 10;
    if (/douyinvod|bytevod/i.test(candidate)) score += 4;
    if (/\.mp4(?:$|\?)/i.test(candidate)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidate;
    }
  }
  return bestScore > 0 ? bestUrl : null;
}

// fallow-ignore-next-line complexity
async function downloadDouyinDesktopVideo(sourceUrl: string, audioUrl: string | null): Promise<string> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-desktop-"));
  const targetPath = path.join(tempRoot, /\.(m3u8)(?:$|\?)/i.test(sourceUrl) ? "capture.mp4" : `capture.${inferDouyinVideoExtension(sourceUrl)}`);
  if (/\.m3u8(?:$|\?)/i.test(sourceUrl)) {
    await downloadDouyinPlaylistWithFfmpeg(sourceUrl, targetPath);
    return targetPath;
  }
  await fetchDouyinResourceToFile(sourceUrl, targetPath);
  if (!audioUrl) {
    return targetPath;
  }
  const audioPath = path.join(tempRoot, "capture-audio.mp4");
  try {
    await fetchDouyinResourceToFile(audioUrl, audioPath);
  } catch {
    return targetPath;
  }
  const mergedPath = path.join(tempRoot, "capture-merged.mp4");
  try {
    await muxDouyinWithFfmpeg(targetPath, audioPath, mergedPath);
  } catch {
    return targetPath;
  }
  fs.rmSync(targetPath, { force: true });
  fs.rmSync(audioPath, { force: true });
  fs.renameSync(mergedPath, targetPath);
  return targetPath;
}

async function fetchDouyinResourceToFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Referer: "https://www.douyin.com/",
      "User-Agent": DOUYIN_CAPTURE_USER_AGENT,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`抖音资源下载失败：HTTP ${response.status}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
    fs.createWriteStream(targetPath),
  );
}

async function muxDouyinWithFfmpeg(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c", "copy",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      outputPath,
    ], { windowsHide: true, shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg mux exited with code ${code ?? "unknown"}`));
    });
  });
}

async function downloadDouyinPlaylistWithFfmpeg(sourceUrl: string, targetPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-user_agent",
      DOUYIN_CAPTURE_USER_AGENT,
      "-headers",
      "Referer: https://www.douyin.com/\r\n",
      "-i",
      sourceUrl,
      "-c",
      "copy",
      targetPath,
    ], {
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}`));
    });
  });
}

function inferDouyinVideoExtension(sourceUrl: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const extension = path.extname(pathname).toLowerCase().replace(/^\./, "");
    return extension && /^[a-z0-9]+$/i.test(extension) ? extension : "mp4";
  } catch {
    return "mp4";
  }
}

function deriveDouyinTextTitle(value: string): string {
  const lines = value
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/复制此链接.*$/u, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.find((line) => line.length > 4)?.slice(0, 80) || "未命名抖音视频";
}

function normalizeAbsoluteUrl(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (!/^https?:\/\//i.test(text)) {
    return "";
  }
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function readSyncCompileConfig(projectRoot: string): SyncCompileConfig {
  const configPath = path.join(projectRoot, "sync-compile-config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as SyncCompileConfig;
  } catch {
    return {};
  }
}

function readDotEnvFile(projectRoot: string): Record<string, string> {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
    if (match) out[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// fallow-ignore-next-line complexity
async function configureDesktopNetwork(projectRoot: string): Promise<void> {
  const envFile = readDotEnvFile(projectRoot);
  for (const key of ["GLOBAL_AGENT_HTTP_PROXY", "GLOBAL_AGENT_HTTPS_PROXY", "GLOBAL_AGENT_NO_PROXY"]) {
    if (!process.env[key] && envFile[key]) {
      process.env[key] = envFile[key];
    }
  }
  if (!process.env.GLOBAL_AGENT_HTTP_PROXY && !process.env.GLOBAL_AGENT_HTTPS_PROXY) {
    return;
  }
  try {
    await import("global-agent/bootstrap");
    debugLog("network:global-agent enabled");
  } catch (error) {
    debugLog(`network:global-agent failed ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const proxyUrl = process.env.GLOBAL_AGENT_HTTPS_PROXY ?? process.env.GLOBAL_AGENT_HTTP_PROXY;
    if (!proxyUrl) {
      return;
    }
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    debugLog("network:undici proxy enabled");
  } catch (error) {
    debugLog(`network:undici proxy failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveAccountServiceUrl(): string {
  const envFile = readDotEnvFile(desktopConfig.projectRoot);
  return String(process.env.CLOUDFLARE_WORKER_URL ?? envFile.CLOUDFLARE_WORKER_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function inferIdentityType(identifier: string): "email" | "phone" {
  return identifier.includes("@") ? "email" : "phone";
}

// fallow-ignore-next-line complexity
async function authenticateAccount(payload: InitializePayload): Promise<AccountSessionConfig & { serviceUrl: string }> {
  const serviceUrl = resolveAccountServiceUrl();
  const password = String(payload.accountPassword ?? "");
  if (!serviceUrl) throw new Error("Account service URL is not configured.");
  if (password.length < 8) throw new Error("Account password must be at least 8 characters.");
  const endpoint = `${serviceUrl}/auth/${payload.authMode === "register" ? "register" : "login"}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityType: inferIdentityType(payload.accountIdentifier),
        identifier: payload.accountIdentifier,
        password,
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`账号服务连接失败：${endpoint}。${reason}`);
  }
  const result = await response.json() as {
    ok?: boolean;
    error?: string;
    user?: { id?: string };
    session?: { token?: string; expiresAt?: string };
  };
  if (!response.ok || result.ok === false || !result.user?.id || !result.session?.token) {
    throw new Error(result.error ?? "Account login failed.");
  }
  return {
    accountId: normalizeOwnerUserId(result.user.id),
    token: result.session.token,
    expiresAt: String(result.session.expiresAt ?? ""),
    serviceUrl,
  };
}

// fallow-ignore-next-line complexity
async function startWeChatMiniProgramLogin(): Promise<{
  loginId: string;
  pollToken: string;
  qrPayload: string;
  expiresAt: string;
}> {
  const serviceUrl = resolveAccountServiceUrl();
  if (!serviceUrl) throw new Error("Account service URL is not configured.");
  const response = await fetch(`${serviceUrl}/auth/wechat/mini-login/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const result = await response.json() as {
    ok?: boolean;
    error?: string;
    loginId?: string;
    pollToken?: string;
    qrPayload?: string;
    expiresAt?: string;
  };
  if (wechatResponseFailed(response, result.ok) || !result.loginId || !result.pollToken || !result.qrPayload) {
    throw new Error(result.error ?? "Failed to start WeChat mini-program login.");
  }
  return {
    loginId: result.loginId,
    pollToken: result.pollToken,
    qrPayload: result.qrPayload,
    expiresAt: String(result.expiresAt ?? ""),
  };
}

// fallow-ignore-next-line complexity
async function pollWeChatMiniProgramLogin(payload: WeChatMiniLoginPollPayload): Promise<{
  status: "pending" | "confirmed" | "expired";
  accountSession?: AccountSessionConfig;
  error?: string;
}> {
  const serviceUrl = resolveAccountServiceUrl();
  if (!serviceUrl) throw new Error("Account service URL is not configured.");
  const response = await fetch(`${serviceUrl}/auth/wechat/mini-login/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as {
    ok?: boolean;
    status?: "pending" | "confirmed" | "expired";
    error?: string;
    user?: { id?: string };
    session?: { token?: string; expiresAt?: string };
  };
  if (result.status === "pending") return { status: "pending" };
  if (result.status === "expired") return { status: "expired", error: result.error };
  if (wechatResponseFailed(response, result.ok) || !result.user?.id || !result.session?.token) {
    throw new Error(result.error ?? "WeChat mini-program login failed.");
  }
  return {
    status: "confirmed",
    accountSession: buildWeChatSession(serviceUrl, result.user.id, result.session.token, result.session.expiresAt),
  };
}

function wechatResponseFailed(response: Response, ok: boolean | undefined): boolean {
  return !response.ok || ok === false;
}

function buildWeChatSession(
  serviceUrl: string,
  accountId: string,
  token: string,
  expiresAt: string | undefined,
): AccountSessionConfig & { serviceUrl: string } {
  return {
    accountId: normalizeOwnerUserId(accountId),
    token,
    expiresAt: String(expiresAt ?? ""),
    serviceUrl,
  };
}

async function saveRemoteSyncLocation(config: AppConfig): Promise<void> {
  const response = await fetch(`${config.accountServiceUrl}/account/sync-location/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.accountSession.token}`,
    },
    body: JSON.stringify({
      workspaceId: config.workspaceId,
      displayName: path.basename(config.targetRepoPath),
      syncBackend: {
        type: "local_directory",
        config: { localPath: config.targetRepoPath },
      },
    }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Failed to save account sync location.");
}

// fallow-ignore-next-line complexity
function buildWebServerEnv(appConfig: AppConfig | null): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(appConfig?.accountServiceUrl ? { CLOUDFLARE_WORKER_URL: appConfig.accountServiceUrl } : {}),
    ...(appConfig?.accountSession.token ? { CLOUDFLARE_ACCOUNT_SESSION_TOKEN: appConfig.accountSession.token } : {}),
    ...(appConfig?.workspaceId ? { CLOUDFLARE_WORKSPACE_ID: appConfig.workspaceId } : {}),
  };
}

function resolveDesktopServerRoots(): DesktopServerRoots {
  const syncConfig = readSyncCompileConfig(desktopConfig.projectRoot);
  const sourceVaultRoot = syncConfig.source_vault_root?.trim();
  const runtimeRoot = syncConfig.runtime_output_root?.trim();

  if (!sourceVaultRoot) {
    throw new Error("Desktop source vault root is not configured.");
  }
  if (!runtimeRoot) {
    throw new Error("Desktop runtime root is not configured.");
  }

  return {
    sourceVaultRoot,
    runtimeRoot,
  };
}

function writeSyncCompileConfig(projectRoot: string, config: SyncCompileConfig): void {
  const configPath = path.join(projectRoot, "sync-compile-config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function bindWorkspaceOrThrow(
  targetRepoPath: string,
  accountIdentifier: string,
): WorkspaceMetadata {
  const binding = ensureWorkspaceBinding(targetRepoPath, accountIdentifier);
  if (!binding.ok) {
    throw new Error(`${binding.error} (${WORKSPACE_METADATA_RELATIVE_PATH})`);
  }
  return binding.metadata;
}

function saveDesktopSyncConfig(
  targetVault: string,
  sourceFolders: string[] | undefined,
  metadata: WorkspaceMetadata,
  accountUserId: string,
): void {
  const existingConfig = readSyncCompileConfig(desktopConfig.projectRoot);
  const nextConfig = normalizeDesktopSyncCompileConfig(
    desktopConfig.projectRoot,
    existingConfig,
    targetVault,
    {
      ownerUserId: accountUserId,
      workspaceId: metadata.workspaceId,
    },
  );
  writeSyncCompileConfig(desktopConfig.projectRoot, {
    ...nextConfig,
    compiler_root: existingConfig.compiler_root ?? desktopConfig.projectRoot,
    source_folders: sourceFolders ?? existingConfig.source_folders,
    cloudflare_workspace_id: metadata.workspaceId,
  });
}

function saveAuthenticatedAppConfig(payload: InitializePayload, sessionConfig: AccountSessionConfig & { serviceUrl: string }): AppConfig {
  const currentConfig = readAppConfig(desktopConfig.appConfigPath);
  const accountIdentifier = normalizeOwnerUserId(payload.accountIdentifier);
  const targetRepoPath = payload.targetRepoPath.trim();
  const workspaceMetadata = bindWorkspaceOrThrow(targetRepoPath, sessionConfig.accountId);
  const draftConfig: AppConfig = {
    accountIdentifier,
    accountUserId: sessionConfig.accountId,
    accountServiceUrl: sessionConfig.serviceUrl,
    accountSession: {
      accountId: sessionConfig.accountId,
      token: sessionConfig.token,
      expiresAt: sessionConfig.expiresAt,
    },
    targetRepoPath,
    sourceFolders: payload.sourceFolders.map((folder) => folder.trim()).filter(Boolean),
    initialized: false,
    workspaceId: workspaceMetadata.workspaceId,
    keyboardShortcuts: normalizeShortcuts(currentConfig?.keyboardShortcuts),
  };
  writeAppConfig(desktopConfig.appConfigPath, draftConfig);
  appBootstrap = loadAppBootstrap(desktopConfig);
  return draftConfig;
}

function saveDraftAppConfig(payload: InitializePayload): AppConfig {
  const currentConfig = readAppConfig(desktopConfig.appConfigPath);
  if (!currentConfig?.accountSession.token || !currentConfig.accountUserId) {
    throw new Error("Please log in before saving this workspace.");
  }
  return saveAuthenticatedAppConfig(payload, {
    ...currentConfig.accountSession,
    accountId: currentConfig.accountUserId,
    serviceUrl: currentConfig.accountServiceUrl,
  });
}

// fallow-ignore-next-line complexity
function saveDesktopConfig(targetVault: string): DesktopConfig {
  const normalizedTargetVault = targetVault.trim();
  if (!normalizedTargetVault) {
    throw new Error("Target vault cannot be empty.");
  }
  const currentConfig = readAppConfig(desktopConfig.appConfigPath);
  const accountUserId = currentConfig?.accountUserId ?? "";
  const workspaceMetadata = bindWorkspaceOrThrow(normalizedTargetVault, accountUserId);
  saveDesktopSyncConfig(
    normalizedTargetVault,
    currentConfig?.sourceFolders,
    workspaceMetadata,
    accountUserId,
  );

  desktopConfig.targetVault = normalizedTargetVault;
  ensureAuditDirectories(desktopConfig.targetVault);
  appBootstrap.desktopConfig = { ...desktopConfig };
  return { ...desktopConfig };
}

function relayInitializationProgress(stage: string, message: string): void {
  const lines = message
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!mainWindow || lines.length === 0) {
    return;
  }

  for (const line of lines) {
    mainWindow.webContents.send("desktop:initialize-progress", {
      stage,
      message: line,
      at: new Date().toISOString(),
    });
  }
}

function formatProjectLogEntry(
  action: string,
  title: string,
  details: Record<string, string | string[] | boolean | number | undefined> = {},
): string {
  const timestamp = new Date();
  const iso = timestamp.toISOString();
  const date = iso.slice(0, 10);
  const lines = [`## [${date}] ${action} | ${title}`, "", `- time: ${iso}`];

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    const detail = Array.isArray(value) ? value.join(", ") : String(value);
    lines.push(`- ${key}: ${detail}`);
  }

  return `${lines.join("\n")}\n\n`;
}

async function appendProjectLog(
  targetVault: string,
  action: string,
  title: string,
  details: Record<string, string | string[] | boolean | number | undefined> = {},
): Promise<void> {
  const logPath = path.join(targetVault, LOG_FILENAME);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, formatProjectLogEntry(action, title, details), "utf8");
}

function buildReadyBootstrap(config: AppConfig): AppBootstrap {
  return {
    startupState: "READY",
    appConfig: config,
    desktopConfig: { ...desktopConfig },
  };
}

async function runInitializationInBackground(
  targetRepoPath: string,
  draftConfig: AppConfig,
): Promise<void> {
  try {
    await appendProjectLog(targetRepoPath, "initialize", "Background sync and compile started", {
      target: targetRepoPath,
      sources: draftConfig.sourceFolders,
    });
    await runSyncCompileProcess();

    const completedAt = new Date().toISOString();
    const readyConfig: AppConfig = {
      ...draftConfig,
      initialized: true,
      lastSyncAt: completedAt,
      lastCompileAt: completedAt,
    };
    writeAppConfig(desktopConfig.appConfigPath, readyConfig);
    appBootstrap = buildReadyBootstrap(readyConfig);

    await appendProjectLog(targetRepoPath, "initialize", "Background sync and compile completed", {
      target: targetRepoPath,
      status: "success",
    });
  } catch (error) {
    await appendProjectLog(targetRepoPath, "initialize", "Background sync and compile failed", {
      target: targetRepoPath,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runInitialization(payload: InitializePayload): Promise<AppBootstrap> {
  const accountIdentifier = normalizeOwnerUserId(payload.accountIdentifier);
  const targetRepoPath = payload.targetRepoPath.trim();
  const sourceFolders = payload.sourceFolders.map((folder) => folder.trim()).filter(Boolean);

  if (!accountIdentifier) {
    throw new Error("Account identifier is required.");
  }
  if (!targetRepoPath) {
    throw new Error("Target repository path is required.");
  }
  if (sourceFolders.length === 0) {
    throw new Error("At least one source folder is required.");
  }

  activeStartupState = "INITIALIZING";

  const accountSession = await authenticateAccount({ ...payload, accountIdentifier });
  const draftConfig = saveAuthenticatedAppConfig(
    { ...payload, accountIdentifier, targetRepoPath, sourceFolders },
    accountSession,
  );
  await saveRemoteSyncLocation(draftConfig);
  saveDesktopConfig(targetRepoPath);

  ensureAuditDirectories(targetRepoPath);
  desktopConfig.targetVault = targetRepoPath;
  await startWebServer(targetRepoPath, true);
  activeStartupState = "READY";
  appBootstrap = buildReadyBootstrap(draftConfig);

  void runInitializationInBackground(targetRepoPath, draftConfig);

  return getAppBootstrap();
}

async function runWeChatSessionInitialization(payload: WeChatSessionInitializePayload): Promise<AppBootstrap> {
  const targetRepoPath = payload.targetRepoPath.trim();
  const sourceFolders = payload.sourceFolders.map((folder) => folder.trim()).filter(Boolean);
  if (!targetRepoPath) throw new Error("Target repository path is required.");
  if (sourceFolders.length === 0) throw new Error("At least one source folder is required.");

  activeStartupState = "INITIALIZING";
  const accountSession = {
    ...payload.accountSession,
    serviceUrl: resolveAccountServiceUrl(),
  };
  if (!accountSession.serviceUrl) throw new Error("Account service URL is not configured.");
  const draftConfig = saveAuthenticatedAppConfig({
    accountIdentifier: accountSession.accountId,
    authMode: "wechat",
    targetRepoPath,
    sourceFolders,
  }, accountSession);
  await saveRemoteSyncLocation(draftConfig);
  saveDesktopConfig(targetRepoPath);

  ensureAuditDirectories(targetRepoPath);
  desktopConfig.targetVault = targetRepoPath;
  await startWebServer(targetRepoPath, true);
  activeStartupState = "READY";
  appBootstrap = buildReadyBootstrap(draftConfig);
  void runInitializationInBackground(targetRepoPath, draftConfig);
  return getAppBootstrap();
}

async function runSyncCompileProcess(): Promise<void> {
  const scriptPath = path.join(desktopConfig.projectRoot, "scripts", "sync-compile.mjs");
  const accountConfig = readAppConfig(desktopConfig.appConfigPath);

  // fallow-ignore-next-line complexity
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveNodeCommand(), [scriptPath], {
      cwd: desktopConfig.projectRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        CLOUDFLARE_WORKER_URL: accountConfig?.accountServiceUrl ?? process.env.CLOUDFLARE_WORKER_URL,
        CLOUDFLARE_ACCOUNT_SESSION_TOKEN: accountConfig?.accountSession.token ?? process.env.CLOUDFLARE_ACCOUNT_SESSION_TOKEN,
        CLOUDFLARE_WORKSPACE_ID: accountConfig?.workspaceId ?? process.env.CLOUDFLARE_WORKSPACE_ID,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      relayInitializationProgress("compile", String(chunk));
    });

    child.stderr.on("data", (chunk) => {
      relayInitializationProgress("error", String(chunk));
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Sync + compile exited with code ${code ?? "unknown"}.`));
    });
  });
}

function getAppBootstrap(): AppBootstrap {
  return {
    ...appBootstrap,
    appConfig: appBootstrap.appConfig ? normalizeAppConfig(appBootstrap.appConfig) : appBootstrap.appConfig,
    startupState: activeStartupState,
    desktopConfig: { ...desktopConfig },
  };
}

function getCurrentShortcuts(): AppShortcuts {
  return normalizeShortcuts(appBootstrap?.appConfig?.keyboardShortcuts);
}

function registerConfiguredShortcuts(): ShortcutStatus {
  globalShortcut.unregisterAll();
  const shortcuts = getCurrentShortcuts();
  const errors = [
    registerGlobalShortcut(
      "flash-diary",
      shortcuts.flashDiaryCapture,
      () => void showFlashDiaryCaptureWindow(),
    ),
    registerGlobalShortcut(
      "workflow-recorder",
      shortcuts.workflowRecorder,
      () => void showWorkflowRecorderCaptureWindow(),
    ),
  ].filter((error): error is string => Boolean(error));
  shortcutStatus = {
    shortcuts,
    registered: errors.length === 0,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
  return shortcutStatus;
}

function registerGlobalShortcut(label: string, value: string, handler: () => void): string | null {
  const accelerator = value.trim();
  if (!accelerator) {
    debugLog(`shortcut:${label} empty`);
    return `${label}: Shortcut is empty.`;
  }
  const registered = globalShortcut.register(accelerator, handler);
  debugLog(`shortcut:${label} accelerator=${accelerator} registered=${registered}`);
  return registered ? null : `${label}: Shortcut registration failed: ${accelerator}`;
}

// fallow-ignore-next-line complexity
function saveShortcut(payload: ShortcutSavePayload): ShortcutStatus {
  if (!(payload.id in DEFAULT_SHORTCUTS)) {
    throw new Error("Unknown shortcut id.");
  }
  const accelerator = payload.accelerator.trim();
  if (!accelerator) {
    throw new Error("Shortcut cannot be empty.");
  }

  const existing = readAppConfig(desktopConfig.appConfigPath) ?? {
    accountIdentifier: appBootstrap?.appConfig?.accountIdentifier ?? "",
    accountUserId: appBootstrap?.appConfig?.accountUserId ?? "",
    accountServiceUrl: appBootstrap?.appConfig?.accountServiceUrl ?? "",
    accountSession: appBootstrap?.appConfig?.accountSession ?? { accountId: "", token: "", expiresAt: "" },
    targetRepoPath: desktopConfig.targetVault,
    sourceFolders: [],
    initialized: activeStartupState === "READY",
    workspaceId: appBootstrap?.appConfig?.workspaceId,
    keyboardShortcuts: DEFAULT_SHORTCUTS,
  };
  const nextConfig = normalizeAppConfig({
    ...existing,
    keyboardShortcuts: {
      ...normalizeShortcuts(existing.keyboardShortcuts),
      [payload.id]: accelerator,
    },
  });
  writeAppConfig(desktopConfig.appConfigPath, nextConfig);
  appBootstrap = {
    ...appBootstrap,
    appConfig: nextConfig,
  };
  return registerConfiguredShortcuts();
}

async function openBrowserUrl(url: string): Promise<BrowserOpenResult> {
  return isBrowserInternalUrl(url) ? openBrowserInternalUrl(url) : openDefaultExternalUrl(url);
}

async function openDefaultExternalUrl(url: string): Promise<BrowserOpenResult> {
  await shell.openExternal(url);
  return { ok: true, browser: "default" };
}

async function openBrowserInternalUrl(url: string): Promise<BrowserOpenResult> {
  for (const candidate of await browserLaunchCandidates()) {
    if (await tryLaunchBrowser(candidate, url)) return { ok: true, browser: candidate.name };
  }
  return { ok: false, error: "未找到可打开浏览器内部链接的系统默认浏览器，也未找到 Chrome 或 Edge。" };
}

function isBrowserInternalUrl(url: string): boolean {
  return /^(chrome-extension|chrome|edge):\/\//i.test(url.trim());
}

async function browserLaunchCandidates(): Promise<BrowserLaunchCandidate[]> {
  if (process.platform === "win32") return await windowsBrowserLaunchCandidates();
  if (process.platform === "darwin") {
    return [
      { name: "Chrome", command: "open", args: ["-a", "Google Chrome"] },
      { name: "Edge", command: "open", args: ["-a", "Microsoft Edge"] },
    ];
  }
  return [
    { name: "Chrome", command: "google-chrome", args: [] },
    { name: "Chromium", command: "chromium", args: [] },
    { name: "Edge", command: "microsoft-edge", args: [] },
  ];
}

// fallow-ignore-next-line complexity
async function windowsBrowserLaunchCandidates(): Promise<BrowserLaunchCandidate[]> {
  const local = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.PROGRAMFILES ?? "";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "";
  const defaultBrowser = await windowsDefaultBrowserLaunchCandidate();
  return [
    ...(defaultBrowser ? [defaultBrowser] : []),
    { name: "Chrome", command: path.join(local, "Google", "Chrome", "Application", "chrome.exe"), args: [] },
    { name: "Chrome", command: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"), args: [] },
    { name: "Chrome", command: path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"), args: [] },
    { name: "Edge", command: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"), args: [] },
    { name: "Edge", command: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"), args: [] },
    { name: "Chrome", command: "chrome.exe", args: [] },
    { name: "Edge", command: "msedge.exe", args: [] },
  ];
}

// fallow-ignore-next-line complexity
async function windowsDefaultBrowserLaunchCandidate(): Promise<BrowserLaunchCandidate | null> {
  const progId = await windowsDefaultBrowserProgId();
  if (!progId) return null;
  const commandText = readRegistryValue(await queryRegistryValue(`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`))
    ?? readRegistryValue(await queryRegistryValue(`HKCR\\${progId}\\shell\\open\\command`));
  const command = commandText ? parseWindowsBrowserCommand(commandText) : null;
  return command ? { name: "系统默认浏览器", ...command } : null;
}

async function windowsDefaultBrowserProgId(): Promise<string | null> {
  for (const protocol of ["http", "https"]) {
    const progId = readRegistryValue(await queryRegistryValue(
      `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`,
      "ProgId",
    ));
    if (progId) return progId;
  }
  return null;
}

function queryRegistryValue(key: string, value?: string): Promise<string> {
  const args = ["query", key, value ? "/v" : "/ve", value ?? ""].filter(Boolean);
  return new Promise((resolve) => {
    execFile("reg", args, { windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

function readRegistryValue(output: string): string | null {
  const line = output.split(/\r?\n/).find((item) => /\sREG_\w+\s/i.test(item));
  return line?.replace(/^.*?\sREG_\w+\s+/i, "").trim() || null;
}

// fallow-ignore-next-line complexity
function parseWindowsBrowserCommand(value: string): Pick<BrowserLaunchCandidate, "command" | "args"> | null {
  const quoted = value.trim().match(/^"([^"]+)"\s*(.*)$/);
  if (quoted?.[1]) return { command: quoted[1], args: parseWindowsBrowserArgs(quoted[2] ?? "") };
  const unquoted = value.trim().match(/^([^\s]+\.exe)\b\s*(.*)$/i);
  return unquoted?.[1] ? { command: unquoted[1], args: parseWindowsBrowserArgs(unquoted[2] ?? "") } : null;
}

function parseWindowsBrowserArgs(value: string): string[] {
  return value.match(/"[^"]*"|[^\s]+/g)
    ?.map((arg) => arg.replace(/^"|"$/g, ""))
    .filter((arg) => !/^%[1lL]$/.test(arg)) ?? [];
}

function tryLaunchBrowser(candidate: BrowserLaunchCandidate, url: string): Promise<boolean> {
  if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(candidate.command, [...candidate.args, url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

ipcMain.handle("desktop:get-config", () => desktopConfig);
ipcMain.handle("desktop:get-app-bootstrap", () => getAppBootstrap());
ipcMain.handle("desktop:get-shortcuts", () => shortcutStatus);
ipcMain.handle("desktop:save-shortcut", (_event, payload: ShortcutSavePayload) =>
  saveShortcut(payload),
);
ipcMain.handle("desktop:choose-target-vault", () => chooseTargetVault());
ipcMain.handle("desktop:choose-source-folders", () => chooseSourceFolders());
ipcMain.handle("desktop:choose-personal-timeline-source-entry", () => choosePersonalTimelineSourceEntry());
ipcMain.handle("desktop:import-xiaohongshu-cookie", () => importXiaohongshuCookie());
ipcMain.handle("desktop:open-xiaohongshu-login", () => openXiaohongshuLogin());
ipcMain.handle("desktop:import-douyin-cookie", () => importDouyinCookie());
ipcMain.handle("desktop:open-douyin-login", () => openDouyinLogin());
ipcMain.handle("desktop:fetch-xiaohongshu-favorites", () => fetchXiaohongshuFavorites());
ipcMain.handle("desktop:save-config", (_event, payload: { targetVault?: string } | undefined) =>
  saveDesktopConfig(payload?.targetVault ?? ""),
);
ipcMain.handle(
  "desktop:save-app-config",
  (_event, payload: InitializePayload) => saveDraftAppConfig(payload),
);
ipcMain.handle("desktop:initialize-app", (_event, payload: InitializePayload) =>
  runInitialization(payload),
);
ipcMain.handle("desktop:start-wechat-mini-login", () => startWeChatMiniProgramLogin());
ipcMain.handle("desktop:poll-wechat-mini-login", (_event, payload: WeChatMiniLoginPollPayload) =>
  pollWeChatMiniProgramLogin(payload),
);
ipcMain.handle("desktop:initialize-app-wechat-session", (_event, payload: WeChatSessionInitializePayload) =>
  runWeChatSessionInitialization(payload),
);
ipcMain.handle("desktop:open-external", (_event, url: string) => shell.openExternal(url));
ipcMain.handle("desktop:open-browser-url", (_event, url: string) => openBrowserUrl(url));
ipcMain.handle("desktop:choose-flash-diary-media", async () => {
  const result = flashDiaryCaptureWindow
    ? await dialog.showOpenDialog(flashDiaryCaptureWindow, {
      title: "\u9009\u62e9\u95ea\u5ff5\u65e5\u8bb0\u9644\u4ef6",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "\u56fe\u7247\u4e0e\u89c6\u9891", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "mp4", "mov", "avi", "mkv", "webm"] },
        { name: "\u6240\u6709\u6587\u4ef6", extensions: ["*"] },
      ],
    })
    : await dialog.showOpenDialog({
      title: "\u9009\u62e9\u95ea\u5ff5\u65e5\u8bb0\u9644\u4ef6",
      properties: ["openFile", "multiSelections"],
    });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("desktop:open-workflow-recorder", () => showWorkflowRecorderCaptureWindow());
ipcMain.handle("desktop:get-workflow-recorder-tasks", () => fetchWorkflowRecorderTasks());
ipcMain.handle("desktop:create-workflow-recorder-task", (_event, payload: WorkflowRecorderTaskCreatePayload) =>
  createWorkflowRecorderTask(payload),
);
// fallow-ignore-next-line complexity
ipcMain.handle("desktop:choose-workflow-recorder-attachments", async () => {
  const parentWindow = workflowRecorderWindow && !workflowRecorderWindow.isDestroyed()
    ? workflowRecorderWindow
    : mainWindow;
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, workflowRecorderAttachmentDialogOptions())
    : await dialog.showOpenDialog(workflowRecorderAttachmentDialogOptions());
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("desktop:submit-workflow-recorder", (_event, payload: WorkflowRecorderPayload) =>
  submitWorkflowRecorder(payload),
);
registerFlashDiaryMediaHandlers();
ipcMain.handle("desktop:submit-flash-diary-entry", async (_event, payload: FlashDiaryEntryPayload) => {
  const submission = buildFlashDiarySubmission(payload);
  const taskLabel = deriveClipTaskLabel(payload, submission);
  showClipNotification("\u5f00\u59cb\u526a\u85cf", taskLabel);
  processFlashDiaryEntryInBackground(submission, payload, taskLabel).catch((error) => {
    debugLog("flash-diary background submit failed: " + (error instanceof Error ? error.message : String(error)));
  });
  return { queued: true } as const;
});

function workflowRecorderAttachmentDialogOptions(): OpenDialogOptions {
  return {
    title: "\u9009\u62e9\u6267\u884c\u8bb0\u5f55\u9644\u4ef6",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "\u56fe\u7247\u3001\u6587\u4ef6\u4e0e\u89c6\u9891", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "mp4", "mov", "avi", "mkv", "webm", "pdf", "docx", "pptx", "xlsx", "md", "txt"] },
      { name: "\u6240\u6709\u6587\u4ef6", extensions: ["*"] },
    ],
  };
}

// fallow-ignore-next-line complexity
async function fetchWorkflowRecorderTasks(): Promise<WorkflowRecorderTask[]> {
  const state = await fetchCurrentTaskPlanState();
  return state ? selectWorkflowRecorderTasks(state) : [];
}

async function createWorkflowRecorderTask(payload: WorkflowRecorderTaskCreatePayload): Promise<WorkflowRecorderTask> {
  const title = normalizeWorkflowRecorderTaskTitle(payload);
  const state = await fetchCurrentTaskPlanState();
  if (!state) throw new Error("任务池读取失败。");
  const snapshot = readTaskPlanPoolSnapshot(state);
  const item = createManualWorkflowRecorderTask(title);
  await saveTaskPlanPoolSnapshot({ ...snapshot, items: [item, ...snapshot.items] });
  return {
    id: String(item.id),
    title: String(item.title),
    domain: "",
    project: "",
    badge: "当前任务",
  };
}

async function fetchCurrentTaskPlanState(): Promise<unknown | null> {
  const response = await fetch(`${serverUrl}api/task-plan/state`);
  const payload = await response.json() as TaskPlanStateResponse;
  if (!response.ok) return null;
  return readTaskPlanStatePayload(payload);
}

function readTaskPlanStatePayload(payload: TaskPlanStateResponse): unknown | null {
  return payload.success === true ? payload.data?.state ?? null : null;
}

function normalizeWorkflowRecorderTaskTitle(payload: WorkflowRecorderTaskCreatePayload): string {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) throw new Error("任务名不能为空。");
  return title;
}

function readTaskPlanPoolSnapshot(state: unknown): TaskPlanPoolSnapshot {
  const root = readObjectRecord(state);
  const pool = readObjectRecord(root?.pool);
  return {
    items: readObjectArray(pool?.items),
    stages: readObjectArray(pool?.stages),
  };
}

function createManualWorkflowRecorderTask(title: string): Record<string, unknown> {
  return {
    id: `workflow-recorder-${randomUUID()}`,
    title,
    priority: "mid",
    source: "手动新增",
    zone: "mine",
    createdAt: new Date().toISOString(),
  };
}

async function saveTaskPlanPoolSnapshot(snapshot: TaskPlanPoolSnapshot): Promise<void> {
  const response = await fetch(`${serverUrl}api/task-plan/pool`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  const result = await response.json() as { success?: boolean; error?: { message?: string } | string };
  if (response.ok && result.success === true) return;
  throw new Error(readTaskPlanPoolSaveError(result));
}

function readTaskPlanPoolSaveError(result: { error?: { message?: string } | string }): string {
  if (typeof result.error === "string") return result.error;
  return result.error?.message ?? "新增任务失败。";
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(readObjectRecord(item))) : [];
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// fallow-ignore-next-line complexity
async function submitWorkflowRecorder(payload: WorkflowRecorderPayload): Promise<{ status: string; message: string }> {
  const response = await fetch(`${serverUrl}api/workflow-recorder/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeWorkflowRecorderPayload(payload)),
  });
  const result = await response.json() as { success?: boolean; data?: { status?: string; message?: string }; error?: string };
  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "\u6267\u884c\u8bb0\u5f55\u63d0\u4ea4\u5931\u8d25");
  }
  return {
    status: result.data?.status ?? "recorded",
    message: result.data?.message ?? "\u5df2\u8bb0\u5f55\u3002",
  };
}

function normalizeWorkflowRecorderPayload(payload: WorkflowRecorderPayload): WorkflowRecorderPayload {
  return {
    text: String(payload.text ?? "").trim(),
    taskId: typeof payload.taskId === "string" ? payload.taskId.trim() : "",
    attachments: Array.isArray(payload.attachments) ? payload.attachments.map(String).filter(Boolean) : [],
    marker: readWorkflowRecorderMarker(payload.marker),
  };
}

function readWorkflowRecorderMarker(value: unknown): WorkflowRecorderPayload["marker"] {
  return isWorkflowRecorderMarker(value) ? value : "normal";
}

function isWorkflowRecorderMarker(value: unknown): value is WorkflowRecorderMarker {
  return typeof value === "string" && WORKFLOW_RECORDER_MARKERS.has(value as WorkflowRecorderMarker);
}

// fallow-ignore-next-line complexity
function deriveClipTaskLabel(
  payload: FlashDiaryEntryPayload,
  submission: ReturnType<typeof buildFlashDiarySubmission>,
): string {
  const body = submission.body as Record<string, unknown> | undefined;
  const url = typeof body?.url === "string" ? body.url : "";
  if (url) return url;
  const firstLine = (payload.text ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? (firstLine.length > 60 ? firstLine.slice(0, 60) + "\u2026" : firstLine) : "\u65e0\u6807\u9898";
}

// fallow-ignore-next-line complexity
function showClipNotification(title: string, body: string, options?: { openPath?: string; urgent?: boolean }): void {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title,
      body: body.length > 240 ? body.slice(0, 240) + "\u2026" : body,
      silent: !options?.urgent,
    });
    if (options?.openPath) {
      const fullPath = options.openPath;
      notification.on("click", () => {
        shell.showItemInFolder(fullPath);
      });
    }
    notification.show();
  } catch (error) {
    debugLog("notification failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

// fallow-ignore-next-line complexity
async function processFlashDiaryEntryInBackground(
  submission: ReturnType<typeof buildFlashDiarySubmission>,
  payload: FlashDiaryEntryPayload,
  taskLabel: string,
): Promise<void> {
  const endpoint = submission.endpoint;
  let body: unknown = submission.body;
  try {
    const result = endpoint === "smartclip-mcp"
      ? await submitSmartClipClipping(readSmartClipSubmissionBody(body))
      : await submitDesktopSubmissionEndpoint(endpoint, body);
    if (!result.success) {
      throw new Error(result.error ?? "\u63d0\u4ea4\u5931\u8d25");
    }
    const resolvedPath = typeof result.data?.path === "string" && result.data.path.trim()
      ? path.resolve(desktopConfig.projectRoot, result.data.path)
      : undefined;
    const warnings = Array.isArray(result.data?.warnings) ? result.data!.warnings! : [];
    const successBody = warnings.length > 0
      ? `${taskLabel}\n\u26a0 ${warnings.length} \u6761\u8b66\u544a`
      : taskLabel;
    showClipNotification("\u526a\u85cf\u6210\u529f", successBody, { openPath: resolvedPath });
    mainWindow?.webContents.send(FLASH_DIARY_CAPTURE_CHANNEL, {
      status: "submitted",
      at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog("flash-diary submit error: " + message);
    showClipNotification("\u526a\u85cf\u5931\u8d25", `${taskLabel}\n${message}`, { urgent: true });
    mainWindow?.webContents.send(FLASH_DIARY_CAPTURE_CHANNEL, {
      status: "error",
      at: new Date().toISOString(),
      message,
    });
  }
}

async function submitDesktopSubmissionEndpoint(
  endpoint: "api/flash-diary/entry" | "api/source-gallery/create",
  body: unknown,
): Promise<DesktopSubmissionResult> {
  const response = await fetch(`${serverUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as DesktopSubmissionResult;
  return response.ok ? result : { ...result, success: false };
}

async function submitSmartClipClipping(input: SmartClipSubmissionBody): Promise<DesktopSubmissionResult> {
  const clip = await clipPageWithSmartClip({ url: input.url, mode: "full" });
  const result = await submitDesktopSubmissionEndpoint("api/source-gallery/create", {
    type: "clipping",
    title: clip.title ?? input.url,
    body: renderSmartClipMarkdown(input.body, clip),
    url: clip.url || input.url,
    now: input.now,
    mediaPaths: input.mediaPaths,
  });
  return mergeSmartClipWarnings(result, clip);
}

function readSmartClipSubmissionBody(value: unknown): SmartClipSubmissionBody {
  if (isSmartClipSubmissionBody(value)) return value;
  throw new Error("SmartClip 剪藏参数无效");
}

// fallow-ignore-next-line complexity
function isSmartClipSubmissionBody(value: unknown): value is SmartClipSubmissionBody {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.url === "string"
    && record.url.trim().length > 0
    && typeof record.body === "string"
    && typeof record.now === "string"
    && Array.isArray(record.mediaPaths);
}

function renderSmartClipMarkdown(userNote: string, clip: SmartClipMcpClipResult): string {
  const note = userNote.trim();
  return [
    note ? `## 用户备注\n\n${note}` : "",
    "## SmartClip 剪藏正文",
    "",
    clip.markdown.trim(),
  ].filter(Boolean).join("\n\n");
}

function mergeSmartClipWarnings(
  result: DesktopSubmissionResult,
  clip: SmartClipMcpClipResult,
): DesktopSubmissionResult {
  const warnings = [
    ...(Array.isArray(result.data?.warnings) ? result.data.warnings : []),
    clip.warning,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return warnings.length > 0
    ? { ...result, data: { ...result.data, warnings } }
    : result;
}

const EXTERNAL_PROTOCOL_PATTERN = /^(?!https?:|file:|about:|data:|blob:)[a-z][a-z0-9+.\-]*:/i;

app.on("web-contents-created", (_event, contents) => {
  const block = (event: Electron.Event, targetUrl: string) => {
    if (EXTERNAL_PROTOCOL_PATTERN.test(targetUrl)) event.preventDefault();
  };
  contents.on("will-navigate", block);
  contents.on("will-redirect", block);
  const willFrameNavigate = "will-frame-navigate" as unknown as "will-navigate";
  contents.on(willFrameNavigate, block);
  contents.setWindowOpenHandler(({ url: targetUrl }) =>
    EXTERNAL_PROTOCOL_PATTERN.test(targetUrl) ? { action: "deny" } : { action: "allow" },
  );
});

if (singleInstanceLock) {
  app.whenReady().then(async () => {
    await createWindow();
    registerConfiguredShortcuts();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error("Failed to start:", message);
    void dialog.showErrorBox("启动失败", message);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  void stopWebServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  stopSmartClipMcpClient();
  void stopWebServer();
});
