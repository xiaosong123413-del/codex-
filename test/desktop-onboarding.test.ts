import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("desktop onboarding startup flow", () => {
  it("implements a persisted startup state machine in the Electron main process", async () => {
    const mainSource = await readFile(
      path.join(root, "desktop-webui", "src", "main.ts"),
      "utf8",
    );

    expect(mainSource).toContain("UNCONFIGURED");
    expect(mainSource).toContain("CONFIGURING");
    expect(mainSource).toContain("INITIALIZING");
    expect(mainSource).toContain("READY");
    expect(mainSource).toContain("app.getPath(\"userData\")");
    expect(mainSource).toContain("initialized");
    expect(mainSource).toContain("lastSyncAt");
    expect(mainSource).toContain("lastCompileAt");
    expect(mainSource).toContain("accountIdentifier");
    expect(mainSource).toContain("accountSession");
    expect(mainSource).toContain("authenticateAccount");
    expect(mainSource).toContain("saveRemoteSyncLocation");
    expect(mainSource).toContain("CLOUDFLARE_ACCOUNT_SESSION_TOKEN");
    expect(mainSource).toContain("ensureWorkspaceBinding");
    expect(mainSource).toContain("WORKSPACE_METADATA_RELATIVE_PATH");
    expect(mainSource).toContain("desktop:choose-source-folders");
    expect(mainSource).toContain("desktop:initialize-app");
    expect(mainSource).toContain("runInitializationInBackground");
    expect(mainSource).toContain("appendProjectLog");
    expect(mainSource).toContain("The background initialization flag should not bounce the desktop UI");
    expect(mainSource).not.toContain("if (!appConfig.initialized) return \"CONFIGURING\";");
  });

  it("exposes onboarding and initialization APIs through the preload bridge", async () => {
    const preloadSource = await readFile(
      path.join(root, "desktop-webui", "src", "preload.ts"),
      "utf8",
    );

    expect(preloadSource).toContain("chooseSourceFolders");
    expect(preloadSource).toContain("getAppBootstrap");
    expect(preloadSource).toContain("initializeApp");
    expect(preloadSource).toContain("accountIdentifier");
    expect(preloadSource).toContain("accountPassword");
    expect(preloadSource).toContain("authMode");
    expect(preloadSource).toContain("onInitializationProgress");
  });

  it("renders a welcome page and initialization page before the main workspace", async () => {
    const html = await readFile(path.join(root, "web", "client", "index.html"), "utf8");
    const client = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");
    const styles = await readFile(path.join(root, "web", "client", "styles.css"), "utf8");

    expect(html).toContain("\u4ece\u8fd9\u91cc\u5f00\u542f\u4f60\u7684\u7b2c\u4e8c\u5927\u8111");
    expect(html).toContain("id=\"welcome-screen\"");
    expect(html).toContain("id=\"setup-screen\" class=\"startup-screen hidden\" hidden");
    expect(html).toContain("id=\"workspace-shell\" class=\"hidden\" hidden");
    expect(html).toContain("id=\"account-identifier\"");
    expect(html).toContain("id=\"account-password\"");
    expect(html).toContain("id=\"account-auth-mode\"");
    expect(html).toContain("id=\"setup-copy\"");
    expect(html).toContain("id=\"setup-workspace-target\"");
    expect(html).toContain("id=\"setup-workspace-sources\"");
    expect(html).toContain("id=\"start-initialize\"");
    expect(html).not.toContain("id=\"initialize-log\"");
    expect(html).toContain("\u76ee\u6807\u4ed3\u5e93");
    expect(html).toContain("\u8d26\u53f7\u6807\u8bc6");
    expect(html).toContain("\u5bc6\u7801");
    expect(html).toContain("\u540c\u6b65\u6e90\u6587\u4ef6\u5939");
    expect(client).toContain("getAppBootstrap");
    expect(client).toContain("UNCONFIGURED");
    expect(client).toContain("INITIALIZING");
    expect(client).toContain("startInitialization");
    expect(client).toContain("accountIdentifier");
    expect(client).toContain("accountPassword");
    expect(client).toContain("accountAuthMode");
    expect(client).toContain("shouldReusePersistedWorkspace");
    expect(client).toContain("hasPersistedWorkspaceConfig");
    expect(client).toContain("readSetupWorkspaceSelection");
    expect(client).toContain("renderStartupState");
    expect(client).toContain("setElementHidden");
    expect(client).toContain("element.hidden = hidden");
    expect(client).toContain("void window.llmWikiDesktop.initializeApp(payload)");
    expect(client).not.toContain("initializeLog");
    expect(styles).toContain("#welcome-screen");
    expect(styles).toContain("#setup-screen");
    expect(styles).toContain("#account-identifier");
    expect(styles).toContain("#account-password");
    expect(styles).toContain("#account-auth-mode");
    expect(styles).toContain("#start-initialize");
    expect(styles).not.toContain(".initialize-log");
  });
});
