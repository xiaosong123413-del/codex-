/**
 * Markdown chunker for local vector indexing.
 *
 * It preserves heading breadcrumbs for each chunk so semantic search can match
 * short content with its surrounding page structure, matching the legacy v2
 * LanceDB row shape.
 */

interface TextChunk {
  index: number;
  text: string;
  headingPath: string;
}

interface ChunkOptions {
  targetChars: number;
  overlapChars: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/u;

/** Splits markdown into overlapping chunks with stable heading paths. */
export function chunkMarkdown(content: string, options: ChunkOptions): TextChunk[] {
  const targetChars = Math.max(200, options.targetChars);
  const overlapChars = Math.min(Math.max(0, options.overlapChars), Math.floor(targetChars / 2));
  const sections = splitByHeadings(content);
  const chunks: TextChunk[] = [];
  for (const section of sections) {
    appendSectionChunks(chunks, section.text, section.headingPath, targetChars, overlapChars);
  }
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

function splitByHeadings(content: string): Array<{ headingPath: string; text: string }> {
  const sections: Array<{ headingPath: string; text: string }> = [];
  const headings: string[] = [];
  let buffer: string[] = [];
  let currentPath = "";
  for (const line of content.split(/\r?\n/u)) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flushSection(sections, currentPath, buffer);
      buffer = [line];
      currentPath = updateHeadingPath(headings, match[1]!.length, match[2]!.trim());
      continue;
    }
    buffer.push(line);
  }
  flushSection(sections, currentPath, buffer);
  return sections.length > 0 ? sections : [{ headingPath: "", text: content }];
}

function updateHeadingPath(headings: string[], level: number, title: string): string {
  headings.splice(level - 1);
  headings[level - 1] = title;
  return headings.filter(Boolean).join(" > ");
}

function flushSection(
  sections: Array<{ headingPath: string; text: string }>,
  headingPath: string,
  buffer: readonly string[],
): void {
  const text = buffer.join("\n").trim();
  if (text) sections.push({ headingPath, text });
}

function appendSectionChunks(
  chunks: TextChunk[],
  text: string,
  headingPath: string,
  targetChars: number,
  overlapChars: number,
): void {
  let cursor = 0;
  while (cursor < text.length) {
    const end = chooseChunkEnd(text, cursor, targetChars);
    const chunkText = text.slice(cursor, end).trim();
    if (chunkText) chunks.push({ index: chunks.length, text: chunkText, headingPath });
    if (end >= text.length) break;
    cursor = Math.max(cursor + 1, end - overlapChars);
  }
}

function chooseChunkEnd(text: string, start: number, targetChars: number): number {
  const hardEnd = Math.min(text.length, start + targetChars);
  if (hardEnd >= text.length) return text.length;
  const window = text.slice(start, hardEnd);
  const paragraphBreak = window.lastIndexOf("\n\n");
  if (paragraphBreak > targetChars * 0.5) return start + paragraphBreak;
  const sentenceBreak = Math.max(window.lastIndexOf("。"), window.lastIndexOf("."), window.lastIndexOf("\n"));
  return sentenceBreak > targetChars * 0.5 ? start + sentenceBreak + 1 : hardEnd;
}
