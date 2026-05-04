/**
 * Settings user guide panel lifecycle helpers.
 *
 * The user guide now lives inside settings, but its content remains a static
 * client-rendered document so it is available even when local wiki data is not.
 */

import { renderUserGuidePage } from "../user-guide/index.js";

/**
 * Renders the settings panel shell that hosts the user guide document.
 */
export function renderSettingsUserGuidePanel(): string {
  return `
    <section class="settings-panel settings-panel--user-guide" data-settings-panel="user-guide" hidden>
      <div data-settings-user-guide-page></div>
    </section>
  `;
}

/**
 * Mounts the user guide into the settings user-guide section.
 */
export function mountSettingsUserGuidePanel(root: HTMLElement, anchor?: string): void {
  const container = root.querySelector<HTMLElement>("[data-settings-user-guide-page]");
  if (!container) {
    return;
  }
  const page = renderUserGuidePage(anchor);
  container.replaceChildren(page);
}

/**
 * Disposes the embedded user guide page.
 */
export function disposeSettingsUserGuidePanel(root: HTMLElement): void {
  root.querySelector<HTMLElement>("[data-settings-user-guide-page]")?.replaceChildren();
}
