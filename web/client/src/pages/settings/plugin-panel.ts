/**
 * Reserved plugin settings entry.
 *
 * Plugin management is intentionally not exposed yet. The settings page keeps
 * a stable entry point so users can find where core and community plugin
 * support will live once the feature is ready.
 */

type PluginKind = "core" | "third-party";

export interface PluginPanelTarget {
  readonly kind: PluginKind;
  readonly pluginId?: string;
}

interface PluginPlaceholderCopy {
  readonly title: string;
  readonly description: string;
  readonly status: string;
}

const PLUGIN_PLACEHOLDER_COPY: Readonly<Record<PluginKind, PluginPlaceholderCopy>> = {
  core: {
    title: "核心插件",
    description: "核心插件入口已保留，后续版本将支持内置能力的插件化管理。",
    status: "核心插件详情后续支持。",
  },
  "third-party": {
    title: "第三方插件",
    description: "第三方插件入口已保留，后续版本将支持社区插件安装、更新和管理。",
    status: "第三方插件安装与管理后续支持。",
  },
};

/** Renders no concrete plugin groups until plugin support is available. */
export function renderPluginSidebarGroups(): string {
  return "";
}

/** Renders the reserved plugin settings section. */
export function renderPluginsPanel(): string {
  const copy = PLUGIN_PLACEHOLDER_COPY["third-party"];
  return `
    <section class="settings-panel settings-plugins" data-settings-panel="plugins" hidden>
      <article class="settings-plugin-preferences" data-plugin-placeholder>
        <div class="settings-plugin-preferences__row">
          <div>
            <h2 data-plugin-placeholder-title>${copy.title}</h2>
            <p data-plugin-placeholder-copy>${copy.description}</p>
          </div>
        </div>
        <p class="settings-plugin-status" data-plugin-status>${copy.status}</p>
      </article>
    </section>
  `;
}

/** Binds the reserved plugin section to its default copy. */
export function bindPluginsPanel(root: HTMLElement): void {
  selectPluginPanelTarget(root, { kind: "third-party" });
}

/** Selects which reserved plugin entry copy is shown. */
export function selectPluginPanelTarget(root: HTMLElement, target: PluginPanelTarget): void {
  const panel = root.querySelector<HTMLElement>("[data-settings-panel=\"plugins\"]");
  if (!panel) return;
  const copy = PLUGIN_PLACEHOLDER_COPY[target.kind];
  updateText(panel, "[data-plugin-placeholder-title]", copy.title);
  updateText(panel, "[data-plugin-placeholder-copy]", copy.description);
  updateText(panel, "[data-plugin-status]", pluginStatusForTarget(target, copy));
}

function pluginStatusForTarget(target: PluginPanelTarget, copy: PluginPlaceholderCopy): string {
  if (target.pluginId) {
    return "具体插件详情已移除，后续版本会重新支持插件详情页。";
  }
  return copy.status;
}

function updateText(root: HTMLElement, selector: string, text: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}
