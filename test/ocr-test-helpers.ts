/**
 * Shared helpers for OCR route and orchestration tests.
 *
 * OCR tests need the same small filesystem harness and Cloudflare Worker env
 * stubs. Keeping those helpers here prevents each test from duplicating the
 * cleanup and response boilerplate while still exercising the real services.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeOcrRoots(
  trackedRoots: string[],
  prefix: string,
  options: { includeProjectRoot?: boolean } = {},
): { projectRoot: string; sourceVaultRoot: string; runtimeRoot: string } {
  const projectRoot = options.includeProjectRoot
    ? fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-project-`))
    : "";
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-source-`));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-runtime-`));
  trackedRoots.push(...[projectRoot, sourceVaultRoot, runtimeRoot].filter(Boolean));
  return { projectRoot, sourceVaultRoot, runtimeRoot };
}

export function removeTrackedRoots(trackedRoots: string[]): void {
  while (trackedRoots.length > 0) {
    const root = trackedRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}

export function writeTextFile(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export function stubCloudflareOcrEnv(envBackup: Map<string, string | undefined>): void {
  stubEnv(envBackup, {
    CLOUDFLARE_WORKER_URL: "https://worker.example.com",
    CLOUDFLARE_REMOTE_TOKEN: "remote-secret",
    CLOUDFLARE_OCR_MODEL: "@cf/test/ocr",
  });
}

export function restoreEnv(envBackup: Map<string, string | undefined>): void {
  for (const [key, value] of envBackup.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envBackup.clear();
}

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubEnv(envBackup: Map<string, string | undefined>, values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!envBackup.has(key)) envBackup.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
