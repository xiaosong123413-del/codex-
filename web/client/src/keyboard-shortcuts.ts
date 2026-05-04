/**
 * Shared keyboard-shortcut configuration for the web client.
 *
 * The desktop process persists Electron accelerator strings in the app config.
 * Browser-side shortcuts reuse that same shape so the settings page can show and
 * edit every user-facing shortcut in one place. DOM keyboard events are matched
 * against the configured accelerator without registering any browser-global
 * handler beyond the page code that owns each action.
 */
export interface AppShortcuts {
  readonly flashDiaryCapture: string;
  readonly pageTextSearch: string;
  readonly workflowRecorder: string;
  readonly workspaceSave: string;
}

export type ShortcutId = keyof AppShortcuts;

export const WORKFLOW_RECORDER_OPEN_EVENT = "llmwiki:workflow-recorder-open";
export const WORKFLOW_RECORDER_PENDING_KEY = "llmwiki.workflowRecorderOpenPending";

export const DEFAULT_SHORTCUTS: AppShortcuts = {
  flashDiaryCapture: "CommandOrControl+Shift+J",
  pageTextSearch: "Ctrl+F",
  workflowRecorder: "CommandOrControl+Shift+E",
  workspaceSave: "CommandOrControl+S",
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
let activeShortcuts: AppShortcuts = DEFAULT_SHORTCUTS;

/**
 * Normalizes persisted shortcuts so newly added shortcut ids always appear.
 */
function normalizeShortcutSettings(shortcuts: Partial<AppShortcuts> | null | undefined): AppShortcuts {
  return {
    flashDiaryCapture: normalizeShortcutValue(shortcuts?.flashDiaryCapture, DEFAULT_SHORTCUTS.flashDiaryCapture),
    pageTextSearch: normalizeShortcutValue(shortcuts?.pageTextSearch, DEFAULT_SHORTCUTS.pageTextSearch),
    workflowRecorder: normalizeShortcutValue(shortcuts?.workflowRecorder, DEFAULT_SHORTCUTS.workflowRecorder),
    workspaceSave: normalizeShortcutValue(shortcuts?.workspaceSave, DEFAULT_SHORTCUTS.workspaceSave),
  };
}

/**
 * Replaces the active browser-side shortcut settings.
 */
export function setClientKeyboardShortcuts(shortcuts: Partial<AppShortcuts> | null | undefined): void {
  activeShortcuts = normalizeShortcutSettings(shortcuts);
}

/**
 * Returns the active browser-side shortcut for one action.
 */
export function getClientKeyboardShortcut(id: ShortcutId): string {
  return activeShortcuts[id];
}

/**
 * Converts a keyboard event captured by the settings page into an accelerator.
 */
export function acceleratorFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return null;
  const key = normalizeEventKey(event.key);
  if (!key) return null;
  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Command" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ].filter(Boolean);
  return parts.join("+");
}

/**
 * Checks whether a DOM keydown event matches an Electron-style accelerator.
 */
export function eventMatchesShortcut(event: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  const hasCommandOrControl = event.ctrlKey || event.metaKey;
  return event.altKey === parsed.alt
    && event.shiftKey === parsed.shift
    && (parsed.commandOrControl ? hasCommandOrControl : event.ctrlKey === parsed.ctrl && event.metaKey === parsed.meta)
    && normalizeEventKey(event.key) === parsed.key;
}

function normalizeShortcutValue(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

interface ParsedShortcut {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly commandOrControl: boolean;
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
}

function parseAccelerator(accelerator: string): ParsedShortcut | null {
  const parts = accelerator.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  return {
    alt: modifiers.has("alt") || modifiers.has("option"),
    ctrl: modifiers.has("ctrl") || modifiers.has("control"),
    commandOrControl: modifiers.has("commandorcontrol") || modifiers.has("cmdorctrl"),
    key: normalizeAcceleratorKey(key),
    meta: modifiers.has("command") || modifiers.has("cmd") || modifiers.has("meta") || modifiers.has("super"),
    shift: modifiers.has("shift"),
  };
}

function normalizeAcceleratorKey(key: string): string {
  return normalizeKeyName(key.trim());
}

function normalizeEventKey(key: string): string {
  return normalizeKeyName(key);
}

function normalizeKeyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const normalized = key.toLowerCase();
  if (normalized === " ") return "Space";
  if (normalized.startsWith("arrow")) return normalized.slice("arrow".length).replace(/^\w/, (value) => value.toUpperCase());
  return normalized.replace(/^\w/, (value) => value.toUpperCase());
}
