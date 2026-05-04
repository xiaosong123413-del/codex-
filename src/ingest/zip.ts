/**
 * Lightweight ZIP reader for Office-style document containers.
 *
 * The ingest pipeline only needs to read known XML/media entries from local
 * DOCX/PPTX/ODS files, so this module implements the narrow ZIP operations
 * required by those formats without exposing archive mutation primitives.
 */

import zlib from "node:zlib";

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Return central-directory entries from a ZIP buffer. */
export function readZipEntries(bytes: Buffer): ZipEntry[] {
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) return [];
  const centralDirSize = bytes.readUInt32LE(end + 12);
  const centralDirOffset = bytes.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  const limit = centralDirOffset + centralDirSize;
  while (offset + 46 <= limit && bytes.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    entries.push({
      name: bytes.toString("utf8", offset + 46, offset + 46 + nameLength),
      compression: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      uncompressedSize: bytes.readUInt32LE(offset + 24),
      localHeaderOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflate a stored or deflated ZIP entry. Unsupported methods return empty data. */
export function inflateZipEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (bytes.readUInt32LE(offset) !== 0x04034b50) return Buffer.alloc(0);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) {
    return zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
  if (entry.uncompressedSize === 0) return Buffer.alloc(0);
  return Buffer.alloc(0);
}

/** Read a ZIP entry as UTF-8 text. */
export function readZipText(bytes: Buffer, entryName: string): string | null {
  const entry = readZipEntries(bytes).find((candidate) => candidate.name === entryName);
  if (!entry) return null;
  const inflated = inflateZipEntry(bytes, entry);
  return inflated.length === 0 ? "" : inflated.toString("utf8");
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const min = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
