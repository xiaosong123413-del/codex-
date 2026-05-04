/**
 * Browser-side automation workspace API helpers.
 *
 * This file keeps fetch contracts and DTO shapes away from the page renderer
 * so list/detail/log views can stay focused on DOM state and interaction.
 */

export interface AutomationListItem {
  id: string;
  name: string;
  summary: string;
  icon: string;
  enabled: boolean;
  trigger: string;
  updatedAt?: string;
  sourceKind: "automation" | "app" | "code" | "information";
}

interface AutomationDocumentStepResponse {
  index: number;
  text: string;
}

interface AutomationResolvedApp {
  id: string;
  name: string;
  workflow: string;
  prompt: string;
  provider: string;
  model: string;
}

interface AutomationEffectiveModel {
  provider: string;
  model: string;
  source: "none" | "explicit" | "app" | "default";
  label: string;
}

interface AutomationFlowNodeResponse {
  id: string;
  type: "trigger" | "action" | "branch" | "merge";
  title: string;
  description: string;
  standard?: string;
  implementation?: string;
  appId?: string;
  modelMode: "explicit" | "default";
  model?: string;
  app: AutomationResolvedApp | null;
  effectiveModel: AutomationEffectiveModel;
}

interface AutomationFlowEdgeResponse {
  id: string;
  source: string;
  target: string;
}

interface AutomationFlowBranchResponse {
  id: string;
  title: string;
  sourceNodeId: string;
  mergeNodeId?: string;
  nodeIds: string[];
}

export interface AutomationCommentResponse {
  id: string;
  automationId: string;
  targetType: AutomationCommentTargetType;
  targetId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  pinnedX: number;
  pinnedY: number;
  manualX?: number;
  manualY?: number;
}

// fallow-ignore-next-line unused-type
export type AutomationCommentTargetType = "node" | "edge" | "canvas";

export interface AutomationCommentDraftTarget {
  targetType: AutomationCommentTargetType;
  targetId: string;
  pinnedX: number;
  pinnedY: number;
}

interface AutomationCommentPatchInput extends Partial<Pick<
  AutomationCommentResponse,
  "text" | "targetType" | "targetId" | "pinnedX" | "pinnedY"
>> {
  manualX?: number | null;
  manualY?: number | null;
}

interface AutomationLayoutResponse {
  automationId: string;
  branchOffsets: Record<string, { x: number; y: number }>;
}

type AutomationSourceInsightScope = "page" | "cross-page";

export type AutomationSourceInsightNodeKind = "trigger" | "decision" | "input" | "process" | "result";

interface AutomationPotentialDestinationResponse {
  id: string;
  automationId: string;
  nodeId: string;
  label: string;
  intendedOutcome: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface AutomationSourceInsightMissingLinkResponse {
  to: string;
  statusNote: string;
}

interface AutomationSourceInsightNodeResponse {
  id: string;
  kind: AutomationSourceInsightNodeKind;
  label: string;
  displayId?: string;
}

interface AutomationSourceInsightEdgeResponse {
  source: string;
  target: string;
  label?: string;
}

interface AutomationSourceInsightPageHotspotViewResponse {
  title: string;
  description: string;
  svg: string;
}

export interface AutomationSourceInsightNodeInsightResponse {
  summary: string;
  upstream: string[];
  downstream: string[];
  shownIn: string[];
  sourcePaths: string[];
  missingLinks: AutomationSourceInsightMissingLinkResponse[];
  specRows?: Array<{
    label: string;
    value: string;
  }>;
  potentialDestinations: AutomationPotentialDestinationResponse[];
}

interface AutomationSourceInsightResponse {
  scope: AutomationSourceInsightScope;
  page: {
    id: string;
    title: string;
    routeLabel: string;
  };
  graph: {
    mermaid: string;
    nodes: AutomationSourceInsightNodeResponse[];
    edges: AutomationSourceInsightEdgeResponse[];
  };
  pageHotspotView?: AutomationSourceInsightPageHotspotViewResponse;
  nodeInsights: Record<string, AutomationSourceInsightNodeInsightResponse>;
  appendices?: Array<{
    id: string;
    title: string;
    content: string;
  }>;
}

interface AutomationLogResponse {
  id: string;
  automationId?: string;
  status: string;
  summary: string;
  startedAt: string;
  endedAt?: string;
}

export interface AutomationDetailResponse {
  automation: {
    id: string;
    name: string;
    summary: string;
    icon: string;
    enabled: boolean;
    trigger: string;
    sourceKind: "automation" | "app" | "code" | "information";
    viewMode: "flow";
    documentSteps: AutomationDocumentStepResponse[];
    apps: AutomationResolvedApp[];
    flow: {
      nodes: AutomationFlowNodeResponse[];
      edges: AutomationFlowEdgeResponse[];
      branches: AutomationFlowBranchResponse[];
    };
    mermaid?: string;
    sourceInsight?: AutomationSourceInsightResponse;
  };
  comments: AutomationCommentResponse[];
  layout: AutomationLayoutResponse;
}

interface AutomationWorkspaceChangeEvent {
  version: number;
  changedAt: string;
  files: string[];
}

export async function fetchAutomationList(): Promise<AutomationListItem[]> {
  const payload = await requestJson<{ automations: AutomationListItem[] }>("/api/automation-workspace");
  return payload.automations ?? [];
}

export async function fetchAutomationDetail(automationId: string): Promise<AutomationDetailResponse> {
  return requestJson<AutomationDetailResponse>(`/api/automation-workspace/${encodeURIComponent(automationId)}`);
}

export async function createAutomationComment(
  automationId: string,
  input: Pick<AutomationCommentResponse, "targetType" | "targetId" | "text" | "pinnedX" | "pinnedY">
    & Partial<Pick<AutomationCommentResponse, "manualX" | "manualY">>,
): Promise<AutomationCommentResponse> {
  return requestJson<AutomationCommentResponse>(`/api/automation-workspace/${encodeURIComponent(automationId)}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function patchAutomationComment(
  automationId: string,
  commentId: string,
  input: AutomationCommentPatchInput,
): Promise<AutomationCommentResponse> {
  return requestJson<AutomationCommentResponse>(`/api/automation-workspace/${encodeURIComponent(automationId)}/comments/${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteAutomationComment(automationId: string, commentId: string): Promise<void> {
  await requestJson(`/api/automation-workspace/${encodeURIComponent(automationId)}/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });
}

async function saveAutomationLayout(
  automationId: string,
  branchOffsets: AutomationLayoutResponse["branchOffsets"],
): Promise<AutomationLayoutResponse> {
  return requestJson<AutomationLayoutResponse>(`/api/automation-workspace/${encodeURIComponent(automationId)}/layout`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchOffsets }),
  });
}

export async function fetchAutomationLogs(automationId: string): Promise<AutomationLogResponse[]> {
  const payload = await requestJson<{ logs: AutomationLogResponse[] }>(`/api/automation-workspace/${encodeURIComponent(automationId)}/logs`);
  return payload.logs ?? [];
}

export function subscribeAutomationWorkspaceChanges(
  onChange: (event: AutomationWorkspaceChangeEvent) => void,
): () => void {
  const eventSource = new EventSource("/api/automation-workspace/events");
  eventSource.addEventListener("change", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as AutomationWorkspaceChangeEvent;
    onChange(payload);
  });
  return () => {
    eventSource.close();
  };
}

async function requestJson<T = void>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.ok && response.status === 204) {
    return null as T;
  }
  const payload = await parseResponsePayload<T>(response);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error ?? `Request failed: ${url}`);
  }
  return (payload.data ?? null) as T;
}

async function parseResponsePayload<T>(
  response: Response,
): Promise<{ success?: boolean; data?: T; error?: string } | null> {
  const rawPayload = await response.text().catch(() => "");
  if (rawPayload.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(rawPayload) as { success?: boolean; data?: T; error?: string };
  } catch {
    return null;
  }
}
