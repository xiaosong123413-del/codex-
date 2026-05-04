/**
 * Graphy Deep Research dialog and API client.
 *
 * The dialog is intentionally explicit: Graphy asks the server to optimize a
 * research topic, lets the user edit topic and search queries, then starts the
 * server-side web-search + LLM synthesis job.
 */
import { parseSseMessages } from "../chat/stream.js";
import type { KnowledgeGap } from "./graph-insights.js";

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

interface PreparedResearch {
  topic: string;
  queries: string[];
  rationale: string;
}

interface ResearchResult {
  path: string;
  sourceCount: number;
  urls: string[];
  savedAt: string;
}

interface DialogCallbacks {
  onStatus: (status: string) => void;
  onRunStart: (topic: string, queries: readonly string[]) => void;
  onToken: (token: string) => void;
  onComplete: (result: ResearchResult) => void;
  onError: (message: string) => void;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
};

export async function launchGraphResearchDialog(
  root: HTMLElement,
  gap: KnowledgeGap,
  signal: AbortSignal,
  callbacks: DialogCallbacks,
): Promise<void> {
  callbacks.onStatus("正在优化研究主题...");
  try {
    const prepared = await prepareResearch(gap, signal);
    if (signal.aborted) return;
    showResearchDialog(root, gap, prepared, signal, callbacks);
    callbacks.onStatus("研究主题已生成，等待确认。");
  } catch (error) {
    if (!signal.aborted) callbacks.onStatus(errorMessage(error));
  }
}

async function prepareResearch(gap: KnowledgeGap, signal: AbortSignal): Promise<PreparedResearch> {
  const response = await fetch("/api/wiki/graph/research/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: gap.title, description: gap.description, type: gap.type }),
    signal,
  });
  return readApiData<PreparedResearch>(response, "无法优化研究主题。");
}

function showResearchDialog(
  root: HTMLElement,
  gap: KnowledgeGap,
  prepared: PreparedResearch,
  signal: AbortSignal,
  callbacks: DialogCallbacks,
): void {
  const overlay = document.createElement("div");
  overlay.className = "graphy-research-dialog";
  overlay.innerHTML = renderDialog(prepared);
  root.append(overlay);
  bindDialog(overlay, gap, signal, callbacks);
}

function bindDialog(
  overlay: HTMLElement,
  gap: KnowledgeGap,
  signal: AbortSignal,
  callbacks: DialogCallbacks,
): void {
  overlay.querySelectorAll<HTMLElement>("[data-graphy-research-cancel]").forEach((button) => {
    button.addEventListener("click", () => overlay.remove());
  });
  overlay.querySelector<HTMLFormElement>("[data-graphy-research-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitResearch(overlay, gap, signal, callbacks);
  });
}

async function submitResearch(
  overlay: HTMLElement,
  gap: KnowledgeGap,
  signal: AbortSignal,
  callbacks: DialogCallbacks,
): Promise<void> {
  const topic = readField(overlay, "[data-graphy-research-topic]");
  const queries = readField(overlay, "[data-graphy-research-queries]").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  callbacks.onRunStart(topic, queries);
  callbacks.onStatus("Deep Research 正在运行...");
  try {
    const result = await runResearch(topic, queries, gap, signal, callbacks);
    if (signal.aborted) return;
    overlay.remove();
    callbacks.onComplete(result);
  } catch (error) {
    if (!signal.aborted) callbacks.onError(errorMessage(error));
  }
}

async function runResearch(
  topic: string,
  queries: readonly string[],
  gap: KnowledgeGap,
  signal: AbortSignal,
  callbacks: DialogCallbacks,
): Promise<ResearchResult> {
  const response = await fetch("/api/wiki/graph/research/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, queries, gap: { title: gap.title, description: gap.description, type: gap.type } }),
    signal,
  });
  return readResearchStream(response, callbacks);
}

async function readResearchStream(response: Response, callbacks: DialogCallbacks): Promise<ResearchResult> {
  if (!response.ok || !response.body) {
    return readApiData<ResearchResult>(response, "Deep Research 运行失败。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseMessages(buffer);
    buffer = parsed.rest;
    const doneResult = handleResearchStreamMessages(parsed.messages, callbacks);
    if (doneResult) return doneResult;
  }
  throw new Error("Deep Research stream ended before completion.");
}

function handleResearchStreamMessages(
  messages: readonly { event: string; data: string }[],
  callbacks: DialogCallbacks,
): ResearchResult | null {
  for (const message of messages) {
    const payload = parsePayload(message.data);
    if (message.event === "status") callbacks.onStatus(readPayloadText(payload));
    if (message.event === "token") callbacks.onToken(readToken(payload));
    if (message.event === "error") throw new Error(readError(payload));
    if (message.event === "done") return readResearchResult(payload);
  }
  return null;
}

function parsePayload(data: string): unknown {
  return JSON.parse(data) as unknown;
}

function readPayloadText(payload: unknown): string {
  const record = asRecord(payload);
  return typeof record.message === "string" ? record.message : "";
}

function readToken(payload: unknown): string {
  const record = asRecord(payload);
  return typeof record.token === "string" ? record.token : "";
}

function readError(payload: unknown): string {
  const record = asRecord(payload);
  return typeof record.error === "string" ? record.error : "Deep Research 运行失败。";
}

function readResearchResult(payload: unknown): ResearchResult {
  const record = asRecord(payload);
  return {
    path: String(record.path ?? ""),
    sourceCount: Number(record.sourceCount ?? 0),
    urls: Array.isArray(record.urls) ? record.urls.filter(isString) : [],
    savedAt: String(record.savedAt ?? ""),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function readApiData<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await readJsonPayload<T>(response);
  if (response.ok && hasApiData(payload)) return payload.data;
  throw new Error(apiErrorMessage(payload, fallbackMessage));
}

async function readJsonPayload<T>(response: Response): Promise<ApiResponse<T> | null> {
  return response.json().catch(() => null) as Promise<ApiResponse<T> | null>;
}

function hasApiData<T>(payload: ApiResponse<T> | null): payload is ApiResponse<T> & { data: T } {
  if (!payload) return false;
  if (payload.success === false) return false;
  return payload.data !== undefined && payload.data !== null;
}

function apiErrorMessage<T>(payload: ApiResponse<T> | null, fallbackMessage: string): string {
  return payload?.error ?? fallbackMessage;
}

function renderDialog(prepared: PreparedResearch): string {
  return `
    <div class="graphy-research-dialog__backdrop" data-graphy-research-cancel></div>
    <form class="graphy-research-dialog__panel" data-graphy-research-form>
      <header>
        <p class="graphy-page__eyebrow">DEEP RESEARCH</p>
        <h2>确认研究主题</h2>
      </header>
      <label>Topic<textarea data-graphy-research-topic required>${escapeHtml(prepared.topic)}</textarea></label>
      <label>Search queries<textarea data-graphy-research-queries required>${escapeHtml(prepared.queries.join("\n"))}</textarea></label>
      <p>${escapeHtml(prepared.rationale)}</p>
      <footer>
        <button type="button" class="btn btn-secondary" data-graphy-research-cancel>取消</button>
        <button type="submit" class="btn btn-primary">开始</button>
      </footer>
    </form>
  `;
}

function readField(root: HTMLElement, selector: string): string {
  return root.querySelector<HTMLTextAreaElement>(selector)?.value.trim() ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPE_MAP[character] ?? character);
}
