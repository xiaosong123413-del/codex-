/**
 * Settings workflow panel lifecycle helpers.
 *
 * The settings page owns workflow as a secondary-navigation section. This
 * module mounts list, detail, or log workflow views inside that section and
 * tears them down when the user leaves the panel so SSE subscriptions do not
 * keep running in the background.
 */

import {
  renderAutomationLogPage,
  renderAutomationWorkspacePage,
} from "../automation/index.js";

type DisposableElement = HTMLElement & { __dispose?: () => void };

export interface SettingsAutomationPanelState {
  automationId?: string;
  automationLogId?: string;
}

interface MountedAutomationWorkspace {
  key: string;
  workspace: DisposableElement;
}

const mountedAutomationWorkspace = new WeakMap<HTMLElement, MountedAutomationWorkspace>();

const SETTINGS_AUTOMATION_HOME_HASH = "#/settings/automation";

/**
 * Renders the settings panel shell that will host the workflow workspace.
 */
export function renderSettingsAutomationPanel(): string {
  return `
    <section class="settings-panel settings-panel--automation-workspace" data-settings-panel="automation" hidden>
      <div data-settings-automation-workspace></div>
    </section>
  `;
}

/**
 * Mounts the correct workflow subview into the settings automation panel.
 */
export function mountSettingsAutomationPanel(
  root: HTMLElement,
  state: SettingsAutomationPanelState,
): void {
  const nextKey = buildAutomationWorkspaceKey(state);
  const mounted = mountedAutomationWorkspace.get(root);
  if (mounted?.key === nextKey) {
    return;
  }
  disposeSettingsAutomationPanel(root);
  const container = root.querySelector<HTMLElement>("[data-settings-automation-workspace]");
  if (!container) {
    return;
  }
  const workspace = renderAutomationSubview(root, state);
  container.replaceChildren(workspace);
  mountedAutomationWorkspace.set(root, { key: nextKey, workspace: workspace as DisposableElement });
}

/**
 * Disposes the embedded workflow workspace.
 */
export function disposeSettingsAutomationPanel(root: HTMLElement): void {
  const mounted = mountedAutomationWorkspace.get(root);
  mounted?.workspace.__dispose?.();
  mountedAutomationWorkspace.delete(root);
  root.querySelector<HTMLElement>("[data-settings-automation-workspace]")?.replaceChildren();
}

function buildAutomationWorkspaceKey(state: SettingsAutomationPanelState): string {
  if (state.automationLogId) {
    return `log:${state.automationLogId}`;
  }
  return state.automationId ? `detail:${state.automationId}` : "list";
}

function renderAutomationSubview(
  root: HTMLElement,
  state: SettingsAutomationPanelState,
): HTMLElement {
  const options = {
    homeHash: SETTINGS_AUTOMATION_HOME_HASH,
    onNavigate: (target: SettingsAutomationPanelState) => mountSettingsAutomationPanel(root, target),
  };
  if (state.automationLogId) {
    return renderAutomationLogPage(state.automationLogId, options);
  }
  return renderAutomationWorkspacePage(state.automationId, options);
}
