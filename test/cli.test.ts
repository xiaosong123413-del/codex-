import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const exec = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const TSUP_CLI = path.join(REPO_ROOT, "node_modules", "tsup", "dist", "cli-default.js");
let isolatedCliRoot = "";
let cliUnderTest = CLI;

async function cleanupDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

async function runCompileWithoutSources(
  suffix: string,
  envOverrides: NodeJS.ProcessEnv,
): Promise<string> {
  const cwd = path.join(tmpdir(), `llmwiki-test-${suffix}-${Date.now()}`);
  await mkdir(path.join(cwd, "sources"), { recursive: true });
  try {
    const { stdout } = await exec("node", [cliUnderTest, "compile"], {
      cwd,
      env: { ...process.env, ...envOverrides },
    });
    return stdout;
  } finally {
    await cleanupDirectory(cwd);
  }
}

async function createCompileWorkspace(
  suffix: string,
  claudeSettingsContent?: string,
): Promise<{ cwd: string; settingsPath?: string }> {
  const cwd = path.join(tmpdir(), `llmwiki-test-${suffix}-${Date.now()}`);
  await mkdir(path.join(cwd, "sources"), { recursive: true });

  if (!claudeSettingsContent) {
    return { cwd };
  }

  const claudeDir = path.join(cwd, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(settingsPath, claudeSettingsContent, "utf8");
  return { cwd, settingsPath };
}

describe("CLI smoke tests", () => {
  beforeAll(async () => {
    await exec(process.execPath, [TSUP_CLI], { cwd: REPO_ROOT });
    isolatedCliRoot = await mkdtemp(path.join(REPO_ROOT, ".tmp-cli-dist-"));
    await mkdir(path.join(isolatedCliRoot, "dist"), { recursive: true });
    await copyFile(CLI, path.join(isolatedCliRoot, "dist", "cli.js"));
    await copyFile(path.join(REPO_ROOT, "package.json"), path.join(isolatedCliRoot, "package.json"));
    cliUnderTest = path.join(isolatedCliRoot, "dist", "cli.js");
  }, 30_000);

  afterAll(async () => {
    if (isolatedCliRoot) await cleanupDirectory(isolatedCliRoot);
  });

  it("prints help and exits 0", async () => {
    const { stdout } = await exec("node", [cliUnderTest, "--help"]);
    expect(stdout).toContain("llmwiki");
    expect(stdout).toContain("ingest");
    expect(stdout).toContain("compile");
    expect(stdout).toContain("query");
  }, 30_000);

  it("prints version", async () => {
    const { stdout } = await exec("node", [cliUnderTest, "--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);

  it("compile fails without Anthropic credentials", async () => {
    try {
      await exec("node", [cliUnderTest, "compile"], {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          ANTHROPIC_BASE_URL: "http://localhost:11434",
        },
      });
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const error = err as { stderr?: string; code?: number };
      // Should exit with non-zero or print an error
      expect(error.code).not.toBe(0);
    }
  }, 30_000);

  it("compile without sources works with ANTHROPIC_AUTH_TOKEN", async () => {
    const stdout = await runCompileWithoutSources("compile-token", {
      ANTHROPIC_AUTH_TOKEN: "dummy-token",
      ANTHROPIC_API_KEY: "",
    });
    expect(stdout).not.toContain("ANTHROPIC_API_KEY");
  }, 30_000);

  it("compile without sources works with Claude settings auth-token fallback", async () => {
    const workspace = await createCompileWorkspace(
      "compile-claude-settings",
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "fallback-token", ANTHROPIC_MODEL: "Kimi-2.5" } }),
    );

    try {
      const { stdout } = await exec("node", [cliUnderTest, "compile"], {
        cwd: workspace.cwd,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          LLMWIKI_CLAUDE_SETTINGS_PATH: workspace.settingsPath,
        },
      });
      expect(stdout).not.toContain("Anthropic credentials are required");
    } finally {
      await cleanupDirectory(workspace.cwd);
    }
  }, 30_000);

  it("compile without sources works with the Cloudflare provider", async () => {
    const stdout = await runCompileWithoutSources("compile-cloudflare", {
      LLMWIKI_PROVIDER: "cloudflare",
      OPENAI_API_KEY: "",
      CLOUDFLARE_WORKER_URL: "https://example.workers.dev",
      CLOUDFLARE_REMOTE_TOKEN: "remote-token",
    });
    expect(stdout).not.toContain("Unknown provider");
    expect(stdout).not.toContain("OPENAI_API_KEY");
  }, 30_000);

  it("compile reports malformed Claude settings with formatted CLI error", async () => {
    const workspace = await createCompileWorkspace(
      "compile-malformed-claude-settings",
      "{ malformed-json",
    );

    try {
      await exec("node", [cliUnderTest, "compile"], {
        cwd: workspace.cwd,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          LLMWIKI_CLAUDE_SETTINGS_PATH: workspace.settingsPath,
        },
      });
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const error = err as { stderr?: string; code?: number };
      expect(error.code).not.toBe(0);
      expect(error.stderr ?? "").toContain("Error:");
      expect(error.stderr ?? "").toContain("Failed to parse Claude settings");
    } finally {
      await cleanupDirectory(workspace.cwd);
    }
  }, 30_000);

  it("ingest shows next-step hint", async () => {
    const cwd = path.join(tmpdir(), `llmwiki-test-ingest-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    const fixture = path.join(REPO_ROOT, "test", "fixtures", "sample-source.md");
    try {
      const { stdout } = await exec("node", [cliUnderTest, "ingest", fixture], { cwd });
      expect(stdout).toContain("Next: llmwiki compile");
    } finally {
      await cleanupDirectory(cwd);
    }
  }, 30_000);

  it("compile without sources does not show query hint", async () => {
    const stdout = await runCompileWithoutSources("compile", { ANTHROPIC_API_KEY: "dummy" });
    expect(stdout).not.toContain("Next: llmwiki query");
  }, 30_000);
});
