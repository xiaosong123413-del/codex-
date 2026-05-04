/**
 * Settings dialog launcher.
 *
 * The global rail opens settings as a focused modal while direct settings
 * routes can still render the same settings page as a full page. This module
 * owns only the modal shell and delegates all settings behavior to
 * `renderSettingsPage`.
 */

import { renderIcon } from "../../components/icon.js";
import { renderSettingsPage } from "./index.js";

type SettingsDialogPluginKind = "core" | "third-party";

type DisposableSettingsPage = HTMLElement & {
  __dispose?: () => void;
};

type SettingsDialogRoot = HTMLElement & {
  __close?: () => void;
};

interface SettingsDialogOptions {
  readonly initialSection?: string;
  readonly initialPluginKind?: SettingsDialogPluginKind;
  readonly onClose?: () => void;
}

const SETTINGS_DIALOG_SELECTOR = "[data-settings-dialog]";

/** Opens the settings modal and returns its root element. */
export function openSettingsDialog(options: SettingsDialogOptions = {}): HTMLElement {
  closeExistingSettingsDialog();
  const host = createSettingsDialogHost();
  const page = renderSettingsPage(options.initialSection ?? "plugins", {
    isDialog: true,
    pluginKind: options.initialPluginKind ?? "third-party",
  }) as DisposableSettingsPage;
  page.classList.add("settings-page--dialog");
  host.querySelector<HTMLElement>("[data-settings-dialog-content]")?.append(page);
  bindSettingsDialog(host, page, options.onClose);
  document.body.append(host);
  return host;
}

function closeExistingSettingsDialog(): void {
  const existing = document.querySelector<SettingsDialogRoot>(SETTINGS_DIALOG_SELECTOR);
  if (existing?.__close) {
    existing.__close();
    return;
  }
  existing?.remove();
}

function createSettingsDialogHost(): SettingsDialogRoot {
  const host = document.createElement("div") as SettingsDialogRoot;
  host.className = "settings-dialog";
  host.dataset.settingsDialog = "true";
  host.innerHTML = `
    <button type="button" class="settings-dialog__backdrop" data-settings-dialog-close aria-label="关闭设置"></button>
    <section class="settings-dialog__panel" role="dialog" aria-modal="true" aria-label="设置">
      <button type="button" class="settings-dialog__close" data-settings-dialog-close aria-label="关闭设置" title="关闭设置">${renderIcon("x", { size: 20 })}</button>
      <div class="settings-dialog__content" data-settings-dialog-content></div>
    </section>
  `;
  return host;
}

function bindSettingsDialog(
  host: SettingsDialogRoot,
  page: DisposableSettingsPage,
  onClose: (() => void) | undefined,
): void {
  const close = (): void => {
    window.removeEventListener("keydown", handleKeydown);
    page.__dispose?.();
    host.remove();
    onClose?.();
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  host.__close = close;
  host.querySelectorAll<HTMLButtonElement>("[data-settings-dialog-close]").forEach((button) => {
    button.addEventListener("click", close);
  });
  window.addEventListener("keydown", handleKeydown);
}
