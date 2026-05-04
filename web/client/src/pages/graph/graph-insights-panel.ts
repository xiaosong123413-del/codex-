/**
 * Right-side Graphy Insights panel.
 *
 * This module owns only DOM rendering and click routing for deterministic graph
 * insight cards. The graph page supplies highlight and research callbacks.
 */
import type { KnowledgeGap, SurprisingConnection } from "./graph-insights.js";

export interface GraphInsightsRefs {
  button: HTMLButtonElement;
  panel: HTMLElement;
}

interface GraphInsightsCallbacks {
  onHighlight: (nodeIds: readonly string[]) => void;
  onResearch: (gap: KnowledgeGap) => void;
}

interface GraphInsightsState {
  open: boolean;
  selectedKey: string | null;
  dismissedKeys: Set<string>;
  surprising: SurprisingConnection[];
  gaps: KnowledgeGap[];
  researchStatus: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
};
const DISMISSED_INSIGHTS_STORAGE_KEY = "graphy.dismissedSurprisingConnections.v1";

export interface GraphInsightsController {
  setInsights: (surprising: SurprisingConnection[], gaps: KnowledgeGap[]) => void;
  setResearchStatus: (status: string) => void;
  close: () => void;
}

export function bindGraphInsightsPanel(
  root: HTMLElement,
  refs: GraphInsightsRefs,
  callbacks: GraphInsightsCallbacks,
): GraphInsightsController {
  const state: GraphInsightsState = {
    open: false,
    selectedKey: null,
    dismissedKeys: loadDismissedInsightKeys(),
    surprising: [],
    gaps: [],
    researchStatus: "",
  };
  refs.button.addEventListener("click", () => togglePanel(root, refs, state, callbacks));
  refs.panel.addEventListener("click", (event) => handlePanelClick(event, root, refs, state, callbacks));
  renderPanel(refs, state);
  return {
    setInsights: (surprising, gaps) => {
      state.surprising = surprising;
      state.gaps = gaps;
      renderPanel(refs, state);
    },
    setResearchStatus: (status) => {
      state.researchStatus = status;
      renderPanel(refs, state);
    },
    close: () => closePanel(root, refs, state, callbacks),
  };
}

function togglePanel(
  root: HTMLElement,
  refs: GraphInsightsRefs,
  state: GraphInsightsState,
  callbacks: GraphInsightsCallbacks,
): void {
  state.open = !state.open;
  if (!state.open) {
    state.selectedKey = null;
    callbacks.onHighlight([]);
  }
  root.classList.toggle("graphy-page--insights-open", state.open);
  refs.panel.hidden = !state.open;
  refs.button.setAttribute("aria-expanded", String(state.open));
  renderPanel(refs, state);
}

function closePanel(
  root: HTMLElement,
  refs: GraphInsightsRefs,
  state: GraphInsightsState,
  callbacks: GraphInsightsCallbacks,
): void {
  state.open = false;
  state.selectedKey = null;
  root.classList.remove("graphy-page--insights-open");
  refs.panel.hidden = true;
  refs.button.setAttribute("aria-expanded", "false");
  callbacks.onHighlight([]);
  renderPanel(refs, state);
}

function handlePanelClick(
  event: MouseEvent,
  root: HTMLElement,
  refs: GraphInsightsRefs,
  state: GraphInsightsState,
  callbacks: GraphInsightsCallbacks,
): void {
  const target = event.target as HTMLElement;
  const closeButton = target.closest<HTMLButtonElement>("[data-graphy-insights-close]");
  if (closeButton) return closePanel(root, refs, state, callbacks);
  const researchButton = target.closest<HTMLButtonElement>("[data-graphy-research-gap]");
  if (researchButton?.dataset.graphyResearchGap) {
    event.stopPropagation();
    return researchGap(researchButton.dataset.graphyResearchGap, state, callbacks);
  }
  const dismissButton = target.closest<HTMLButtonElement>("[data-graphy-dismiss-insight]");
  if (dismissButton?.dataset.graphyDismissInsight) {
    event.stopPropagation();
    return dismissInsight(dismissButton.dataset.graphyDismissInsight, refs, state, callbacks);
  }
  const card = target.closest<HTMLElement>("[data-graphy-insight-card]");
  if (card?.dataset.graphyInsightCard) selectInsightCard(card.dataset.graphyInsightCard, refs, state, callbacks);
}

function researchGap(key: string, state: GraphInsightsState, callbacks: GraphInsightsCallbacks): void {
  const gap = state.gaps.find((item) => item.key === key);
  if (gap) callbacks.onResearch(gap);
}

function selectInsightCard(
  key: string,
  refs: GraphInsightsRefs,
  state: GraphInsightsState,
  callbacks: GraphInsightsCallbacks,
): void {
  const insight = findInsightByKey(key, state);
  if (!insight) return;
  if (state.selectedKey === key) {
    state.selectedKey = null;
    callbacks.onHighlight([]);
    renderPanel(refs, state);
    return;
  }
  state.selectedKey = key;
  callbacks.onHighlight(insight.nodeIds);
  renderPanel(refs, state);
}

function dismissInsight(
  key: string,
  refs: GraphInsightsRefs,
  state: GraphInsightsState,
  callbacks: GraphInsightsCallbacks,
): void {
  state.dismissedKeys.add(key);
  saveDismissedInsightKeys(state.dismissedKeys);
  if (state.selectedKey === key) {
    state.selectedKey = null;
    callbacks.onHighlight([]);
  }
  renderPanel(refs, state);
}

function findInsightByKey(
  key: string,
  state: GraphInsightsState,
): SurprisingConnection | KnowledgeGap | null {
  return state.surprising.find((item) => item.key === key)
    ?? state.gaps.find((item) => item.key === key)
    ?? null;
}

function renderPanel(refs: GraphInsightsRefs, state: GraphInsightsState): void {
  const visibleSurprising = visibleSurprisingConnections(state);
  refs.button.textContent = `Insights ${visibleSurprising.length + state.gaps.length}`;
  refs.panel.innerHTML = `
    <header class="graphy-insights__header">
      <div>
        <p class="graphy-page__eyebrow">GRAPH INSIGHTS</p>
        <h2>Insights</h2>
      </div>
      <button type="button" class="graphy-page__preview-close" data-graphy-insights-close aria-label="关闭洞察">&times;</button>
    </header>
    ${state.researchStatus ? `<p class="graphy-insights__status">${escapeHtml(state.researchStatus)}</p>` : ""}
    ${renderSurprisingConnections(state, visibleSurprising)}
    ${renderKnowledgeGaps(state)}
  `;
}

function renderSurprisingConnections(
  state: GraphInsightsState,
  visibleSurprising: readonly SurprisingConnection[],
): string {
  return `
    <section class="graphy-insights__section">
      <h3>意外连接</h3>
      ${visibleSurprising.length ? visibleSurprising.map((item) => renderConnectionCard(item, state)).join("") : renderEmpty("没有检测到明显的意外连接。")}
    </section>
  `;
}

function renderConnectionCard(item: SurprisingConnection, state: GraphInsightsState): string {
  return `
    <article class="graphy-insight-card${state.selectedKey === item.key ? " is-active" : ""}" data-graphy-insight-card="${escapeHtml(item.key)}">
      <div class="graphy-insight-card__heading">
        <p class="graphy-insight-card__title">${escapeHtml(item.source.label)} ↔ ${escapeHtml(item.target.label)}</p>
        <button type="button" data-graphy-dismiss-insight="${escapeHtml(item.key)}" aria-label="忽略这条意外连接">&times;</button>
      </div>
      <p class="graphy-insight-card__meta">score ${item.score.toFixed(1)}</p>
      <ul>${item.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderKnowledgeGaps(state: GraphInsightsState): string {
  return `
    <section class="graphy-insights__section">
      <h3>知识空白</h3>
      ${state.gaps.length ? state.gaps.map((item) => renderGapCard(item, state)).join("") : renderEmpty("没有检测到明显的知识空白。")}
    </section>
  `;
}

function renderGapCard(item: KnowledgeGap, state: GraphInsightsState): string {
  return `
    <article class="graphy-insight-card${state.selectedKey === item.key ? " is-active" : ""}" data-graphy-insight-card="${escapeHtml(item.key)}">
      <p class="graphy-insight-card__title">${escapeHtml(item.title)}</p>
      <p>${escapeHtml(item.description)}</p>
      <p class="graphy-insight-card__suggestion">${escapeHtml(item.suggestion)}</p>
      <button type="button" class="btn btn-secondary btn-inline" data-graphy-research-gap="${escapeHtml(item.key)}">Deep Research</button>
    </article>
  `;
}

function renderEmpty(message: string): string {
  return `<p class="graphy-insights__empty">${escapeHtml(message)}</p>`;
}

function visibleSurprisingConnections(state: GraphInsightsState): SurprisingConnection[] {
  return state.surprising.filter((item) => !state.dismissedKeys.has(item.key));
}

function loadDismissedInsightKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_INSIGHTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(isNonEmptyString) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedInsightKeys(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DISMISSED_INSIGHTS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Local storage can be disabled; dismissal still works for the current page.
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPE_MAP[character] ?? character);
}
