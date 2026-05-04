import { renderIcon } from "../../components/icon.js";
import {
  WORKFLOW_RECORDER_OPEN_EVENT,
  WORKFLOW_RECORDER_PENDING_KEY,
  eventMatchesShortcut,
  getClientKeyboardShortcut,
} from "../../keyboard-shortcuts.js";
import {
  applyPanelWidth,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth,
  type PanelWidthBounds,
} from "../../shell/panel-layout.js";
import { attachResizeHandle } from "../../shell/resize-handle.js";
import {
  bindWorkLogBlockEditor,
  renderWorkLogBlockToolbar,
  serializeWorkLogEditorHtml,
} from "./work-log-block-editor.js";
import { disposeWorkspacePageGraph, mountWorkspacePageGraph } from "./workspace-graph.js";
import {
  TASK_POOL_UNGROUPED_DOMAIN,
  TASK_POOL_UNGROUPED_PROJECT,
  addTaskPoolTreeChild,
  canDeleteTaskPoolTreeNode,
  canRenameTaskPoolTreeNode,
  deleteTaskPoolTreeNode,
  getTaskPoolDomainName,
  getTaskPoolProjectOptionKey,
  getTaskPoolTreeNodeLabel,
  getTaskPoolTreeOptions,
  moveTaskPoolTaskToProject,
  renameTaskPoolTreeNode,
  type TaskPoolTreeLevel,
  type TaskPoolTreeNodeIdentity,
} from "./task-pool-tree-model.js";
import {
  renderTaskPoolTreeLayout,
  type TaskPoolTreeRenderState,
} from "./task-pool-tree-view.js";
import {
  TASK_POOL_SORT_LABELS,
  readTaskPoolBoardZone,
  renderTaskPoolBoard,
  sortTaskPoolBoardItems,
  type TaskPoolBoardGroupMode,
  type TaskPoolBoardGroupModes,
  type TaskPoolBoardSortMode,
  type TaskPoolBoardSortModes,
  type TaskPoolBoardZone,
} from "./task-pool-board.js";
import {
  isExecutionWorkbenchDocument,
  mountExecutionWorkbench,
  renderExecutionWorkbenchDocument,
} from "./execution-workbench.js";
import {
  isProjectWorkspaceDocument,
  mountProjectWorkspace,
  renderProjectWorkspaceDocument,
} from "./project-workspace.js";
import type {
  ProjectWorkspaceCreateRequest,
  ProjectWorkspaceDragNode,
  ProjectWorkspaceHierarchyMove,
} from "./project-workspace-dnd.js";
import {
  isWorkspaceLibraryPage,
  renderWorkspaceLibraryDocument,
  type WorkspaceGalleryStatus,
  type WorkspaceDocGalleryMeta,
} from "./workspace-library-hub.js";
import { handleKnowledgePreviewClick, withKnowledgePreviewLinks } from "../../shell/knowledge-preview-links.js";

type WorkspaceTab = "task-plan" | "task-pool" | "work-log";

type WorkspaceDocKind = "root" | "domain" | "project" | "work-log";

interface WorkspacePageOptions {
  routeSection?: string;
  forceTaskPoolBoard?: boolean;
  onOpenKnowledgePreview?: (path: string) => void;
}

interface WorkspaceRouteState {
  activeTab: WorkspaceTab;
  taskPoolDomainSlug: string | null;
}

interface WorkspaceTabDefinition {
  id: WorkspaceTab;
  label: string;
  icon: string;
}

const WORKSPACE_TABS: readonly WorkspaceTabDefinition[] = [
  { id: "task-plan", label: "\u4efb\u52a1\u8ba1\u5212\u9875", icon: "clipboard-list" },
  { id: "task-pool", label: "\u4efb\u52a1\u6c60", icon: "archive" },
  { id: "work-log", label: "\u5de5\u4f5c\u65e5\u5fd7", icon: "book-open-text" },
];
const DEFAULT_WORKSPACE_DOC_ID = "root";
const DEFAULT_WORKSPACE_DOC_PATH = "wiki/专题/index.md";
const WORKSPACE_GALLERY_DRAG_TYPE = "application/x-llmwiki-workspace-gallery-path";
const WORKSPACE_GALLERY_STATUSES: readonly WorkspaceGalleryStatus[] = [
  "已验证但成功",
  "待验证",
  "已验证但失败",
];

interface WorkspaceDocument {
  id: string;
  kind: WorkspaceDocKind;
  label: string;
  path: string;
  title: string | null;
  html: string;
  raw: string;
  modifiedAt: string | null;
  domain: string | null;
  project: string | null;
  contentLoaded?: boolean;
  treeHidden?: boolean;
  gallery?: WorkspaceDocGalleryMeta;
}

interface WorkspaceDocumentPage {
  path: string;
  title: string | null;
  html: string;
  raw?: string;
  modifiedAt?: string | null;
}

interface WorkspaceDocumentPayload {
  success: boolean;
  data?: {
    document: WorkspaceDocumentPage;
  };
  error?: string;
}

interface WorkspaceDocDeleteDialog {
  target: WorkspaceDocument;
  childPaths: readonly string[];
}

interface WorkspaceDocsPayload {
  success: boolean;
  data?: {
    documents: WorkspaceDocument[];
  };
  error?: string;
}

interface WorkspaceGalleryStatusMoveData {
  previousPath: string;
  path: string;
  status: WorkspaceGalleryStatus;
}

interface WorkspaceGalleryStatusMovePayload {
  success?: boolean;
  data?: WorkspaceGalleryStatusMoveData;
  error?: string;
}

interface WorkspaceDocsState {
  status: "idle" | "loading" | "ready" | "error";
  documents: WorkspaceDocument[];
  selectedId: string;
  error: string | null;
}

function createInitialWorkspaceRootDocument(): WorkspaceDocument {
  return {
    id: DEFAULT_WORKSPACE_DOC_ID,
    kind: "root",
    label: "工作日志",
    path: DEFAULT_WORKSPACE_DOC_PATH,
    title: "工作日志",
    html: "",
    raw: "",
    modifiedAt: null,
    domain: null,
    project: null,
    contentLoaded: false,
  };
}

interface SavedWorkspaceDocumentContent {
  currentHtml: string;
  nextTitle: string;
  raw: string;
}

interface WorkspaceGraphyPosition {
  x: number;
  y: number;
}

type TaskPlanLoadStatus = "idle" | "loading" | "ready" | "error";

type TaskPlanRoadmapWindow = "current" | "prev" | "next";

type TaskPlanRoadmapView = "week";
type TaskPlanSplitCollapse = "none" | "top" | "bottom";

type TaskPlanPriority = "high" | "mid" | "low" | "cool" | "neutral";
type TaskPlanTaskSource = "文字输入" | "近日状态" | "闪念日记" | "工作日志" | "AI 生成" | "手动新增";
type TaskPoolOwner = "me" | "ai";
type TaskPoolBoardScrollSnapshot = Partial<Record<TaskPoolBoardZone, number>>;

interface TaskPlanVoiceState {
  transcript: string;
  audioPath: string | null;
  updatedAt: string | null;
}

export interface TaskPlanPoolItem {
  id: string;
  title: string;
  priority: TaskPlanPriority;
  source: TaskPlanTaskSource;
  domain?: string;
  project?: string;
  stageId?: string;
  projectOrder?: number;
  taskOrder?: number;
  zone?: TaskPoolBoardZone;
  owner?: TaskPoolOwner;
  createdAt?: string;
  completedAt?: string;
  dueDate?: string;
  diaryDate?: string;
  generationBatchId?: string;
  generatedReason?: string;
  duplicateOfTitle?: string;
  currentProgress?: string;
  lastStop?: string;
  nextStep?: string;
  linkedCases?: string[];
  linkedResources?: string[];
  linkedMethods?: string[];
  sourceRefs?: string[];
  workflowLog?: TaskWorkflowLogEntry[];
  actions?: TaskPlanActionItem[];
}

interface TaskPlanStageItem {
  id: string;
  title: string;
  domain: string;
  project: string;
  order: number;
}

interface TaskPlanActionItem {
  id: string;
  title: string;
  order: number;
  completedAt?: string;
}

interface TaskWorkflowLogEntry {
  id: string;
  recordedAt: string;
  node: string;
  tool: string;
  input: string;
  output: string;
  issue: string;
  nextStep: string;
  attachments: string[];
  sourceRecordId: string;
}

interface TaskPoolGenerationRecord {
  id: string;
  generatedAt: string;
  diaryPaths: string[];
  diaryDates: string[];
  createdTaskIds: string[];
  skippedDuplicateTitles: string[];
}

interface TaskPlanScheduleItem {
  id: string;
  title: string;
  startTime: string;
  priority: TaskPlanPriority;
}

interface TaskPlanScheduleState {
  generationId: string | null;
  revisionId: string | null;
  items: TaskPlanScheduleItem[];
  confirmed: boolean;
}

interface TaskPlanRoadmapEntry {
  id: string;
  title: string;
}

interface TaskPlanRoadmapGroup {
  id: string;
  title: string;
  items: TaskPlanRoadmapEntry[];
}

interface TaskPlanRoadmapState {
  view: TaskPlanRoadmapView;
  windowStart: string;
  topLabel: string;
  windowLabel: string;
  groups: TaskPlanRoadmapGroup[];
}

interface TaskPlanMorningFlowState {
  voiceDone: boolean;
  diaryDone: boolean;
  planningDone: boolean;
  fineTuneDone: boolean;
}

interface TaskPlanState {
  voice: TaskPlanVoiceState;
  statusSummary: string;
  pool: {
    items: TaskPlanPoolItem[];
    stages?: TaskPlanStageItem[];
    generationRecords: TaskPoolGenerationRecord[];
  };
  schedule: TaskPlanScheduleState;
  roadmap: TaskPlanRoadmapState;
  morningFlow: TaskPlanMorningFlowState;
}

interface TaskPlanViewState {
  status: TaskPlanLoadStatus;
  state: TaskPlanState | null;
  roadmapWindow: TaskPlanRoadmapWindow;
  roadmapView: TaskPlanRoadmapView;
  textDraft: string;
  statusDraft: string;
  poolDraft: TaskPlanPoolItem[];
  poolEditMode: boolean;
  poolDraftTouched: boolean;
  poolFilter: TaskPlanTaskSource | "全部";
  poolSortMode: TaskPoolBoardSortMode;
  scheduleDraft: TaskPlanScheduleItem[];
  scheduleEditMode: boolean;
  splitRatio: number;
  busyAction: "text" | "pool" | "pool-generate" | "status" | "status-refresh" | "generate" | "save" | "roadmap" | null;
  feedback: string | null;
  error: string | null;
  pendingScheduleFocusId: string | null;
  draggingScheduleId: string | null;
  pendingPoolFocusId: string | null;
}

type TaskPoolViewMode = "list" | "tree";
type HealthDomainStatus = "idle" | "loading" | "ready" | "error";
type HealthImportTab = "account" | "api";

interface TaskPoolViewState {
  mode: TaskPoolViewMode;
  treeLevel: TaskPoolTreeLevel;
  selectedOptions: string[];
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  zoomPercent: number;
  selectedNode: TaskPoolTreeNodeIdentity | null;
  editingNode: TaskPoolTreeNodeIdentity | null;
  editValue: string;
  draggingTaskId: string | null;
  dropProjectKey: string | null;
  selectedCandidateId: string | null;
  isGenerationRecordOpen: boolean;
  isWorkflowRecorderOpen: boolean;
  workflowRecorderDraft: string;
  workflowRecorderFeedback: string | null;
  workflowRecorderBusy: boolean;
  sortModes: TaskPoolBoardSortModes;
  groupModes: TaskPoolBoardGroupModes;
}

interface HealthDomainConnectionState {
  mode: "account" | "api" | null;
  status: "disconnected" | "connected" | "error";
  label: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface HealthDomainSleepLatestState {
  bedTime: string | null;
  wakeTime: string | null;
  totalSleep: string | null;
  deepSleepQuality: string | null;
  deepSleepMinutes: number | null;
  restingHeartRate: string | null;
  sleepScore: string | null;
  awakeDuration: string | null;
  sleepAverageHeartRate: string | null;
  steps: string | null;
  intensityMinutes: string | null;
}

interface HealthDomainSleepTrendsState {
  bedTimes: string[];
  wakeTimes: string[];
  deepSleepMinutes: number[];
  sleepScores: number[];
  steps: number[];
  intensityMinutes: number[];
}

interface HealthDomainSleepState {
  latest: HealthDomainSleepLatestState;
  insights: string[];
  trends: HealthDomainSleepTrendsState;
}

interface HealthDomainState {
  connection: HealthDomainConnectionState;
  sleep: HealthDomainSleepState;
}

interface WorkspaceHealthStatePayload {
  success: boolean;
  data?: {
    state: HealthDomainState;
  };
  error?: string | WorkspaceHealthErrorPayload;
}

interface WorkspaceHealthErrorPayload {
  code?: string;
  message?: string;
  captchaImageDataUrl?: string;
}

interface WorkspaceHealthActionPayload {
  success: boolean;
  data?: {
    state?: HealthDomainState;
    maskedPhone?: string;
    ticketReady?: boolean;
    message?: string;
    sessionId?: string;
    qrImageUrl?: string;
    loginUrl?: string | null;
    status?: "pending" | "connected";
  };
  error?: string | WorkspaceHealthErrorPayload;
}

interface HealthDomainCaptchaChallengeState {
  imageDataUrl: string;
  message: string | null;
}

interface HealthDomainQrLoginState {
  sessionId: string;
  qrImageUrl: string;
  loginUrl: string | null;
}

interface HealthDomainViewState {
  status: HealthDomainStatus;
  state: HealthDomainState | null;
  activeImportTab: HealthImportTab;
  isImportModalOpen: boolean;
  accountDraft: {
    username: string;
    verificationCode: string;
    captchaCode: string;
    relativeUid: string;
  };
  apiDraft: {
    tokenJson: string;
    apiBaseUrl: string;
    relativeUid: string;
  };
  busyAction: "send-code" | "connect" | "sync" | "qr-login" | null;
  feedback: string | null;
  error: string | null;
  captchaChallenge: HealthDomainCaptchaChallengeState | null;
  qrLogin: HealthDomainQrLoginState | null;
}

interface TaskPlanStatePayload {
  success: boolean;
  data?: {
    state: TaskPlanState;
  };
  error?: string | { code?: string; message?: string };
}

interface TaskPlanRoadmapPayload {
  success: boolean;
  data?: {
    roadmap: TaskPlanRoadmapState;
  };
  error?: string | { code?: string; message?: string };
}

interface TaskPlanSchedulePayload {
  success: boolean;
  data?: {
    schedule: TaskPlanScheduleState;
  };
  error?: string | { code?: string; message?: string };
}

interface TaskPoolGeneratePayload {
  success: boolean;
  data?: {
    state: TaskPlanState;
    generationRecord: TaskPoolGenerationRecord | null;
  };
  error?: string | { code?: string; message?: string };
}

interface WorkflowRecorderPayload {
  success: boolean;
  data?: {
    status: "archived" | "pending";
    message: string;
    taskTitle?: string;
    casePath?: string | null;
  };
  error?: string | { code?: string; message?: string };
}

interface TaskPlanStateMutationPayload {
  success: boolean;
  data?: {
    state: TaskPlanState;
  };
  error?: string | { code?: string; message?: string };
}

const WORKSPACE_TREE_BOUNDS: PanelWidthBounds = {
  defaultWidth: 252,
  minWidth: 1,
  maxWidth: 420,
};
const WORKSPACE_TREE_COLLAPSE_WIDTH = 24;

const TASK_POOL_TREE_BOUNDS: PanelWidthBounds = {
  defaultWidth: 252,
  minWidth: 196,
  maxWidth: 360,
};

const WORKSPACE_SIDEBAR_BOUNDS: PanelWidthBounds = {
  defaultWidth: 64,
  minWidth: 64,
  maxWidth: 64,
};

const WORKSPACE_DOC_AUTOSAVE_DELAY_MS = 700;
const WORKSPACE_GRAPHY_POSITION_KEY = "workspace.graphyFloatPosition";
const WORKSPACE_GRAPHY_DEFAULT_POSITION: WorkspaceGraphyPosition = { x: 0, y: 0 };
const TASK_POOL_BOARD_SCROLL_ZONES: readonly TaskPoolBoardZone[] = ["mine", "ai", "candidate"];

const TASK_PLAN_STEP_LABELS = [
  "文字输入与想法",
  "读取每日日记",
  "整合任务为自动规划",
  "手动微调后确认日程",
] as const;
const TASK_PLAN_SPLIT_RATIO_KEY = "workspace.taskPlanSplitRatio";
const TASK_PLAN_SPLIT_RATIO_DEFAULT = 0.34;
const TASK_PLAN_SPLIT_RATIO_MIN = 0.08;
const TASK_PLAN_SPLIT_RATIO_MAX = 0.92;
const TASK_PLAN_SPLIT_COLLAPSE_THRESHOLD = 0.14;
const TASK_PLAN_SPLIT_HANDLE_SIZE = 18;
const TASK_PLAN_SPLIT_TOP_COLLAPSED_HEIGHT = 60;
const TASK_PLAN_SPLIT_BOTTOM_COLLAPSED_HEIGHT = 68;
const TASK_PLAN_PRIORITY_LABELS: Record<TaskPlanPriority, string> = {
  high: "高",
  mid: "中",
  low: "低",
  cool: "中",
  neutral: "低",
};
const TASK_PLAN_SOURCE_LABELS = ["全部", "文字输入", "近日状态", "闪念日记", "工作日志", "AI 生成", "手动新增"] as const;
const TASK_POOL_TREE_SELECTION_LIMIT = 2;
const TASK_POOL_TREE_COLLAPSED_WIDTH = 56;
const TASK_POOL_ZOOM_MIN = 70;
const TASK_POOL_ZOOM_MAX = 130;
const TASK_POOL_ZOOM_STEP = 10;
const TASK_POOL_HEALTH_DOMAIN_SLUG = "health";
const TASK_POOL_DOMAIN_LABEL_OVERRIDES: Record<string, string> = {
  [TASK_POOL_HEALTH_DOMAIN_SLUG]: "健康",
};

export function renderWorkspacePage(options: WorkspacePageOptions = {}): HTMLElement {
  const root = document.createElement("section") as HTMLElement & { __dispose?: () => void };
  root.className = "workspace-page";
  root.addEventListener("click", (event) => {
    handleKnowledgePreviewClick(event, options.onOpenKnowledgePreview);
  }, { capture: true });
  const initialRouteState = parseWorkspaceRouteState(options.routeSection);
  const renderTaskPoolBoard = options.forceTaskPoolBoard ?? initialRouteState.activeTab === "task-pool";
  let activeTab: WorkspaceTab = initialRouteState.activeTab;
  let activeTaskPoolDomainSlug = initialRouteState.taskPoolDomainSlug;
  let workspaceDraftHtml = "";
  let workspaceDraftDocumentId: string | null = null;
  let workspaceDraftDirty = false;
  let workspaceAutoSaveTimer: number | null = null;
  let workspaceGraphyPosition = readWorkspaceGraphyPosition();
  let workspaceGraphAbort: AbortController | null = null;
  let workspaceDocSearch = "";
  let workspaceGallerySelectedPath: string | null = null;
  let workspaceDocTreeScrollTop = 0;
  let workspaceSidebarWidth = 0;
  let workspaceTreeWidth = 0;
  let workspaceDocDeleteDialog: WorkspaceDocDeleteDialog | null = null;
  const workspaceDocContentRequests = new Map<string, Promise<void>>();
  let workspaceDocsState: WorkspaceDocsState = {
    status: "idle",
    documents: [],
    selectedId: "",
    error: null,
  };
  let taskPlanState: TaskPlanViewState = createDefaultTaskPlanViewState();
  let taskPoolState: TaskPoolViewState = createDefaultTaskPoolViewState();
  if (activeTab === "task-pool" && consumeWorkflowRecorderOpenRequest()) {
    taskPoolState = {
      ...taskPoolState,
      isWorkflowRecorderOpen: true,
      workflowRecorderFeedback: null,
    };
  }
  let healthDomainState: HealthDomainViewState = createDefaultHealthDomainViewState();
  let taskPoolGestureState: { baselineScale: number; baselineZoomPercent: number } | null = null;
  let suppressNextTaskPoolTreeEditBlur = false;
  let taskPlanDraftScheduleSequence = 0;
  let taskPlanDraftPoolSequence = 0;
  let ignoreWorkspaceDetailsToggle = false;
  const expandedDomains = new Set<string>();
  const expandedWorkspaceProjects = new Set<string>();

  const ensureWorkspaceDocsLoaded = (): void => {
    if (workspaceDocsState.status === "loading" || workspaceDocsState.status === "ready") {
      return;
    }

    workspaceDocsState = {
      ...workspaceDocsState,
      status: "loading",
      documents: [createInitialWorkspaceRootDocument()],
      selectedId: DEFAULT_WORKSPACE_DOC_ID,
      error: null,
    };
    workspaceDraftDocumentId = DEFAULT_WORKSPACE_DOC_ID;
    workspaceDraftHtml = "";
    workspaceDraftDirty = false;
    render();
    void loadWorkspaceDocs();
  };

  const loadWorkspaceDocs = async (): Promise<void> => {
    const treeRequest = loadWorkspaceDocTree();
    const pageRequest = loadWorkspaceDocContent(DEFAULT_WORKSPACE_DOC_ID);
    await Promise.allSettled([pageRequest, treeRequest]);
  };

  const loadWorkspaceDocTree = async (): Promise<void> => {
    try {
      applyWorkspaceDocTree(await fetchWorkspaceDocTree());
    } catch (error) {
      handleWorkspaceDocTreeError(error);
    }
  };

  const fetchWorkspaceDocTree = async (): Promise<WorkspaceDocument[]> => {
    const response = await fetch("/api/workspace/docs?mode=tree");
    const payload = (await response.json()) as WorkspaceDocsPayload;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "\u5de5\u4f5c\u65e5\u5fd7\u8bfb\u53d6\u5931\u8d25");
    }
    return payload.data.documents;
  };

  const applyWorkspaceDocTree = (documents: readonly WorkspaceDocument[]): void => {
    const selectedId = selectWorkspaceDocumentId(documents, workspaceDocsState.selectedId);
    workspaceDocsState = {
      status: "ready",
      documents: mergeWorkspaceDocumentSummaries(documents, workspaceDocsState.documents),
      selectedId,
      error: null,
    };
    syncExpandedDomains(documents);
    workspaceDraftDocumentId = selectedId || null;
    workspaceDraftHtml = readWorkspaceDraftHtml(workspaceDocsState.documents, selectedId);
    workspaceDraftDirty = false;
    workspaceDocSearch = "";
    render();
    if (selectedId && !workspaceDocsState.documents.find((item) => item.id === selectedId)?.contentLoaded) {
      void loadWorkspaceDocContent(selectedId);
    }
  };

  const handleWorkspaceDocTreeError = (error: unknown): void => {
    if (workspaceDocsState.documents.some((item) => item.contentLoaded)) {
      workspaceDocsState = { ...workspaceDocsState, status: "ready", error: null };
      render();
      return;
    }
    workspaceDocsState = {
      status: "error",
      documents: [],
      selectedId: "",
      error: error instanceof Error ? error.message : String(error),
    };
    render();
  };

  const loadWorkspaceDocContent = async (documentId: string): Promise<void> => {
    const existingRequest = workspaceDocContentRequests.get(documentId);
    if (existingRequest) {
      await existingRequest;
      return;
    }
    const request = loadWorkspaceDocContentRequest(documentId).finally(() => {
      workspaceDocContentRequests.delete(documentId);
    });
    workspaceDocContentRequests.set(documentId, request);
    await request;
  };

  const loadWorkspaceDocContentRequest = async (documentId: string): Promise<void> => {
    const document = workspaceDocsState.documents.find((item) => item.id === documentId);
    if (!document || document.contentLoaded) {
      return;
    }
    applyWorkspaceDocContent(documentId, document.path, await fetchWorkspaceDocPage(document.path));
  };

  const fetchWorkspaceDocPage = async (path: string): Promise<WorkspaceDocumentPage> => {
    const response = await fetch(`/api/workspace/docs?path=${encodeURIComponent(path)}`);
    const payload = (await response.json()) as WorkspaceDocumentPayload;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "\u5de5\u4f5c\u65e5\u5fd7\u8bfb\u53d6\u5931\u8d25");
    }
    return payload.data.document;
  };

  const applyWorkspaceDocContent = (
    documentId: string,
    documentPath: string,
    page: WorkspaceDocumentPage,
  ): void => {
    workspaceDocsState = {
      ...workspaceDocsState,
      documents: workspaceDocsState.documents.map((item) =>
        item.id === documentId
          ? applyLoadedWorkspaceDocContent(item, page)
          : item,
      ),
    };
    const galleryDocLoaded = workspaceGallerySelectedPath === documentPath;
    if (workspaceDocsState.selectedId === documentId && !workspaceDraftDirty) {
      workspaceDraftDocumentId = documentId;
      workspaceDraftHtml = page.html;
      render();
    } else if (galleryDocLoaded) {
      render();
    }
  };

  const applyLoadedWorkspaceDocContent = (
    item: WorkspaceDocument,
    page: WorkspaceDocumentPage,
  ): WorkspaceDocument => ({
    ...item,
    title: page.title,
    html: page.html,
    raw: page.raw ?? item.raw,
    modifiedAt: page.modifiedAt ?? item.modifiedAt,
    contentLoaded: true,
  });

  const ensureTaskPlanLoaded = (): void => {
    if (taskPlanState.status === "loading" || taskPlanState.status === "ready") {
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      status: "loading",
      error: null,
    };
    render();
    void loadTaskPlanState();
  };

  const loadTaskPlanState = async (): Promise<void> => {
    try {
      const state = await fetchTaskPlanState();
      taskPlanState = {
        ...taskPlanState,
        status: "ready",
        state,
        textDraft: state.voice.transcript,
        statusDraft: state.statusSummary,
        poolDraft: cloneTaskPlanPoolItems(state.pool.items),
        poolDraftTouched: false,
        scheduleDraft: state.schedule.items.map((item) => ({ ...item })),
        error: null,
      };
      syncTaskPoolTreeSelection(state.pool.items, taskPoolState.treeLevel, activeTaskPoolDomainSlug);
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const repairTaskPlanPoolDraftIfNeeded = (): void => {
    if (!shouldRepairUntouchedTaskPlanPoolDraft(taskPlanState)) {
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      poolDraft: repairUntouchedTaskPlanPoolDraft(taskPlanState),
      error: null,
    };
  };

  const ensureHealthDomainLoaded = (): void => {
    if (
      healthDomainState.status === "loading" ||
      healthDomainState.status === "ready"
    ) {
      return;
    }
    healthDomainState = {
      ...healthDomainState,
      status: "loading",
      error: null,
    };
    render();
    void loadHealthDomainState();
  };

  const loadHealthDomainState = async (): Promise<void> => {
    try {
      const state = await fetchHealthDomainState();
      healthDomainState = {
        ...healthDomainState,
        status: "ready",
        state,
        error: null,
      };
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const syncTaskPoolTreeSelection = (
    items: readonly TaskPlanPoolItem[],
    level: TaskPoolTreeLevel,
    domainSlug: string | null,
  ): void => {
    const options = getTaskPoolTreeOptions(
      filterTaskPoolItemsByDomain(items, domainSlug),
      level,
    );
    const optionKeys = options.map((option) => option.key);
    const nextSelected = taskPoolState.selectedOptions.filter((option) =>
      optionKeys.includes(option)
    );
    const selectedOptions =
      nextSelected.length > 0
        ? nextSelected
        : optionKeys.slice(0, TASK_POOL_TREE_SELECTION_LIMIT);
    taskPoolState = {
      ...taskPoolState,
      treeLevel: level,
      selectedOptions,
    };
  };

  const setTaskPoolViewMode = (mode: TaskPoolViewMode): void => {
    taskPoolState = {
      ...taskPoolState,
      mode,
    };
    if (mode === "tree") {
      syncTaskPoolTreeSelection(
        getTaskPlanPoolSharedItems(taskPlanState),
        taskPoolState.treeLevel,
        activeTaskPoolDomainSlug,
      );
    }
    render();
  };

  const setTaskPoolTreeLevel = (level: TaskPoolTreeLevel): void => {
    syncTaskPoolTreeSelection(
      getTaskPlanPoolSharedItems(taskPlanState),
      level,
      activeTaskPoolDomainSlug,
    );
    render();
  };

  const toggleTaskPoolTreeOption = (option: string): void => {
    const selectedOptions = taskPoolState.selectedOptions.includes(option)
      ? taskPoolState.selectedOptions.filter((item) => item !== option)
      : [...taskPoolState.selectedOptions, option];
    taskPoolState = {
      ...taskPoolState,
      selectedOptions,
    };
    render();
  };

  const setTaskPoolDomainSlug = (domainSlug: string | null): void => {
    activeTaskPoolDomainSlug = domainSlug;
    syncTaskPoolTreeSelection(
      getTaskPlanPoolSharedItems(taskPlanState),
      taskPoolState.treeLevel,
      activeTaskPoolDomainSlug,
    );
    if (activeTaskPoolDomainSlug === TASK_POOL_HEALTH_DOMAIN_SLUG) {
      ensureHealthDomainLoaded();
    }
    render();
  };

  const setTaskPoolZoomPercent = (nextZoom: number): void => {
    taskPoolState = {
      ...taskPoolState,
      zoomPercent: clampTaskPoolZoomPercent(nextZoom),
    };
    render();
  };

  const stepTaskPoolZoom = (direction: "in" | "out" | "reset"): void => {
    if (direction === "reset") {
      setTaskPoolZoomPercent(90);
      return;
    }
    const delta = direction === "in" ? TASK_POOL_ZOOM_STEP : -TASK_POOL_ZOOM_STEP;
    setTaskPoolZoomPercent(taskPoolState.zoomPercent + delta);
  };

  const syncTaskPoolTreeOptionsAfterMutation = (
    items: readonly TaskPlanPoolItem[],
    preferredNode: TaskPoolTreeNodeIdentity | null,
  ): void => {
    const options = getTaskPoolTreeOptions(
      filterTaskPoolItemsByDomain(items, activeTaskPoolDomainSlug),
      taskPoolState.treeLevel,
    );
    const optionKeys = options.map((option) => option.key);
    const nextSelected = taskPoolState.selectedOptions.filter((option) => optionKeys.includes(option));
    const preferredKey = preferredNode
      ? readTaskPoolTreePreferredOptionKey(preferredNode, taskPoolState.treeLevel)
      : null;
    const allowUnlistedTaskFocus =
      taskPoolState.treeLevel === "task" &&
      preferredNode?.type === "task" &&
      Boolean(preferredKey);
    const selectedOptions =
      preferredKey && (optionKeys.includes(preferredKey) || allowUnlistedTaskFocus)
        ? [preferredKey, ...nextSelected.filter((option) => option !== preferredKey)].slice(
            0,
            TASK_POOL_TREE_SELECTION_LIMIT,
          )
        : nextSelected.length > 0
          ? nextSelected
          : optionKeys.slice(0, TASK_POOL_TREE_SELECTION_LIMIT);
    taskPoolState = {
      ...taskPoolState,
      selectedOptions,
    };
  };

  const startTaskPoolTreeNodeEdit = (node: TaskPoolTreeNodeIdentity): void => {
    taskPoolState = {
      ...taskPoolState,
      selectedNode: node,
      editingNode: node,
      editValue: readTaskPoolTreeNodeDraftLabel(node, taskPlanState),
    };
    render();
  };

  const applyTaskPoolTreeEdit = (
    node: TaskPoolTreeNodeIdentity,
    nextValue: string,
  ): {
    items: TaskPlanPoolItem[];
    node: TaskPoolTreeNodeIdentity;
  } => {
    return {
      items: renameTaskPoolTreeNode(taskPlanState.poolDraft, node, nextValue),
      node: resolveTaskPoolTreeEditedNode(node, nextValue),
    };
  };

  const syncActiveTaskPoolDomainSlugAfterEdit = (
    previousNode: TaskPoolTreeNodeIdentity,
    nextNode: TaskPoolTreeNodeIdentity,
  ): void => {
    const previousSlug = getTaskPoolDomainSlug(previousNode.domain);
    if (
      previousNode.type !== "domain" ||
      activeTaskPoolDomainSlug !== previousSlug
    ) {
      return;
    }
    const nextSlug = getTaskPoolDomainSlug(nextNode.domain);
    activeTaskPoolDomainSlug = nextSlug;
    if (nextSlug === previousSlug) {
      return;
    }
    const nextHash = buildWorkspaceHash("task-pool", nextSlug);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  };

  const commitTaskPoolTreeEdit = (): TaskPoolTreeNodeIdentity | null => {
    const editingNode = taskPoolState.editingNode;
    if (!editingNode) {
      return null;
    }
    const nextEdit = applyTaskPoolTreeEdit(editingNode, taskPoolState.editValue);
    syncActiveTaskPoolDomainSlugAfterEdit(editingNode, nextEdit.node);
    taskPlanState = {
      ...taskPlanState,
      poolDraft: nextEdit.items,
      poolDraftTouched: true,
    };
    taskPoolState = {
      ...taskPoolState,
      selectedNode: nextEdit.node,
      editingNode: null,
    };
    syncTaskPoolTreeOptionsAfterMutation(nextEdit.items, nextEdit.node);
    render();
    return nextEdit.node;
  };

  const addTaskPoolTreeNodeChild = (
    node: TaskPoolTreeNodeIdentity,
    items: readonly TaskPlanPoolItem[] = taskPlanState.poolDraft,
  ): void => {
    const result = addTaskPoolTreeChild(items, node, createTaskPlanPoolDraftId());
    const nextTreeLevel = promoteTaskPoolTreeLevelForFocus(taskPoolState.treeLevel, result.focus);
    const preferredNode = nextTreeLevel === "task" && result.focus.type !== "task"
      ? createTaskPoolTreeFocusFromLastItem(result.items)
      : result.focus;
    taskPlanState = {
      ...taskPlanState,
      poolDraft: result.items,
      poolDraftTouched: true,
      error: null,
    };
    taskPoolState = {
      ...taskPoolState,
      treeLevel: nextTreeLevel,
      selectedNode: result.focus,
      editingNode: result.focus,
      editValue: "",
    };
    syncTaskPoolTreeOptionsAfterMutation(result.items, preferredNode);
    render();
  };

  const deleteTaskPoolTreeSelection = (node: TaskPoolTreeNodeIdentity): void => {
    if (!canDeleteTaskPoolTreeNode(node)) {
      return;
    }
    const nextItems = deleteTaskPoolTreeNode(taskPlanState.poolDraft, node);
    taskPlanState = {
      ...taskPlanState,
      poolDraft: nextItems,
      poolDraftTouched: true,
      error: null,
    };
    taskPoolState = {
      ...taskPoolState,
      selectedNode: null,
      editingNode: null,
      editValue: "",
    };
    syncTaskPoolTreeOptionsAfterMutation(nextItems, null);
    render();
  };

  const commitTaskPoolTreeEditAndAddChild = (): void => {
    const editingNode = taskPoolState.editingNode;
    if (!editingNode) {
      return;
    }
    const nextEdit = applyTaskPoolTreeEdit(editingNode, taskPoolState.editValue);
    syncActiveTaskPoolDomainSlugAfterEdit(editingNode, nextEdit.node);
    taskPlanState = {
      ...taskPlanState,
      poolDraft: nextEdit.items,
      poolDraftTouched: true,
      error: null,
    };
    taskPoolState = {
      ...taskPoolState,
      selectedNode: nextEdit.node,
      editingNode: null,
    };
    addTaskPoolTreeNodeChild(nextEdit.node, nextEdit.items);
  };

  const moveTaskPoolTreeTaskToProject = (
    taskId: string,
    targetDomain: string,
    targetProject: string,
  ): void => {
    const nextItems = moveTaskPoolTaskToProject(
      taskPlanState.poolDraft,
      taskId,
      targetDomain,
      targetProject,
    );
    const movedNode: TaskPoolTreeNodeIdentity = {
      type: "task",
      domain: targetDomain,
      project: targetProject,
      taskId,
    };
    taskPlanState = {
      ...taskPlanState,
      poolDraft: nextItems,
      poolDraftTouched: true,
      error: null,
    };
    taskPoolState = {
      ...taskPoolState,
      selectedNode: movedNode,
      editingNode: null,
      editValue: "",
      draggingTaskId: null,
      dropProjectKey: null,
    };
    syncTaskPoolTreeOptionsAfterMutation(nextItems, movedNode);
    render();
  };

  const updateHealthAccountDraft = (
    patch: Partial<HealthDomainViewState["accountDraft"]>,
  ): void => {
    const shouldResetCaptcha =
      typeof patch.username === "string" &&
      patch.username !== healthDomainState.accountDraft.username;
    healthDomainState = {
      ...healthDomainState,
      accountDraft: {
        ...healthDomainState.accountDraft,
        ...patch,
        ...(shouldResetCaptcha ? { captchaCode: "" } : {}),
      },
      ...(shouldResetCaptcha ? { captchaChallenge: null } : {}),
    };
  };

  const updateHealthApiDraft = (
    patch: Partial<HealthDomainViewState["apiDraft"]>,
  ): void => {
    healthDomainState = {
      ...healthDomainState,
      apiDraft: {
        ...healthDomainState.apiDraft,
        ...patch,
      },
    };
  };

  const openHealthImportModal = (): void => {
    healthDomainState = {
      ...healthDomainState,
      isImportModalOpen: true,
      error: null,
    };
    render();
  };

  const closeHealthImportModal = (): void => {
    healthDomainState = {
      ...healthDomainState,
      isImportModalOpen: false,
      error: null,
      captchaChallenge: null,
    };
    render();
  };

  const sendHealthVerificationCode = async (): Promise<void> => {
    healthDomainState = {
      ...healthDomainState,
      busyAction: "send-code",
      feedback: "正在发送验证码…",
      error: null,
    };
    render();
    try {
      const result = await postHealthVerificationCode(
        healthDomainState.accountDraft.username,
        healthDomainState.accountDraft.captchaCode,
      );
      if (result.kind === "captcha_required") {
        healthDomainState = {
          ...healthDomainState,
          busyAction: null,
          feedback: result.message,
          error: null,
          captchaChallenge: {
            imageDataUrl: result.captchaImageDataUrl,
            message: result.message,
          },
        };
        render();
        return;
      }
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        feedback: result.message ?? `验证码已发送到 ${result.maskedPhone}。`,
        error: null,
        captchaChallenge: result.ticketReady ? null : healthDomainState.captchaChallenge,
        accountDraft: {
          ...healthDomainState.accountDraft,
          captchaCode: result.ticketReady ? "" : healthDomainState.accountDraft.captchaCode,
        },
      };
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const connectHealthAccount = async (): Promise<void> => {
    healthDomainState = {
      ...healthDomainState,
      busyAction: "connect",
      feedback: "正在连接小米运动健康账号…",
      error: null,
    };
    render();
    try {
      const result = await postHealthAccountConnection(healthDomainState.accountDraft);
      if (result.kind === "captcha_required") {
        healthDomainState = {
          ...healthDomainState,
          busyAction: null,
          feedback: result.message,
          error: null,
          captchaChallenge: {
            imageDataUrl: result.captchaImageDataUrl,
            message: result.message,
          },
        };
        render();
        return;
      }
      const state = result.state;
      healthDomainState = {
        ...healthDomainState,
        status: "ready",
        state,
        busyAction: null,
        feedback: "账号连接成功，正在同步健康数据…",
        error: null,
      };
      render();
      await syncHealthDomain();
      closeHealthImportModal();
      return;
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const connectHealthApi = async (): Promise<void> => {
    healthDomainState = {
      ...healthDomainState,
      busyAction: "connect",
      feedback: "正在保存 API 连接…",
      error: null,
    };
    render();
    try {
      const state = await postHealthApiConnection(healthDomainState.apiDraft);
      healthDomainState = {
        ...healthDomainState,
        status: "ready",
        state,
        busyAction: null,
        feedback: "连接已保存，正在同步健康数据…",
        error: null,
      };
      render();
      await syncHealthDomain();
      closeHealthImportModal();
      return;
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const startHealthQrLogin = async (): Promise<void> => {
    healthDomainState = {
      ...healthDomainState,
      busyAction: "qr-login",
      feedback: "正在生成小米账号二维码…",
      error: null,
      qrLogin: null,
    };
    render();
    try {
      const qrLogin = await postHealthQrLoginStart();
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        feedback: "请用小米账号 App 扫码确认登录。",
        error: null,
        qrLogin,
      };
      render();
      window.setTimeout(() => {
        void pollHealthQrLogin(qrLogin.sessionId);
      }, 2000);
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
      render();
    }
  };

  const pollHealthQrLogin = async (sessionId: string): Promise<void> => {
    if (healthDomainState.qrLogin?.sessionId !== sessionId) {
      return;
    }
    try {
      const result = await getHealthQrLoginStatus(
        sessionId,
        healthDomainState.apiDraft.relativeUid,
      );
      if (result.status === "pending") {
        window.setTimeout(() => {
          void pollHealthQrLogin(sessionId);
        }, 2000);
        return;
      }
      healthDomainState = {
        ...healthDomainState,
        status: "ready",
        state: result.state,
        busyAction: null,
        feedback: "二维码登录成功，正在同步健康数据…",
        error: null,
      };
      render();
      await syncHealthDomain();
      closeHealthImportModal();
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
      render();
    }
  };

  const syncHealthDomain = async (): Promise<void> => {
    healthDomainState = {
      ...healthDomainState,
      busyAction: "sync",
      feedback: "正在同步近 7 天睡眠数据…",
      error: null,
    };
    render();
    try {
      const state = await postHealthSync();
      healthDomainState = {
        ...healthDomainState,
        status: "ready",
        state,
        busyAction: null,
        feedback: "睡眠数据已同步。",
        error: null,
      };
    } catch (error) {
      healthDomainState = {
        ...healthDomainState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const syncExpandedDomains = (documents: readonly WorkspaceDocument[]): void => {
    for (const document of documents) {
      if (document.domain) {
        expandedDomains.add(document.domain);
      }
      if (document.domain && document.project) {
        expandedWorkspaceProjects.add(workspaceProjectKey(document.domain, document.project));
      }
    }
  };

  const renderAfterExplicitTreeToggle = (): void => {
    ignoreWorkspaceDetailsToggle = true;
    render();
    window.setTimeout(() => {
      ignoreWorkspaceDetailsToggle = false;
    }, 0);
  };

  const clearWorkspaceAutoSave = (): void => {
    if (workspaceAutoSaveTimer === null) {
      return;
    }
    window.clearTimeout(workspaceAutoSaveTimer);
    workspaceAutoSaveTimer = null;
  };

  const saveWorkspaceDoc = async (options: { renderAfterSave?: boolean } = {}): Promise<void> => {
    const selected = selectedWorkspaceDocument();
    if (!selected) {
      return;
    }
    if (selected.contentLoaded !== true) {
      throw new Error("当前文档还在读取中");
    }

    const saved = await saveSelectedWorkspaceDocument(selected);
    applySavedWorkspaceDocument(selected, saved);
    if (options.renderAfterSave !== false) {
      render();
    }
  };

  const selectedWorkspaceDocument = (): WorkspaceDocument | undefined =>
    workspaceDocsState.documents.find((item) => item.id === workspaceDocsState.selectedId);

  const saveSelectedWorkspaceDocument = async (
    selected: WorkspaceDocument,
  ): Promise<SavedWorkspaceDocumentContent> => {
    const editor = root.querySelector<HTMLElement>("[data-workspace-doc-editor]");
    const fallbackTitle = selected.title ?? selected.label;
    const currentHtml = ensureWorkspaceDocumentTitle(editor?.innerHTML ?? workspaceDraftHtml, fallbackTitle);
    const nextTitle = readWorkspaceDocumentTitle(currentHtml) ?? fallbackTitle;
    const raw = serializeWorkLogEditorHtml(currentHtml);
    await putWorkspaceDoc(selected.path, raw);
    return { currentHtml, nextTitle, raw };
  };

  const applySavedWorkspaceDocument = (
    selected: WorkspaceDocument,
    saved: SavedWorkspaceDocumentContent,
  ): void => {
    workspaceDocsState = {
      ...workspaceDocsState,
      documents: workspaceDocsState.documents.map((item) =>
        item.id === selected.id ? savedWorkspaceDocument(item, saved) : item,
      ),
    };
    if (workspaceDraftDocumentId === selected.id) {
      workspaceDraftHtml = saved.currentHtml;
      workspaceDraftDirty = false;
    }
    if (saved.nextTitle !== selected.title) {
      updateWorkspaceDocTreeLabel(selected.id, saved.nextTitle);
    }
  };

  const saveWorkspaceGalleryDetail = async (documentPath: string, editor: HTMLElement): Promise<void> => {
    const selected = workspaceDocsState.documents.find((item) => item.path === documentPath);
    if (!selected || selected.contentLoaded !== true) {
      return;
    }
    const fallbackTitle = selected.title ?? selected.label;
    const currentHtml = ensureWorkspaceDocumentTitle(editor.innerHTML, fallbackTitle);
    const nextTitle = readWorkspaceDocumentTitle(currentHtml) ?? fallbackTitle;
    const raw = serializeWorkLogEditorHtml(currentHtml);
    await putWorkspaceDoc(selected.path, raw);
    workspaceDocsState = {
      ...workspaceDocsState,
      documents: workspaceDocsState.documents.map((item) =>
        item.path === documentPath ? savedWorkspaceDocument(item, { currentHtml, nextTitle, raw }) : item,
      ),
    };
  };

  const moveWorkspaceGalleryCard = async (documentPath: string, status: WorkspaceGalleryStatus): Promise<void> => {
    const selected = workspaceDocsState.documents.find((item) => item.path === documentPath);
    if (!selected || selected.gallery?.status === status) {
      return;
    }
    const moved = await postWorkspaceGalleryStatusMove(documentPath, status);
    workspaceDocsState = moveWorkspaceGalleryDocument(workspaceDocsState, moved);
    if (workspaceGallerySelectedPath === moved.previousPath) {
      workspaceGallerySelectedPath = moved.path;
    }
    render();
    const nextDocument = workspaceDocsState.documents.find((item) => item.path === moved.path);
    if (nextDocument && workspaceGallerySelectedPath === moved.path) {
      void loadWorkspaceDocContent(nextDocument.id);
    }
  };

  const updateWorkspaceDocTreeLabel = (documentId: string, nextTitle: string): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-workspace-doc-id]").forEach((button) => {
      if (button.dataset.workspaceDocId !== documentId) {
        return;
      }
      const label = button.querySelector<HTMLElement>("[data-workspace-doc-label]");
      if (label) {
        label.textContent = nextTitle;
      }
    });
  };

  const deleteWorkspaceDoc = async (documentId: string): Promise<void> => {
    const target = workspaceDocsState.documents.find((item) => item.id === documentId);
    if (!target) {
      return;
    }
    const childPaths = collectWorkspaceDocChildPaths(workspaceDocsState.documents, target);
    workspaceDocDeleteDialog = { target, childPaths };
    render();
  };

  const confirmWorkspaceDocDelete = async (includeChildren: boolean): Promise<void> => {
    const dialog = workspaceDocDeleteDialog;
    if (!dialog) {
      return;
    }
    const paths = includeChildren ? [dialog.target.path, ...dialog.childPaths] : [dialog.target.path];
    workspaceDocDeleteDialog = null;
    await deleteWorkspaceDocPaths(paths);
    workspaceDocsState = removeWorkspaceDocsByPath(workspaceDocsState, paths);
    workspaceDraftDocumentId = workspaceDocsState.selectedId || null;
    workspaceDraftHtml = workspaceDocsState.documents.find((item) => item.id === workspaceDocsState.selectedId)?.html ?? "";
    workspaceDraftDirty = false;
    render();
  };

  const cancelWorkspaceDocDelete = (): void => {
    workspaceDocDeleteDialog = null;
    render();
  };

  const scheduleWorkspaceAutoSave = (): void => {
    clearWorkspaceAutoSave();
    workspaceAutoSaveTimer = window.setTimeout(() => {
      workspaceAutoSaveTimer = null;
      void saveWorkspaceDoc({ renderAfterSave: false });
    }, WORKSPACE_DOC_AUTOSAVE_DELAY_MS);
  };

  const syncWorkspaceDraftFromEditor = (editor: HTMLElement): void => {
    workspaceDraftDocumentId = workspaceDocsState.selectedId;
    workspaceDraftHtml = editor.innerHTML;
    workspaceDraftDirty = true;
    scheduleWorkspaceAutoSave();
  };

  const saveTaskPlanText = async (): Promise<void> => {
    const text = taskPlanState.textDraft.trim();
    if (!text) {
      taskPlanState = {
        ...taskPlanState,
        error: "文本内容不能为空",
      };
      render();
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      busyAction: "text",
      feedback: "正在保存文本输入…",
      error: null,
    };
    render();
    try {
      const state = await putTaskPlanText(text);
      taskPlanState = {
        ...taskPlanState,
        status: "ready",
        state,
        textDraft: state.voice.transcript,
        statusDraft: state.statusSummary,
        scheduleDraft: taskPlanState.scheduleEditMode
          ? taskPlanState.scheduleDraft
          : state.schedule.items.map((item) => ({ ...item })),
        busyAction: null,
        feedback: "文本输入已同步到今日计划。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const saveTaskPlanStatus = async (): Promise<void> => {
    const statusSummary = taskPlanState.statusDraft.trim();
    if (!statusSummary) {
      taskPlanState = {
        ...taskPlanState,
        error: "近日状态不能为空",
      };
      render();
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      busyAction: "status",
      feedback: "正在保存近日状态…",
      error: null,
    };
    render();
    try {
      const state = await putTaskPlanStatus(statusSummary);
      taskPlanState = {
        ...taskPlanState,
        state,
        textDraft: state.voice.transcript,
        statusDraft: state.statusSummary,
        busyAction: null,
        feedback: "近日状态已保存。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const toggleTaskPlanPoolEditMode = (): void => {
    if (!taskPlanState.poolEditMode && !taskPlanState.state) {
      ensureTaskPlanLoaded();
      taskPlanState = {
        ...taskPlanState,
        feedback: "正在载入共享任务池…",
        error: null,
      };
      render();
      return;
    }
    const currentItems = taskPlanState.state?.pool.items ?? [];
    const nextEditMode = !taskPlanState.poolEditMode;
    taskPlanState = {
      ...taskPlanState,
      poolEditMode: nextEditMode,
      poolDraft: cloneTaskPlanPoolItems(currentItems),
      poolDraftTouched: false,
      poolFilter: "全部",
      pendingPoolFocusId: null,
      error: null,
    };
    taskPoolState = {
      ...taskPoolState,
      selectedNode: null,
      editingNode: null,
      editValue: "",
      draggingTaskId: null,
      dropProjectKey: null,
    };
    render();
  };

  const updateTaskPlanPoolDraft = (
    itemId: string,
    patch: Partial<Pick<TaskPlanPoolItem, "title" | "priority" | "source">>,
  ): void => {
    taskPlanState = {
      ...taskPlanState,
      poolDraft: taskPlanState.poolDraft.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      poolDraftTouched: true,
    };
  };

  const createTaskPlanPoolDraftId = (): string => {
    taskPlanDraftPoolSequence += 1;
    return `draft-pool-${taskPlanDraftPoolSequence}`;
  };

  const addTaskPlanPoolDraftItem = (): string => {
    const nextId = createTaskPlanPoolDraftId();
    const domain =
      activeTaskPoolDomainSlug &&
      activeTaskPoolDomainSlug !== TASK_POOL_HEALTH_DOMAIN_SLUG
        ? resolveTaskPoolDomainLabel(activeTaskPoolDomainSlug)
        : undefined;
    taskPlanState = {
      ...taskPlanState,
      poolDraft: [
        ...taskPlanState.poolDraft,
        {
          id: nextId,
          title: "",
          priority: "neutral",
          source: "手动新增",
          domain,
          createdAt: new Date().toISOString(),
        },
      ],
      poolDraftTouched: true,
      pendingPoolFocusId: nextId,
      error: null,
    };
    render();
    return nextId;
  };

  const removeTaskPlanPoolDraftItem = (itemId: string): void => {
    taskPlanState = {
      ...taskPlanState,
      poolDraft: taskPlanState.poolDraft.filter((item) => item.id !== itemId),
      poolDraftTouched: true,
      error: null,
    };
    render();
  };

  const saveTaskPlanPoolDraft = async (): Promise<void> => {
    repairTaskPlanPoolDraftIfNeeded();
    if (!taskPlanState.state) {
      ensureTaskPlanLoaded();
      taskPlanState = {
        ...taskPlanState,
        feedback: "共享任务池尚未加载完成，暂时无法保存。",
        error: null,
      };
      render();
      return;
    }
    const items = taskPlanState.poolDraft.map((item) => ({
      ...item,
      title: item.title.trim(),
      priority: normalizeTaskPlanPriority(item.priority),
    }));
    taskPlanState = {
      ...taskPlanState,
      busyAction: "pool",
      feedback: "正在保存任务池…",
      error: null,
    };
    render();
    try {
      const state = await putTaskPlanPool(items);
      taskPlanState = {
        ...taskPlanState,
        state,
        poolDraft: cloneTaskPlanPoolItems(state.pool.items),
        poolEditMode: false,
        poolDraftTouched: false,
        poolFilter: "全部",
        busyAction: null,
        feedback: "任务池已保存。",
        error: null,
      };
      taskPoolState = {
        ...taskPoolState,
        editingNode: null,
        editValue: "",
        draggingTaskId: null,
        dropProjectKey: null,
      };
      syncTaskPoolTreeSelection(
        state.pool.items,
        taskPoolState.treeLevel,
        activeTaskPoolDomainSlug,
      );
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const generateTaskPoolCandidates = async (): Promise<void> => {
    taskPlanState = {
      ...taskPlanState,
      busyAction: "pool-generate",
      feedback: "正在根据上次生成后的新日记生成候选任务…",
      error: null,
    };
    render();
    try {
      const result = await postTaskPoolGenerate();
      taskPlanState = applyTaskPoolGeneratedState(taskPlanState, result);
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const moveTaskPoolBoardItem = async (itemId: string, zone: TaskPoolBoardZone): Promise<void> => {
    if (!taskPlanState.state || isTaskPlanPoolBusy(taskPlanState)) {
      return;
    }
    const items = taskPlanState.state.pool.items.map((item) =>
      item.id === itemId ? moveTaskPlanPoolItemToZone(item, zone) : item
    );
    await saveTaskPoolBoardItems(items, "任务池已同步。");
  };

  const completeTaskPoolBoardItem = async (itemId: string): Promise<void> => {
    if (!taskPlanState.state || isTaskPlanPoolBusy(taskPlanState)) {
      return;
    }
    const now = new Date().toISOString();
    const items = taskPlanState.state.pool.items.map((item) =>
      item.id === itemId ? { ...item, completedAt: now } : item
    );
    taskPoolState = closeTaskPoolDrawerForItem(taskPoolState, itemId);
    await saveTaskPoolBoardItems(items, "任务已完成。");
  };

  const deleteTaskPoolBoardItem = async (itemId: string): Promise<void> => {
    if (!taskPlanState.state || isTaskPlanPoolBusy(taskPlanState)) {
      return;
    }
    const items = taskPlanState.state.pool.items.filter((item) => item.id !== itemId);
    taskPoolState = closeTaskPoolDrawerForItem(taskPoolState, itemId);
    await saveTaskPoolBoardItems(items, "任务已删除。");
  };

  const syncTaskPoolBoard = async (): Promise<void> => {
    taskPlanState = {
      ...taskPlanState,
      busyAction: "pool",
      feedback: "正在同步任务计划页展示…",
      error: null,
    };
    render();
    try {
      const state = await fetchTaskPlanState();
      taskPlanState = {
        ...taskPlanState,
        status: "ready",
        state,
        poolDraft: cloneTaskPlanPoolItems(state.pool.items),
        poolDraftTouched: false,
        busyAction: null,
        feedback: "任务计划页已同步到任务池主事实源。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const openWorkflowRecorder = (): void => {
    taskPoolState = {
      ...taskPoolState,
      isWorkflowRecorderOpen: true,
      workflowRecorderFeedback: null,
    };
    render();
    focusWorkflowRecorderInput();
  };

  const focusWorkflowRecorderInput = (): void => {
    window.requestAnimationFrame(() => {
      root.querySelector<HTMLTextAreaElement>("[data-workflow-recorder-input]")?.focus();
    });
  };

  const handleWorkflowRecorderOpenEvent = (): void => {
    if (activeTab !== "task-pool") {
      return;
    }
    openWorkflowRecorder();
  };

  window.addEventListener(WORKFLOW_RECORDER_OPEN_EVENT, handleWorkflowRecorderOpenEvent);
  root.__dispose = () => {
    clearWorkspaceAutoSave();
    workspaceGraphAbort?.abort();
    disposeWorkspacePageGraph(root);
    window.removeEventListener(WORKFLOW_RECORDER_OPEN_EVENT, handleWorkflowRecorderOpenEvent);
  };

  const submitWorkflowRecorder = async (marker: "normal" | "issue" | "end-node"): Promise<void> => {
    const text = taskPoolState.workflowRecorderDraft.trim();
    if (!text) {
      taskPoolState = { ...taskPoolState, workflowRecorderFeedback: "先写一条过程记录。" };
      render();
      return;
    }
    taskPoolState = { ...taskPoolState, workflowRecorderBusy: true, workflowRecorderFeedback: "正在识别任务并归档…" };
    render();
    try {
      const result = await postWorkflowRecorderRecord({ text, marker, attachments: [] });
      taskPoolState = {
        ...taskPoolState,
        workflowRecorderBusy: false,
        workflowRecorderDraft: result.status === "archived" ? "" : text,
        workflowRecorderFeedback: result.message,
      };
      const state = await fetchTaskPlanState();
      taskPlanState = {
        ...taskPlanState,
        status: "ready",
        state,
        poolDraft: cloneTaskPlanPoolItems(state.pool.items),
        poolDraftTouched: false,
        feedback: result.message,
        error: null,
      };
    } catch (error) {
      taskPoolState = {
        ...taskPoolState,
        workflowRecorderBusy: false,
        workflowRecorderFeedback: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const saveTaskPoolBoardItems = async (
    items: TaskPlanPoolItem[],
    feedback: string,
    stages?: TaskPlanStageItem[],
  ): Promise<void> => {
    const scrollSnapshot = captureTaskPoolBoardScroll();
    taskPlanState = applyOptimisticTaskPoolItems(taskPlanState, items, stages);
    render();
    restoreTaskPoolBoardScroll(scrollSnapshot);
    try {
      const state = await putTaskPlanPool(items, stages);
      taskPlanState = {
        ...taskPlanState,
        state,
        poolDraft: cloneTaskPlanPoolItems(state.pool.items),
        poolDraftTouched: false,
        busyAction: null,
        feedback,
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
    restoreTaskPoolBoardScroll(scrollSnapshot);
  };

  const reorderProjectWorkspaceTasks = (orderedTaskIds: readonly string[]): void => {
    if (!taskPlanState.state || orderedTaskIds.length === 0) {
      return;
    }
    const orderMap = new Map(orderedTaskIds.map((id, index) => [id, index]));
    const items = taskPlanState.state.pool.items.map((item) =>
      orderMap.has(item.id) ? { ...item, projectOrder: orderMap.get(item.id) } : item
    );
    void saveTaskPoolBoardItems(items, "执行层级图顺序已同步。", taskPlanState.state.pool.stages ?? []);
  };

  const moveProjectWorkspaceHierarchy = (move: ProjectWorkspaceHierarchyMove): void => {
    const currentState = taskPlanState.state;
    if (!currentState) {
      return;
    }
    if (move.source.kind === "action") {
      const items = moveProjectWorkspaceAction(currentState.pool.items, move);
      if (items !== currentState.pool.items) {
        void saveTaskPoolBoardItems(items, "行动归属已同步。", currentState.pool.stages ?? []);
      }
      return;
    }
    if (move.source.taskIds.length === 0) return;
    const sourceIds = new Set(move.source.taskIds);
    const orderMap = new Map(move.orderedTaskIds.map((id, index) => [id, index]));
    const items = currentState.pool.items.map((item) =>
      applyProjectWorkspaceMove(item, move, sourceIds, orderMap)
    );
    void saveTaskPoolBoardItems(items, "执行层级图归属已同步。", currentState.pool.stages ?? []);
  };

  const createProjectWorkspaceNode = (request: ProjectWorkspaceCreateRequest): void => {
    const currentState = taskPlanState.state;
    if (!currentState) return;
    const result = applyProjectWorkspaceCreate(currentState.pool.items, currentState.pool.stages ?? [], request);
    if (!result) return;
    void saveTaskPoolBoardItems(result.items, result.feedback, result.stages);
  };

  const deleteProjectWorkspaceNode = (node: ProjectWorkspaceDragNode): void => {
    const currentState = taskPlanState.state;
    if (!currentState || isTaskPlanPoolBusy(taskPlanState)) return;
    const items = applyProjectWorkspaceDelete(currentState.pool.items, node);
    if (!items) return;
    if (node.kind === "task") taskPoolState = closeTaskPoolDrawerForItem(taskPoolState, node.taskId);
    const feedback = node.kind === "action" ? "行动已删除。" : "任务已删除。";
    void saveTaskPoolBoardItems(items, feedback, currentState.pool.stages ?? []);
  };

  const scheduleProjectWorkspaceTask = async (taskId: string): Promise<void> => {
    const currentState = taskPlanState.state;
    const task = currentState?.pool.items.find((item) => item.id === taskId);
    if (!currentState || !task || task.completedAt) {
      return;
    }
    if (currentState.schedule.items.some((item) => item.id === task.id || item.title === task.title)) {
      taskPlanState = { ...taskPlanState, feedback: "这个任务已经在今日推进窗口里。", error: null };
      render();
      return;
    }
    const items = [...currentState.schedule.items, createProjectWorkspaceScheduleItem(task, currentState.schedule.items)];
    taskPlanState = applyOptimisticProjectSchedule(taskPlanState, items, "正在同步今日推进窗口…");
    render();
    try {
      const schedule = await putTaskPlanSchedule(items, currentState.schedule.confirmed);
      taskPlanState = applySavedProjectSchedule(taskPlanState, schedule, "今日推进窗口已同步到任务计划页。");
    } catch (error) {
      taskPlanState = { ...taskPlanState, busyAction: null, error: error instanceof Error ? error.message : String(error) };
    }
    render();
  };

  const readTaskPoolBoardScroller = (zone: TaskPoolBoardZone): HTMLElement | null =>
    root.querySelector<HTMLElement>(`[data-task-pool-drop-zone='${zone}'] .workspace-task-pool-board__cards`);

  const captureTaskPoolBoardScroll = (): TaskPoolBoardScrollSnapshot => {
    const snapshot: TaskPoolBoardScrollSnapshot = {};
    for (const zone of TASK_POOL_BOARD_SCROLL_ZONES) {
      const scroller = readTaskPoolBoardScroller(zone);
      if (scroller && scroller.scrollTop > 0) {
        snapshot[zone] = scroller.scrollTop;
      }
    }
    return snapshot;
  };

  const restoreTaskPoolBoardScroll = (snapshot: TaskPoolBoardScrollSnapshot): void => {
    for (const zone of TASK_POOL_BOARD_SCROLL_ZONES) {
      const scrollTop = snapshot[zone];
      const scroller = readTaskPoolBoardScroller(zone);
      if (scrollTop !== undefined && scroller) {
        scroller.scrollTop = scrollTop;
      }
    }
  };

  const refreshTaskPlanStatus = async (): Promise<void> => {
    taskPlanState = {
      ...taskPlanState,
      busyAction: "status-refresh",
      feedback: "正在刷新近日状态…",
      error: null,
    };
    render();
    try {
      const state = await postTaskPlanStatusRefresh();
      taskPlanState = {
        ...taskPlanState,
        state,
        textDraft: state.voice.transcript,
        statusDraft: state.statusSummary,
        busyAction: null,
        feedback: "近日状态已刷新。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const generateTaskPlanSchedule = async (): Promise<void> => {
    const currentState = taskPlanState.state;
    if (!currentState) {
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      busyAction: "generate",
      feedback: "正在根据语音、日志和任务池生成建议时间表…",
      error: null,
    };
    render();
    try {
      const schedule = await postTaskPlanGenerate();
      taskPlanState = {
        ...taskPlanState,
        state: {
          ...currentState,
          schedule,
          morningFlow: {
            ...currentState.morningFlow,
            diaryDone: true,
            planningDone: true,
            fineTuneDone: false,
          },
        },
        scheduleDraft: schedule.items.map((item) => ({ ...item })),
        scheduleEditMode: false,
        busyAction: null,
        feedback: "AI 已生成新的建议时间表。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const updateTaskPlanScheduleDraft = (
    itemId: string,
    patch: Partial<Pick<TaskPlanScheduleItem, "startTime" | "title" | "priority">>,
  ): void => {
    taskPlanState = {
      ...taskPlanState,
      scheduleDraft: taskPlanState.scheduleDraft.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    };
  };

  const toggleTaskPlanScheduleEditMode = (): void => {
    const currentItems = taskPlanState.state?.schedule.items ?? [];
    taskPlanState = {
      ...taskPlanState,
      scheduleEditMode: !taskPlanState.scheduleEditMode,
      scheduleDraft: currentItems.map((item) => ({ ...item })),
      pendingScheduleFocusId: null,
      draggingScheduleId: null,
      error: null,
    };
    render();
  };

  const saveTaskPlanScheduleDraft = async (): Promise<void> => {
    if (!taskPlanState.state) {
      return;
    }
    const items = taskPlanState.scheduleDraft.map((item) => ({
      ...item,
      title: item.title.trim(),
      startTime: item.startTime.trim(),
    }));
    taskPlanState = {
      ...taskPlanState,
      state: {
        ...taskPlanState.state,
        schedule: {
          ...taskPlanState.state.schedule,
          items,
        },
      },
    };
    render();
    await confirmTaskPlanSchedule();
  };

  const addTaskPlanScheduleDraftItem = (): string => {
    taskPlanDraftScheduleSequence += 1;
    const nextId = `draft-schedule-${taskPlanDraftScheduleSequence}`;
    taskPlanState = {
      ...taskPlanState,
      scheduleDraft: [
        ...taskPlanState.scheduleDraft,
        {
          id: nextId,
          title: "",
          startTime: "",
          priority: "neutral",
        },
      ],
      error: null,
      pendingScheduleFocusId: nextId,
    };
    render();
    return nextId;
  };

  const removeTaskPlanScheduleDraftItem = (itemId: string): void => {
    taskPlanState = {
      ...taskPlanState,
      scheduleDraft: taskPlanState.scheduleDraft.filter((item) => item.id !== itemId),
      error: null,
    };
    render();
  };

  const reorderTaskPlanScheduleDraft = (draggedId: string, targetId: string): void => {
    const draggedIndex = taskPlanState.scheduleDraft.findIndex((item) => item.id === draggedId);
    const targetIndex = taskPlanState.scheduleDraft.findIndex((item) => item.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      return;
    }
    const nextItems = taskPlanState.scheduleDraft.map((item) => ({ ...item }));
    const [draggedItem] = nextItems.splice(draggedIndex, 1);
    if (!draggedItem) {
      return;
    }
    const insertionIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    nextItems.splice(insertionIndex, 0, draggedItem);
    const timeSlots = taskPlanState.scheduleDraft.map((item) => item.startTime);
    taskPlanState = {
      ...taskPlanState,
      scheduleDraft: nextItems.map((item, index) => ({
        ...item,
        startTime: timeSlots[index] ?? item.startTime,
      })),
      draggingScheduleId: null,
      error: null,
    };
    render();
  };

  const confirmTaskPlanSchedule = async (): Promise<void> => {
    const currentState = taskPlanState.state;
    if (!currentState) {
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      busyAction: "save",
      feedback: "正在保存微调后的排期…",
      error: null,
    };
    render();
    try {
      const schedule = await putTaskPlanSchedule(currentState.schedule.items, true);
      taskPlanState = {
        ...taskPlanState,
        state: {
          ...currentState,
          schedule,
          morningFlow: {
            ...currentState.morningFlow,
            fineTuneDone: true,
          },
        },
        scheduleDraft: schedule.items.map((item) => ({ ...item })),
        scheduleEditMode: false,
        busyAction: null,
        feedback: "微调已保存，当前日程已确认。",
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const loadTaskPlanRoadmap = async (windowName: TaskPlanRoadmapWindow): Promise<void> => {
    const currentState = taskPlanState.state;
    if (!currentState) {
      return;
    }
    taskPlanState = {
      ...taskPlanState,
      busyAction: "roadmap",
      roadmapWindow: windowName,
      feedback: "正在切换里程碑窗口…",
      error: null,
    };
    render();
    try {
      const roadmap = await fetchTaskPlanRoadmap(windowName, taskPlanState.roadmapView);
      taskPlanState = {
        ...taskPlanState,
        state: {
          ...currentState,
          roadmap,
        },
        busyAction: null,
        feedback: `已切换到${roadmap.windowLabel}。`,
        error: null,
      };
    } catch (error) {
      taskPlanState = {
        ...taskPlanState,
        busyAction: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    render();
  };

  const readWorkspaceDocTreeScroller = (): HTMLElement | null =>
    root.querySelector<HTMLElement>("[data-workspace-tree]");

  const captureWorkspaceDocTreeScroll = (): void => {
    const scroller = readWorkspaceDocTreeScroller();
    if (scroller) {
      workspaceDocTreeScrollTop = scroller.scrollTop;
    }
  };

  const restoreWorkspaceDocTreeScroll = (): void => {
    if (activeTab !== "work-log" || workspaceDocTreeScrollTop <= 0) {
      return;
    }
    const scroller = readWorkspaceDocTreeScroller();
    if (scroller) {
      scroller.scrollTop = workspaceDocTreeScrollTop;
    }
  };

  const render = (): void => {
    captureWorkspaceDocTreeScroll();
    repairTaskPlanPoolDraftIfNeeded();
    root.innerHTML = renderWorkspaceShellHtml();
    applyWorkspaceShellState();
    bindRenderEvents();
    runWorkspaceRenderEffects();
    restoreWorkspaceDocTreeScroll();
  };

  const renderWorkspaceShellHtml = (): string => `
    <div class="workspace-page__shell">
      <aside class="workspace-page__sidebar" data-workspace-sidebar>
        <nav class="workspace-page__sidebar-nav" aria-label="\u5de5\u4f5c\u53f0\u5206\u9875">
          ${WORKSPACE_TABS.map((tab) => renderWorkspaceTabButton(tab, activeTab)).join("")}
        </nav>
      </aside>
      <div class="workspace-page__content">
        <div class="workspace-page__body">
          ${renderWorkspaceView(activeTab, workspaceDocsState, {
            expandedDomains,
            draftDocumentId: workspaceDraftDocumentId,
            draftHtml: workspaceDraftHtml,
            graphyPosition: workspaceGraphyPosition,
            searchQuery: workspaceDocSearch,
            gallerySelectedPath: workspaceGallerySelectedPath,
            deleteDialog: workspaceDocDeleteDialog,
            expandedWorkspaceProjects,
            taskPlanState,
            taskPoolState,
            healthDomainState,
            activeTaskPoolDomainSlug,
            forceTaskPoolBoard: activeTab === "task-pool" || renderTaskPoolBoard,
          })}
        </div>
      </div>
    </div>
  `;

  const applyWorkspaceShellState = (): void => {
    root.dataset.workspaceMode = activeTab;
    root.toggleAttribute("data-task-pool-direct", options.forceTaskPoolBoard === true);
    workspaceSidebarWidth = workspaceSidebarWidth || readPanelWidth("workspace.sidebarWidth", WORKSPACE_SIDEBAR_BOUNDS);
    applyPanelWidth(root, "--workspace-sidebar-width", workspaceSidebarWidth);
  };

  const runWorkspaceRenderEffects = (): void => {
    syncWorkspaceGraphyMount(shouldMountWorkspaceGraphy(activeTab, workspaceDocsState));
    if (activeTab === "work-log") {
      mountExecutionWorkbench(root);
      mountProjectWorkspace(root, {
        onHierarchyMove: moveProjectWorkspaceHierarchy,
        onTaskOrderChange: reorderProjectWorkspaceTasks,
        onScheduleTask: (taskId) => void scheduleProjectWorkspaceTask(taskId),
        onCreateNode: createProjectWorkspaceNode,
        onDeleteNode: deleteProjectWorkspaceNode,
      });
    }
    if (activeTab === "work-log" && workspaceDocsState.status === "idle") {
      ensureWorkspaceDocsLoaded();
    }
    if (tabNeedsTaskPlanState(activeTab, workspaceDocsState) && taskPlanState.status === "idle") {
      ensureTaskPlanLoaded();
    }
  };

  const syncWorkspaceGraphyMount = (shouldMount: boolean): void => {
    if (shouldMount) {
      mountWorkspaceGraphy();
      return;
    }
    workspaceGraphAbort?.abort();
    workspaceGraphAbort = null;
    disposeWorkspacePageGraph(root);
  };

  const mountWorkspaceGraphy = (): void => {
    const selected = workspaceDocsState.documents.find((item) => item.id === workspaceDocsState.selectedId);
    const graph = root.querySelector<HTMLElement>("[data-workspace-page-graph]");
    if (!selected || !graph) {
      return;
    }
    workspaceGraphAbort?.abort();
    disposeWorkspacePageGraph(root);
    workspaceGraphAbort = new AbortController();
    mountWorkspacePageGraph(root, graph, selected.id, workspaceGraphAbort.signal);
  };

  const bindTaskPoolTreeEvents = (): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-tree-level]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextLevel = button.dataset.taskPoolTreeLevel;
        if (nextLevel !== "domain" && nextLevel !== "project" && nextLevel !== "task") {
          return;
        }
        setTaskPoolTreeLevel(nextLevel);
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-task-pool-tree-option]").forEach((input) => {
      input.addEventListener("click", () => {
        const option = input.dataset.taskPoolTreeOption ?? "";
        if (!option) {
          return;
        }
        toggleTaskPoolTreeOption(option);
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-pool-tree-node]").forEach((node) => {
      node.addEventListener("click", () => {
        const treeNode = readTaskPoolTreeNodeIdentity(node);
        if (!treeNode) {
          return;
        }
        const sameNode = isSameTaskPoolTreeNode(taskPoolState.selectedNode, treeNode);
        const canStartEdit =
          sameNode &&
          taskPlanState.poolEditMode &&
          !isTaskPlanPoolBusy(taskPlanState) &&
          canRenameTaskPoolTreeNode(treeNode);
        if (canStartEdit) {
          startTaskPoolTreeNodeEdit(treeNode);
          return;
        }
        taskPoolState = {
          ...taskPoolState,
          selectedNode: treeNode,
          editingNode: null,
          editValue: "",
        };
        render();
      });

      node.addEventListener("keydown", (event) => {
        const treeNode = readTaskPoolTreeNodeIdentity(node);
        if (!treeNode || !taskPlanState.poolEditMode || isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          addTaskPoolTreeNodeChild(treeNode);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          if (!canDeleteTaskPoolTreeNode(treeNode)) {
            return;
          }
          event.preventDefault();
          deleteTaskPoolTreeSelection(treeNode);
        }
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='task']").forEach((node) => {
      node.addEventListener("dragstart", (event) => {
        if (!taskPlanState.poolEditMode || isTaskPlanPoolBusy(taskPlanState)) {
          event.preventDefault();
          return;
        }
        const taskId = node.dataset.taskPoolTreeNodeTaskId;
        if (!taskId) {
          return;
        }
        event.dataTransfer?.setData("text/plain", taskId);
        taskPoolState = {
          ...taskPoolState,
          draggingTaskId: taskId,
          dropProjectKey: null,
        };
      });

      node.addEventListener("dragend", () => {
        taskPoolState = {
          ...taskPoolState,
          draggingTaskId: null,
          dropProjectKey: null,
        };
        render();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='project']").forEach((node) => {
      // fallow-ignore-next-line complexity
      node.addEventListener("dragover", (event) => {
        const activeTaskId = readActiveTaskPoolDragTaskId(
          taskPoolState.draggingTaskId,
          event.dataTransfer ?? null,
        );
        if (!taskPlanState.poolEditMode || isTaskPlanPoolBusy(taskPlanState) || !activeTaskId) {
          return;
        }
        event.preventDefault();
        const targetDomain = node.dataset.taskPoolTreeNodeDomain ?? "";
        const targetProject = node.dataset.taskPoolTreeNodeProject ?? "";
        if (!targetDomain || !targetProject) {
          return;
        }
        const nextDropProjectKey = getTaskPoolProjectOptionKey(targetDomain, targetProject);
        if (taskPoolState.dropProjectKey === nextDropProjectKey) {
          return;
        }
        taskPoolState = {
          ...taskPoolState,
          dropProjectKey: nextDropProjectKey,
        };
        render();
      });

      node.addEventListener("dragleave", () => {
        const targetDomain = node.dataset.taskPoolTreeNodeDomain ?? "";
        const targetProject = node.dataset.taskPoolTreeNodeProject ?? "";
        if (
          taskPoolState.dropProjectKey !== getTaskPoolProjectOptionKey(targetDomain, targetProject)
        ) {
          return;
        }
        taskPoolState = {
          ...taskPoolState,
          dropProjectKey: null,
        };
        render();
      });

      node.addEventListener("drop", (event) => {
        if (!taskPlanState.poolEditMode || isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const activeTaskId = readActiveTaskPoolDragTaskId(
          taskPoolState.draggingTaskId,
          event.dataTransfer ?? null,
        );
        if (!activeTaskId) {
          return;
        }
        event.preventDefault();
        const targetDomain = node.dataset.taskPoolTreeNodeDomain ?? "";
        const targetProject = node.dataset.taskPoolTreeNodeProject ?? "";
        if (!targetDomain || !targetProject) {
          return;
        }
        moveTaskPoolTreeTaskToProject(activeTaskId, targetDomain, targetProject);
      });
    });

    root.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]")?.addEventListener("input", (event) => {
      if (isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      taskPoolState = {
        ...taskPoolState,
        editValue: (event.currentTarget as HTMLInputElement).value,
      };
    });

    root.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]")?.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key !== "Enter" || isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      event.preventDefault();
      suppressNextTaskPoolTreeEditBlur = true;
      commitTaskPoolTreeEditAndAddChild();
      window.setTimeout(() => {
        suppressNextTaskPoolTreeEditBlur = false;
      }, 0);
    });

    root.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]")?.addEventListener("blur", () => {
      if (suppressNextTaskPoolTreeEditBlur) {
        suppressNextTaskPoolTreeEditBlur = false;
        return;
      }
      if (isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      commitTaskPoolTreeEdit();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-domain-chip]").forEach((button) => {
      button.addEventListener("click", () => {
        const domainSlug = button.dataset.taskPoolDomainChip ?? "";
        const nextDomainSlug = domainSlug || null;
        setTaskPoolDomainSlug(nextDomainSlug);
      const nextHash = buildWorkspaceHash("task-pool", nextDomainSlug);
        if (window.location.hash !== nextHash) {
          window.location.hash = nextHash;
        }
      });
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-tree-sidebar-toggle]")?.addEventListener("click", () => {
      taskPoolState = {
        ...taskPoolState,
        isSidebarCollapsed: !taskPoolState.isSidebarCollapsed,
      };
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.taskPoolZoom;
        if (direction === "in" || direction === "out" || direction === "reset") {
          stepTaskPoolZoom(direction);
        }
      });
    });

    root.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]")?.addEventListener("wheel", (event) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      stepTaskPoolZoom(event.deltaY < 0 ? "in" : "out");
    });

    root.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]")?.addEventListener("gesturestart", (event) => {
      const scale = readTaskPoolGestureScale(event) ?? 1;
      taskPoolGestureState = {
        baselineScale: scale,
        baselineZoomPercent: taskPoolState.zoomPercent,
      };
      event.preventDefault();
    });

    root.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]")?.addEventListener("gesturechange", (event) => {
      const scale = readTaskPoolGestureScale(event);
      const gestureState = taskPoolGestureState;
      if (!scale || !gestureState) {
        return;
      }
      event.preventDefault();
      setTaskPoolZoomPercent(
        resolveTaskPoolGestureZoomPercent(
          gestureState.baselineZoomPercent,
          gestureState.baselineScale,
          scale,
        ),
      );
    });

    root.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]")?.addEventListener("gestureend", () => {
      taskPoolGestureState = null;
    });

    root.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]")?.addEventListener("gesturecancel", () => {
      taskPoolGestureState = null;
    });
  };

  const bindHealthDomainEvents = (): void => {
    root.querySelector<HTMLButtonElement>("[data-health-import-open]")?.addEventListener("click", () => {
      openHealthImportModal();
    });

    root.querySelector<HTMLButtonElement>("[data-health-import-close]")?.addEventListener("click", () => {
      closeHealthImportModal();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-health-import-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextTab = button.dataset.healthImportTab;
        if (nextTab !== "account" && nextTab !== "api") {
          return;
        }
        healthDomainState = {
          ...healthDomainState,
          activeImportTab: nextTab,
          ...(nextTab === "api" ? { captchaChallenge: null } : {}),
        };
        render();
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-health-account-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.healthAccountInput;
        if (!field) {
          return;
        }
        updateHealthAccountDraft({ [field]: input.value } as Partial<HealthDomainViewState["accountDraft"]>);
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-health-api-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.healthApiInput;
        if (!field) {
          return;
        }
        updateHealthApiDraft({ [field]: input.value } as Partial<HealthDomainViewState["apiDraft"]>);
      });
    });

    root.querySelector<HTMLTextAreaElement>("[data-health-api-token-input]")?.addEventListener("input", (event) => {
      updateHealthApiDraft({ tokenJson: (event.currentTarget as HTMLTextAreaElement).value });
    });

    root.querySelector<HTMLButtonElement>("[data-health-send-code]")?.addEventListener("click", () => {
      void sendHealthVerificationCode();
    });

    root.querySelector<HTMLButtonElement>("[data-health-connect-account]")?.addEventListener("click", () => {
      void connectHealthAccount();
    });

    root.querySelector<HTMLButtonElement>("[data-health-connect-api]")?.addEventListener("click", () => {
      void connectHealthApi();
    });

    root.querySelector<HTMLButtonElement>("[data-health-qr-login]")?.addEventListener("click", () => {
      void startHealthQrLogin();
    });

    root.querySelector<HTMLButtonElement>("[data-health-sync]")?.addEventListener("click", () => {
      void syncHealthDomain();
    });
  };

  const bindTaskPlanScheduleEvents = (): void => {
    root.querySelector<HTMLTextAreaElement>("[data-task-plan-status-input]")?.addEventListener("input", (event) => {
      taskPlanState = {
        ...taskPlanState,
        statusDraft: (event.currentTarget as HTMLTextAreaElement).value,
      };
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-status-save]")?.addEventListener("click", () => {
      void saveTaskPlanStatus();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-status-refresh]")?.addEventListener("click", () => {
      void refreshTaskPlanStatus();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-generate]")?.addEventListener("click", () => {
      void generateTaskPlanSchedule();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-schedule-edit-toggle]")?.addEventListener("click", () => {
      toggleTaskPlanScheduleEditMode();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-schedule-add]")?.addEventListener("click", () => {
      addTaskPlanScheduleDraftItem();
    });

    root.querySelectorAll<HTMLInputElement>("[data-task-plan-schedule-time-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const itemId = input.dataset.taskPlanScheduleTimeInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanScheduleDraft(itemId, { startTime: input.value });
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        addTaskPlanScheduleDraftItem();
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-task-plan-schedule-title-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const itemId = input.dataset.taskPlanScheduleTitleInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanScheduleDraft(itemId, { title: input.value });
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        addTaskPlanScheduleDraftItem();
      });
    });

    root.querySelectorAll<HTMLSelectElement>("[data-task-plan-schedule-priority-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const itemId = input.dataset.taskPlanSchedulePriorityInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanScheduleDraft(itemId, { priority: normalizeTaskPlanPriority(input.value) });
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        addTaskPlanScheduleDraftItem();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-plan-schedule-row]").forEach((row) => {
      const beginDrag = (event: DragEvent): void => {
        const itemId = row.dataset.taskPlanScheduleRow;
        if (!itemId) {
          return;
        }
        event.dataTransfer?.setData("text/plain", itemId);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.dropEffect = "move";
        }
        taskPlanState = {
          ...taskPlanState,
          draggingScheduleId: itemId,
        };
        row.classList.add("is-dragging");
      };
      row.addEventListener("dragstart", beginDrag);
      row.querySelector<HTMLElement>("[data-task-plan-schedule-drag]")?.addEventListener("dragstart", beginDrag);
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const targetId = row.dataset.taskPlanScheduleRow;
        const draggedId = event.dataTransfer?.getData("text/plain") || taskPlanState.draggingScheduleId;
        if (!targetId || !draggedId) {
          return;
        }
        reorderTaskPlanScheduleDraft(draggedId, targetId);
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        if (!taskPlanState.draggingScheduleId) {
          return;
        }
        taskPlanState = {
          ...taskPlanState,
          draggingScheduleId: null,
        };
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-plan-schedule-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const itemId = button.dataset.taskPlanScheduleRemove;
        if (!itemId) {
          return;
        }
        removeTaskPlanScheduleDraftItem(itemId);
      });
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-schedule-save]")?.addEventListener("click", () => {
      void saveTaskPlanScheduleDraft();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-plan-roadmap-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        void loadTaskPlanRoadmap(normalizeTaskPlanRoadmapWindow(button.dataset.taskPlanRoadmapNav));
      });
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-roadmap-window='current']")?.addEventListener("click", () => {
      void loadTaskPlanRoadmap("current");
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-roadmap-view='week']")?.addEventListener("click", () => {
      void loadTaskPlanRoadmap(taskPlanState.roadmapWindow);
    });

    const taskPlanSplitHandle = root.querySelector<HTMLElement>("[data-task-plan-split-handle]");
    const taskPlanLayout = root.querySelector<HTMLElement>("[data-task-plan-layout]");
    if (taskPlanSplitHandle && taskPlanLayout) {
      attachResizeHandle({
        handle: taskPlanSplitHandle,
        onMove(event) {
          const rect = taskPlanLayout.getBoundingClientRect();
          if (rect.height <= 0) {
            return;
          }
          const ratio = clampTaskPlanSplitRatio((event.clientY - rect.top) / rect.height);
          taskPlanState = {
            ...taskPlanState,
            splitRatio: ratio,
          };
          applyTaskPlanSplitLayout(taskPlanLayout, ratio);
        },
        onEnd() {
          taskPlanState = {
            ...taskPlanState,
            splitRatio: writeTaskPlanSplitRatio(taskPlanState.splitRatio),
          };
          applyTaskPlanSplitLayout(taskPlanLayout, taskPlanState.splitRatio);
        },
      });
      applyTaskPlanSplitLayout(taskPlanLayout, taskPlanState.splitRatio);
    }
  };

  // fallow-ignore-next-line complexity
  const bindRenderEvents = (): void => {
    const openWorkspaceTab = (nextTab: WorkspaceTab): void => {
      if (nextTab === activeTab) {
        return;
      }
      activeTab = nextTab;
      if (nextTab === "task-pool") {
        activeTaskPoolDomainSlug = null;
      }
      const nextHash = buildWorkspaceHash(nextTab, activeTaskPoolDomainSlug);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
      render();
      if (nextTab === "work-log") {
        ensureWorkspaceDocsLoaded();
      }
      if (tabNeedsTaskPlanState(nextTab, workspaceDocsState)) {
        ensureTaskPlanLoaded();
      }
    };

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        openWorkspaceTab(normalizeWorkspaceTab(button.dataset.workspaceTab));
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-doc-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextId = button.dataset.workspaceDocId ?? "";
        if (!nextId) {
          return;
        }
        clearWorkspaceAutoSave();
        const nextDocument = workspaceDocsState.documents.find((item) => item.id === nextId);
        if (!nextDocument) {
          return;
        }
        workspaceDocsState = {
          ...workspaceDocsState,
          selectedId: nextId,
        };
        workspaceGallerySelectedPath = null;
        workspaceDraftDocumentId = nextDocument?.id ?? null;
        workspaceDraftHtml = nextDocument?.html ?? "";
        workspaceDraftDirty = false;
        render();
        void loadWorkspaceDocContent(nextId);
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-gallery-card]").forEach((button) => {
      button.addEventListener("click", () => {
        const documentPath = button.dataset.workspaceGalleryCard ?? "";
        const documentId = workspaceDocsState.documents.find((item) => item.path === documentPath)?.id;
        if (!documentPath || !documentId) {
          return;
        }
        workspaceGallerySelectedPath = documentPath;
        render();
        void loadWorkspaceDocContent(documentId);
      });
      button.addEventListener("dragstart", (event) => {
        const documentPath = button.dataset.workspaceGalleryCard ?? "";
        if (!documentPath || !button.dataset.workspaceGalleryCardStatus) {
          return;
        }
        event.dataTransfer?.setData(WORKSPACE_GALLERY_DRAG_TYPE, documentPath);
        event.dataTransfer?.setData("text/plain", documentPath);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        button.classList.add("is-dragging");
      });
      button.addEventListener("dragend", () => clearWorkspaceGalleryDragState(root));
    });

    root.querySelectorAll<HTMLElement>("[data-workspace-gallery-drop-status]").forEach((column) => {
      column.addEventListener("dragover", (event) => {
        const documentPath = readWorkspaceGalleryDraggedPath(event);
        if (!documentPath) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        column.classList.add("is-drop-preview");
      });
      column.addEventListener("dragleave", () => column.classList.remove("is-drop-preview"));
      column.addEventListener("drop", (event) => {
        const documentPath = readWorkspaceGalleryDraggedPath(event);
        const status = normalizeWorkspaceGalleryStatus(column.dataset.workspaceGalleryDropStatus ?? "");
        clearWorkspaceGalleryDragState(root);
        if (!documentPath || !status) return;
        event.preventDefault();
        void moveWorkspaceGalleryCard(documentPath, status);
      });
    });

    root.querySelector<HTMLButtonElement>("[data-workspace-gallery-save]")?.addEventListener("click", () => {
      const editor = root.querySelector<HTMLElement>("[data-workspace-gallery-editor]");
      const documentPath = editor?.dataset.workspaceGalleryEditor ?? "";
      if (editor && documentPath) {
        void saveWorkspaceGalleryDetail(documentPath, editor).then(() => render());
      }
    });

    root.querySelector<HTMLElement>("[data-workspace-gallery-editor]")?.addEventListener("blur", (event) => {
      const editor = event.currentTarget as HTMLElement;
      const documentPath = editor.dataset.workspaceGalleryEditor ?? "";
      if (documentPath) {
        void saveWorkspaceGalleryDetail(documentPath, editor);
      }
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-doc-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const documentId = button.dataset.workspaceDocDelete ?? "";
        if (!documentId) {
          return;
        }
        void deleteWorkspaceDoc(documentId);
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-doc-delete-cancel]").forEach((button) => {
      button.addEventListener("click", () => {
        cancelWorkspaceDocDelete();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-doc-delete-confirm]").forEach((button) => {
      button.addEventListener("click", () => {
        void confirmWorkspaceDocDelete(button.dataset.workspaceDocDeleteConfirm === "children");
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-domain-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const domain = button.dataset.workspaceDomainToggle ?? "";
        if (!domain) {
          return;
        }
        if (expandedDomains.has(domain)) {
          expandedDomains.delete(domain);
        } else {
          expandedDomains.add(domain);
        }
        renderAfterExplicitTreeToggle();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-project-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const projectKey = button.dataset.workspaceProjectToggle ?? "";
        if (!projectKey) {
          return;
        }
        if (expandedWorkspaceProjects.has(projectKey)) {
          expandedWorkspaceProjects.delete(projectKey);
        } else {
          expandedWorkspaceProjects.add(projectKey);
        }
        renderAfterExplicitTreeToggle();
      });
    });

    root.querySelectorAll<HTMLDetailsElement>("[data-workspace-domain-details]").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (ignoreWorkspaceDetailsToggle) {
          return;
        }
        const domain = details.dataset.workspaceDomainDetails ?? "";
        if (!domain) {
          return;
        }
        if (details.open) {
          expandedDomains.add(domain);
        } else {
          expandedDomains.delete(domain);
        }
      });
    });

    root.querySelectorAll<HTMLDetailsElement>("[data-workspace-project-details]").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (ignoreWorkspaceDetailsToggle) {
          return;
        }
        const projectKey = details.dataset.workspaceProjectDetails ?? "";
        if (!projectKey) {
          return;
        }
        if (details.open) {
          expandedWorkspaceProjects.add(projectKey);
        } else {
          expandedWorkspaceProjects.delete(projectKey);
        }
      });
    });

    root.querySelector<HTMLInputElement>("[data-workspace-tree-search]")?.addEventListener("input", (event) => {
      workspaceDocSearch = (event.currentTarget as HTMLInputElement).value;
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workspace-heading-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.workspaceHeadingTarget ?? "";
        const target = root.querySelector<HTMLElement>(`#${cssEscape(targetId)}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    root.querySelector<HTMLTextAreaElement>("[data-task-plan-text-input]")?.addEventListener("input", (event) => {
      taskPlanState = {
        ...taskPlanState,
        textDraft: (event.currentTarget as HTMLTextAreaElement).value,
      };
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-text-save]")?.addEventListener("click", () => {
      void saveTaskPlanText();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-open-task-pool]")?.addEventListener("click", () => {
      openWorkspaceTab("task-pool");
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-plan-pool-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        if (isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const nextFilter = (button.dataset.taskPlanPoolFilter ?? "全部") as TaskPlanTaskSource | "全部";
        taskPlanState = {
          ...taskPlanState,
          poolFilter: nextFilter,
        };
        render();
      });
    });

    root.querySelector<HTMLSelectElement>("[data-task-plan-pool-sort]")?.addEventListener("change", (event) => {
      const nextSortMode = (event.currentTarget as HTMLSelectElement).value;
      if (!isTaskPoolBoardSortMode(nextSortMode)) {
        return;
      }
      taskPlanState = {
        ...taskPlanState,
        poolSortMode: nextSortMode,
      };
      render();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.addEventListener("click", () => {
      if (isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      toggleTaskPlanPoolEditMode();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-pool-add]")?.addEventListener("click", () => {
      if (isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      addTaskPlanPoolDraftItem();
    });

    root.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.addEventListener("click", () => {
      if (isTaskPlanPoolBusy(taskPlanState)) {
        return;
      }
      void saveTaskPlanPoolDraft();
    });

    root.querySelectorAll<HTMLInputElement>("[data-task-plan-pool-title-input]").forEach((input) => {
      input.addEventListener("input", () => {
        if (isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const itemId = input.dataset.taskPlanPoolTitleInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanPoolDraft(itemId, { title: input.value });
      });
    });

    root.querySelectorAll<HTMLSelectElement>("[data-task-plan-pool-source-input]").forEach((input) => {
      input.addEventListener("change", () => {
        if (isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const itemId = input.dataset.taskPlanPoolSourceInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanPoolDraft(itemId, { source: input.value as TaskPlanTaskSource });
      });
    });

    root.querySelectorAll<HTMLSelectElement>("[data-task-plan-pool-priority-input]").forEach((input) => {
      input.addEventListener("change", () => {
        if (isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const itemId = input.dataset.taskPlanPoolPriorityInput;
        if (!itemId) {
          return;
        }
        updateTaskPlanPoolDraft(itemId, { priority: normalizeTaskPlanPriority(input.value) });
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-plan-pool-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        if (isTaskPlanPoolBusy(taskPlanState)) {
          return;
        }
        const itemId = button.dataset.taskPlanPoolRemove;
        if (!itemId) {
          return;
        }
        removeTaskPlanPoolDraftItem(itemId);
      });
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-generate]")?.addEventListener("click", () => {
      void generateTaskPoolCandidates();
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-sync]")?.addEventListener("click", () => {
      void syncTaskPoolBoard();
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-records]")?.addEventListener("click", () => {
      taskPoolState = { ...taskPoolState, isGenerationRecordOpen: true };
      render();
    });

    root.querySelector<HTMLButtonElement>("[data-workflow-artifacts-open]")?.addEventListener("click", () => {
      window.location.hash = "#/workflow-artifacts";
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-records-close]")?.addEventListener("click", () => {
      taskPoolState = { ...taskPoolState, isGenerationRecordOpen: false };
      render();
    });

    root.querySelector<HTMLButtonElement>("[data-workflow-recorder-close]")?.addEventListener("click", () => {
      taskPoolState = { ...taskPoolState, isWorkflowRecorderOpen: false };
      render();
    });

    root.querySelector<HTMLTextAreaElement>("[data-workflow-recorder-input]")?.addEventListener("input", (event) => {
      taskPoolState = {
        ...taskPoolState,
        workflowRecorderDraft: (event.currentTarget as HTMLTextAreaElement).value,
      };
    });

    root.querySelectorAll<HTMLButtonElement>("[data-workflow-recorder-submit]").forEach((button) => {
      button.addEventListener("click", () => {
        const marker = button.dataset.workflowRecorderSubmit;
        void submitWorkflowRecorder(marker === "issue" || marker === "end-node" ? marker : "normal");
      });
    });

    root.querySelector<HTMLButtonElement>("[data-task-pool-drawer-close]")?.addEventListener("click", () => {
      taskPoolState = { ...taskPoolState, selectedCandidateId: null };
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-complete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const itemId = button.dataset.taskPoolComplete;
        if (!itemId) {
          return;
        }
        void completeTaskPoolBoardItem(itemId);
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const itemId = button.dataset.taskPoolDelete;
        if (!itemId) {
          return;
        }
        void deleteTaskPoolBoardItem(itemId);
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-pool-card]").forEach((card) => {
      card.addEventListener("click", () => {
        taskPoolState = { ...taskPoolState, selectedCandidateId: card.dataset.taskPoolCard ?? null };
        render();
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", card.dataset.taskPoolCard ?? "");
      });
    });

    root.querySelectorAll<HTMLElement>("[data-task-pool-drop-zone]").forEach((zone) => {
      zone.addEventListener("dragover", (event) => event.preventDefault());
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        const taskId = event.dataTransfer?.getData("text/plain") ?? "";
        const nextZone = zone.dataset.taskPoolDropZone;
        if (!taskId || !isTaskPoolBoardZone(nextZone)) {
          return;
        }
        void moveTaskPoolBoardItem(taskId, nextZone);
      });
    });

    root.querySelectorAll<HTMLSelectElement>("[data-task-pool-sort-zone]").forEach((input) => {
      input.addEventListener("change", () => {
        const zone = input.dataset.taskPoolSortZone;
        if (!isTaskPoolBoardZone(zone) || !isTaskPoolBoardSortMode(input.value)) {
          return;
        }
        taskPoolState = {
          ...taskPoolState,
          sortModes: {
            ...taskPoolState.sortModes,
            [zone]: input.value,
          },
        };
        render();
      });
    });

    root.querySelectorAll<HTMLSelectElement>("[data-task-pool-group-zone]").forEach((input) => {
      input.addEventListener("change", () => {
        const zone = input.dataset.taskPoolGroupZone;
        if (!isTaskPoolBoardZone(zone) || !isTaskPoolBoardGroupMode(input.value)) {
          return;
        }
        taskPoolState = {
          ...taskPoolState,
          groupModes: {
            ...taskPoolState.groupModes,
            [zone]: input.value,
          },
        };
        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-task-pool-view-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextMode = button.dataset.taskPoolViewMode;
        if (nextMode !== "list" && nextMode !== "tree") {
          return;
        }
        setTaskPoolViewMode(nextMode);
      });
    });

    bindTaskPoolTreeEvents();
    bindHealthDomainEvents();
    bindTaskPlanScheduleEvents();

    if (taskPlanState.pendingScheduleFocusId) {
      const focusTarget = root.querySelector<HTMLInputElement>(
        `[data-task-plan-schedule-time-input='${cssEscape(taskPlanState.pendingScheduleFocusId)}']`,
      ) ?? root.querySelector<HTMLInputElement>(
        `[data-task-plan-schedule-title-input='${cssEscape(taskPlanState.pendingScheduleFocusId)}']`,
      );
      if (focusTarget) {
        focusTarget.focus();
        taskPlanState = {
          ...taskPlanState,
          pendingScheduleFocusId: null,
        };
      }
    }

    if (taskPlanState.pendingPoolFocusId) {
      const focusTarget = root.querySelector<HTMLInputElement>(
        `[data-task-plan-pool-title-input='${cssEscape(taskPlanState.pendingPoolFocusId)}']`,
      );
      if (focusTarget) {
        focusTarget.focus();
        taskPlanState = {
          ...taskPlanState,
          pendingPoolFocusId: null,
        };
      }
    }

    const treeEditInput = root.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    if (treeEditInput && document.activeElement !== treeEditInput) {
      treeEditInput.focus();
      treeEditInput.setSelectionRange(treeEditInput.value.length, treeEditInput.value.length);
    }

    const treeResize = root.querySelector<HTMLElement>("[data-workspace-tree-resize]");
    if (treeResize) {
      attachResizeHandle({
        handle: treeResize,
        onMove(event) {
          workspaceTreeWidth = clampPanelWidth(event.clientX - root.getBoundingClientRect().left - 24, WORKSPACE_TREE_BOUNDS);
          applyWorkspaceTreeWidth(root, workspaceTreeWidth);
        },
        onEnd() {
          workspaceTreeWidth = writePanelWidth("workspace.treeWidth", workspaceTreeWidth, WORKSPACE_TREE_BOUNDS);
          applyWorkspaceTreeWidth(root, workspaceTreeWidth);
        },
      });
    }

    const taskPoolResize = root.querySelector<HTMLElement>("[data-task-pool-tree-resize]");
    if (taskPoolResize) {
      attachResizeHandle({
        handle: taskPoolResize,
        onMove(event) {
          taskPoolState = {
            ...taskPoolState,
            sidebarWidth: clampPanelWidth(
              event.clientX - root.getBoundingClientRect().left - 40,
              TASK_POOL_TREE_BOUNDS,
            ),
          };
          applyPanelWidth(
            root,
            "--task-pool-tree-sidebar-width",
            taskPoolState.sidebarWidth,
          );
        },
        onEnd() {
          taskPoolState = {
            ...taskPoolState,
            sidebarWidth: writePanelWidth(
              "workspace.taskPoolTreeSidebarWidth",
              taskPoolState.sidebarWidth,
              TASK_POOL_TREE_BOUNDS,
            ),
          };
          applyPanelWidth(
            root,
            "--task-pool-tree-sidebar-width",
            taskPoolState.sidebarWidth,
          );
        },
      });
    }

    if (activeTab === "work-log") {
      workspaceTreeWidth = workspaceTreeWidth || readPanelWidth("workspace.treeWidth", WORKSPACE_TREE_BOUNDS);
      applyWorkspaceTreeWidth(root, workspaceTreeWidth);
      bindWorkLogBlockEditor(root, { onChanged: syncWorkspaceDraftFromEditor });
      bindWorkspaceGraphyDrag();
      const editor = root.querySelector<HTMLElement>("[data-workspace-doc-editor]");
      editor?.addEventListener("input", (event) => {
        workspaceDraftDocumentId = workspaceDocsState.selectedId;
        workspaceDraftHtml = (event.currentTarget as HTMLElement).innerHTML;
        workspaceDraftDirty = true;
        scheduleWorkspaceAutoSave();
      });
      editor?.addEventListener("blur", () => {
        clearWorkspaceAutoSave();
        if (workspaceDraftDirty) {
          void saveWorkspaceDoc({ renderAfterSave: false });
        }
      });
      editor?.addEventListener("keydown", (event) => {
        if (eventMatchesShortcut(event, getClientKeyboardShortcut("workspaceSave"))) {
          event.preventDefault();
          clearWorkspaceAutoSave();
          void saveWorkspaceDoc({ renderAfterSave: false });
        }
      });
    }

    if (activeTab === "task-pool") {
      taskPoolState = {
        ...taskPoolState,
        sidebarWidth:
          taskPoolState.sidebarWidth ||
          readPanelWidth("workspace.taskPoolTreeSidebarWidth", TASK_POOL_TREE_BOUNDS),
      };
      applyPanelWidth(
        root,
        "--task-pool-tree-sidebar-width",
        taskPoolState.isSidebarCollapsed ? TASK_POOL_TREE_COLLAPSED_WIDTH : taskPoolState.sidebarWidth,
      );
      if (
        activeTaskPoolDomainSlug === TASK_POOL_HEALTH_DOMAIN_SLUG &&
        healthDomainState.status === "idle"
      ) {
        ensureHealthDomainLoaded();
      }
      if (taskPoolState.isWorkflowRecorderOpen) {
        focusWorkflowRecorderInput();
      }
    }
  };

  const bindWorkspaceGraphyDrag = (): void => {
    const panel = root.querySelector<HTMLElement>("[data-workspace-graphy]");
    const handle = root.querySelector<HTMLElement>("[data-workspace-graphy-handle]");
    if (!panel || !handle) {
      return;
    }
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startPosition = workspaceGraphyPosition;
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent: PointerEvent): void => {
        moveEvent.preventDefault();
        workspaceGraphyPosition = {
          x: startPosition.x - (moveEvent.clientX - startX),
          y: startPosition.y + moveEvent.clientY - startY,
        };
        workspaceGraphyPosition = normalizeWorkspaceGraphyPosition(workspaceGraphyPosition);
        applyWorkspaceGraphyPosition(panel, workspaceGraphyPosition);
      };
      const end = (): void => {
        writeWorkspaceGraphyPosition(workspaceGraphyPosition);
        handle.releasePointerCapture?.(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  };

  render();
  return root;
}

function renderWorkspaceView(
  tab: WorkspaceTab,
  workspaceDocsState: WorkspaceDocsState,
  options: {
    expandedDomains: ReadonlySet<string>;
    expandedWorkspaceProjects: ReadonlySet<string>;
    draftDocumentId: string | null;
    draftHtml: string;
    graphyPosition: WorkspaceGraphyPosition;
    searchQuery: string;
    gallerySelectedPath: string | null;
    deleteDialog?: WorkspaceDocDeleteDialog | null;
    taskPlanState?: TaskPlanViewState;
    taskPoolState?: TaskPoolViewState;
    healthDomainState?: HealthDomainViewState;
    activeTaskPoolDomainSlug?: string | null;
    forceTaskPoolBoard?: boolean;
  },
): string {
  const taskPlanViewState = options.taskPlanState ?? createDefaultTaskPlanViewState();
  const taskPoolViewState = options.taskPoolState ?? createDefaultTaskPoolViewState();
  const healthViewState = options.healthDomainState ?? createDefaultHealthDomainViewState();
  const renderers: Record<WorkspaceTab, () => string> = {
    "task-plan": () => renderTaskPlanView(taskPlanViewState),
    "task-pool": () =>
      renderTaskPoolView(
        taskPlanViewState,
        taskPoolViewState,
        healthViewState,
        options.activeTaskPoolDomainSlug ?? null,
        options.forceTaskPoolBoard ?? false,
      ),
    "work-log": () => renderWorkLogView(workspaceDocsState, options),
  };
  return renderers[tab]();
}

function renderTaskPlanView(viewState: TaskPlanViewState): string {
  const taskPlanState = viewState.state ?? createDefaultTaskPlanState();
  const scheduleItems = viewState.scheduleEditMode ? viewState.scheduleDraft : taskPlanState.schedule.items;
  const poolItems = getTaskPlanPoolVisibleItems(viewState);
  const poolBusy = isTaskPlanPoolBusy(viewState);
  const morningSteps = [
    taskPlanState.morningFlow.voiceDone,
    taskPlanState.morningFlow.diaryDone,
    taskPlanState.morningFlow.planningDone,
    taskPlanState.morningFlow.fineTuneDone,
  ];
  const feedback = viewState.error
    ? viewState.error
    : viewState.feedback ?? (viewState.status === "loading" && !viewState.state ? "正在同步任务计划..." : "系统已与后端任务计划状态同步。");

  return renderTaskPlanLayout(viewState, taskPlanState, scheduleItems, poolItems, poolBusy, morningSteps, feedback);
}

// fallow-ignore-next-line complexity
function renderTaskPlanLayout(
  viewState: TaskPlanViewState,
  taskPlanState: TaskPlanState,
  scheduleItems: TaskPlanScheduleItem[],
  poolItems: TaskPlanPoolItem[],
  poolBusy: boolean,
  morningSteps: boolean[],
  feedback: string,
): string {

  return `
    <section class="workspace-view workspace-view--task-plan" data-workspace-view="task-plan">
      <div class="workspace-task-plan-layout" data-task-plan-layout style="--task-plan-top-ratio:${viewState.splitRatio};">
        <div class="workspace-task-plan-poster workspace-task-plan-poster--top" data-task-plan-top>
          <div class="workspace-task-plan-poster__morning">
            <div class="workspace-task-plan-poster__morning-label">
              <span class="workspace-task-plan-poster__morning-icon">${renderIcon("refresh-cw", { size: 18 })}</span>
              <span>晨间流程建议</span>
            </div>
            ${TASK_PLAN_STEP_LABELS.map((label, index) => `
              <div class="workspace-task-plan-poster__morning-step" data-done="${morningSteps[index] ? "true" : "false"}">
                <span class="workspace-task-plan-poster__morning-index">${index + 1}</span>
                <span>${label}</span>
              </div>
              ${index < TASK_PLAN_STEP_LABELS.length - 1 ? '<span class="workspace-task-plan-poster__morning-arrow">›</span>' : ""}
            `).join("")}
          </div>

          <section class="workspace-task-plan-poster__assistant" data-task-plan-assistant-layout="compact-feedback">
            <header class="workspace-task-plan-poster__assistant-header">
              <h2>AI 智能排期助手</h2>
              <div class="workspace-task-plan-poster__assistant-actions" data-task-plan-assistant-actions>
                <button
                  type="button"
                  class="workspace-task-plan-poster__action"
                  data-task-plan-generate
                  ${viewState.busyAction === "generate" ? "disabled" : ""}
                >
                  <span class="workspace-task-plan-poster__action-icon">✦</span>
                  <span>AI优先级判断·时间排序</span>
                </button>
                <div
                  class="workspace-task-plan-poster__action-feedback"
                  data-task-plan-feedback-inline
                  data-busy="${viewState.busyAction ? "true" : "false"}"
                >${escapeHtml(feedback)}</div>
              </div>
            </header>

            <div class="workspace-task-plan-poster__assistant-grid">
              <article
                class="workspace-task-plan-poster__card workspace-task-plan-poster__card--voice"
                data-task-plan-card="text"
              >
                <div class="workspace-task-plan-poster__card-head">
                  <div class="workspace-task-plan-poster__card-title">
                    <span class="workspace-task-plan-poster__card-index">1</span>
                    <span>文字输入</span>
                  </div>
                  <div class="workspace-task-plan-poster__card-actions">
                    <button
                      type="button"
                      class="workspace-task-plan-poster__control-chip"
                      data-task-plan-text-save
                      ${viewState.busyAction === "text" ? "disabled" : ""}
                    >保存</button>
                  </div>
                </div>
                <textarea class="workspace-task-plan-poster__editor" data-task-plan-text-input placeholder="直接输入你今天的想法与安排">${escapeHtml(viewState.textDraft)}</textarea>
                <div class="workspace-task-plan-poster__card-foot">${taskPlanState.voice.updatedAt ? "已同步" : "待输入"} <span>✔</span></div>
              </article>

              <article class="workspace-task-plan-poster__card workspace-task-plan-poster__card--status">
                <div class="workspace-task-plan-poster__card-head">
                  <div class="workspace-task-plan-poster__card-title">
                    <span class="workspace-task-plan-poster__card-index">2</span>
                    <span>近日状态</span>
                  </div>
                  <div class="workspace-task-plan-poster__card-actions">
                    <button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-status-save ${viewState.busyAction === "status" ? "disabled" : ""}>保存</button>
                    <button type="button" class="workspace-task-plan-poster__control-arrow" data-task-plan-status-refresh ${viewState.busyAction === "status-refresh" ? "disabled" : ""}>↻</button>
                  </div>
                </div>
                <textarea class="workspace-task-plan-poster__editor workspace-task-plan-poster__editor--status" data-task-plan-status-input>${escapeHtml(viewState.statusDraft)}</textarea>
              </article>

              <article class="workspace-task-plan-poster__card workspace-task-plan-poster__card--pool">
                <div class="workspace-task-plan-poster__card-head">
                  <div class="workspace-task-plan-poster__card-title">
                    <span class="workspace-task-plan-poster__card-index">3</span>
                    <button type="button" class="workspace-task-plan-poster__card-title-link" data-task-plan-open-task-pool>已有任务池</button>
                  </div>
                  <div class="workspace-task-plan-poster__card-actions">
                    <button
                      type="button"
                      class="workspace-task-plan-poster__control-arrow"
                      data-task-pool-generate
                      aria-label="根据近日日记生成任务"
                      title="根据近日日记生成任务"
                      ${poolBusy ? "disabled" : ""}
                    >${renderIcon("plus", { size: 15 })}</button>
                    ${viewState.poolEditMode ? `<button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-add ${poolBusy ? "disabled" : ""}>新增</button>` : ""}
                    ${viewState.poolEditMode ? `<button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-save ${poolBusy ? "disabled" : ""}>保存</button>` : ""}
                    <button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-edit-toggle ${poolBusy ? "disabled" : ""}>${viewState.poolEditMode ? "取消" : "编辑"}</button>
                  </div>
                </div>
                <div class="workspace-task-plan-poster__pool-filters">
                  ${renderTaskPlanPoolFilters(viewState.poolFilter, poolBusy)}
                  ${renderTaskPlanPoolSort(viewState.poolSortMode, poolBusy)}
                </div>
                <div class="workspace-task-plan-poster__pool-list" data-task-plan-pool-list data-task-plan-scroll-mode="flex">
                  ${renderTaskPlanPoolRows(poolItems, viewState.poolEditMode, poolBusy)}
                </div>
                <div class="workspace-task-plan-poster__pool-total">共 ${poolItems.length} 项任务</div>
              </article>

              <article class="workspace-task-plan-poster__card workspace-task-plan-poster__card--schedule">
                <div class="workspace-task-plan-poster__card-head">
                  <div class="workspace-task-plan-poster__card-title">
                    <span class="workspace-task-plan-poster__card-index">4</span>
                    <span>今日建议时间表</span>
                  </div>
                  <div class="workspace-task-plan-poster__card-actions">
                    ${viewState.scheduleEditMode ? '<button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-schedule-add>新增</button>' : ""}
                    <button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-schedule-edit-toggle>${viewState.scheduleEditMode ? "取消" : "修改"}</button>
                  </div>
                </div>
                <div class="workspace-task-plan-poster__timeline" data-task-plan-schedule-list data-task-plan-scroll-mode="flex">
                  ${scheduleItems.map((item) => viewState.scheduleEditMode
                    ? `
                      <div
                        class="workspace-task-plan-poster__timeline-row workspace-task-plan-poster__timeline-row--edit${viewState.draggingScheduleId === item.id ? " is-dragging" : ""}"
                        data-task-plan-schedule-row="${escapeHtml(item.id)}"
                        draggable="true"
                      >
                        <span class="workspace-task-plan-poster__timeline-drag" data-task-plan-schedule-drag draggable="true" aria-hidden="true">⋮⋮</span>
                        <input class="workspace-task-plan-poster__timeline-input workspace-task-plan-poster__timeline-input--time" data-task-plan-schedule-time-input="${escapeHtml(item.id)}" value="${escapeHtml(item.startTime)}" />
                        <input class="workspace-task-plan-poster__timeline-input" data-task-plan-schedule-title-input="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}" />
                        <select class="workspace-task-plan-poster__timeline-select" data-task-plan-schedule-priority-input="${escapeHtml(item.id)}">
                          ${(["high", "mid", "low", "cool", "neutral"] as const).map((priority) => `
                            <option value="${priority}" ${item.priority === priority ? "selected" : ""}>${TASK_PLAN_PRIORITY_LABELS[priority]}</option>
                          `).join("")}
                        </select>
                        <button type="button" class="workspace-task-plan-poster__timeline-remove" data-task-plan-schedule-remove="${escapeHtml(item.id)}">删除</button>
                      </div>
                    `
                    : `
                      <div class="workspace-task-plan-poster__timeline-row" data-task-plan-schedule-row="${escapeHtml(item.id)}">
                        <div class="workspace-task-plan-poster__timeline-time">${escapeHtml(item.startTime)}</div>
                        <div class="workspace-task-plan-poster__timeline-card">
                          <span>${escapeHtml(item.title)}</span>
                          <span class="workspace-task-plan-poster__pill workspace-task-plan-poster__pill--${item.priority}">${TASK_PLAN_PRIORITY_LABELS[item.priority]}</span>
                          <span class="workspace-task-plan-poster__timeline-menu">⋮</span>
                        </div>
                      </div>
                    `).join("")}
                </div>
                <div class="workspace-task-plan-poster__schedule-actions">
                  <button type="button" class="workspace-task-plan-poster__fine-tune workspace-task-plan-poster__fine-tune--compact" data-task-plan-schedule-save ${viewState.busyAction === "save" ? "disabled" : ""}>
                    <span>${renderIcon("copy", { size: 14 })}</span>
                    <span>${viewState.scheduleEditMode ? "保存日程" : "确认日程"}</span>
                  </button>
                </div>
                <p class="workspace-task-plan-poster__fine-copy workspace-task-plan-poster__fine-copy--schedule">
                  系统已结合文本输入、近日状态与任务池<br/>
                  确认后会将当前时间表保存为正式版本。
                </p>
              </article>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderTaskPoolView(
  viewState: TaskPlanViewState,
  taskPoolState: TaskPoolViewState,
  healthViewState: HealthDomainViewState,
  activeDomainSlug: string | null,
  forceBoard: boolean,
): string {
  if (viewState.status === "loading") {
    return renderTaskPoolStatusView("\u6b63\u5728\u540c\u6b65\u4efb\u52a1\u8ba1\u5212\u9875\u7684\u5171\u4eab\u4efb\u52a1\u6c60...");
  }
  if (viewState.status === "error") {
    return renderTaskPoolStatusView(viewState.error ?? "\u4efb\u52a1\u6c60\u52a0\u8f7d\u5931\u8d25");
  }
  return renderTaskPoolReadyView(
    viewState,
    taskPoolState,
    healthViewState,
    activeDomainSlug,
    forceBoard,
  );
}

function renderTaskPoolStatusView(subtitle: string): string {
  return `
    <section class="workspace-view workspace-view--task-pool" data-workspace-view="task-pool">
      <section class="workspace-panel workspace-panel--pool-placeholder">
        <div class="eyebrow">TASK POOL</div>
        <h2>\u4efb\u52a1\u6c60</h2>
        <p class="workspace-page__subtitle">${escapeHtml(subtitle)}</p>
      </section>
    </section>
  `;
}

// fallow-ignore-next-line complexity
function renderTaskPoolReadyView(
  viewState: TaskPlanViewState,
  taskPoolState: TaskPoolViewState,
  healthViewState: HealthDomainViewState,
  activeDomainSlug: string | null,
  forceBoard: boolean,
): string {
  const allPoolItems = getTaskPlanPoolSharedItems(viewState);
  const poolBusy = isTaskPlanPoolBusy(viewState);
  if (activeDomainSlug === TASK_POOL_HEALTH_DOMAIN_SLUG) {
    return renderHealthDomainView(
      viewState,
      taskPoolState,
      healthViewState,
      activeDomainSlug,
    );
  }
  if (forceBoard) {
    return renderTaskPoolBoard({
    pool: viewState.state?.pool ?? { items: allPoolItems, stages: [], generationRecords: [] },
      selectedCandidateId: taskPoolState.selectedCandidateId,
      recordsOpen: taskPoolState.isGenerationRecordOpen,
      recorderOpen: taskPoolState.isWorkflowRecorderOpen,
      recorderDraft: taskPoolState.workflowRecorderDraft,
      recorderFeedback: taskPoolState.workflowRecorderFeedback,
      busy: poolBusy || viewState.busyAction === "pool-generate" || taskPoolState.workflowRecorderBusy,
      feedback: viewState.feedback,
      error: viewState.error,
      sortModes: taskPoolState.sortModes,
      groupModes: taskPoolState.groupModes,
    });
  }
  const pageTitle = resolveTaskPoolPageTitle(activeDomainSlug);
  const subtitle = activeDomainSlug
    ? `当前展示“${escapeHtml(pageTitle)}”领域下的共享任务。`
    : "\u4e0e\u4efb\u52a1\u8ba1\u5212\u9875\u5171\u4eab\u540c\u4e00\u4efd\u4efb\u52a1\u6c60\uff0c\u53ef\u76f4\u63a5\u7b5b\u9009\u3001\u7f16\u8f91\u5e76\u4fdd\u5b58\u3002";
  const scopedItems = filterTaskPoolItemsByDomain(allPoolItems, activeDomainSlug);
  const listItems = scopedItems.filter(
    (item) => viewState.poolFilter === "全部" || item.source === viewState.poolFilter,
  );
  const treeRenderState: TaskPoolTreeRenderState = {
    level: taskPoolState.treeLevel,
    selectedOptions: taskPoolState.selectedOptions,
    isSidebarCollapsed: taskPoolState.isSidebarCollapsed,
    zoomPercent: taskPoolState.zoomPercent,
    isEditorEnabled: viewState.poolEditMode,
    selectedNode: taskPoolState.selectedNode,
    editingNode: taskPoolState.editingNode,
    editValue: taskPoolState.editValue,
    draggingTaskId: taskPoolState.draggingTaskId,
    dropProjectKey: taskPoolState.dropProjectKey,
    dirty: isTaskPoolDraftDirty(viewState),
  };
  return `
    <section class="workspace-view workspace-view--task-pool" data-workspace-view="task-pool">
      <div class="workspace-task-pool-page">
        <header class="workspace-task-pool-page__header">
          <div>
            <div class="eyebrow">TASK POOL</div>
            <h2>${escapeHtml(pageTitle)}</h2>
            <p class="workspace-page__subtitle">${subtitle}</p>
          </div>
          ${taskPoolState.mode === "tree" ? renderTaskPoolActions(viewState, poolBusy, false) : ""}
          ${renderTaskPoolModeBar(allPoolItems, taskPoolState, activeDomainSlug)}
        </header>
        ${
          taskPoolState.mode === "tree"
            ? renderTaskPoolTreeLayout(scopedItems, treeRenderState)
            : renderTaskPoolListLayout(viewState, listItems, poolBusy)
        }
      </div>
    </section>
  `;
}

function renderTaskPoolModeBar(
  items: readonly TaskPlanPoolItem[],
  taskPoolState: TaskPoolViewState,
  activeDomainSlug: string | null,
): string {
  return `
    <div class="workspace-task-pool-page__toolbar">
      <div class="workspace-task-pool-page__modes">
        ${renderTaskPoolModeButton("list", "\u5217\u8868\u89c6\u56fe", taskPoolState.mode)}
        ${renderTaskPoolModeButton("tree", "\u6811\u72b6\u56fe", taskPoolState.mode)}
      </div>
      <div class="workspace-task-pool-page__domains">
        ${renderTaskPoolDomainChips(items, activeDomainSlug)}
      </div>
      ${
        taskPoolState.mode === "tree"
          ? renderTaskPoolZoomControls(taskPoolState.zoomPercent)
          : ""
      }
    </div>
  `;
}

function renderTaskPoolModeButton(
  mode: TaskPoolViewMode,
  label: string,
  activeMode: TaskPoolViewMode,
): string {
  const active = mode === activeMode;
  return `
    <button
      type="button"
      class="workspace-task-pool-page__mode${active ? " is-active" : ""}"
      data-task-pool-view-mode="${mode}"
      data-active="${active ? "true" : "false"}"
    >${label}</button>
  `;
}

function renderTaskPoolDomainChips(
  items: readonly TaskPlanPoolItem[],
  activeDomainSlug: string | null,
): string {
  const domainLabels = [...getTaskPoolDomainLabels(items), "健康"];
  const uniqueLabels = Array.from(new Set(domainLabels));
  return uniqueLabels
    .map((label) => {
      const domainSlug = getTaskPoolDomainSlug(label);
      const isActive = activeDomainSlug === domainSlug;
      return `
        <button
          type="button"
          class="workspace-task-pool-page__domain${isActive ? " is-active" : ""}"
          data-task-pool-domain-chip="${escapeHtml(domainSlug)}"
        >${escapeHtml(label)}</button>
      `;
    })
    .join("");
}

function renderTaskPoolZoomControls(zoomPercent: number): string {
  return `
    <div class="workspace-task-pool-page__zoom">
      <button type="button" class="workspace-task-pool-page__zoom-btn" data-task-pool-zoom="out">−</button>
      <span class="workspace-task-pool-page__zoom-value">${zoomPercent}%</span>
      <button type="button" class="workspace-task-pool-page__zoom-btn" data-task-pool-zoom="in">+</button>
      <button type="button" class="workspace-task-pool-page__zoom-reset" data-task-pool-zoom="reset">\u91cd\u7f6e</button>
    </div>
  `;
}

function renderTaskPoolListLayout(
  viewState: TaskPlanViewState,
  items: readonly TaskPlanPoolItem[],
  poolBusy: boolean,
): string {
  return `
    <section class="workspace-task-plan-poster__card workspace-task-pool-page__card">
      <div class="workspace-task-plan-poster__card-head">
        <div class="workspace-task-plan-poster__card-title">
          <span class="workspace-task-plan-poster__card-index">3</span>
          <span>共享任务池</span>
        </div>
        ${renderTaskPoolActions(viewState, poolBusy)}
      </div>
      <div class="workspace-task-plan-poster__pool-filters">
        ${renderTaskPlanPoolFilters(viewState.poolFilter, poolBusy)}
      </div>
      <div class="workspace-task-plan-poster__pool-list workspace-task-pool-page__list" data-task-plan-pool-list>
        ${renderTaskPlanPoolRows(items, viewState.poolEditMode, poolBusy)}
      </div>
      <div class="workspace-task-plan-poster__pool-total">共 ${items.length} 项任务</div>
    </section>
  `;
}

// fallow-ignore-next-line complexity
function renderHealthDomainView(
  taskPlanViewState: TaskPlanViewState,
  taskPoolState: TaskPoolViewState,
  healthViewState: HealthDomainViewState,
  activeDomainSlug: string | null,
): string {
  const latest = healthViewState.state?.sleep.latest ?? createEmptyHealthSleepLatestState();
  const insights = healthViewState.state?.sleep.insights ?? [];
  const trends = healthViewState.state?.sleep.trends ?? createEmptyHealthSleepTrendsState();
  const healthTasks = getHealthTaskPoolItems(taskPlanViewState);
  return `
    <section class="workspace-view workspace-view--task-pool" data-workspace-view="task-pool">
      <div class="workspace-task-pool-page">
        <header class="workspace-task-pool-page__header">
          <div>
            <div class="eyebrow">HEALTH DOMAIN</div>
            <h2>健康</h2>
            <p class="workspace-page__subtitle">重点跟踪入睡、起床、深度睡眠质量，以及影响睡眠的活动与心率趋势。</p>
          </div>
          ${renderTaskPoolModeBar(taskPlanViewState.state?.pool.items ?? [], taskPoolState, activeDomainSlug)}
        </header>
        <section class="workspace-health-domain" data-workspace-domain-view="health">
          <div class="workspace-health-domain__topbar">
            <div class="workspace-health-domain__sync">
              <strong>${escapeHtml(healthViewState.state?.connection.label ?? "小米运动健康未连接")}</strong>
              <span>${escapeHtml(readHealthConnectionSummary(healthViewState))}</span>
            </div>
            <div class="workspace-health-domain__actions">
              <button type="button" class="workspace-task-plan-poster__control-chip" data-health-import-open>导入小米运动健康数据</button>
              <button type="button" class="workspace-task-plan-poster__control-chip" data-health-sync ${healthViewState.busyAction === "sync" ? "disabled" : ""}>手动同步</button>
            </div>
          </div>
          <div class="workspace-health-domain__metrics">
            ${renderHealthMetricCard("入睡时间", latest.bedTime)}
            ${renderHealthMetricCard("起床时间", latest.wakeTime)}
            ${renderHealthMetricCard("深度睡眠质量", latest.deepSleepQuality)}
            ${renderHealthMetricCard("总睡眠时长", latest.totalSleep)}
          </div>
          <div class="workspace-health-domain__factors">
            ${renderHealthFactorCard("睡眠评分", latest.sleepScore)}
            ${renderHealthFactorCard("清醒时长", latest.awakeDuration)}
            ${renderHealthFactorCard("睡眠平均心率", latest.sleepAverageHeartRate)}
            ${renderHealthFactorCard("步数 / 活动量", latest.steps && latest.intensityMinutes ? `${latest.steps} · ${latest.intensityMinutes}` : latest.steps ?? latest.intensityMinutes)}
          </div>
          <div class="workspace-health-domain__grid">
            <section class="workspace-health-domain__panel">
              <header><h3>影响睡眠的因素</h3></header>
              <div class="workspace-health-domain__insights">${insights.length > 0 ? insights.map((item) => `<div class="workspace-health-domain__insight">${escapeHtml(item)}</div>`).join("") : '<div class="workspace-health-domain__empty">连接后会显示最近 7 天的睡眠风险提醒。</div>'}</div>
            </section>
            <section class="workspace-health-domain__panel">
              <header><h3>最近 7 天趋势</h3></header>
              <div class="workspace-health-domain__trend-list">
                ${renderHealthTrendRow("入睡时间", (trends.bedTimes ?? []).join(" · "))}
                ${renderHealthTrendRow("起床时间", (trends.wakeTimes ?? []).join(" · "))}
                ${renderHealthTrendRow("深睡分钟", (trends.deepSleepMinutes ?? []).join(" / "))}
                ${renderHealthTrendRow("睡眠评分", (trends.sleepScores ?? []).join(" / "))}
              </div>
            </section>
            <section class="workspace-health-domain__panel">
              <header><h3>健康任务</h3></header>
              <div class="workspace-health-domain__task-list">
                ${healthTasks.length > 0 ? healthTasks.map((item) => `<div class="workspace-health-domain__task">${escapeHtml(item.title)}</div>`).join("") : '<div class="workspace-health-domain__empty">当前还没有标记为“健康”领域的共享任务。</div>'}
              </div>
            </section>
          </div>
          ${renderHealthImportModal(healthViewState)}
        </section>
      </div>
    </section>
  `;
}

function renderHealthMetricCard(title: string, value: string | null): string {
  return `<article class="workspace-health-domain__metric"><span>${title}</span><strong>${escapeHtml(value ?? "--")}</strong></article>`;
}

function renderHealthFactorCard(title: string, value: string | null): string {
  return `<article class="workspace-health-domain__factor"><span>${title}</span><strong>${escapeHtml(value ?? "--")}</strong></article>`;
}

function renderHealthTrendRow(title: string, value: string): string {
  return `<div class="workspace-health-domain__trend"><span>${title}</span><strong>${escapeHtml(value || "--")}</strong></div>`;
}

function renderHealthImportModal(healthViewState: HealthDomainViewState): string {
  if (!healthViewState.isImportModalOpen) {
    return "";
  }
  const showSmsReadyHint =
    !!healthViewState.captchaChallenge &&
    healthViewState.accountDraft.verificationCode.trim().length > 0;
  return `
    <div class="workspace-health-domain__modal-backdrop" data-health-import-modal>
      <section class="workspace-health-domain__modal">
        <header class="workspace-health-domain__modal-head">
          <div>
            <strong>导入小米运动健康数据</strong>
            <span>支持手机号验证码连接、二维码登录和 token / API 连接。</span>
          </div>
          <button type="button" class="workspace-health-domain__modal-close" data-health-import-close>×</button>
        </header>
        <div class="workspace-health-domain__modal-tabs">
          <button type="button" class="workspace-health-domain__modal-tab${healthViewState.activeImportTab === "account" ? " is-active" : ""}" data-health-import-tab="account">验证码连接</button>
          <button type="button" class="workspace-health-domain__modal-tab${healthViewState.activeImportTab === "api" ? " is-active" : ""}" data-health-import-tab="api">高级连接</button>
        </div>
        ${renderHealthImportModalBody(healthViewState, showSmsReadyHint)}
        ${renderHealthImportModalFoot(healthViewState, showSmsReadyHint)}
      </section>
    </div>
  `;
}

function renderHealthImportModalBody(
  healthViewState: HealthDomainViewState,
  showSmsReadyHint: boolean,
): string {
  if (healthViewState.activeImportTab === "account") {
    return renderHealthAccountImportBody(healthViewState, showSmsReadyHint);
  }
  return renderHealthApiImportBody(healthViewState);
}

function renderHealthAccountImportBody(
  healthViewState: HealthDomainViewState,
  showSmsReadyHint: boolean,
): string {
  return `
    <div class="workspace-health-domain__modal-body">
      <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-account-input="username" value="${escapeHtml(healthViewState.accountDraft.username)}" placeholder="手机号" />
      ${renderHealthCaptchaChallenge(healthViewState, showSmsReadyHint)}
      <div class="workspace-health-domain__inline">
        <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-account-input="verificationCode" value="${escapeHtml(healthViewState.accountDraft.verificationCode)}" placeholder="短信验证码" />
        <button type="button" class="workspace-task-plan-poster__control-chip" data-health-send-code ${healthViewState.busyAction === "send-code" ? "disabled" : ""}>${healthViewState.captchaChallenge ? "提交图形验证码" : "获取验证码"}</button>
      </div>
      <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-account-input="relativeUid" value="${escapeHtml(healthViewState.accountDraft.relativeUid)}" placeholder="亲友共享 UID" />
      <button type="button" class="workspace-task-plan-poster__control-chip workspace-health-domain__primary" data-health-connect-account ${healthViewState.busyAction === "connect" ? "disabled" : ""}>验证码登录并连接</button>
    </div>
  `;
}

function renderHealthCaptchaChallenge(
  healthViewState: HealthDomainViewState,
  showSmsReadyHint: boolean,
): string {
  if (!healthViewState.captchaChallenge) {
    return "";
  }
  return `
    <div class="workspace-health-domain__captcha" data-health-captcha-challenge>
      <div class="workspace-health-domain__captcha-copy">${escapeHtml(healthViewState.captchaChallenge.message ?? "当前连接触发了图形验证码，请先完成校验。")}</div>
      <img class="workspace-health-domain__captcha-image" src="${escapeHtml(healthViewState.captchaChallenge.imageDataUrl)}" alt="图形验证码" />
      <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-account-input="captchaCode" value="${escapeHtml(healthViewState.accountDraft.captchaCode)}" placeholder="图形验证码" />
      ${showSmsReadyHint ? '<div class="workspace-health-domain__captcha-hint">如果你已经收到短信验证码，不要再点右侧按钮，直接点下方“登录并连接”。</div>' : ""}
    </div>
  `;
}

function renderHealthApiImportBody(healthViewState: HealthDomainViewState): string {
  return `
    <div class="workspace-health-domain__modal-body">
      ${renderHealthQrLoginPanel(healthViewState)}
      <textarea class="workspace-task-plan-poster__editor workspace-health-domain__textarea" data-health-api-token-input placeholder="粘贴 token.json 内容">${escapeHtml(healthViewState.apiDraft.tokenJson)}</textarea>
      <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-api-input="apiBaseUrl" value="${escapeHtml(healthViewState.apiDraft.apiBaseUrl)}" placeholder="API 地址（可选）" />
      <input class="workspace-task-plan-poster__editor workspace-health-domain__input" data-health-api-input="relativeUid" value="${escapeHtml(healthViewState.apiDraft.relativeUid)}" placeholder="亲友共享 UID" />
      <button type="button" class="workspace-task-plan-poster__control-chip workspace-health-domain__primary" data-health-connect-api ${healthViewState.busyAction === "connect" ? "disabled" : ""}>保存并导入</button>
    </div>
  `;
}

function renderHealthQrLoginPanel(healthViewState: HealthDomainViewState): string {
  return `
    <div class="workspace-health-domain__qr">
      <div>
        <strong>二维码登录生成 token</strong>
        <span>先填写亲友共享 UID，再用小米账号 App 扫码；成功后会自动保存并导入。</span>
      </div>
      ${renderHealthQrLoginImage(healthViewState.qrLogin)}
      <button type="button" class="workspace-task-plan-poster__control-chip" data-health-qr-login ${healthViewState.busyAction === "qr-login" ? "disabled" : ""}>${healthViewState.qrLogin ? "重新生成二维码" : "生成二维码登录"}</button>
    </div>
  `;
}

function renderHealthQrLoginImage(qrLogin: HealthDomainQrLoginState | null): string {
  if (!qrLogin) {
    return "";
  }
  return `
    <img class="workspace-health-domain__qr-image" src="${escapeHtml(qrLogin.qrImageUrl)}" alt="小米账号二维码" />
    ${qrLogin.loginUrl ? `<a class="workspace-health-domain__qr-link" href="${escapeHtml(qrLogin.loginUrl)}" target="_blank" rel="noreferrer">打开登录链接</a>` : ""}
  `;
}

function renderHealthImportModalFoot(
  healthViewState: HealthDomainViewState,
  showSmsReadyHint: boolean,
): string {
  return `
    <footer class="workspace-health-domain__modal-foot">
      <div class="workspace-health-domain__modal-status">
        <span>${escapeHtml(healthViewState.error ?? healthViewState.feedback ?? "")}</span>
        ${showSmsReadyHint ? '<span class="workspace-health-domain__modal-note">短信已经到手机后，后续以“登录并连接”为准。</span>' : ""}
      </div>
    </footer>
  `;
}

function renderTaskPoolActions(
  viewState: TaskPlanViewState,
  poolBusy: boolean,
  showAddButton: boolean = true,
): string {
  return `
    <div class="workspace-task-plan-poster__card-actions">
      <button type="button" class="workspace-task-plan-poster__control-chip" data-workflow-artifacts-open>执行沉淀</button>
      ${viewState.poolEditMode && showAddButton ? `<button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-add ${poolBusy ? "disabled" : ""}>新增</button>` : ""}
      ${viewState.poolEditMode ? `<button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-save ${poolBusy ? "disabled" : ""}>保存</button>` : ""}
      <button type="button" class="workspace-task-plan-poster__control-chip" data-task-plan-pool-edit-toggle ${poolBusy ? "disabled" : ""}>${viewState.poolEditMode ? "取消" : "编辑"}</button>
    </div>
  `;
}

type TaskPlanPoolDraftRepairState = Pick<
  TaskPlanViewState,
  "state" | "poolDraft" | "poolEditMode" | "poolDraftTouched"
>;

function cloneTaskPlanPoolItems(items: readonly TaskPlanPoolItem[]): TaskPlanPoolItem[] {
  return items.map((item) => ({ ...item }));
}

function shouldRepairUntouchedTaskPlanPoolDraft(viewState: TaskPlanPoolDraftRepairState): boolean {
  const persistedItems = viewState.state?.pool.items ?? [];
  return (
    viewState.poolEditMode &&
    !viewState.poolDraftTouched &&
    viewState.poolDraft.length === 0 &&
    persistedItems.length > 0
  );
}

export function repairUntouchedTaskPlanPoolDraft(
  viewState: TaskPlanPoolDraftRepairState,
): TaskPlanPoolItem[] {
  if (shouldRepairUntouchedTaskPlanPoolDraft(viewState)) {
    return cloneTaskPlanPoolItems(viewState.state?.pool.items ?? []);
  }
  return cloneTaskPlanPoolItems(viewState.poolDraft);
}

function getTaskPlanPoolSharedItems(
  viewState: Pick<TaskPlanViewState, "state" | "poolDraft" | "poolEditMode" | "poolDraftTouched">,
): TaskPlanPoolItem[] {
  const state = viewState.state ?? createDefaultTaskPlanState();
  if (viewState.poolEditMode) {
    return repairUntouchedTaskPlanPoolDraft(viewState);
  }
  return state.pool.items;
}

function getTaskPlanPoolVisibleItems(viewState: TaskPlanViewState): TaskPlanPoolItem[] {
  const state = viewState.state ?? createDefaultTaskPlanState();
  const items = viewState.poolEditMode ? repairUntouchedTaskPlanPoolDraft(viewState) : state.pool.items;
  const visibleItems = items
    .filter((item) => !item.completedAt)
    .filter((item) => readTaskPoolBoardZone(item) !== "candidate")
    .filter((item) => viewState.poolFilter === "全部" || item.source === viewState.poolFilter);
  return sortTaskPoolBoardItems(visibleItems, viewState.poolSortMode);
}

function isTaskPoolDraftDirty(viewState: TaskPlanViewState): boolean {
  const persisted = JSON.stringify(viewState.state?.pool.items ?? []);
  const draft = JSON.stringify(viewState.poolDraft);
  return persisted !== draft;
}

function isTaskPlanPoolBusy(viewState: Pick<TaskPlanViewState, "busyAction">): boolean {
  return viewState.busyAction === "pool" || viewState.busyAction === "pool-generate";
}

function isTaskPoolBoardZone(value: string | undefined): value is TaskPoolBoardZone {
  return value === "mine" || value === "ai" || value === "candidate";
}

function moveTaskPlanPoolItemToZone(
  item: TaskPlanPoolItem,
  zone: TaskPoolBoardZone,
): TaskPlanPoolItem {
  return {
    ...item,
    zone,
    owner: zone === "ai" ? "ai" : item.owner === "ai" && zone === "candidate" ? "ai" : "me",
  };
}

function closeTaskPoolDrawerForItem(
  viewState: TaskPoolViewState,
  itemId: string,
): TaskPoolViewState {
  if (viewState.selectedCandidateId !== itemId) {
    return viewState;
  }
  return { ...viewState, selectedCandidateId: null };
}

function applyOptimisticTaskPoolItems(
  viewState: TaskPlanViewState,
  items: TaskPlanPoolItem[],
  stages?: TaskPlanStageItem[],
): TaskPlanViewState {
  if (!viewState.state) {
    return viewState;
  }
  return {
    ...viewState,
    busyAction: "pool",
    state: {
      ...viewState.state,
      pool: {
        ...viewState.state.pool,
        items,
        stages: stages ?? viewState.state.pool.stages ?? [],
      },
    },
    poolDraft: cloneTaskPlanPoolItems(items),
    error: null,
  };
}

function applyProjectWorkspaceMove(
  item: TaskPlanPoolItem,
  move: ProjectWorkspaceHierarchyMove,
  sourceIds: ReadonlySet<string>,
  orderMap: ReadonlyMap<string, number>,
): TaskPlanPoolItem {
  const movedItem = sourceIds.has(item.id) ? moveProjectWorkspaceItem(item, move) : item;
  const projectOrder = orderMap.get(item.id);
  return projectOrder === undefined ? movedItem : { ...movedItem, projectOrder };
}

function moveProjectWorkspaceItem(
  item: TaskPlanPoolItem,
  move: ProjectWorkspaceHierarchyMove,
): TaskPlanPoolItem {
  if (move.source.kind === "domain" || !move.source.taskIds.includes(item.id)) {
    return item;
  }
  if (move.source.kind === "project") {
    return { ...item, domain: normalizeProjectWorkspaceDomain(move.target.domain) };
  }
  if (move.target.kind === "stage") {
    return {
      ...item,
      domain: normalizeProjectWorkspaceDomain(move.target.domain),
      project: normalizeProjectWorkspaceProject(move.target.project),
      stageId: move.target.stageId,
    };
  }
  return {
    ...item,
    domain: normalizeProjectWorkspaceDomain(move.target.domain),
    project: normalizeProjectWorkspaceProject(move.target.kind === "domain" ? "" : move.target.project),
    stageId: move.target.stageId || item.stageId,
  };
}

function moveProjectWorkspaceAction(
  items: readonly TaskPlanPoolItem[],
  move: ProjectWorkspaceHierarchyMove,
): TaskPlanPoolItem[] {
  const action = findProjectWorkspaceAction(items, move.source.taskId, move.source.actionId);
  if (!action || !move.target.taskId || move.source.taskId === move.target.taskId) return items as TaskPlanPoolItem[];
  const withoutAction = items.map((item) => item.id === move.source.taskId
    ? { ...item, actions: (item.actions ?? []).filter((candidate) => candidate.id !== action.id) }
    : item);
  return withoutAction.map((item) => item.id === move.target.taskId
    ? { ...item, actions: orderProjectWorkspaceActions([...(item.actions ?? []), action]) }
    : item);
}

function findProjectWorkspaceAction(
  items: readonly TaskPlanPoolItem[],
  taskId: string,
  actionId: string,
): TaskPlanActionItem | null {
  return items.find((item) => item.id === taskId)?.actions?.find((action) => action.id === actionId) ?? null;
}

function orderProjectWorkspaceActions(actions: readonly TaskPlanActionItem[]): TaskPlanActionItem[] {
  return actions.map((action, order) => ({ ...action, order }));
}

function applyProjectWorkspaceCreate(
  items: readonly TaskPlanPoolItem[],
  stages: readonly TaskPlanStageItem[],
  request: ProjectWorkspaceCreateRequest,
): { items: TaskPlanPoolItem[]; stages: TaskPlanStageItem[]; feedback: string } | null {
  if (request.node.kind === "project") return createFromProject(items, stages, request);
  if (request.node.kind === "stage") return createFromStage(items, stages, request);
  if (request.node.kind === "task") return createFromTask(items, stages, request);
  if (request.node.kind === "action" && request.mode === "sibling") return createSiblingAction(items, stages, request);
  return null;
}

function applyProjectWorkspaceDelete(
  items: readonly TaskPlanPoolItem[],
  node: ProjectWorkspaceDragNode,
): TaskPlanPoolItem[] | null {
  if (node.kind === "task" && node.taskId) {
    const nextItems = items.filter((item) => item.id !== node.taskId);
    return nextItems.length === items.length ? null : nextItems;
  }
  if (node.kind !== "action" || !node.taskId || !node.actionId) return null;
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.id !== node.taskId) return item;
    const actions = (item.actions ?? []).filter((action) => action.id !== node.actionId);
    changed = actions.length !== (item.actions ?? []).length;
    return changed ? { ...item, actions: orderProjectWorkspaceActions(actions) } : item;
  });
  return changed ? nextItems : null;
}

function createFromProject(
  items: readonly TaskPlanPoolItem[],
  stages: readonly TaskPlanStageItem[],
  request: ProjectWorkspaceCreateRequest,
) {
  const domain = normalizeProjectWorkspaceDomain(request.node.domain) ?? TASK_POOL_UNGROUPED_DOMAIN;
  const project = request.mode === "sibling" ? nextProjectTitle(items, domain) : request.node.project;
  const stage = createStage(domain, project, nextStageOrder(stages, domain, project));
  return { items: [...items], stages: [...stages, stage], feedback: "已创建阶段。" };
}

function createFromStage(
  items: readonly TaskPlanPoolItem[],
  stages: readonly TaskPlanStageItem[],
  request: ProjectWorkspaceCreateRequest,
) {
  if (request.mode === "sibling") {
    const stage = createStage(request.node.domain, request.node.project, nextStageOrder(stages, request.node.domain, request.node.project));
    return { items: [...items], stages: [...stages, stage], feedback: "已创建同级阶段。" };
  }
  const task = createTask(request.node.domain, request.node.project, request.node.stageId, nextTaskOrder(items, request.node.stageId));
  return { items: [...items, task], stages: [...stages], feedback: "已创建阶段任务。" };
}

function createFromTask(
  items: readonly TaskPlanPoolItem[],
  stages: readonly TaskPlanStageItem[],
  request: ProjectWorkspaceCreateRequest,
) {
  if (request.mode === "child") {
    return { items: addActionToTask(items, request.node.taskId), stages: [...stages], feedback: "已创建行动。" };
  }
  const task = createTask(request.node.domain, request.node.project, request.node.stageId, nextTaskOrder(items, request.node.stageId));
  return { items: [...items, task], stages: [...stages], feedback: "已创建同阶段任务。" };
}

function createSiblingAction(
  items: readonly TaskPlanPoolItem[],
  stages: readonly TaskPlanStageItem[],
  request: ProjectWorkspaceCreateRequest,
) {
  return { items: addActionToTask(items, request.node.taskId), stages: [...stages], feedback: "已创建同级行动。" };
}

function createStage(domain: string, project: string, order: number): TaskPlanStageItem {
  return { id: `stage-${Date.now()}-${order}`, title: "新阶段", domain, project, order };
}

function createTask(domain: string, project: string, stageId: string, taskOrder: number): TaskPlanPoolItem {
  return { id: `task-${Date.now()}-${taskOrder}`, title: "新任务", priority: "mid", source: "手动新增", domain, project, stageId, taskOrder };
}

function addActionToTask(items: readonly TaskPlanPoolItem[], taskId: string): TaskPlanPoolItem[] {
  return items.map((item) => item.id === taskId
    ? { ...item, actions: [...(item.actions ?? []), { id: `action-${Date.now()}`, title: "新行动", order: item.actions?.length ?? 0 }] }
    : item);
}

function nextStageOrder(stages: readonly TaskPlanStageItem[], domain: string, project: string): number {
  return stages.filter((stage) => stage.domain === domain && stage.project === project).length;
}

function nextTaskOrder(items: readonly TaskPlanPoolItem[], stageId: string): number {
  return items.filter((item) => item.stageId === stageId).length;
}

function nextProjectTitle(items: readonly TaskPlanPoolItem[], domain: string): string {
  const count = new Set(items.filter((item) => item.domain === domain).map((item) => item.project)).size;
  return `新项目 ${count + 1}`;
}

function normalizeProjectWorkspaceDomain(value: string): string | undefined {
  return value && value !== TASK_POOL_UNGROUPED_DOMAIN ? value : undefined;
}

function normalizeProjectWorkspaceProject(value: string): string | undefined {
  return value && value !== TASK_POOL_UNGROUPED_PROJECT ? value : undefined;
}

function createProjectWorkspaceScheduleItem(
  task: TaskPlanPoolItem,
  currentItems: readonly TaskPlanScheduleItem[],
): TaskPlanScheduleItem {
  return {
    id: task.id,
    title: task.title,
    startTime: readNextProjectScheduleStartTime(currentItems.length),
    priority: normalizeTaskPlanPriority(task.priority),
  };
}

function applyOptimisticProjectSchedule(
  viewState: TaskPlanViewState,
  items: readonly TaskPlanScheduleItem[],
  feedback: string,
): TaskPlanViewState {
  if (!viewState.state) return viewState;
  return {
    ...viewState,
    busyAction: "save",
    state: { ...viewState.state, schedule: { ...viewState.state.schedule, items: [...items] } },
    scheduleDraft: items.map((item) => ({ ...item })),
    feedback,
    error: null,
  };
}

function applySavedProjectSchedule(
  viewState: TaskPlanViewState,
  schedule: TaskPlanScheduleState,
  feedback: string,
): TaskPlanViewState {
  if (!viewState.state) return viewState;
  return {
    ...viewState,
    state: { ...viewState.state, schedule },
    scheduleDraft: schedule.items.map((item) => ({ ...item })),
    busyAction: null,
    feedback,
    error: null,
  };
}

function readNextProjectScheduleStartTime(index: number): string {
  return ["09:00", "10:30", "14:00", "16:00", "19:30"][index] ?? "待排期";
}

function applyTaskPoolGeneratedState(
  viewState: TaskPlanViewState,
  result: { state: TaskPlanState; generationRecord: TaskPoolGenerationRecord | null },
): TaskPlanViewState {
  return {
    ...viewState,
    status: "ready",
    state: result.state,
    poolDraft: cloneTaskPlanPoolItems(result.state.pool.items),
    poolDraftTouched: false,
    busyAction: null,
    feedback: result.generationRecord ? "已根据新日记生成候选任务。" : "没有上次生成之后的新日记。",
    error: null,
  };
}

function renderTaskPlanPoolFilters(activeFilter: TaskPlanViewState["poolFilter"], disabled: boolean): string {
  return TASK_PLAN_SOURCE_LABELS.map((source) => `
    <button
      type="button"
      class="workspace-task-plan-poster__pool-filter${activeFilter === source ? " is-active" : ""}"
      data-task-plan-pool-filter="${source}"
      ${disabled ? "disabled" : ""}
    >${source}</button>
  `).join("");
}

function renderTaskPlanPoolSort(activeSortMode: TaskPoolBoardSortMode, disabled: boolean): string {
  return `
    <label class="workspace-task-plan-poster__pool-sort">
      <span>排序</span>
      <select data-task-plan-pool-sort ${disabled ? "disabled" : ""}>
        ${(Object.keys(TASK_POOL_SORT_LABELS) as TaskPoolBoardSortMode[]).map((mode) => `
          <option value="${mode}" ${mode === activeSortMode ? "selected" : ""}>${TASK_POOL_SORT_LABELS[mode]}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderTaskPlanPoolRows(items: readonly TaskPlanPoolItem[], editMode: boolean, disabled: boolean): string {
  return items.map((item) => {
    const priority = normalizeTaskPlanPriority(item.priority);
    const priorityLabel = TASK_PLAN_PRIORITY_LABELS[priority];
    return editMode
      ? `
        <div class="workspace-task-plan-poster__pool-row workspace-task-plan-poster__pool-row--edit" data-task-plan-pool-row="${escapeHtml(item.id)}">
          <input class="workspace-task-plan-poster__timeline-input" data-task-plan-pool-title-input="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}" ${disabled ? "disabled" : ""} />
          <select class="workspace-task-plan-poster__timeline-select" data-task-plan-pool-source-input="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>
            ${TASK_PLAN_SOURCE_LABELS.filter((source) => source !== "全部").map((source) => `
              <option value="${source}" ${item.source === source ? "selected" : ""}>${source}</option>
            `).join("")}
          </select>
          <select class="workspace-task-plan-poster__timeline-select" data-task-plan-pool-priority-input="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>
            ${(["high", "mid", "low", "cool", "neutral"] as const).map((priority) => `
              <option value="${priority}" ${priority === normalizeTaskPlanPriority(item.priority) ? "selected" : ""}>${TASK_PLAN_PRIORITY_LABELS[priority]}</option>
            `).join("")}
          </select>
          <button type="button" class="workspace-task-plan-poster__timeline-remove" data-task-plan-pool-remove="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>删除</button>
        </div>
      `
      : `
        <div class="workspace-task-plan-poster__pool-row">
          <span class="workspace-task-plan-poster__pool-caret">▸</span>
          <span class="workspace-task-plan-poster__pool-text">${escapeHtml(item.title)}</span>
          <span class="workspace-task-plan-poster__pool-meta">
            <span class="workspace-task-plan-poster__source-pill">${escapeHtml(item.source)}</span>
            <span class="workspace-task-plan-poster__pill workspace-task-plan-poster__pill--${priority}">${priorityLabel}</span>
          </span>
        </div>
      `;
  }).join("");
}

function getTaskPoolDomainLabels(items: readonly TaskPlanPoolItem[]): string[] {
  return Array.from(
    new Set(items.map((item) => getTaskPoolDomainName(item)).filter(Boolean)),
  );
}

function getTaskPoolDomainSlug(label: string): string {
  if (label === "健康") {
    return TASK_POOL_HEALTH_DOMAIN_SLUG;
  }
  return encodeURIComponent(label);
}

function resolveTaskPoolPageTitle(domainSlug: string | null): string {
  if (!domainSlug) {
    return "\u4efb\u52a1\u6c60";
  }
  return resolveTaskPoolDomainLabel(domainSlug);
}

function resolveTaskPoolDomainLabel(domainSlug: string): string {
  if (TASK_POOL_DOMAIN_LABEL_OVERRIDES[domainSlug]) {
    return TASK_POOL_DOMAIN_LABEL_OVERRIDES[domainSlug];
  }
  try {
    return decodeURIComponent(domainSlug);
  } catch {
    return domainSlug;
  }
}

function filterTaskPoolItemsByDomain(
  items: readonly TaskPlanPoolItem[],
  domainSlug: string | null,
): TaskPlanPoolItem[] {
  if (!domainSlug || domainSlug === TASK_POOL_HEALTH_DOMAIN_SLUG) {
    return [...items];
  }
  const domainLabel = resolveTaskPoolDomainLabel(domainSlug);
  return items.filter((item) => getTaskPoolDomainName(item) === domainLabel);
}

function getHealthTaskPoolItems(
  taskPlanViewState: TaskPlanViewState,
): TaskPlanPoolItem[] {
  return (taskPlanViewState.state?.pool.items ?? []).filter(
    (item) => getTaskPoolDomainName(item) === "健康",
  );
}

function createEmptyHealthSleepLatestState(): HealthDomainSleepLatestState {
  return {
    bedTime: null,
    wakeTime: null,
    totalSleep: null,
    deepSleepQuality: null,
    deepSleepMinutes: null,
    restingHeartRate: null,
    sleepScore: null,
    awakeDuration: null,
    sleepAverageHeartRate: null,
    steps: null,
    intensityMinutes: null,
  };
}

function createEmptyHealthSleepTrendsState(): HealthDomainSleepTrendsState {
  return {
    bedTimes: [],
    wakeTimes: [],
    deepSleepMinutes: [],
    sleepScores: [],
    steps: [],
    intensityMinutes: [],
  };
}

function readHealthConnectionSummary(
  healthViewState: HealthDomainViewState,
): string {
  const connection = healthViewState.state?.connection;
  if (!connection) {
    return healthViewState.error ?? "\u5c1a\u672a\u8fde\u63a5";
  }
  if (connection.lastSyncedAt) {
    return `最近同步：${connection.lastSyncedAt}`;
  }
  if (connection.lastError) {
    return connection.lastError;
  }
  return connection.status === "connected"
    ? "\u5df2\u8fde\u63a5\uff0c\u7b49\u5f85\u9996\u6b21\u540c\u6b65"
    : "\u5c1a\u672a\u8fde\u63a5";
}

function renderWorkLogView(
  state: WorkspaceDocsState,
  options: {
    expandedDomains: ReadonlySet<string>;
    expandedWorkspaceProjects: ReadonlySet<string>;
    draftDocumentId: string | null;
    draftHtml: string;
    graphyPosition: WorkspaceGraphyPosition;
    searchQuery: string;
    gallerySelectedPath: string | null;
    taskPlanState?: TaskPlanViewState;
    deleteDialog?: WorkspaceDocDeleteDialog | null;
  },
): string {
  const statusView = renderWorkLogStatusView(state);
  if (statusView) return statusView;
  const selected = state.documents.find((item) => item.id === state.selectedId) ?? state.documents[0];
  if (!selected) {
    return renderWorkLogPlaceholder("\u8fd8\u6ca1\u6709\u53ef\u8bfb\u53d6\u7684\u6587\u6863\u3002");
  }
  return renderWorkLogReadyView(state, options, selected);
}

function renderWorkLogReadyView(
  state: WorkspaceDocsState,
  options: {
    expandedDomains: ReadonlySet<string>;
    expandedWorkspaceProjects: ReadonlySet<string>;
    draftDocumentId: string | null;
    draftHtml: string;
    graphyPosition: WorkspaceGraphyPosition;
    searchQuery: string;
    gallerySelectedPath: string | null;
    taskPlanState?: TaskPlanViewState;
    deleteDialog?: WorkspaceDocDeleteDialog | null;
  },
  selected: WorkspaceDocument,
): string {
  const visibleDocuments = filterWorkspaceDocuments(state.documents, options.searchQuery);
  const currentHtml = options.draftDocumentId === selected.id ? options.draftHtml : selected.html;
  return `
    <section class="workspace-view workspace-view--work-log" data-workspace-view="work-log">
      <div class="workspace-log-shell">
        <aside class="workspace-log-tree" data-workspace-tree-panel>
          <div class="workspace-log-tree__search">
            ${renderIcon("search", { size: 16 })}
            <input
              type="search"
              value="${escapeHtml(options.searchQuery)}"
              placeholder="\u641c\u7d22"
              aria-label="\u641c\u7d22\u6587\u6863"
              data-workspace-tree-search
            />
          </div>
          <header class="workspace-log-tree__header">
            <div class="workspace-log-tree__title">
              <span>\u76ee\u5f55</span>
            </div>
            <div class="workspace-log-tree__actions">
              <button type="button" class="workspace-log-tree__icon-button" aria-label="\u65b0\u5efa">${renderIcon("plus", { size: 15 })}</button>
              <button type="button" class="workspace-log-tree__icon-button" aria-label="\u7b5b\u9009">${renderIcon("settings", { size: 15 })}</button>
            </div>
          </header>
          <nav class="wiki-page__sidebar-links workspace-doc-tree" data-workspace-tree>
            ${renderWorkspaceDocTree(visibleDocuments, selected.id, options.expandedDomains, options.expandedWorkspaceProjects)}
          </nav>
          ${options.deleteDialog ? renderWorkspaceDocDeleteDialog(options.deleteDialog) : ""}
        </aside>
        <div class="workspace-doc-sidebar-resize panel-resize-handle" data-workspace-tree-resize></div>
        ${renderWorkspaceWikiDocument(
          selected,
          currentHtml,
          options.graphyPosition,
          visibleDocuments,
          options.gallerySelectedPath,
          options.taskPlanState?.state?.pool.items ?? [],
          options.taskPlanState?.state?.pool.stages ?? [],
          options.taskPlanState?.state?.schedule.items ?? [],
        )}
      </div>
    </section>
  `;
}

function renderWorkLogStatusView(state: WorkspaceDocsState): string | null {
  if (state.status === "loading" && state.documents.length === 0) {
    return renderWorkLogPlaceholder("\u6b63\u5728\u8bfb\u53d6\u9886\u57df / \u9879\u76ee / \u5de5\u4f5c\u65e5\u5fd7\u6587\u6863...");
  }
  if (state.status === "error") {
    return renderWorkLogPlaceholder(state.error ?? "\u672a\u77e5\u9519\u8bef");
  }
  return null;
}

function renderWorkLogPlaceholder(subtitle: string): string {
  return `
    <section class="workspace-view workspace-view--work-log" data-workspace-view="work-log">
      <section class="workspace-panel workspace-panel--pool-placeholder">
        <div class="eyebrow">DOCUMENTS</div>
        <h2>\u5de5\u4f5c\u65e5\u5fd7</h2>
        <p class="workspace-page__subtitle">${escapeHtml(subtitle)}</p>
      </section>
    </section>
  `;
}

function selectWorkspaceDocumentId(documents: readonly WorkspaceDocument[], currentId: string): string {
  if (documents.some((item) => item.id === currentId)) {
    return currentId;
  }
  return documents.find((item) => item.id === DEFAULT_WORKSPACE_DOC_ID)?.id ?? documents[0]?.id ?? "";
}

function mergeWorkspaceDocumentSummaries(
  summaries: readonly WorkspaceDocument[],
  previousDocuments: readonly WorkspaceDocument[],
): WorkspaceDocument[] {
  const previousById = new Map(previousDocuments.map((item) => [item.id, item]));
  return summaries.map((summary) => {
    const previous = previousById.get(summary.id);
    if (!previous?.contentLoaded) {
      return summary;
    }
    return {
      ...summary,
      title: previous.title ?? summary.title,
      html: previous.html,
      raw: previous.raw,
      modifiedAt: previous.modifiedAt ?? summary.modifiedAt,
      contentLoaded: true,
    };
  });
}

function readWorkspaceDraftHtml(documents: readonly WorkspaceDocument[], selectedId: string): string {
  return documents.find((item) => item.id === selectedId)?.html ?? "";
}

function renderWorkspaceWikiDocument(
  document: WorkspaceDocument,
  html: string,
  graphyPosition: WorkspaceGraphyPosition,
  documents: readonly WorkspaceDocument[],
  gallerySelectedPath: string | null,
  taskPoolItems: readonly TaskPlanPoolItem[],
  taskPoolStages: readonly TaskPlanStageItem[],
  scheduleItems: readonly TaskPlanScheduleItem[],
): string {
  if (isExecutionWorkbenchDocument(document)) {
    return renderExecutionWorkbenchDocument(document);
  }
  if (isProjectWorkspaceDocument(document)) {
    return renderProjectWorkspaceDocument(document, taskPoolItems, taskPoolStages, scheduleItems);
  }
  if (isWorkspaceLibraryPage(document)) {
    return renderWorkspaceLibraryDocument(document, documents, gallerySelectedPath);
  }
  const title = document.title ?? document.label;
  const isLoading = document.contentLoaded !== true;
  const articleHtml = isLoading
    ? renderWorkspaceWikiLoadingState(title)
    : withKnowledgePreviewLinks(ensureWorkspaceDocumentTitle(html, title) || renderWorkspaceWikiEmptyState(title));
  const editable = isLoading ? "false" : "true";
  return `
    <section class="workspace-log-wiki-entry wiki-page" data-workspace-wiki-open data-wiki-current-path="${escapeHtml(document.path)}">
      <main class="wiki-page__main">
        <div class="wiki-page__body" data-wiki-body>
          <div class="wiki-page__article-layout" data-workspace-article-layout>
            ${renderWorkspaceGraphyPanel(graphyPosition)}
            ${renderWorkLogBlockToolbar()}
            <article class="wiki-page__article markdown-rendered workspace-doc-editor" data-wiki-article data-workspace-doc-editor data-workspace-doc-content contenteditable="${editable}" spellcheck="false" aria-label="${escapeHtml(title)}">${articleHtml}</article>
          </div>
        </div>
      </main>
    </section>
  `;
}

function ensureWorkspaceDocumentTitle(html: string, title: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = trimmed;
  if (wrapper.querySelector("h1, h2, h3")) {
    return wrapper.innerHTML;
  }
  const titleNode = document.createElement("h1");
  titleNode.textContent = title;
  wrapper.prepend(titleNode);
  return wrapper.innerHTML;
}

function readWorkspaceDocumentTitle(html: string): string | null {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const title = wrapper.querySelector("h1, h2, h3")?.textContent?.trim() ?? "";
  return title || null;
}

function renderWorkspaceGraphyPanel(position: WorkspaceGraphyPosition): string {
  return `
    <aside
      class="workspace-work-log-graphy"
      data-workspace-graphy
      style="--workspace-graphy-right: ${position.x}px; --workspace-graphy-top: ${position.y}px;"
    >
      <div class="workspace-work-log-graphy__handle" data-workspace-graphy-handle>
        <span>Graphy</span>
      </div>
      <section data-workspace-page-graph></section>
    </aside>
  `;
}

function renderWorkspaceWikiEmptyState(title: string): string {
  return `
    <div class="wiki-page__empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>This page exists, but it does not contain rendered article content yet.</p>
    </div>
  `;
}

function renderWorkspaceWikiLoadingState(title: string): string {
  return `
    <div class="wiki-page__empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>正在读取当前文档...</p>
    </div>
  `;
}

function filterWorkspaceDocuments(documents: readonly WorkspaceDocument[], query: string): WorkspaceDocument[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...documents];
  }
  const lookup = buildWorkspaceDocumentLookup(documents);
  const includedIds = new Set<string>();
  for (const document of documents) {
    if (!matchesWorkspaceDocumentQuery(document, normalizedQuery)) {
      continue;
    }
    includeWorkspaceDocumentHierarchy(includedIds, lookup, document);
  }

  return documents.filter((item) => includedIds.has(item.id));
}

function renderLifeStat(title: string, detail: string, value: string): string {
  const meter = value.endsWith("%") ? `<div class="workspace-progress workspace-progress--compact"><span style="width:${value}"></span></div>` : "";
  return `<article class="workspace-life-stat"><div><strong>${title}</strong><p>${detail}</p></div><div class="workspace-life-stat__value">${meter}<span>${value}</span></div></article>`;
}

function renderGanttRow(title: string, labels: readonly string[]): string {
  return `<div class="workspace-gantt__row"><div class="workspace-gantt__label">${title}</div><div class="workspace-gantt__bars">${labels.map((label, index) => `<span class="workspace-gantt__bar workspace-gantt__bar--${(index % 3) + 1}">${label}</span>`).join("")}</div></div>`;
}

function renderDeliverableCard(title: string, status: string, deadline: string): string {
  return `<article class="workspace-deliverable-card"><div class="workspace-deliverable-card__header"><strong>${title}</strong><span class="workspace-chip">${status}</span></div><p>${deadline}</p></article>`;
}

function renderTimelineItem(time: string, title: string): string {
  return `<article class="workspace-timeline-item"><time>${time}</time><span>${title}</span><span class="workspace-link-pill">\u5efa\u8bae</span></article>`;
}

function tabNeedsTaskPlanState(tab: WorkspaceTab, docsState?: WorkspaceDocsState): boolean {
  if (tab === "task-plan" || tab === "task-pool") {
    return true;
  }
  if (tab !== "work-log" || !docsState) {
    return false;
  }
  const selected = docsState.documents.find((item) => item.id === docsState.selectedId);
  return selected ? isProjectWorkspaceDocument(selected) : false;
}

function shouldMountWorkspaceGraphy(tab: WorkspaceTab, docsState: WorkspaceDocsState): boolean {
  if (tab !== "work-log") {
    return false;
  }
  const selected = docsState.documents.find((item) => item.id === docsState.selectedId);
  return selected?.contentLoaded === true;
}

function normalizeWorkspaceTab(value: string | undefined): WorkspaceTab {
  return value === "task-plan" || value === "task-pool" || value === "work-log" ? value : "task-plan";
}

function parseWorkspaceRouteState(routeSection: string | undefined): WorkspaceRouteState {
  const normalizedSection = (routeSection ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalizedSection || normalizedSection === "project-progress") {
    return createWorkspaceRouteState("task-plan");
  }
  if (normalizedSection.startsWith("task-pool/domain/")) {
    const domainSlug = normalizedSection.slice("task-pool/domain/".length).trim();
    return createWorkspaceRouteState("task-pool", domainSlug || null);
  }
  if (normalizedSection === "toolbox" || normalizedSection.startsWith("toolbox/")) {
    return createWorkspaceRouteState("work-log");
  }
  if (isWorkspaceRouteTab(normalizedSection)) {
    return createWorkspaceRouteState(normalizedSection);
  }
  return createWorkspaceRouteState("task-plan");
}

function buildWorkspaceHash(tab: WorkspaceTab, taskPoolDomainSlug: string | null = null): string {
  if (tab === "task-pool" && taskPoolDomainSlug) {
    return `#/workspace/task-pool/domain/${taskPoolDomainSlug}`;
  }
  return `#/workspace/${tab}`;
}

function buildWorkspaceDocumentLookup(documents: readonly WorkspaceDocument[]): {
  root: WorkspaceDocument | undefined;
  domainByLabel: Map<string, WorkspaceDocument>;
  projectByKey: Map<string, WorkspaceDocument>;
} {
  return {
    root: documents.find((item) => item.kind === "root"),
    domainByLabel: new Map(documents.filter((item) => item.kind === "domain").map((item) => [item.label, item])),
    projectByKey: new Map(
      documents
        .filter((item) => item.kind === "project" && item.domain && item.project)
        .map((item) => [`${item.domain}/${item.project}`, item] as const),
    ),
  };
}

function matchesWorkspaceDocumentQuery(document: WorkspaceDocument, normalizedQuery: string): boolean {
  return [document.label, document.path, document.title ?? "", document.raw]
    .join("\n")
    .toLowerCase()
    .includes(normalizedQuery);
}

function includeWorkspaceDocumentHierarchy(
  includedIds: Set<string>,
  lookup: {
    root: WorkspaceDocument | undefined;
    domainByLabel: Map<string, WorkspaceDocument>;
    projectByKey: Map<string, WorkspaceDocument>;
  },
  document: WorkspaceDocument,
): void {
  includedIds.add(document.id);
  if (lookup.root) {
    includedIds.add(lookup.root.id);
  }
  if (document.domain) {
    const domainDoc = lookup.domainByLabel.get(document.domain);
    if (domainDoc) {
      includedIds.add(domainDoc.id);
    }
  }
  if (document.domain && document.project) {
    const projectDoc = lookup.projectByKey.get(`${document.domain}/${document.project}`);
    if (projectDoc) {
      includedIds.add(projectDoc.id);
    }
  }
}

function createWorkspaceRouteState(
  activeTab: WorkspaceTab,
  taskPoolDomainSlug: string | null = null,
): WorkspaceRouteState {
  return { activeTab, taskPoolDomainSlug };
}

function isWorkspaceRouteTab(value: string): value is WorkspaceTab {
  return value === "task-plan" || value === "task-pool" || value === "work-log";
}

function createDefaultTaskPlanViewState(): TaskPlanViewState {
  return {
    status: "idle",
    state: null,
    roadmapWindow: "current",
    roadmapView: "week",
    textDraft: "",
    statusDraft: "",
    poolDraft: [],
    poolEditMode: false,
    poolDraftTouched: false,
    poolFilter: "全部",
    poolSortMode: "created-desc",
    scheduleDraft: [],
    scheduleEditMode: false,
    splitRatio: readTaskPlanSplitRatio(),
    busyAction: null,
    feedback: null,
    error: null,
    pendingScheduleFocusId: null,
    draggingScheduleId: null,
    pendingPoolFocusId: null,
  };
}

function createDefaultTaskPoolViewState(): TaskPoolViewState {
  return {
    mode: "list",
    treeLevel: "domain",
    selectedOptions: [],
    isSidebarCollapsed: false,
    sidebarWidth: 0,
    zoomPercent: 90,
    selectedNode: null,
    editingNode: null,
    editValue: "",
    draggingTaskId: null,
    dropProjectKey: null,
    selectedCandidateId: null,
    isGenerationRecordOpen: false,
    isWorkflowRecorderOpen: false,
    workflowRecorderDraft: "",
    workflowRecorderFeedback: null,
    workflowRecorderBusy: false,
    sortModes: {
      mine: "created-desc",
      ai: "created-desc",
      candidate: "created-desc",
    },
    groupModes: {
      mine: "none",
      ai: "none",
      candidate: "none",
    },
  };
}

function isTaskPoolBoardSortMode(value: string | undefined): value is TaskPoolBoardSortMode {
  return value === "created-desc"
    || value === "created-asc"
    || value === "due-asc"
    || value === "due-desc"
    || value === "priority-desc"
    || value === "priority-asc";
}

function isTaskPoolBoardGroupMode(value: string | undefined): value is TaskPoolBoardGroupMode {
  return value === "none" || value === "project" || value === "priority";
}

function createDefaultHealthDomainViewState(): HealthDomainViewState {
  return {
    status: "idle",
    state: null,
    activeImportTab: "account",
    isImportModalOpen: false,
    accountDraft: {
      username: "",
      verificationCode: "",
      captchaCode: "",
      relativeUid: "",
    },
    apiDraft: {
      tokenJson: "",
      apiBaseUrl: "",
      relativeUid: "",
    },
    busyAction: null,
    feedback: null,
    error: null,
    captchaChallenge: null,
    qrLogin: null,
  };
}

function createDefaultTaskPlanState(): TaskPlanState {
  return {
    voice: {
      transcript: "今天要先完成需求文档，再和产品确认功能逻辑，下午整理用户反馈，晚上复盘。",
      audioPath: null,
      updatedAt: null,
    },
    statusSummary: "今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。",
    pool: {
      items: [
        { id: "pool-1", title: "完成需求文档初稿", priority: "high", source: "文字输入", domain: "产品设计", project: "工作台改版" },
        { id: "pool-2", title: "与开发确认功能逻辑", priority: "high", source: "文字输入", domain: "产品设计", project: "任务同步" },
        { id: "pool-3", title: "整理用户反馈并归类", priority: "mid", source: "近日状态", domain: "用户研究", project: "反馈归类" },
        { id: "pool-4", title: "复盘今日完成情况", priority: "low", source: "AI 生成", domain: "个人成长", project: "日常复盘" },
      ],
      generationRecords: [],
    },
    schedule: {
      generationId: null,
      revisionId: null,
      confirmed: false,
      items: [
        { id: "schedule-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
        { id: "schedule-2", title: "与开发确认功能逻辑", startTime: "10:30", priority: "high" },
        { id: "schedule-3", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" },
      ],
    },
    roadmap: {
      view: "week",
      windowStart: "2024-05-12",
      topLabel: "领域 / 产品设计",
      windowLabel: "2024年5月",
      groups: [
        {
          id: "roadmap-group-1",
          title: "1. 产品 & 设计",
          items: [
            { id: "roadmap-item-1", title: "工作台改版" },
            { id: "roadmap-item-2", title: "任务追踪页优化" },
          ],
        },
        {
          id: "roadmap-group-2",
          title: "2. 用户研究",
          items: [
            { id: "roadmap-item-3", title: "用户访谈洞察" },
            { id: "roadmap-item-4", title: "访谈提要" },
          ],
        },
        {
          id: "roadmap-group-3",
          title: "3. 个人成长",
          items: [
            { id: "roadmap-item-5", title: "效率系统复盘" },
            { id: "roadmap-item-6", title: "阅读沉淀" },
          ],
        },
      ],
    },
    morningFlow: {
      voiceDone: false,
      diaryDone: false,
      planningDone: false,
      fineTuneDone: false,
    },
  };
}

function buildTaskPlanRoadmapHeaders(windowStart: string): string[] {
  const baseDate = new Date(windowStart);
  const start = Number.isNaN(baseDate.getTime()) ? new Date("2024-05-12T00:00:00.000Z") : baseDate;
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const weekDay = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] ?? "周一";
    return `${date.getMonth() + 1}/${date.getDate()} ${weekDay}`;
  });
}

async function fetchHealthDomainState(): Promise<HealthDomainState> {
  const response = await fetch("/api/workspace/health/state");
  const payload = (await response.json()) as WorkspaceHealthStatePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readWorkspaceHealthError(payload.error, "健康数据读取失败"));
  }
  return payload.data.state;
}

async function postHealthVerificationCode(
  username: string,
  captchaCode: string,
): Promise<
  | { kind: "sent"; maskedPhone: string; ticketReady: boolean; message: string | null }
  | { kind: "captcha_required"; message: string; captchaImageDataUrl: string }
> {
  const response = await fetch("/api/workspace/health/connection/account/send-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, captchaCode }),
  });
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  const challenge = readWorkspaceHealthCaptchaChallenge(payload.error);
  if (challenge) {
    return {
      kind: "captcha_required",
      message: readWorkspaceHealthError(payload.error, "获取验证码前需要先完成图形验证码。"),
      captchaImageDataUrl: challenge,
    };
  }
  if (!response.ok || !payload.success || !payload.data?.maskedPhone) {
    throw new Error(readWorkspaceHealthError(payload.error, "验证码发送失败"));
  }
  return {
    kind: "sent",
    maskedPhone: payload.data.maskedPhone,
    ticketReady: payload.data.ticketReady !== false,
    message:
      typeof payload.data.message === "string" && payload.data.message.trim()
        ? payload.data.message
        : null,
  };
}

async function postHealthAccountConnection(
  draft: HealthDomainViewState["accountDraft"],
): Promise<
  | { kind: "connected"; state: HealthDomainState }
  | { kind: "captcha_required"; message: string; captchaImageDataUrl: string }
> {
  const response = await fetch("/api/workspace/health/connection/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  const challenge = readWorkspaceHealthCaptchaChallenge(payload.error);
  if (challenge) {
    return {
      kind: "captcha_required",
      message: readWorkspaceHealthError(payload.error, "提交图形验证码后再完成登录。"),
      captchaImageDataUrl: challenge,
    };
  }
  if (!response.ok || !payload.success || !payload.data?.state) {
    throw new Error(readWorkspaceHealthError(payload.error, "健康账号连接失败"));
  }
  return { kind: "connected", state: payload.data.state };
}

async function postHealthApiConnection(
  draft: HealthDomainViewState["apiDraft"],
): Promise<HealthDomainState> {
  const response = await fetch("/api/workspace/health/connection/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  if (!response.ok || !payload.success || !payload.data?.state) {
    throw new Error(readWorkspaceHealthError(payload.error, "健康 API 连接失败"));
  }
  return payload.data.state;
}

async function postHealthQrLoginStart(): Promise<HealthDomainQrLoginState> {
  const response = await fetch("/api/workspace/health/connection/qr/start", {
    method: "POST",
  });
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  if (!response.ok || !payload.success || !payload.data?.sessionId || !payload.data.qrImageUrl) {
    throw new Error(readWorkspaceHealthError(payload.error, "二维码生成失败"));
  }
  return {
    sessionId: payload.data.sessionId,
    qrImageUrl: payload.data.qrImageUrl,
    loginUrl: payload.data.loginUrl ?? null,
  };
}

async function getHealthQrLoginStatus(
  sessionId: string,
  relativeUid: string,
): Promise<
  | { status: "pending" }
  | { status: "connected"; state: HealthDomainState }
> {
  const params = new URLSearchParams();
  const normalizedRelativeUid = relativeUid.trim();
  if (normalizedRelativeUid) {
    params.set("relativeUid", normalizedRelativeUid);
  }
  const query = params.toString();
  const response = await fetch(
    `/api/workspace/health/connection/qr/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`,
  );
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  if (!response.ok || !payload.success || !payload.data?.status) {
    throw new Error(readWorkspaceHealthError(payload.error, "二维码登录失败"));
  }
  if (payload.data.status === "pending") {
    return { status: "pending" };
  }
  if (!payload.data.state) {
    throw new Error("二维码登录成功后未返回健康连接状态");
  }
  return { status: "connected", state: payload.data.state };
}

async function postHealthSync(): Promise<HealthDomainState> {
  const response = await fetch("/api/workspace/health/sync", {
    method: "POST",
  });
  const payload = (await response.json()) as WorkspaceHealthActionPayload;
  if (!response.ok || !payload.success || !payload.data?.state) {
    throw new Error(readWorkspaceHealthError(payload.error, "健康数据同步失败"));
  }
  return payload.data.state;
}

async function fetchTaskPlanState(): Promise<TaskPlanState> {
  const response = await fetch("/api/task-plan/state");
  const payload = (await response.json()) as TaskPlanStatePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务计划读取失败"));
  }
  return payload.data.state;
}

async function fetchTaskPlanRoadmap(
  windowName: TaskPlanRoadmapWindow,
  view: TaskPlanRoadmapView,
): Promise<TaskPlanRoadmapState> {
  const response = await fetch(`/api/task-plan/roadmap?window=${windowName}&view=${view}`);
  const payload = (await response.json()) as TaskPlanRoadmapPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务路线图读取失败"));
  }
  return payload.data.roadmap;
}

async function postTaskPlanVoice(input: {
  filename: string;
  mimeType: string;
  audioBase64: string;
}): Promise<TaskPlanState> {
  const response = await fetch("/api/task-plan/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as TaskPlanVoicePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "语音转写失败"));
  }
  return payload.data.state;
}

async function putTaskPlanText(text: string): Promise<TaskPlanState> {
  const response = await fetch("/api/task-plan/text", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = (await response.json()) as TaskPlanStateMutationPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "文本输入保存失败"));
  }
  return payload.data.state;
}

async function putTaskPlanStatus(statusSummary: string): Promise<TaskPlanState> {
  const response = await fetch("/api/task-plan/status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ statusSummary }),
  });
  const payload = (await response.json()) as TaskPlanStateMutationPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "近日状态保存失败"));
  }
  return payload.data.state;
}

async function putTaskPlanPool(
  items: readonly TaskPlanPoolItem[],
  stages?: readonly TaskPlanStageItem[],
): Promise<TaskPlanState> {
  const body = stages ? { items, stages } : { items };
  const response = await fetch("/api/task-plan/pool", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TaskPlanStateMutationPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务池保存失败"));
  }
  return payload.data.state;
}

async function postTaskPlanStatusRefresh(): Promise<TaskPlanState> {
  const response = await fetch("/api/task-plan/status/refresh", {
    method: "POST",
  });
  const payload = (await response.json()) as TaskPlanStateMutationPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "近日状态刷新失败"));
  }
  return payload.data.state;
}

async function postTaskPlanGenerate(): Promise<TaskPlanScheduleState> {
  const response = await fetch("/api/task-plan/generate", {
    method: "POST",
  });
  const payload = (await response.json()) as TaskPlanSchedulePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务计划生成失败"));
  }
  return payload.data.schedule;
}

async function postTaskPoolGenerate(): Promise<{
  state: TaskPlanState;
  generationRecord: TaskPoolGenerationRecord | null;
}> {
  const response = await fetch("/api/task-plan/pool/generate", {
    method: "POST",
  });
  const payload = (await response.json()) as TaskPoolGeneratePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务池候选生成失败"));
  }
  return payload.data;
}

async function postWorkflowRecorderRecord(input: {
  text: string;
  marker: "normal" | "issue" | "end-node";
  attachments: string[];
}): Promise<NonNullable<WorkflowRecorderPayload["data"]>> {
  const response = await fetch("/api/workflow-recorder/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as WorkflowRecorderPayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "当前执行记录归档失败"));
  }
  return payload.data;
}

async function putTaskPlanSchedule(
  items: readonly TaskPlanScheduleItem[],
  confirmed: boolean,
): Promise<TaskPlanScheduleState> {
  const response = await fetch("/api/task-plan/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, confirmed }),
  });
  const payload = (await response.json()) as TaskPlanSchedulePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(readTaskPlanError(payload.error, "任务计划保存失败"));
  }
  return payload.data.schedule;
}

function normalizeTaskPlanRoadmapWindow(value: string | undefined): TaskPlanRoadmapWindow {
  return value === "prev" || value === "next" ? value : "current";
}

function normalizeTaskPlanPriority(value: string): TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral"
    ? value
    : "neutral";
}

function readTaskPoolTreeNodeIdentity(element: HTMLElement): TaskPoolTreeNodeIdentity | null {
  const type = element.dataset.taskPoolTreeNodeType;
  if (type !== "domain" && type !== "project" && type !== "task") {
    return null;
  }
  return {
    type,
    domain: element.dataset.taskPoolTreeNodeDomain ?? "",
    project: element.dataset.taskPoolTreeNodeProject ?? "",
    taskId: type === "task" ? element.dataset.taskPoolTreeNodeTaskId ?? null : null,
  };
}

function isSameTaskPoolTreeNode(
  currentNode: TaskPoolTreeNodeIdentity | null,
  nextNode: TaskPoolTreeNodeIdentity,
): boolean {
  return Boolean(
    currentNode &&
      currentNode.type === nextNode.type &&
      currentNode.domain === nextNode.domain &&
      currentNode.project === nextNode.project &&
      currentNode.taskId === nextNode.taskId,
  );
}

function readTaskPoolTreeNodeDraftLabel(
  node: TaskPoolTreeNodeIdentity,
  viewState: Pick<TaskPlanViewState, "state" | "poolDraft" | "poolEditMode" | "poolDraftTouched">,
): string {
  return getTaskPoolTreeNodeLabel(getTaskPlanPoolSharedItems(viewState), node);
}

function readTaskPoolTreePreferredOptionKey(
  node: TaskPoolTreeNodeIdentity,
  level: TaskPoolTreeLevel,
): string | null {
  if (level === "domain") {
    return node.domain || null;
  }
  if (level === "project") {
    return node.type === "domain" ? null : getTaskPoolProjectOptionKey(node.domain, node.project);
  }
  return node.taskId;
}

function resolveTaskPoolTreeEditedNode(
  node: TaskPoolTreeNodeIdentity,
  nextValue: string,
): TaskPoolTreeNodeIdentity {
  const trimmedValue = nextValue.trim();
  if (node.type === "domain") {
    return {
      ...node,
      domain: trimmedValue || TASK_POOL_UNGROUPED_DOMAIN,
    };
  }
  if (node.type === "project") {
    return {
      ...node,
      project: trimmedValue || TASK_POOL_UNGROUPED_PROJECT,
    };
  }
  return node;
}

function createTaskPoolTreeFocusFromLastItem(
  items: readonly TaskPlanPoolItem[],
): TaskPoolTreeNodeIdentity | null {
  const item = items[items.length - 1];
  if (!item) {
    return null;
  }
  return {
    type: "task",
    domain: getTaskPoolDomainName(item),
    project: item.project?.trim() || TASK_POOL_UNGROUPED_PROJECT,
    taskId: item.id,
  };
}

function promoteTaskPoolTreeLevelForFocus(
  currentLevel: TaskPoolTreeLevel,
  focus: TaskPoolTreeNodeIdentity,
): TaskPoolTreeLevel {
  if (focus.type === "project" && currentLevel === "domain") {
    return "project";
  }
  if (focus.type === "task" && currentLevel !== "task") {
    return "task";
  }
  return currentLevel;
}

function clampTaskPoolZoomPercent(value: number): number {
  return Math.min(TASK_POOL_ZOOM_MAX, Math.max(TASK_POOL_ZOOM_MIN, value));
}

function readTaskPlanError(
  error: string | { code?: string; message?: string } | undefined,
  fallback: string,
): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function readWorkspaceHealthError(
  error: string | WorkspaceHealthErrorPayload | undefined,
  fallback: string,
): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function readWorkspaceHealthCaptchaChallenge(
  error: string | WorkspaceHealthErrorPayload | undefined,
): string | null {
  if (!error || typeof error === "string") {
    return null;
  }
  return typeof error.captchaImageDataUrl === "string" && error.captchaImageDataUrl.trim()
    ? error.captchaImageDataUrl
    : null;
}

function clampTaskPlanSplitRatio(value: number): number {
  return Math.min(
    TASK_PLAN_SPLIT_RATIO_MAX,
    Math.max(TASK_PLAN_SPLIT_RATIO_MIN, Number.isFinite(value) ? value : TASK_PLAN_SPLIT_RATIO_DEFAULT),
  );
}

function applyWorkspaceTreeWidth(root: HTMLElement, width: number): void {
  const isCollapsed = width <= WORKSPACE_TREE_COLLAPSE_WIDTH;
  root.toggleAttribute("data-workspace-tree-collapsed", isCollapsed);
  applyPanelWidth(root, "--workspace-tree-width", isCollapsed ? 1 : width);
}

function resolveTaskPlanSplitCollapse(ratio: number): TaskPlanSplitCollapse {
  if (ratio <= TASK_PLAN_SPLIT_COLLAPSE_THRESHOLD) {
    return "top";
  }
  if (ratio >= 1 - TASK_PLAN_SPLIT_COLLAPSE_THRESHOLD) {
    return "bottom";
  }
  return "none";
}

function applyTaskPlanSplitLayout(layout: HTMLElement, ratio: number): void {
  const normalizedRatio = clampTaskPlanSplitRatio(ratio);
  const collapse = resolveTaskPlanSplitCollapse(normalizedRatio);
  layout.style.setProperty("--task-plan-top-ratio", `${normalizedRatio}`);
  if (collapse === "top") {
    layout.dataset.taskPlanCollapse = "top";
    layout.style.gridTemplateRows = `${TASK_PLAN_SPLIT_TOP_COLLAPSED_HEIGHT}px ${TASK_PLAN_SPLIT_HANDLE_SIZE}px minmax(0, calc(100% - ${TASK_PLAN_SPLIT_TOP_COLLAPSED_HEIGHT + TASK_PLAN_SPLIT_HANDLE_SIZE}px))`;
    return;
  }
  if (collapse === "bottom") {
    layout.dataset.taskPlanCollapse = "bottom";
    layout.style.gridTemplateRows = `minmax(0, calc(100% - ${TASK_PLAN_SPLIT_BOTTOM_COLLAPSED_HEIGHT + TASK_PLAN_SPLIT_HANDLE_SIZE}px)) ${TASK_PLAN_SPLIT_HANDLE_SIZE}px ${TASK_PLAN_SPLIT_BOTTOM_COLLAPSED_HEIGHT}px`;
    return;
  }
  delete layout.dataset.taskPlanCollapse;
  const topPercent = Number((normalizedRatio * 100).toFixed(1));
  const bottomPercent = Number((100 - topPercent).toFixed(1));
  const gutterOffset = TASK_PLAN_SPLIT_HANDLE_SIZE / 2;
  layout.style.gridTemplateRows = `minmax(0, calc(${topPercent}% - ${gutterOffset}px)) ${TASK_PLAN_SPLIT_HANDLE_SIZE}px minmax(0, calc(${bottomPercent}% - ${gutterOffset}px))`;
}

function readTaskPlanSplitRatio(): number {
  const raw = window.localStorage.getItem(TASK_PLAN_SPLIT_RATIO_KEY);
  return clampTaskPlanSplitRatio(raw ? Number(raw) : TASK_PLAN_SPLIT_RATIO_DEFAULT);
}

function writeTaskPlanSplitRatio(value: number): number {
  const ratio = Number(clampTaskPlanSplitRatio(value).toFixed(1));
  window.localStorage.setItem(TASK_PLAN_SPLIT_RATIO_KEY, ratio.toFixed(1));
  return ratio;
}

function renderWorkspaceDocTree(
  documents: readonly WorkspaceDocument[],
  selectedId: string,
  expandedDomains: ReadonlySet<string>,
  expandedWorkspaceProjects: ReadonlySet<string>,
): string {
  const treeDocuments = documents.filter((item) => item.treeHidden !== true);
  const root = treeDocuments.find((item) => item.kind === "root");
  const domainDocs = treeDocuments.filter((item) => item.kind === "domain");
  const projectDocs = treeDocuments.filter((item) => item.kind === "project");
  const workLogs = treeDocuments.filter((item) => item.kind === "work-log");

  return `
    <ul class="wiki-page__path-tree workspace-doc-tree__path-tree">
    ${root ? `<li class="workspace-doc-tree__node workspace-doc-tree__node--root">${renderWorkspaceDocTreeItem(root, selectedId, documents)}</li>` : ""}
    ${domainDocs.map((domain) => {
      const projects = projectDocs.filter((project) => project.domain === domain.label);
      const domainLogs = workLogs.filter((log) => log.domain === domain.label);
      const expanded = expandedDomains.has(domain.label);
      const domainChildCount = projects.length + domainLogs.length;
      return `
        <li class="workspace-doc-tree__node workspace-doc-tree__node--domain" data-wiki-path-item="${escapeHtml(domain.path)}">
          <details ${expanded ? "open" : ""} data-workspace-domain-details="${escapeHtml(domain.label)}">
            <summary>${renderWorkspaceDocTreeItem(domain, selectedId, documents, {
              scope: "domain",
              key: domain.label,
              expanded,
              childCount: domainChildCount,
            })}</summary>
            <ul class="workspace-doc-tree__children workspace-doc-tree__children--project">
            ${domainLogs.map((log) => `
              <li class="wiki-page__path-page workspace-doc-tree__node workspace-doc-tree__node--work-log" data-wiki-path-item="${escapeHtml(log.path)}">
                ${renderWorkspaceDocTreeItem(log, selectedId, documents)}
              </li>
            `).join("")}
            ${projects.map((project) => {
              const projectLogs = domainLogs.filter((log) => log.project === project.label);
              const projectKey = workspaceProjectKey(project.domain ?? "", project.label);
              const projectExpanded = expandedWorkspaceProjects.has(projectKey);
              return `
                <li class="wiki-page__path-page workspace-doc-tree__node workspace-doc-tree__node--project" data-wiki-path-item="${escapeHtml(project.path)}">
                  <details ${projectExpanded ? "open" : ""} data-workspace-project-details="${escapeHtml(projectKey)}">
                    <summary>${renderWorkspaceDocTreeItem(project, selectedId, documents, {
                      scope: "project",
                      key: projectKey,
                      expanded: projectExpanded,
                      childCount: projectLogs.length,
                    })}</summary>
                  ${projectLogs.length > 0 ? `
                    <ul class="workspace-doc-tree__children workspace-doc-tree__children--log">
                      ${projectLogs.map((log) => `
                        <li class="wiki-page__path-page workspace-doc-tree__node workspace-doc-tree__node--work-log" data-wiki-path-item="${escapeHtml(log.path)}">
                          ${renderWorkspaceDocTreeItem(log, selectedId, documents)}
                        </li>
                      `).join("")}
                    </ul>
                ` : ""}
                  </details>
                </li>
              `;
            }).join("")}
            </ul>
          </details>
        </li>
      `;
    }).join("")}
    </ul>
  `;
}

function renderWorkspaceDocTreeItem(
  item: WorkspaceDocument,
  selectedId: string,
  documents: readonly WorkspaceDocument[],
  toggle?: {
    scope: "domain" | "project";
    key: string;
    expanded: boolean;
    childCount: number;
  },
): string {
  const childCount = collectWorkspaceDocChildPaths(documents, item).length;
  const label = item.title ?? item.label;
  return `
    <div class="workspace-doc-tree__row">
      ${renderWorkspaceDocTreeToggle(toggle, label)}
      <button
        type="button"
        class="workspace-doc-tree__wiki-link workspace-doc-tree__wiki-link--${item.kind}${item.id === selectedId ? " is-active" : ""}"
        data-workspace-doc-id="${escapeHtml(item.id)}"
        data-workspace-doc-kind="${item.kind}"
        title="${escapeHtml(item.path)}"
      >
        <span class="workspace-doc-tree__glyph">${renderWorkspaceDocIcon(item.kind)}</span>
        <span data-workspace-doc-label>${escapeHtml(label)}</span>
      </button>
      <button
        type="button"
        class="workspace-doc-tree__delete"
        data-workspace-doc-delete="${escapeHtml(item.id)}"
        title="${childCount > 0 ? `删除，可选择是否包含 ${childCount} 个子页面` : "删除页面"}"
        aria-label="${childCount > 0 ? `删除 ${escapeHtml(label)}，可选择是否包含子页面` : `删除 ${escapeHtml(label)}`}"
      >${renderIcon("trash-2", { size: 13 })}</button>
    </div>
  `;
}

function renderWorkspaceDocTreeToggle(
  toggle: {
    scope: "domain" | "project";
    key: string;
    expanded: boolean;
    childCount: number;
  } | undefined,
  label: string,
): string {
  if (!toggle || toggle.childCount <= 0) {
    return "";
  }
  const action = toggle.expanded ? "收起" : "展开";
  return `
    <button
      type="button"
      class="workspace-doc-tree__toggle"
      data-workspace-${toggle.scope}-toggle="${escapeHtml(toggle.key)}"
      aria-expanded="${toggle.expanded ? "true" : "false"}"
      aria-label="${action}${escapeHtml(label)}"
      title="${action}"
    >${renderIcon("chevron-right", { size: 14 })}</button>
  `;
}

function renderWorkspaceDocDeleteDialog(dialog: WorkspaceDocDeleteDialog): string {
  const childCount = dialog.childPaths.length;
  const label = dialog.target.title ?? dialog.target.label;
  const includeChildrenButton = childCount > 0
    ? `
      <button
        type="button"
        class="btn btn-danger workspace-doc-delete-dialog__danger"
        data-workspace-doc-delete-confirm="children"
      >包括 ${childCount} 个子页面</button>
    `
    : "";
  return `
    <section class="workspace-doc-delete-dialog" role="dialog" aria-modal="true" aria-label="删除页面">
      <div class="workspace-doc-delete-dialog__title">删除「${escapeHtml(label)}」？</div>
      <p>${childCount > 0 ? "这个页面下面还有子页面，请选择删除范围。" : "这个页面删除后将从目录中移除。"}</p>
      <div class="workspace-doc-delete-dialog__actions">
        <button
          type="button"
          class="btn btn-secondary"
          data-workspace-doc-delete-confirm="current"
        >只删除这个页面</button>
        ${includeChildrenButton}
        <button
          type="button"
          class="btn btn-ghost"
          data-workspace-doc-delete-cancel
        >取消</button>
      </div>
    </section>
  `;
}

function renderWorkspaceDocIcon(kind: WorkspaceDocKind): string {
  if (kind === "root") return renderIcon("folder-open", { size: 14 });
  if (kind === "domain") return renderIcon("folder-open", { size: 14 });
  if (kind === "project") return renderIcon("book-open-text", { size: 14 });
  return renderIcon("clipboard-list", { size: 14 });
}

function renderWorkspaceTabButton(tab: WorkspaceTabDefinition, activeTab: WorkspaceTab): string {
  const isActive = tab.id === activeTab;
  return `
    <button
      type="button"
      class="workspace-page__sidebar-item${isActive ? " is-active" : ""}"
      data-workspace-tab="${tab.id}"
      data-active="${isActive ? "true" : "false"}"
      aria-label="${escapeHtml(tab.label)}"
      title="${escapeHtml(tab.label)}"
    >${renderIcon(tab.icon, { size: 22 })}</button>
  `;
}

function collectWorkspaceDocChildPaths(
  documents: readonly WorkspaceDocument[],
  target: WorkspaceDocument,
): string[] {
  if (target.kind === "root") {
    return documents.filter((item) => item.id !== target.id).map((item) => item.path);
  }
  if (target.kind === "domain") {
    return documents
      .filter((item) => item.id !== target.id && item.domain === target.label)
      .map((item) => item.path);
  }
  if (target.kind === "project") {
    return documents
      .filter((item) => item.id !== target.id && item.domain === target.domain && item.project === target.label)
      .map((item) => item.path);
  }
  return [];
}

async function deleteWorkspaceDocPaths(paths: readonly string[]): Promise<void> {
  const response = await fetch("/api/workspace/docs", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  const payload = (await response.json()) as { success?: boolean; error?: string };
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "工作日志删除失败");
  }
}

async function putWorkspaceDoc(pathValue: string, raw: string): Promise<void> {
  const response = await fetch("/api/workspace/docs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: pathValue, raw }),
  });
  const payload = (await response.json()) as { success?: boolean; error?: string };
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "工作日志保存失败");
  }
}

async function postWorkspaceGalleryStatusMove(
  pathValue: string,
  status: WorkspaceGalleryStatus,
): Promise<WorkspaceGalleryStatusMoveData> {
  const response = await fetch("/api/workspace/docs/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: pathValue, status }),
  });
  const payload = (await response.json()) as WorkspaceGalleryStatusMovePayload;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "沉淀库状态更新失败");
  }
  return payload.data;
}

function savedWorkspaceDocument(
  document: WorkspaceDocument,
  saved: SavedWorkspaceDocumentContent,
): WorkspaceDocument {
  return {
    ...document,
    title: saved.nextTitle,
    raw: saved.raw,
    html: saved.currentHtml,
    modifiedAt: new Date().toISOString(),
    contentLoaded: true,
  };
}

function moveWorkspaceGalleryDocument(
  state: WorkspaceDocsState,
  moved: WorkspaceGalleryStatusMoveData,
): WorkspaceDocsState {
  return {
    ...state,
    documents: state.documents.map((item) => {
      if (item.path !== moved.previousPath) return item;
      return {
        ...item,
        path: moved.path,
        gallery: item.gallery ? { ...item.gallery, status: moved.status } : item.gallery,
        html: "",
        raw: "",
        contentLoaded: false,
      };
    }),
  };
}

function removeWorkspaceDocsByPath(state: WorkspaceDocsState, paths: readonly string[]): WorkspaceDocsState {
  const removed = new Set(paths);
  const documents = state.documents.filter((item) => !removed.has(item.path));
  const selectedId = removed.has(state.documents.find((item) => item.id === state.selectedId)?.path ?? "")
    ? documents[0]?.id ?? ""
    : state.selectedId;
  return {
    ...state,
    documents,
    selectedId,
  };
}

function workspaceProjectKey(domain: string, project: string): string {
  return `${domain}/${project}`;
}

function normalizeWorkspaceGalleryStatus(value: string): WorkspaceGalleryStatus | null {
  return WORKSPACE_GALLERY_STATUSES.includes(value as WorkspaceGalleryStatus) ? value as WorkspaceGalleryStatus : null;
}

function readWorkspaceGalleryDraggedPath(event: DragEvent): string {
  return event.dataTransfer?.getData(WORKSPACE_GALLERY_DRAG_TYPE)
    || event.dataTransfer?.getData("text/plain")
    || "";
}

function clearWorkspaceGalleryDragState(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(
    ".workspace-library-card.is-dragging, .workspace-library-gallery__column.is-drop-preview",
  ).forEach((node) => node.classList.remove("is-dragging", "is-drop-preview"));
}

function htmlToMarkdown(html: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return renderMarkdownBlocks(Array.from(wrapper.childNodes)).trim();
}

function renderMarkdownBlocks(nodes: readonly ChildNode[]): string {
  return nodes
    .map((node) => renderMarkdownNode(node))
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}

function renderMarkdownNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  const renderer = WORKSPACE_MARKDOWN_RENDERERS[node.tagName.toLowerCase()];
  return renderer ? renderer(node) : renderInlineMarkdown(node.childNodes);
}

const WORKSPACE_MARKDOWN_RENDERERS: Record<string, (node: HTMLElement) => string> = {
  h1: (node) => renderMarkdownHeading(node, "#"),
  h2: (node) => renderMarkdownHeading(node, "##"),
  h3: (node) => renderMarkdownHeading(node, "###"),
  p: (node) => `${renderInlineMarkdown(node.childNodes).trim()}\n\n`,
  strong: (node) => wrapInlineMarkdown(node, "**"),
  b: (node) => wrapInlineMarkdown(node, "**"),
  em: (node) => wrapInlineMarkdown(node, "*"),
  i: (node) => wrapInlineMarkdown(node, "*"),
  ul: (node) => renderMarkdownList(node, false),
  ol: (node) => renderMarkdownList(node, true),
  blockquote: (node) => renderMarkdownBlockquote(node),
  pre: (node) => `\`\`\`\n${node.textContent?.trim() ?? ""}\n\`\`\`\n\n`,
  hr: () => "---\n\n",
  br: () => "\n",
  a: (node) => `[${renderInlineMarkdown(node.childNodes)}](${node.getAttribute("href") ?? ""})`,
  div: (node) => renderMarkdownContainer(node),
  section: (node) => renderMarkdownContainer(node),
  article: (node) => renderMarkdownContainer(node),
};

function renderMarkdownHeading(node: HTMLElement, prefix: string): string {
  return `${prefix} ${renderInlineMarkdown(node.childNodes).trim()}\n\n`;
}

function wrapInlineMarkdown(node: HTMLElement, marker: string): string {
  return `${marker}${renderInlineMarkdown(node.childNodes)}${marker}`;
}

function renderMarkdownList(node: HTMLElement, ordered: boolean): string {
  const lines = Array.from(node.children).map((child, index) => {
    const prefix = ordered ? `${index + 1}.` : "-";
    return `${prefix} ${renderInlineMarkdown(child.childNodes).trim()}`;
  });
  return `${lines.join("\n")}\n\n`;
}

function renderMarkdownBlockquote(node: HTMLElement): string {
  return `${renderInlineMarkdown(node.childNodes).split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
}

function renderMarkdownContainer(node: HTMLElement): string {
  return `${renderMarkdownBlocks(Array.from(node.childNodes))}\n`;
}

function renderInlineMarkdown(nodes: NodeListOf<ChildNode> | readonly ChildNode[]): string {
  return Array.from(nodes)
    .map((node) => renderMarkdownNode(node))
    .join("")
    .replace(/\n{3,}/g, "\n\n");
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

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function readWorkspaceGraphyPosition(): WorkspaceGraphyPosition {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_GRAPHY_POSITION_KEY);
    if (!raw) {
      return WORKSPACE_GRAPHY_DEFAULT_POSITION;
    }
    const parsed = JSON.parse(raw) as Partial<WorkspaceGraphyPosition>;
    return normalizeWorkspaceGraphyPosition(parsed);
  } catch {
    return WORKSPACE_GRAPHY_DEFAULT_POSITION;
  }
}

function writeWorkspaceGraphyPosition(position: WorkspaceGraphyPosition): void {
  window.localStorage.setItem(WORKSPACE_GRAPHY_POSITION_KEY, JSON.stringify(position));
}

function applyWorkspaceGraphyPosition(panel: HTMLElement, position: WorkspaceGraphyPosition): void {
  panel.style.setProperty("--workspace-graphy-right", `${position.x}px`);
  panel.style.setProperty("--workspace-graphy-top", `${position.y}px`);
}

function normalizeWorkspaceGraphyPosition(value: Partial<WorkspaceGraphyPosition>): WorkspaceGraphyPosition {
  const x = Number(value.x);
  const y = Number(value.y);
  return {
    x: Number.isFinite(x) ? Math.max(0, x) : WORKSPACE_GRAPHY_DEFAULT_POSITION.x,
    y: Number.isFinite(y) ? Math.max(0, y) : WORKSPACE_GRAPHY_DEFAULT_POSITION.y,
  };
}

function consumeWorkflowRecorderOpenRequest(): boolean {
  try {
    if (window.sessionStorage.getItem(WORKFLOW_RECORDER_PENDING_KEY) !== "1") {
      return false;
    }
    window.sessionStorage.removeItem(WORKFLOW_RECORDER_PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

function readActiveTaskPoolDragTaskId(
  activeTaskId: string | null,
  dataTransfer: Pick<DataTransfer, "getData"> | null | undefined,
): string | null {
  if (!activeTaskId) {
    return null;
  }
  const transferredTaskId = dataTransfer?.getData("text/plain") ?? "";
  if (transferredTaskId && transferredTaskId !== activeTaskId) {
    return null;
  }
  return activeTaskId;
}

function readTaskPoolGestureScale(event: Event): number | null {
  const scale = (event as Event & { scale?: number }).scale;
  return typeof scale === "number" && Number.isFinite(scale) ? scale : null;
}

function resolveTaskPoolGestureZoomPercent(
  baselineZoomPercent: number,
  baselineScale: number,
  nextScale: number,
): number {
  if (nextScale === baselineScale) {
    return baselineZoomPercent;
  }
  const stepDirection = nextScale > baselineScale ? 1 : -1;
  return baselineZoomPercent + stepDirection * TASK_POOL_ZOOM_STEP;
}
