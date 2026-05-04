/**
 * Deterministic PNG image renderer for generated page illustrations.
 *
 * It turns an existing text context into a local PNG card. Callers decide when
 * to generate and where to store the resulting PNG file.
 */

import crypto from "node:crypto";
import sharp from "sharp";

export interface ContentImageContext {
  logicalPath: string;
  title: string;
  summary: string;
  keywords: string[];
  label: string;
}

interface Palette {
  backgroundA: string;
  backgroundB: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
}

const PALETTES: readonly Palette[] = [
  { backgroundA: "#f4f8ff", backgroundB: "#dceafe", accent: "#2563eb", accentSoft: "#bfdbfe", text: "#10213f", muted: "#51627a" },
  { backgroundA: "#f8fbf2", backgroundB: "#dff3cf", accent: "#3f8f46", accentSoft: "#c7e9bf", text: "#18331d", muted: "#58705b" },
  { backgroundA: "#fff8ed", backgroundB: "#ffe2b8", accent: "#c96a1b", accentSoft: "#fed7aa", text: "#3b2415", muted: "#7c6049" },
  { backgroundA: "#fbf7ff", backgroundB: "#eadcff", accent: "#7c3aed", accentSoft: "#ddd6fe", text: "#28184c", muted: "#625073" },
];

/**
 * Renders a deterministic content illustration as a real PNG buffer.
 */
export async function renderContentImagePng(context: ContentImageContext): Promise<Buffer> {
  return sharp(Buffer.from(renderContentImageSvg(context))).png().toBuffer();
}

function renderContentImageSvg(context: ContentImageContext): string {
  const hash = crypto.createHash("sha256").update(`${context.logicalPath}\n${context.title}`).digest();
  const palette = PALETTES[hash[0]! % PALETTES.length]!;
  const title = wrapText(context.title, 18, 2);
  const summary = wrapText(context.summary || "根据页面内容自动生成的内容配图。", 29, 3);
  const keywords = context.keywords.length > 0 ? context.keywords.slice(0, 4) : ["记录", "自动配图"];
  return buildSvg({ context, hash, palette, title, summary, keywords });
}

function buildSvg(input: {
  context: ContentImageContext;
  hash: Buffer;
  palette: Palette;
  title: readonly string[];
  summary: readonly string[];
  keywords: readonly string[];
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" role="img" aria-label="${escapeXml(input.context.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${input.palette.backgroundA}"/>
      <stop offset="100%" stop-color="${input.palette.backgroundB}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#31415f" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="960" height="640" rx="42" fill="url(#bg)"/>
  ${renderDecorativeGraph(input.hash, input.palette, input.keywords)}
  <g filter="url(#shadow)"><rect x="76" y="82" width="808" height="476" rx="34" fill="#ffffff" fill-opacity="0.78"/></g>
  <text x="118" y="138" fill="${input.palette.accent}" font-family="Georgia, 'Noto Serif SC', serif" font-size="28" font-weight="700">§ ${escapeXml(input.context.label)}</text>
  ${renderTextLines(input.title, 118, 224, 50, 48, input.palette.text, "800")}
  ${renderTextLines(input.summary, 122, 364, 27, 38, input.palette.muted, "500")}
  ${renderKeywordChips(input.keywords, input.palette)}
  <text x="122" y="514" fill="${input.palette.muted}" font-family="'Noto Sans SC', Arial, sans-serif" font-size="22">${escapeXml(shortenPath(input.context.logicalPath))}</text>
</svg>`;
}

function renderDecorativeGraph(hash: Buffer, palette: Palette, keywords: readonly string[]): string {
  const nodes = keywords.slice(0, 4).map((keyword, index) => {
    const x = 610 + ((hash[index + 1] ?? 0) % 190);
    const y = 164 + index * 72 + ((hash[index + 8] ?? 0) % 36);
    return `<circle cx="${x}" cy="${y}" r="${18 + index * 4}" fill="${palette.accentSoft}" opacity="0.72"/><text x="${x + 34}" y="${y + 8}" fill="${palette.accent}" font-size="22" font-weight="700">${escapeXml(keyword)}</text>`;
  });
  return `<path d="M598 142 C724 88 810 130 858 226 C774 248 710 330 812 438" fill="none" stroke="${palette.accent}" stroke-width="4" opacity="0.22"/>${nodes.join("")}`;
}

function renderTextLines(
  lines: readonly string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  fill: string,
  weight: string,
): string {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-family="'Noto Serif SC', Georgia, serif" font-size="${fontSize}" font-weight="${weight}">${escapeXml(line)}</text>`
  )).join("");
}

function renderKeywordChips(keywords: readonly string[], palette: Palette): string {
  return keywords.slice(0, 4).map((keyword, index) => {
    const x = 120 + index * 150;
    return `<rect x="${x}" y="444" width="128" height="42" rx="21" fill="${palette.accentSoft}" opacity="0.72"/><text x="${x + 24}" y="472" fill="${palette.accent}" font-family="'Noto Sans SC', Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(keyword.slice(0, 8))}</text>`;
  }).join("");
}

function wrapText(input: string, maxUnits: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (const char of Array.from(input.trim())) {
    if (textUnits(`${current}${char}`) > maxUnits) {
      lines.push(current);
      current = char;
    } else {
      current += char;
    }
    if (lines.length === maxLines) {
      truncated = true;
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return truncated ? markLastLineTruncated(lines) : lines;
}

function markLastLineTruncated(lines: string[]): string[] {
  const next = [...lines];
  next[next.length - 1] = `${next[next.length - 1]?.replace(/[，。,.、\s]+$/u, "") ?? ""}…`;
  return next;
}

function textUnits(value: string): number {
  return Array.from(value).reduce((total, char) => total + (/[\u3400-\u9fff]/u.test(char) ? 1.8 : 1), 0);
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function shortenPath(value: string): string {
  return value.length <= 58 ? value : `...${value.slice(-55)}`;
}
