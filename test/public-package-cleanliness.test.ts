/**
 * Guards the public packaging boundary so release artifacts cannot include the
 * developer's local runtime, secrets, cookies, tokens, or personal vault data.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("public package cleanliness guard", () => {
  it("blocks private local data from public release directories", async () => {
    const script = await readFile(path.join(root, "scripts", "assert-public-package-clean.mjs"), "utf8");
    const packageJson = await readFile(path.join(root, "package.json"), "utf8");
    const launcherBuild = await readFile(path.join(root, "scripts", "build-desktop-webui-launcher.ps1"), "utf8");
    const guiBuild = await readFile(path.join(root, "scripts", "build-gui.ps1"), "utf8");

    expect(packageJson).toContain("public-package:check");
    expect(launcherBuild).toContain("assert-public-package-clean.mjs");
    expect(guiBuild).toContain("assert-public-package-clean.mjs");
    expect(script).toContain(".runtime");
    expect(script).toContain(".env");
    expect(script).toContain("sync-compile-config");
    expect(script).toContain("app-config");
    expect(script).toContain("cookie");
    expect(script).toContain("token");
    expect(script).toContain("ai-vault");
    expect(script).toContain("raw");
    expect(script).toContain("wiki");
    expect(script).toContain("sources_full");
  });
});
