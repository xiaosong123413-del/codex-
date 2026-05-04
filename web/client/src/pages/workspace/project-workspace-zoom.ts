/**
 * Zoom runtime for the project workspace graph layer.
 *
 * The hierarchy graph keeps a natural, readable layout. This module only
 * changes the graph layer scale, so parent panes never squeeze node text.
 */
const GRAPH_SCALE_KEY = "workspace.projectWorkspaceGraphScale";
const DEFAULT_GRAPH_SCALE = 1;
const MIN_GRAPH_SCALE = 0.55;
const MAX_GRAPH_SCALE = 1.4;
const GRAPH_SCALE_STEP = 0.1;

export function readInitialGraphScale(): string {
  return String(clampGraphScale(Number(window.localStorage.getItem(GRAPH_SCALE_KEY)) || DEFAULT_GRAPH_SCALE));
}

export function mountProjectWorkspaceGraphZoom(page: HTMLElement): void {
  const layer = page.querySelector<HTMLElement>("[data-project-graph-layer]");
  const viewport = page.querySelector<HTMLElement>("[data-project-graph-viewport]");
  if (!layer || !viewport) return;
  page.querySelectorAll<HTMLButtonElement>("[data-project-graph-zoom]").forEach((button) => {
    button.addEventListener("click", () => setGraphScale(layer, page, nextGraphScale(layer, button.dataset.projectGraphZoom)));
  });
  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setGraphScale(layer, page, readGraphScale(layer) + (event.deltaY > 0 ? -GRAPH_SCALE_STEP : GRAPH_SCALE_STEP));
  }, { passive: false });
}

function setGraphScale(layer: HTMLElement, page: HTMLElement, value: number): void {
  const scale = clampGraphScale(value);
  layer.style.setProperty("--project-workspace-graph-scale", String(scale));
  window.localStorage.setItem(GRAPH_SCALE_KEY, String(scale));
  const scaleLabel = page.querySelector<HTMLElement>("[data-project-graph-zoom='reset']");
  if (scaleLabel) scaleLabel.textContent = `${Math.round(scale * 100)}%`;
}

function nextGraphScale(layer: HTMLElement, action: string | undefined): number {
  if (action === "reset") return DEFAULT_GRAPH_SCALE;
  return readGraphScale(layer) + (action === "out" ? -GRAPH_SCALE_STEP : GRAPH_SCALE_STEP);
}

function readGraphScale(layer: HTMLElement): number {
  return Number(layer.style.getPropertyValue("--project-workspace-graph-scale")) || DEFAULT_GRAPH_SCALE;
}

function clampGraphScale(value: number): number {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_GRAPH_SCALE;
  return Math.min(MAX_GRAPH_SCALE, Math.max(MIN_GRAPH_SCALE, Math.round(safeValue * 100) / 100));
}
