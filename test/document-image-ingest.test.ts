import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import ingestFile from "../src/ingest/file.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("document image ingest", () => {
  it("extracts office embedded images into sources/media and inserts markdown refs", async () => {
    const root = makeRoot();
    const docx = path.join(root, "Quarter Report.docx");
    fs.writeFileSync(docx, makeZip({
      "word/media/image1.png": makePng(120, 120),
      "word/document.xml": Buffer.from("<document />"),
    }));

    const result = await withCwd(root, () => ingestFile(docx));

    expect(result.title).toBe("Quarter Report");
    expect(result.content).toContain("## Embedded Images");
    expect(result.content).toContain("![](./media/quarter-report/image-001.png)");
    expect(fs.existsSync(path.join(root, "sources", "media", "quarter-report", "image-001.png"))).toBe(true);
  });

  it("extracts common PDF JPEG image streams", async () => {
    const root = makeRoot();
    const pdf = path.join(root, "Paper.pdf");
    fs.writeFileSync(pdf, makePdfWithJpeg(makeJpeg(160, 120)));

    const result = await withCwd(root, () => ingestFile(pdf));

    expect(result.content).toContain("![](./media/paper/image-001.jpg)");
    expect(fs.existsSync(path.join(root, "sources", "media", "paper", "image-001.jpg"))).toBe(true);
  });

  it("extracts DOCX headings, inline styles, lists, and tables as markdown", async () => {
    const root = makeRoot();
    const docx = path.join(root, "Plan.docx");
    fs.writeFileSync(docx, makeDocx());

    const result = await withCwd(root, () => ingestFile(docx));

    expect(result.content).toContain("# Roadmap");
    expect(result.content).toContain("**Bold** and *italic*");
    expect(result.content).toContain("- First task");
    expect(result.content).toContain("| Area | Owner |");
  });

  it("extracts PPTX slides as markdown and writes a text cache", async () => {
    const root = makeRoot();
    const pptx = path.join(root, "Deck.pptx");
    fs.writeFileSync(pptx, makePptx());

    const result = await withCwd(root, () => ingestFile(pptx));

    expect(result.content).toContain("## Slide 1");
    expect(result.content).toContain("Launch Plan");
    expect(result.content).toContain("- Ship beta");
    expect(fs.existsSync(path.join(root, ".cache", "Deck.pptx.txt"))).toBe(true);
  });

  it("extracts spreadsheets with multiple sheets as markdown tables", async () => {
    const root = makeRoot();
    const xlsx = path.join(root, "Metrics.xlsx");
    writeWorkbook(xlsx);

    const result = await withCwd(root, () => ingestFile(xlsx));

    expect(result.content).toContain("## Summary");
    expect(result.content).toContain("| Metric | Value |");
    expect(result.content).toContain("## Detail");
    expect(result.content).toContain("| Region | Count |");
  });

  it("copies image, video, and audio sources into markdown-previewable media pages", async () => {
    const root = makeRoot();
    const image = path.join(root, "Diagram.png");
    fs.writeFileSync(image, makePng(120, 120));

    const result = await withCwd(root, () => ingestFile(image));

    expect(result.content).toContain("![](./media/diagram/Diagram.png)");
    expect(fs.existsSync(path.join(root, "sources", "media", "diagram", "Diagram.png"))).toBe(true);
  });
});

async function withCwd<T>(cwd: string, action: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await action();
  } finally {
    process.chdir(previous);
  }
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "document-image-ingest-"));
  roots.push(root);
  return root;
}

function makeZip(entries: Record<string, Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function makePng(width: number, height: number): Buffer {
  const header = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  return Buffer.concat([header, dims, Buffer.from("08020000000000000049454e44ae426082", "hex")]);
}

function makeJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function makePdfWithJpeg(jpeg: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\n", "latin1"),
    jpeg,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
}

function makeDocx(): Buffer {
  return makeZip({
    "word/document.xml": Buffer.from(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Roadmap</w:t></w:r></w:p>
          <w:p>
            <w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>
            <w:r><w:t> and </w:t></w:r>
            <w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
          </w:p>
          <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>First task</w:t></w:r></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Area</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
            <w:tr><w:tc><w:p><w:r><w:t>Ingest</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>
    `),
  });
}

function makePptx(): Buffer {
  return makeZip({
    "ppt/slides/slide1.xml": Buffer.from(`
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:p><a:r><a:t>Launch Plan</a:t></a:r></a:p>
        <a:p><a:buChar char="•"/><a:r><a:t>Ship beta</a:t></a:r></a:p>
      </p:sld>
    `),
  });
}

function writeWorkbook(filePath: string): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Metric", "Value"],
    ["Users", 42],
  ]), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Region", "Count"],
    ["NA", 7],
  ]), "Detail");
  XLSX.writeFile(workbook, filePath);
}
