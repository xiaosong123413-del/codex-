/**
 * Settings project log panel lifecycle helpers.
 *
 * The project log is exposed as a settings sub-page. This module mounts the
 * real project log page inside the settings panel only while that section is
 * active, so document-level listeners are cleaned up when the user switches
 * away.
 */

import { renderProjectLogPage } from "../project-log/index.js";

type DisposableElement = HTMLElement & { __dispose?: () => void };

const mountedProjectLogPage = new WeakMap<HTMLElement, DisposableElement>();

/**
 * Renders the settings panel shell that hosts the project log page.
 */
export function renderSettingsProjectLogPanel(): string {
  return `
    <section class="settings-panel settings-panel--project-log" data-settings-panel="project-log" hidden>
      <div data-settings-project-log-page></div>
    </section>
  `;
}

/**
 * Mounts the project log page into the settings project-log section.
 */
export function mountSettingsProjectLogPanel(root: HTMLElement): void {
  if (mountedProjectLogPage.has(root)) {
    return;
  }
  const container = root.querySelector<HTMLElement>("[data-settings-project-log-page]");
  if (!container) {
    return;
  }
  const page = renderProjectLogPage();
  container.replaceChildren(page);
  mountedProjectLogPage.set(root, page as DisposableElement);
}

/**
 * Disposes the embedded project log page.
 */
export function disposeSettingsProjectLogPanel(root: HTMLElement): void {
  const mounted = mountedProjectLogPage.get(root);
  mounted?.__dispose?.();
  mountedProjectLogPage.delete(root);
  root.querySelector<HTMLElement>("[data-settings-project-log-page]")?.replaceChildren();
}
