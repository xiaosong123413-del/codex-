/**
 * Tests for source-image OCR orchestration.
 *
 * These cover the shared pipeline used by source gallery actions, diary image
 * OCR, search indexing, and the mobile-facing OCR route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeSourceOcrSidecar } from "../web/server/services/ocr-service.js";
import { runSourceGalleryOcr } from "../web/server/services/source-gallery.js";
import { readSourceMediaIndex, scanSourceMediaIndex, writeSourceMediaIndex } from "../web/server/services/source-media-index.js";
import {
  jsonResponse,
  makeOcrRoots,
  removeTrackedRoots,
  restoreEnv,
  stubCloudflareOcrEnv,
  writeTextFile,
} from "./ocr-test-helpers.js";

const roots: string[] = [];
const envBackup = new Map<string, string | undefined>();

afterEach(() => {
  restoreEnv(envBackup);
  vi.unstubAllGlobals();
  removeTrackedRoots(roots);
});

describe("source OCR orchestration", () => {
  it("runs source gallery OCR through the shared source-image pipeline", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeOcrRoots(roots, "source-ocr");
    writeTextFile(sourceVaultRoot, "raw/剪藏/two-images.md", [
      "# Two Images",
      "",
      "![front](images/front.png)",
      "![back](images/back.png)",
    ].join("\n"));
    writeTextFile(sourceVaultRoot, "raw/剪藏/images/front.png", "front-bytes");
    writeTextFile(sourceVaultRoot, "raw/剪藏/images/back.png", "back-bytes");
    const index = await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
    const record = Object.values(index.records).find((item) => item.path === "raw/剪藏/two-images.md");
    if (!record) throw new Error("expected source media record");
    stubCloudflareOcrEnv(envBackup);
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { filename?: string };
      return jsonResponse({ text: `${body.filename ?? "unknown"} text` });
    }));

    const result = await runSourceGalleryOcr(sourceVaultRoot, runtimeRoot, record.id);
    const reread = readSourceMediaIndex(runtimeRoot).records[record.id];

    expect(result.path).toBe(`.llmwiki/ocr/${record.id}.txt`);
    expect(result.text).toContain("front.png text");
    expect(result.text).toContain("back.png text");
    expect(reread?.ocrTextPath).toBe(result.path);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("refreshes OCR sidecars that were written before the current OCR prompt version", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeOcrRoots(roots, "source-ocr-refresh");
    writeTextFile(sourceVaultRoot, "raw/剪藏/screenshot.md", [
      "# Screenshot",
      "",
      "![screen](images/screen.png)",
    ].join("\n"));
    writeTextFile(sourceVaultRoot, "raw/剪藏/images/screen.png", "image-bytes");
    const index = await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
    const record = Object.values(index.records).find((item) => item.path === "raw/剪藏/screenshot.md");
    if (!record) throw new Error("expected source media record");
    const staleSidecar = await writeSourceOcrSidecar(runtimeRoot, record.id, "old English image description");
    index.records[record.id] = { ...record, ocrTextPath: staleSidecar.path };
    await writeSourceMediaIndex(runtimeRoot, index);
    stubCloudflareOcrEnv(envBackup);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ text: "我们认真评估了你提交的申请。" })));

    const result = await runSourceGalleryOcr(sourceVaultRoot, runtimeRoot, record.id);
    const reread = readSourceMediaIndex(runtimeRoot).records[record.id];

    expect(result.text).toContain("我们认真评估");
    expect(result.text).not.toContain("old English image description");
    expect("ocrFingerprint" in (reread ?? {})).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
