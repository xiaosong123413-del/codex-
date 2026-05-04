/**
 * Markdown image parsing helpers shared by search and chat source rendering.
 *
 * Captions live in image alt text after the ingest caption pass. Keeping this
 * parser small and deterministic lets search index those captions and lets the
 * UI expose the original image reference without re-reading full documents.
 */

export interface MarkdownImageRef {
  alt: string;
  url: string;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function extractMarkdownImages(markdown: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = normalizeImageUrl(match[2] ?? "");
    if (!url) continue;
    refs.push({
      alt: (match[1] ?? "").trim(),
      url,
    });
  }
  return refs;
}

function normalizeImageUrl(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}
