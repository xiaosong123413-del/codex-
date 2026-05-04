/**
 * Live Graphy Deep Research panel.
 *
 * The panel keeps user-confirmed research runs visible while the server streams
 * queue status and synthesis tokens. It also folds model thinking blocks once
 * normal wiki prose starts arriving.
 */
import type { KnowledgeGap } from "./graph-insights.js";
import { launchGraphResearchDialog } from "./graph-research-dialog.js";

interface ResearchResult {
  path: string;
  sourceCount: number;
  urls: string[];
  savedAt: string;
}

interface ResearchPanelTask {
  id: string;
  topic: string;
  queries: readonly string[];
  status: string;
  synthesis: string;
  result: ResearchResult | null;
  error: string | null;
}

interface ResearchSegment {
  type: "think" | "body";
  content: string;
}

interface GraphResearchPanelController {
  start: (gap: KnowledgeGap) => void;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
};

export function bindGraphResearchPanel(
  root: HTMLElement,
  signal: AbortSignal,
): GraphResearchPanelController {
  const panel = document.createElement("aside");
  const tasks: ResearchPanelTask[] = [];
  let activeTask: ResearchPanelTask | null = null;
  panel.className = "graphy-research-panel";
  panel.hidden = true;
  root.querySelector(".graphy-page__main")?.append(panel);

  return {
    start: (gap) => {
      panel.hidden = false;
      root.classList.add("graphy-page--research-open");
      void launchGraphResearchDialog(root, gap, signal, {
        onStatus: (status) => updateStatus(activeTask, panel, tasks, status),
        onRunStart: (topic, queries) => {
          activeTask = createResearchTask(topic, queries);
          tasks.unshift(activeTask);
          renderResearchPanel(panel, tasks);
        },
        onToken: (token) => appendToken(activeTask, panel, tasks, token),
        onComplete: (result) => completeTask(activeTask, panel, tasks, result),
        onError: (message) => failTask(activeTask, panel, tasks, message),
      });
    },
  };
}

function createResearchTask(topic: string, queries: readonly string[]): ResearchPanelTask {
  return {
    id: `research-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    topic,
    queries,
    status: "Queued",
    synthesis: "",
    result: null,
    error: null,
  };
}

function updateStatus(
  task: ResearchPanelTask | null,
  panel: HTMLElement,
  tasks: readonly ResearchPanelTask[],
  status: string,
): void {
  if (task) task.status = status || task.status;
  renderResearchPanel(panel, tasks);
}

function appendToken(
  task: ResearchPanelTask | null,
  panel: HTMLElement,
  tasks: readonly ResearchPanelTask[],
  token: string,
): void {
  if (task) task.synthesis += token;
  renderResearchPanel(panel, tasks);
}

function completeTask(
  task: ResearchPanelTask | null,
  panel: HTMLElement,
  tasks: readonly ResearchPanelTask[],
  result: ResearchResult,
): void {
  if (task) {
    task.status = `Saved ${result.path}`;
    task.result = result;
  }
  renderResearchPanel(panel, tasks);
}

function failTask(
  task: ResearchPanelTask | null,
  panel: HTMLElement,
  tasks: readonly ResearchPanelTask[],
  message: string,
): void {
  if (task) task.error = message;
  renderResearchPanel(panel, tasks);
}

function renderResearchPanel(panel: HTMLElement, tasks: readonly ResearchPanelTask[]): void {
  panel.innerHTML = `
    <header class="graphy-research-panel__header">
      <div>
        <p class="graphy-page__eyebrow">RESEARCH</p>
        <h2>Research Panel</h2>
      </div>
    </header>
    ${tasks.length ? tasks.map(renderResearchTask).join("") : "<p>等待研究任务。</p>"}
  `;
  panel.scrollTop = panel.scrollHeight;
}

function renderResearchTask(task: ResearchPanelTask): string {
  return `
    <article class="graphy-research-task">
      <header>
        <h3>${escapeHtml(task.topic)}</h3>
        <p>${escapeHtml(task.status)}</p>
      </header>
      <ul>${task.queries.map((query) => `<li>${escapeHtml(query)}</li>`).join("")}</ul>
      ${task.error ? `<p class="graphy-research-task__error">${escapeHtml(task.error)}</p>` : ""}
      ${renderSynthesis(task.synthesis)}
      ${task.result ? renderResult(task.result) : ""}
    </article>
  `;
}

function renderSynthesis(content: string): string {
  if (!content) return "";
  const segments = splitThinkingSegments(content);
  const hasBody = segments.some((segment) => segment.type === "body" && segment.content.trim());
  return `
    <div class="graphy-research-task__synthesis">
      ${segments.map((segment) => renderSegment(segment, hasBody)).join("")}
    </div>
  `;
}

function renderSegment(segment: ResearchSegment, hasBody: boolean): string {
  if (segment.type === "think") {
    return `
      <details class="graphy-research-task__think"${hasBody ? "" : " open"}>
        <summary>Thinking</summary>
        <pre>${escapeHtml(segment.content)}</pre>
      </details>
    `;
  }
  return `<div class="graphy-research-task__body">${escapeHtml(segment.content)}</div>`;
}

function renderResult(result: ResearchResult): string {
  return `
    <footer class="graphy-research-task__result">
      <a href="#/wiki/${encodeURIComponent(result.path)}">${escapeHtml(result.path)}</a>
      <span>${result.sourceCount} sources</span>
    </footer>
  `;
}

function splitThinkingSegments(content: string): ResearchSegment[] {
  const segments: ResearchSegment[] = [];
  const pattern = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/giu;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    appendBodySegment(segments, content.slice(cursor, index));
    segments.push({ type: "think", content: match[2] ?? "" });
    cursor = index + match[0].length;
  }
  appendBodySegment(segments, content.slice(cursor));
  return segments.length ? segments : [{ type: "body", content }];
}

function appendBodySegment(segments: ResearchSegment[], content: string): void {
  if (content) segments.push({ type: "body", content });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPE_MAP[character] ?? character);
}
