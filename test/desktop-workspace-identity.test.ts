/**
 * Tests the desktop account/workspace ownership boundary used before the
 * Electron shell starts reading or writing a user-selected sync location.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeDesktopSyncCompileConfig } from "../desktop-webui/src/sync-config.js";
import {
  WORKSPACE_METADATA_RELATIVE_PATH,
  ensureWorkspaceBinding,
} from "../desktop-webui/src/workspace-identity.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("desktop workspace identity", () => {
  it("creates owner metadata in a new sync workspace and reuses it for the same account", () => {
    const workspaceRoot = makeTempDir("desktop-workspace-identity-");
    const created = ensureWorkspaceBinding(
      workspaceRoot,
      " Alice@Example.COM ",
      new Date("2026-04-29T00:00:00.000Z"),
      () => "workspace-one",
    );

    expect(created).toMatchObject({
      ok: true,
      created: true,
      metadata: {
        schemaVersion: 1,
        workspaceId: "workspace-one",
        ownerUserId: "alice@example.com",
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    });

    const metadataPath = path.join(workspaceRoot, WORKSPACE_METADATA_RELATIVE_PATH);
    expect(JSON.parse(fs.readFileSync(metadataPath, "utf8"))).toMatchObject({
      workspaceId: "workspace-one",
      ownerUserId: "alice@example.com",
    });

    const reused = ensureWorkspaceBinding(
      workspaceRoot,
      "alice@example.com",
      new Date("2026-04-30T00:00:00.000Z"),
      () => "workspace-two",
    );

    expect(reused).toMatchObject({
      ok: true,
      created: false,
      metadata: {
        workspaceId: "workspace-one",
        ownerUserId: "alice@example.com",
      },
    });
  });

  it("rejects opening a sync workspace owned by another account", () => {
    const workspaceRoot = makeTempDir("desktop-workspace-owned-");
    fs.mkdirSync(path.join(workspaceRoot, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, WORKSPACE_METADATA_RELATIVE_PATH),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: "workspace-one",
        ownerUserId: "owner-a@example.com",
        createdAt: "2026-04-29T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = ensureWorkspaceBinding(workspaceRoot, "owner-b@example.com");

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("belongs to another account"),
    });
  });

  it("scopes the desktop runtime root by account and workspace", () => {
    const projectRoot = makeTempDir("desktop-runtime-scope-");

    const config = normalizeDesktopSyncCompileConfig(
      projectRoot,
      { runtime_output_root: "D:/legacy-runtime" },
      "D:/sync-vault",
      {
        ownerUserId: "Alice@Example.COM",
        workspaceId: "workspace:one",
      },
    );

    expect(config.runtime_output_root).toBe(
      path.join(projectRoot, ".runtime", "accounts", "alice_example.com", "workspace_one"),
    );
  });
});

function makeTempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
