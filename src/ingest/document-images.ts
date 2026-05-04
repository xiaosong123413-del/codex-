/**
 * Extract embedded raster images from local document files during ingest.
 *
 * DOCX and PPTX are ZIP containers, so their media files can be copied out
 * directly. PDF support is intentionally conservative: it extracts common
 * embedded JPEG/PNG streams and leaves vector drawings or unusual encodings
 * untouched instead of pretending every PDF page can be rendered.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inflateZipEntry, readZipEntries } from "./zip.js";

interface ExtractedDocumentImage {
  relPath: string;
  mimeType: string;
  width?: number;
  height?: number;
  sha256: string;
}

const OFFICE_MEDIA_RE = /^(word|ppt)\/media\/[^/]+\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGES_PER_DOCUMENT = 500;
const MIN_IMAGE_DIMENSION = 100;

export async function extractDocumentImages(
  sourceFile: string,
  outputDir: string,
  relDir: string,
): Promise<ExtractedDocumentImage[]> {
  const ext = path.extname(sourceFile).toLowerCase();
  const bytes = await fs.readFile(sourceFile);
  if (ext === ".docx" || ext === ".pptx") {
    return extractOfficeImages(bytes, outputDir, relDir);
  }
  if (ext === ".pdf") {
    return extractPdfImages(bytes, outputDir, relDir);
  }
  return [];
}

async function extractOfficeImages(
  bytes: Buffer,
  outputDir: string,
  relDir: string,
): Promise<ExtractedDocumentImage[]> {
  const entries = readZipEntries(bytes).filter((entry) => OFFICE_MEDIA_RE.test(entry.name));
  const images: ExtractedDocumentImage[] = [];
  for (const entry of entries.slice(0, MAX_IMAGES_PER_DOCUMENT)) {
    const data = inflateZipEntry(bytes, entry);
    const image = await persistImage(data, path.extname(entry.name), outputDir, relDir, images.length + 1);
    if (image) images.push(image);
  }
  return images;
}

async function extractPdfImages(
  bytes: Buffer,
  outputDir: string,
  relDir: string,
): Promise<ExtractedDocumentImage[]> {
  const images: ExtractedDocumentImage[] = [];
  const source = bytes.toString("latin1");
  const streamRe = /<<(?:.|\r|\n)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamRe)) {
    if (images.length >= MAX_IMAGES_PER_DOCUMENT) break;
    const header = match[0].slice(0, Math.max(0, match[0].indexOf("stream")));
    const ext = readPdfImageExtension(header);
    if (!ext) continue;
    const streamBytes = Buffer.from(match[1] ?? "", "latin1");
    const image = await persistImage(streamBytes, ext, outputDir, relDir, images.length + 1);
    if (image) images.push(image);
  }
  return images;
}

async function persistImage(
  bytes: Buffer,
  extension: string,
  outputDir: string,
  relDir: string,
  index: number,
): Promise<ExtractedDocumentImage | null> {
  const dimensions = readImageDimensions(bytes);
  if (dimensions && (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION)) {
    return null;
  }
  const normalizedExt = normalizeImageExtension(extension, bytes);
  if (!normalizedExt) return null;
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `image-${String(index).padStart(3, "0")}${normalizedExt}`;
  await fs.writeFile(path.join(outputDir, fileName), bytes);
  return {
    relPath: path.posix.join(relDir, fileName),
    mimeType: mimeTypeForExtension(normalizedExt),
    width: dimensions?.width,
    height: dimensions?.height,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function readPdfImageExtension(header: string): string | null {
  if (!/\/Subtype\s*\/Image\b/.test(header)) return null;
  if (/\/Filter\s*(?:\[)?\s*\/DCTDecode\b/.test(header)) return ".jpg";
  if (/\/Filter\s*(?:\[)?\s*\/JPXDecode\b/.test(header)) return ".jp2";
  if (/\/Filter\s*(?:\[)?\s*\/FlateDecode\b/.test(header) && /\/ColorSpace\s*\/DeviceRGB\b/.test(header)) return null;
  return null;
}

function readImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes);
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function normalizeImageExtension(extension: string, bytes: Buffer): string | null {
  const ext = extension.toLowerCase();
  if (ext === ".jpeg") return ".jpg";
  if ([".png", ".jpg", ".gif", ".webp", ".bmp"].includes(ext)) return ext;
  if (bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  return null;
}

function mimeTypeForExtension(extension: string): string {
  if (extension === ".jpg") return "image/jpeg";
  return `image/${extension.slice(1)}`;
}
