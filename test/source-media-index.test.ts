import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSourceGalleryDetail, listSourceGalleryItems } from "../web/server/services/source-gallery.js";
import { readSourceMediaIndex, scanSourceMediaIndex } from "../web/server/services/source-media-index.js";
import { readSourceOcrSidecar, writeSourceOcrSidecar } from "../web/server/services/ocr-service.js";
import { readSourceTranscriptSidecar, writeSourceTranscriptSidecar } from "../web/server/services/transcript-service.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("source media index", () => {
  it("scans raw and sources_full media into a reconstructable sidecar", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeRoots();
    write(sourceVaultRoot, "raw/\u526a\u85cf/article.md", [
      "---",
      "title: Raw Article",
      "---",
      "",
      "# Raw Article",
      "",
      "![cover](images/cover.png)",
      "[paper](docs/spec.pdf)",
      "![[videos/demo.mp4]]",
      "[audio](audio/sample.wav)",
    ].join("\n"));
    write(sourceVaultRoot, "raw/\u526a\u85cf/images/cover.png", "png");
    write(sourceVaultRoot, "raw/\u526a\u85cf/docs/spec.pdf", "pdf");
    write(sourceVaultRoot, "raw/\u526a\u85cf/videos/demo.mp4", "video");
    write(sourceVaultRoot, "raw/\u526a\u85cf/audio/sample.wav", "audio");
    write(runtimeRoot, "sources_full/compiled.md", [
      "---",
      "title: Compiled Source",
      "---",
      "",
      "# Compiled Source",
      "",
      "![diagram](media/diagram.webp)",
    ].join("\n"));
    write(runtimeRoot, "sources_full/media/diagram.webp", "webp");
    write(runtimeRoot, "sources_full/\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09/loose.pdf", "pdf");

    const index = await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
    const reread = readSourceMediaIndex(runtimeRoot);
    const rawRecord = Object.values(index.records).find((record) => record.path === "raw/\u526a\u85cf/article.md");
    const sourceRecord = Object.values(index.records).find((record) => record.path === "sources_full/compiled.md");

    expect(fs.existsSync(path.join(runtimeRoot, ".llmwiki", "source-media-index.json"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, ".llmwiki", "source-media-index.json"))).toBe(false);
    expect(index.version).toBe(1);
    expect(rawRecord?.mediaCount).toBe(4);
    expect(rawRecord?.mediaKinds).toEqual(["image", "video", "pdf", "audio"]);
    expect(rawRecord?.coverImagePath).toBe("raw/\u526a\u85cf/images/cover.png");
    expect(sourceRecord?.mediaKinds).toEqual(["image"]);
    expect(Object.values(reread.assets).some((asset) => asset.path === "sources_full/\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09/loose.pdf")).toBe(true);
  });

  it("reads and writes OCR and transcript sidecars without external calls", async () => {
    const { runtimeRoot } = makeRoots();

    const ocr = await writeSourceOcrSidecar(runtimeRoot, "source-id", "OCR text");
    const transcript = await writeSourceTranscriptSidecar(runtimeRoot, "source-id", "Transcript text");

    expect(ocr.path).toBe(".llmwiki/ocr/source-id.txt");
    expect(transcript.path).toBe(".llmwiki/transcripts/source-id.txt");
    expect(readSourceOcrSidecar(runtimeRoot, "source-id")).toBe("OCR text");
    expect(readSourceTranscriptSidecar(runtimeRoot, "source-id")).toBe("Transcript text");
  });

  it("surfaces media index fields through source gallery items", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeRoots();
    write(sourceVaultRoot, "raw/\u526a\u85cf/article.md", [
      "---",
      "title: Indexed Item",
      "---",
      "",
      "# Indexed Item",
      "",
      "Body only.",
    ].join("\n"));

    const index = await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
    const record = Object.values(index.records).find((item) => item.path === "raw/\u526a\u85cf/article.md");
    if (!record) throw new Error("expected source media record");
    record.coverImagePath = "raw/\u526a\u85cf/images/cover.png";
    record.mediaCount = 1;
    record.mediaKinds = ["image"];
    record.ocrTextPath = ".llmwiki/ocr/source-id.txt";
    record.transcriptPath = ".llmwiki/transcripts/source-id.txt";
    await fs.promises.writeFile(
      path.join(runtimeRoot, ".llmwiki", "source-media-index.json"),
      `${JSON.stringify(index, null, 2)}\n`,
      "utf8",
    );
    write(sourceVaultRoot, "raw/\u526a\u85cf/images/cover.png", "png");

    const { items } = await listSourceGalleryItems(sourceVaultRoot, runtimeRoot);
    const item = items[0];

    expect(item?.previewImageUrl).toBe(`/api/source-gallery/media?path=${encodeURIComponent("raw/\u526a\u85cf/images/cover.png")}`);
    expect(item?.mediaCount).toBe(1);
    expect(item?.mediaKinds).toEqual(["image"]);
    expect(item?.ocrTextPath).toBe(".llmwiki/ocr/source-id.txt");
    expect(item?.transcriptPath).toBe(".llmwiki/transcripts/source-id.txt");
  });

  it("matches source gallery queries against OCR sidecar text", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeRoots();
    write(sourceVaultRoot, "raw/\u526a\u85cf/article.md", [
      "---",
      "title: Indexed Item",
      "---",
      "",
      "# Indexed Item",
      "",
      "![cover](images/cover.png)",
    ].join("\n"));
    write(sourceVaultRoot, "raw/\u526a\u85cf/images/cover.png", "png");

    const index = await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
    const record = Object.values(index.records).find((item) => item.path === "raw/\u526a\u85cf/article.md");
    if (!record) throw new Error("expected source media record");
    const sidecar = await writeSourceOcrSidecar(runtimeRoot, record.id, "图片里的白板文字");
    record.ocrTextPath = sidecar.path;
    await fs.promises.writeFile(
      path.join(runtimeRoot, ".llmwiki", "source-media-index.json"),
      `${JSON.stringify(index, null, 2)}\n`,
      "utf8",
    );

    const { items } = await listSourceGalleryItems(sourceVaultRoot, runtimeRoot, "白板文字");

    expect(items.map((item) => item.path)).toEqual(["raw/\u526a\u85cf/article.md"]);
  });

  it("returns embedded media entries in source gallery detail", async () => {
    const { sourceVaultRoot, runtimeRoot } = makeRoots();
    write(sourceVaultRoot, "raw/\u526a\u85cf/article.md", [
      "---",
      "title: Indexed Item",
      "---",
      "",
      "# Indexed Item",
      "",
      "![cover](images/cover.png)",
      "[video](videos/demo.mp4)",
    ].join("\n"));
    write(sourceVaultRoot, "raw/\u526a\u85cf/images/cover.png", "png");
    write(sourceVaultRoot, "raw/\u526a\u85cf/videos/demo.mp4", "video");

    await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);

    const { items } = await listSourceGalleryItems(sourceVaultRoot, runtimeRoot);
    const item = items.find((entry) => entry.path === "raw/\u526a\u85cf/article.md");
    if (!item) throw new Error("expected source gallery item");

    const detail = await getSourceGalleryDetail(sourceVaultRoot, runtimeRoot, item.id);

    expect(detail.media).toEqual([
      {
        kind: "image",
        path: "raw/\u526a\u85cf/images/cover.png",
        url: `/api/source-gallery/media?path=${encodeURIComponent("raw/\u526a\u85cf/images/cover.png")}`,
      },
      {
        kind: "video",
        path: "raw/\u526a\u85cf/videos/demo.mp4",
        url: `/api/source-gallery/media?path=${encodeURIComponent("raw/\u526a\u85cf/videos/demo.mp4")}`,
      },
    ]);
  });
});

function makeRoots(): { sourceVaultRoot: string; runtimeRoot: string } {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-media-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-media-runtime-"));
  roots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "raw", "\u526a\u85cf"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "sources_full"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  return { sourceVaultRoot, runtimeRoot };
}

function write(root: string, relativePath: string, content: string): void {
  const full = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}
