/**
 * Controller for the dedicated personal profile page backed by wiki/个人信息档案/about-me.md.
 *
 * The page keeps the dashboard rendering and raw markdown editing in the same
 * surface so the user can edit text and avatar content without leaving the
 * profile route.
 */

import { parseAboutMeProfileMarkdown, type AboutMeProfileDocument } from "./about-me-profile-markdown.js";
import {
  renderLoadedProfile,
  renderMissingProfile,
  renderProfileShell,
  type AboutMeHomeSideCardTab,
  type AboutMeProfileViewModel,
  type AboutMeTab,
} from "./about-me-profile-view.js";

interface AboutMePageResponse {
  path: string;
  title: string | null;
  html: string;
  raw?: string;
  modifiedAt?: string;
  sourceEditable?: boolean;
}

interface AboutMeProfileState {
  path: string;
  activeTab: AboutMeTab;
  activeHomeSideCard: AboutMeHomeSideCardTab;
  editing: boolean;
  saving: boolean;
  statusMessage: string;
  draftRaw: string;
  response: AboutMePageResponse | null;
  document: AboutMeProfileDocument | null;
}

type DisposableNode = HTMLElement & {
  __dispose?: () => void;
};

export function renderAboutMeProfilePage(path: string): HTMLElement {
  const root = document.createElement("section") as DisposableNode;
  const controller = new AbortController();
  const state: AboutMeProfileState = {
    path,
    activeTab: "首页",
    activeHomeSideCard: "时间线",
    editing: false,
    saving: false,
    statusMessage: "",
    draftRaw: "",
    response: null,
    document: null,
  };
  root.className = "about-me-profile";
  root.innerHTML = renderProfileShell(path);
  root.__dispose = () => controller.abort();
  void loadAboutMeProfile(root, state, controller.signal);
  return root;
}

async function loadAboutMeProfile(
  root: HTMLElement,
  state: AboutMeProfileState,
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await fetchAboutMePage(state.path, signal);
    if (signal.aborted) {
      return;
    }
    if (!response) {
      state.response = null;
      state.document = null;
      root.innerHTML = renderMissingProfile(state.path);
      return;
    }
    state.response = response;
    state.document = parseAboutMeProfileMarkdown(response.raw ?? fallbackMarkdown(response));
    state.draftRaw = response.raw ?? fallbackMarkdown(response);
    renderProfile(root, state, signal);
  } catch {
    if (!signal.aborted) {
      root.innerHTML = renderMissingProfile(state.path);
    }
  }
}

async function fetchAboutMePage(path: string, signal: AbortSignal): Promise<AboutMePageResponse | null> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}`, { signal });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as AboutMePageResponse;
}

function fallbackMarkdown(response: AboutMePageResponse): string {
  return `# ${response.title ?? "About Me"}`;
}

function renderProfile(root: HTMLElement, state: AboutMeProfileState, signal: AbortSignal): void {
  root.innerHTML = renderLoadedProfile(toViewModel(state));
  bindTabSwitching(root, state);
  bindHomeSideCardSwitching(root, state, signal);
  bindEditorActions(root, state, signal);
}

function toViewModel(state: AboutMeProfileState): AboutMeProfileViewModel {
  return {
    path: state.path,
    modifiedAt: state.response?.modifiedAt ?? "",
    raw: state.draftRaw,
    sourceEditable: Boolean(state.response?.sourceEditable),
    activeTab: state.activeTab,
    activeHomeSideCard: state.activeHomeSideCard,
    editing: state.editing,
    saving: state.saving,
    statusMessage: state.statusMessage,
    document: state.document,
  };
}

function bindTabSwitching(root: HTMLElement, state: AboutMeProfileState): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-about-me-tab]"));
  if (buttons.length === 0) {
    return;
  }
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-about-me-panel]"));
  const activate = (tab: AboutMeTab): void => {
    state.activeTab = tab;
    for (const button of buttons) {
      const active = button.dataset.aboutMeTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.aboutMePanel !== tab;
    }
  };
  for (const button of buttons) {
    button.onclick = () => activate(button.dataset.aboutMeTab as AboutMeTab);
  }
  activate(state.activeTab);
}

function bindHomeSideCardSwitching(
  root: HTMLElement,
  state: AboutMeProfileState,
  signal: AbortSignal,
): void {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-about-me-home-panel-switch]"),
  );
  for (const button of buttons) {
    button.onclick = () => {
      const nextTab = button.dataset.aboutMeHomePanelSwitch as AboutMeHomeSideCardTab;
      if (nextTab === state.activeHomeSideCard) {
        return;
      }
      state.activeHomeSideCard = nextTab;
      renderProfile(root, state, signal);
    };
  }
}

function bindEditorActions(root: HTMLElement, state: AboutMeProfileState, signal: AbortSignal): void {
  const editButton = root.querySelector<HTMLButtonElement>("[data-about-me-edit]");
  const saveButton = root.querySelector<HTMLButtonElement>("[data-about-me-save]");
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-about-me-cancel]");
  const editor = root.querySelector<HTMLTextAreaElement>("[data-about-me-editor]");

  editButton?.addEventListener("click", () => {
    state.editing = true;
    state.statusMessage = "";
    state.draftRaw = state.response?.raw ?? "";
    renderProfile(root, state, signal);
  });

  cancelButton?.addEventListener("click", () => {
    state.editing = false;
    state.saving = false;
    state.statusMessage = "";
    state.draftRaw = state.response?.raw ?? "";
    renderProfile(root, state, signal);
  });

  if (!saveButton || !editor) {
    return;
  }

  const syncSaveDisabled = (): void => {
    saveButton.disabled = state.saving || editor.value === (state.response?.raw ?? "");
  };

  editor.addEventListener("input", () => {
    state.draftRaw = editor.value;
    syncSaveDisabled();
  });
  syncSaveDisabled();

  saveButton.addEventListener("click", () => {
    state.draftRaw = editor.value;
    void saveAboutMeProfile(root, state, signal);
  });
}

async function saveAboutMeProfile(
  root: HTMLElement,
  state: AboutMeProfileState,
  signal: AbortSignal,
): Promise<void> {
  if (!state.response?.sourceEditable) {
    return;
  }
  state.saving = true;
  state.statusMessage = "";
  renderProfile(root, state, signal);
  try {
    const response = await fetch("/api/page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.path, raw: state.draftRaw }),
      signal,
    });
    if (!response.ok) {
      throw new Error("save failed");
    }
    state.editing = false;
    state.saving = false;
    state.statusMessage = "已保存";
    await loadAboutMeProfile(root, state, signal);
  } catch {
    if (signal.aborted) {
      return;
    }
    state.saving = false;
    state.statusMessage = "保存失败";
    renderProfile(root, state, signal);
  }
}
