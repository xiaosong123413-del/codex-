/**
 * Shared helpers for Markdown heading anchors used by rendered pages and
 * source-evidence records.
 *
 * Personal facts and timeline entries often cite a diary section rather than a
 * whole page. Keeping heading normalization in one place makes links such as
 * `raw/闪念日记/2026-04-29.md#让 ChatGPT 看手相` resolve to the same DOM id that the
 * Markdown renderer emits.
 */

export interface MarkdownHeadingAnchor {
  file: string;
  heading: string;
  target: string;
  preview?: string;
}

const MARKDOWN_HEADING_RE = /^(#{2,6})\s+(.+?)\s*#*\s*$/gmu;
const EXPLICIT_ANCHOR_RE = /\s*\{#([^}\s]+)\}\s*$/u;

/** Normalize visible heading text into the stable fragment used by wiki links. */
export function normalizeMarkdownHeadingAnchor(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Extract h2-h6 anchors from a Markdown file for evidence-source indexing. */
export function extractMarkdownHeadingAnchors(file: string, markdown: string): MarkdownHeadingAnchor[] {
  const matches = Array.from(markdown.matchAll(MARKDOWN_HEADING_RE));
  return matches.flatMap((match, index) => {
    const rawHeading = match[2]?.trim() ?? "";
    const parsed = parseMarkdownHeading(rawHeading);
    if (!parsed.heading) return [];
    return [{
      file,
      heading: parsed.heading,
      target: `${file}#${parsed.anchor}`,
      preview: firstHeadingParagraph(markdown, match, matches[index + 1]),
    }];
  });
}

function firstHeadingParagraph(
  markdown: string,
  current: RegExpMatchArray,
  next: RegExpMatchArray | undefined,
): string | undefined {
  const start = (current.index ?? 0) + current[0].length;
  const end = next?.index ?? markdown.length;
  const section = markdown.slice(start, end);
  return firstUsefulParagraph(section);
}

function firstUsefulParagraph(markdown: string): string | undefined {
  for (const block of markdown.split(/\n\s*\n/u)) {
    const text = cleanMarkdownParagraph(block);
    if (text) return text.length > 80 ? `${text.slice(0, 80)}...` : text;
  }
  return undefined;
}

function cleanMarkdownParagraph(markdown: string): string {
  const text = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^---+$/u.test(line) && !/^!\[/u.test(line))
    .join(" ")
    .trim();
  return trimInlineHeading(text);
}

function trimInlineHeading(text: string): string {
  const index = text.search(/#{2,6}\s/u);
  return index === -1 ? text : text.slice(0, index).trim();
}

function parseMarkdownHeading(rawHeading: string): { heading: string; anchor: string } {
  const explicitAnchor = EXPLICIT_ANCHOR_RE.exec(rawHeading)?.[1]?.trim();
  const heading = rawHeading
    .replace(EXPLICIT_ANCHOR_RE, "")
    .replace(/\s+#+\s*$/u, "")
    .trim();
  return {
    heading,
    anchor: explicitAnchor || normalizeMarkdownHeadingAnchor(heading),
  };
}
