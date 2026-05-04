import { contextBridge, ipcRenderer } from "electron";

interface InitializePayload {
  accountIdentifier: string;
  accountPassword?: string;
  authMode?: "login" | "register" | "wechat";
  targetRepoPath: string;
  sourceFolders: string[];
}

interface AccountSessionPayload {
  accountId: string;
  token: string;
  expiresAt: string;
}

interface FlashDiaryEntryPayload {
  target?: "flash-diary" | "clipping";
  text: string;
  mediaPaths: string[];
  clippingUrl?: string;
  clippingComment?: string;
}

interface FlashDiaryMediaPayload {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

interface WorkflowRecorderPayload {
  text: string;
  taskId?: string;
  attachments: string[];
  marker: "normal" | "issue" | "resolved" | "method" | "end-node";
}

interface WorkflowRecorderTaskCreatePayload {
  title: string;
}

interface ShortcutSavePayload {
  id: "flashDiaryCapture" | "pageTextSearch" | "workflowRecorder" | "workspaceSave";
  accelerator: string;
}

contextBridge.exposeInMainWorld("llmWikiDesktop", {
  getDesktopConfig: () => ipcRenderer.invoke("desktop:get-config"),
  getAppBootstrap: () => ipcRenderer.invoke("desktop:get-app-bootstrap"),
  getShortcuts: () => ipcRenderer.invoke("desktop:get-shortcuts"),
  saveShortcut: (payload: ShortcutSavePayload) =>
    ipcRenderer.invoke("desktop:save-shortcut", payload),
  chooseTargetVault: () => ipcRenderer.invoke("desktop:choose-target-vault"),
  chooseSourceFolders: () => ipcRenderer.invoke("desktop:choose-source-folders"),
  choosePersonalTimelineSourceEntry: () =>
    ipcRenderer.invoke("desktop:choose-personal-timeline-source-entry"),
  saveDesktopConfig: (targetVault: string) =>
    ipcRenderer.invoke("desktop:save-config", { targetVault }),
  saveAppConfig: (payload: InitializePayload) =>
    ipcRenderer.invoke("desktop:save-app-config", payload),
  initializeApp: (payload: InitializePayload) =>
    ipcRenderer.invoke("desktop:initialize-app", payload),
  startWeChatMiniProgramLogin: () =>
    ipcRenderer.invoke("desktop:start-wechat-mini-login"),
  pollWeChatMiniProgramLogin: (payload: { loginId: string; pollToken: string }) =>
    ipcRenderer.invoke("desktop:poll-wechat-mini-login", payload),
  initializeAppWithWeChatSession: (
    payload: Omit<InitializePayload, "accountIdentifier" | "accountPassword" | "authMode"> & {
      accountSession: AccountSessionPayload;
    },
  ) => ipcRenderer.invoke("desktop:initialize-app-wechat-session", payload),
  onInitializationProgress: (listener: (payload: unknown) => void) => {
    const wrappedListener = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("desktop:initialize-progress", wrappedListener);
    return () => {
      ipcRenderer.removeListener("desktop:initialize-progress", wrappedListener);
    };
  },
  onInstanceRedirected: (listener: () => void) => {
    const wrappedListener = () => listener();
    ipcRenderer.on("desktop:instance-redirected", wrappedListener);
    return () => {
      ipcRenderer.removeListener("desktop:instance-redirected", wrappedListener);
    };
  },
  onFlashDiaryCapture: (listener: (payload: unknown) => void) => {
    const wrappedListener = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("desktop:flash-diary-capture", wrappedListener);
    return () => {
      ipcRenderer.removeListener("desktop:flash-diary-capture", wrappedListener);
    };
  },
  openWorkflowRecorder: () => ipcRenderer.invoke("desktop:open-workflow-recorder"),
  getWorkflowRecorderTasks: () => ipcRenderer.invoke("desktop:get-workflow-recorder-tasks"),
  createWorkflowRecorderTask: (payload: WorkflowRecorderTaskCreatePayload) =>
    ipcRenderer.invoke("desktop:create-workflow-recorder-task", payload),
  chooseWorkflowRecorderAttachments: () =>
    ipcRenderer.invoke("desktop:choose-workflow-recorder-attachments"),
  submitWorkflowRecorder: (payload: WorkflowRecorderPayload) =>
    ipcRenderer.invoke("desktop:submit-workflow-recorder", payload),
  chooseFlashDiaryMedia: () => ipcRenderer.invoke("desktop:choose-flash-diary-media"),
  saveFlashDiaryMedia: (payload: FlashDiaryMediaPayload) =>
    ipcRenderer.invoke("desktop:save-flash-diary-media", payload),
  submitFlashDiaryEntry: (payload: FlashDiaryEntryPayload) =>
    ipcRenderer.invoke("desktop:submit-flash-diary-entry", payload),
  importXiaohongshuCookie: () => ipcRenderer.invoke("desktop:import-xiaohongshu-cookie"),
  openXiaohongshuLogin: () => ipcRenderer.invoke("desktop:open-xiaohongshu-login"),
  importDouyinCookie: () => ipcRenderer.invoke("desktop:import-douyin-cookie"),
  openDouyinLogin: () => ipcRenderer.invoke("desktop:open-douyin-login"),
  fetchXiaohongshuFavorites: () => ipcRenderer.invoke("desktop:fetch-xiaohongshu-favorites"),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  openBrowserUrl: (url: string) => ipcRenderer.invoke("desktop:open-browser-url", url),
});

export {};
