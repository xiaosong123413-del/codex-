/**
 * Shared bottom-right progress notice for sync and system-check launches.
 *
 * The web shell has two entry points for those runs: the rail buttons start a
 * background run, while the dedicated run page also opens a live log stream.
 * This helper keeps the visible progress feedback consistent and determinate:
 * callers move the bar from an initial running percentage to 100% only when the
 * backend run has actually reached a terminal state.
 */

interface RunProgressOptions {
  readonly key: string;
  readonly title: string;
  readonly message: string;
  readonly percent?: number;
}

export interface RunProgressHandle {
  update(message: string, percent?: number): void;
  complete(message: string): void;
  fail(message: string): void;
  close(): void;
}

interface ProgressCard {
  readonly element: HTMLElement;
  readonly message: HTMLElement;
  readonly percent: HTMLElement;
  readonly bar: HTMLElement;
}

type ProgressState = "complete" | "error";

const FEEDBACK_HOST_ID = "app-toast-host";
const EXIT_DELAY_MS = 3600;
const MIN_PROGRESS_PERCENT = 1;
const COMPLETE_PROGRESS_PERCENT = 100;
const REMOVE_ANIMATION_MS = 180;

export function showRunProgress(options: RunProgressOptions): RunProgressHandle {
  const host = ensureFeedbackHost();
  removeExistingProgress(host, options.key);
  const card = createProgressCard(options);
  let removeTimer: number | undefined;
  let currentPercent = normalizeProgressPercent(options.percent ?? MIN_PROGRESS_PERCENT);
  host.appendChild(card.element);
  renderProgressPercent(card, currentPercent);

  const close = (): void => {
    if (removeTimer !== undefined) window.clearTimeout(removeTimer);
    removeProgress(card.element);
  };

  const setPercent = (percent: number): void => {
    currentPercent = normalizeProgressPercent(percent);
    renderProgressPercent(card, currentPercent);
  };

  const settle = (state: ProgressState, message: string, percent: number): void => {
    if (removeTimer !== undefined) window.clearTimeout(removeTimer);
    card.element.dataset.state = state;
    card.message.textContent = message;
    setPercent(percent);
    removeTimer = window.setTimeout(close, EXIT_DELAY_MS);
  };

  return {
    update(message: string, percent?: number): void {
      card.message.textContent = message;
      if (percent !== undefined) setPercent(percent);
    },
    complete(message: string): void {
      settle("complete", message, COMPLETE_PROGRESS_PERCENT);
    },
    fail(message: string): void {
      settle("error", message, currentPercent);
    },
    close,
  };
}

function ensureFeedbackHost(): HTMLElement {
  const existing = document.getElementById(FEEDBACK_HOST_ID);
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = FEEDBACK_HOST_ID;
  host.className = "app-toast-host";
  document.body.appendChild(host);
  return host;
}

function removeExistingProgress(host: HTMLElement, key: string): void {
  host.querySelectorAll<HTMLElement>("[data-run-progress-key]").forEach((element) => {
    if (element.dataset.runProgressKey === key) element.remove();
  });
}

function createProgressCard(options: RunProgressOptions): ProgressCard {
  const element = document.createElement("div");
  element.className = "run-progress-toast";
  element.dataset.runProgressKey = options.key;
  element.dataset.state = "running";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  const header = document.createElement("div");
  header.className = "run-progress-toast__header";
  const title = document.createElement("div");
  title.className = "run-progress-toast__title";
  title.textContent = options.title;
  const percent = document.createElement("div");
  percent.className = "run-progress-toast__percent";
  header.append(title, percent);
  const message = document.createElement("div");
  message.className = "run-progress-toast__message";
  message.textContent = options.message;
  const bar = createProgressBar();
  element.append(header, message, bar);
  return { element, message, percent, bar };
}

function createProgressBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "run-progress-toast__bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "1");
  bar.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("div");
  fill.className = "run-progress-toast__bar-fill";
  bar.appendChild(fill);
  return bar;
}

function renderProgressPercent(card: ProgressCard, percent: number): void {
  card.element.style.setProperty("--run-progress-percent", `${percent}%`);
  card.percent.textContent = `${percent}%`;
  card.bar.setAttribute("aria-valuenow", String(percent));
}

function normalizeProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_PROGRESS_PERCENT;
  return Math.min(COMPLETE_PROGRESS_PERCENT, Math.max(MIN_PROGRESS_PERCENT, Math.round(percent)));
}

function removeProgress(element: HTMLElement): void {
  element.classList.add("is-leaving");
  window.setTimeout(() => element.remove(), REMOVE_ANIMATION_MS);
}
