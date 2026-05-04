/**
 * Numeric progress helpers for background check and sync runs.
 *
 * Run status events only say whether a run is still active or finished, while
 * line events can carry more granular stage information. These helpers keep the
 * visible progress honest: running updates are capped below 100%, and terminal
 * status is the only path to a completed progress bar.
 */

const PROGRESS_LINE_PATTERN = /^进度\s+(\d{1,3})%[：:]\s*(.+)$/u;
const MIN_RUNNING_PROGRESS_PERCENT = 1;
const MAX_RUNNING_PROGRESS_PERCENT = 99;
const OBSERVED_LINE_STEP_PERCENT = 4;

export function readRunLineProgress(text: string): { readonly percent: number; readonly message: string } | null {
  const match = PROGRESS_LINE_PATTERN.exec(text.trim());
  if (!match) return null;
  const percent = Number(match[1]);
  const message = match[2]?.trim() ?? "";
  if (!Number.isFinite(percent) || !message) return null;
  return {
    percent: normalizeRunningProgressPercent(percent),
    message,
  };
}

export function normalizeRunningProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_RUNNING_PROGRESS_PERCENT;
  return Math.min(
    MAX_RUNNING_PROGRESS_PERCENT,
    Math.max(MIN_RUNNING_PROGRESS_PERCENT, Math.round(percent)),
  );
}

export function nextObservedLineProgressPercent(currentPercent: number): number {
  return normalizeRunningProgressPercent(currentPercent + OBSERVED_LINE_STEP_PERCENT);
}
