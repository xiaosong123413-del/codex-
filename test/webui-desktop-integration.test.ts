import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDefaultDesktopRuntimeRoot, normalizeDesktopSyncCompileConfig } from "../desktop-webui/src/sync-config";

const root = path.resolve(import.meta.dirname, "..");

describe("webui desktop integration", () => {
  it("adds a dedicated desktop launcher build script and source", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const buildScript = await readFile(
      path.join(root, "scripts", "build-desktop-webui-launcher.ps1"),
      "utf8",
    );
    const launcherSource = await readFile(
      path.join(root, "desktop-webui-launcher", "Program.cs"),
      "utf8",
    );

    expect(packageJson.scripts?.["desktop:webui:launcher:build"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop-webui-launcher.ps1",
    );
    expect(buildScript).toContain("LLM-Wiki-WebUI-Launcher.exe");
    expect(buildScript).toContain("csc.exe");
    expect(buildScript).toContain("/target:winexe");
    expect(launcherSource).toContain("npm run web:build");
    expect(launcherSource).toContain("ElectronExe");
    expect(launcherSource).toContain("npm run build");
    expect(launcherSource).toContain("Process.Start(info)");
  });

  it("extends the tree and page routes for wiki/raw browsing plus activity logs", async () => {
    const treeRoute = await readFile(
      path.join(root, "web", "server", "routes", "tree.ts"),
      "utf8",
    );
    const pageRoute = await readFile(
      path.join(root, "web", "server", "routes", "pages.ts"),
      "utf8",
    );
    const serverEntry = await readFile(
      path.join(root, "web", "server", "index.ts"),
      "utf8",
    );

    expect(treeRoute).toContain("layer");
    expect(treeRoute).toContain("\"raw\"");
    expect(treeRoute).toContain("q");
    expect(treeRoute).toContain("sources_full");
    expect(treeRoute).toContain("sources");
    expect(pageRoute).toContain("handleActivityLog");
    expect(pageRoute).toContain("log.md");
    expect(pageRoute).toContain("sizeBytes");
    expect(pageRoute).toContain("modifiedAt");
    expect(pageRoute).toContain("aliases");
    expect(serverEntry).toContain("app.get(\"/api/log\"");
  });

  it("adds desktop settings and activity log panels to the browser client", async () => {
    const html = await readFile(path.join(root, "web", "client", "index.html"), "utf8");
    const client = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");
    const browser = await readFile(path.join(root, "web", "client", "src", "shell", "browser.ts"), "utf8");
    const rail = await readFile(path.join(root, "web", "client", "src", "shell", "rail.ts"), "utf8");
    const settingsPage = await readFile(path.join(root, "web", "client", "src", "pages", "settings", "index.ts"), "utf8");
    const settingsProjectLogPanel = await readFile(
      path.join(root, "web", "client", "src", "pages", "settings", "project-log-panel.ts"),
      "utf8",
    );
    const projectLogPage = await readFile(path.join(root, "web", "client", "src", "pages", "project-log", "index.ts"), "utf8");
    const shellStyles = await readFile(path.join(root, "web", "client", "assets", "styles", "shell.css"), "utf8");
    const styles = await readFile(path.join(root, "web", "client", "styles.css"), "utf8");

    expect(html).toContain("id=\"shell-browser-slot\"");
    expect(html).toContain("id=\"shell-browser-rail-toggle\"");
    expect(html).toContain("id=\"shell-main-slot\"");
    expect(html).not.toContain("id=\"settings-dialog\"");
    expect(html).not.toContain("id=\"activity-log-panel\"");
    expect(browser).toContain("id=\"layer-toggle\"");
    expect(browser).toContain("id=\"tree-search\"");
    expect(rail).toContain("settings");
    expect(client).toContain("loadTree(");
    expect(client).toContain("currentLayer");
    expect(client).toContain("treeSearch");
    expect(client).toContain("window.llmWikiDesktop");
    expect(client).toContain("browserRailToggle");
    expect(client).toContain("setChatBrowserCollapsed(false)");
    expect(settingsPage).toContain("renderSettingsProjectLogPanel");
    expect(settingsProjectLogPanel).toContain("data-settings-project-log-page");
    expect(projectLogPage).toContain("/api/project-log");
    expect(shellStyles).toContain(".layer-toggle");
    expect(shellStyles).toContain(".shell-browser__rail-toggle");
    expect(styles).toContain(".settings-page");
    expect(styles).toContain(".project-log-page");
  });

  it("keeps the desktop chat bootstrap aligned with the chat page app-selector API", async () => {
    const client = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");

    expect(client).toContain("onAppChange:");
    expect(client).toContain("chatPage.setApps(");
    expect(client).toContain("chatPage?.setApp(");
    expect(client).not.toContain("onAgentChange:");
    expect(client).not.toContain("chatPage.setAgents(");
    expect(client).not.toContain("chatPage?.setAgent(");
  });

  it("forces a fresh web bundle and server restart for the desktop app", async () => {
    const launcherScript = await readFile(
      path.join(root, "scripts", "start-desktop-webui.ps1"),
      "utf8",
    );
    const desktopMain = await readFile(
      path.join(root, "desktop-webui", "src", "main.ts"),
      "utf8",
    );
    const syncConfigHelper = await readFile(
      path.join(root, "desktop-webui", "src", "sync-config.ts"),
      "utf8",
    );

    expect(launcherScript).toContain("npm run web:build");
    expect(launcherScript).toContain("$config.runtime_output_root");
    expect(launcherScript).not.toContain("$config.target_vault");
    expect(launcherScript).not.toContain('Join-Path ([string]$config.target_vault) "wiki"');
    expect(desktopMain).toContain("await startWebServer(desktopConfig.targetVault, true);");
    expect(desktopMain).toContain("\"--source-vault\"");
    expect(desktopMain).toContain("\"--runtime-root\"");
    expect(desktopMain).toContain("normalizeDesktopSyncCompileConfig");
    expect(desktopMain).not.toContain("target_vault?: string");
    expect(desktopMain).not.toContain("source_vault_root?.trim() || targetVault.trim()");
    expect(desktopMain).not.toContain("target_vault: normalizedTargetVault");
    expect(desktopMain).not.toContain("target_vault: targetRepoPath");
    expect(syncConfigHelper).toContain('path.join(projectRoot, ".runtime", "ai-vault")');
    expect(syncConfigHelper).toContain("runtime_output_root: runtimeOutputRoot");
    expect(desktopMain).toContain("if (!forceRestart && await isServerCompatible(DEFAULT_WEB_PORT))");
    expect(desktopMain).toContain("const liveRestart = forceRestart && Boolean(mainWindow);");
    expect(desktopMain).toContain("const restartPort = activeWebPort;");
    expect(desktopMain).toContain("await waitForPortToClose(restartPort)");
    expect(desktopMain).toContain("liveRestart && restartPort === DEFAULT_WEB_PORT");
    expect(desktopMain).toContain("Local LLM Wiki web server port ${restartPort} is unavailable during live restart.");
  });

  it("normalizes desktop sync config so bootstrap always has an explicit runtime root", () => {
    const projectRoot = "D:/Desktop/llm-wiki-compiler-main";
    const sourceVaultRoot = "D:/Desktop/ai-vault";

    const normalized = normalizeDesktopSyncCompileConfig(projectRoot, {}, sourceVaultRoot);
    const preserved = normalizeDesktopSyncCompileConfig(projectRoot, {
      runtime_output_root: "D:/custom/runtime-root",
    }, sourceVaultRoot);

    expect(normalized.source_vault_root).toBe(sourceVaultRoot);
    expect(normalized.runtime_output_root).toBe(getDefaultDesktopRuntimeRoot(projectRoot));
    expect(preserved.runtime_output_root).toBe("D:/custom/runtime-root");
  });
});
