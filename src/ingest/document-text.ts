/**
 * Structured text extraction for non-plain local documents.
 *
 * Each supported format is reduced to Markdown before it enters the compiler:
 * DOCX keeps common paragraph/table semantics, PPTX is read slide-by-slide,
 * PDF uses text extraction, and spreadsheets become per-sheet Markdown tables.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as mammoth from "mammoth";
import TurndownService from "turndown";
import * as XLSX from "xlsx";
import { readZipEntries, readZipText } from "./zip.js";

const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xls", ".ods"]);
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as PdfParser;

interface PdfParserResult {
  text: string;
}

type PdfParser = (buffer: Buffer) => Promise<PdfParserResult>;

/** Extract document body text as Markdown for a supported structured format. */
export async function extractDocumentMarkdown(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") return extractDocxMarkdown(filePath);
  if (ext === ".pptx") return extractPptxMarkdown(filePath);
  if (ext === ".pdf") return extractPdfMarkdown(filePath);
  if (SPREADSHEET_EXTENSIONS.has(ext)) return extractSpreadsheetMarkdown(filePath);
  throw new Error(`Unsupported document type "${ext}".`);
}

async function extractDocxMarkdown(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const xmlMarkdown = extractDocxXmlMarkdown(buffer);
  if (xmlMarkdown.trim()) return xmlMarkdown.trim();
  const mammothMarkdown = await tryMammothMarkdown(buffer);
  if (mammothMarkdown.trim()) return mammothMarkdown.trim();
  return "";
}

async function tryMammothMarkdown(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    return new TurndownService({ headingStyle: "atx" }).turndown(result.value);
  } catch {
    return "";
  }
}

function extractDocxXmlMarkdown(bytes: Buffer): string {
  const xml = readZipText(bytes, "word/document.xml");
  if (!xml) return "";
  const tables = collectDocxTables(xml);
  const bodyWithoutTables = xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, "\n");
  const paragraphs = collectDocxParagraphs(bodyWithoutTables);
  return [...paragraphs, ...tables].filter(Boolean).join("\n\n");
}

function collectDocxParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const match of xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const text = extractDocxRuns(paragraph).trim();
    if (!text) continue;
    paragraphs.push(formatDocxParagraph(paragraph, text));
  }
  return paragraphs;
}

function formatDocxParagraph(paragraph: string, text: string): string {
  const headingMatch = paragraph.match(/<w:pStyle[^>]+w:val=["']Heading([1-6])["']/);
  if (headingMatch) return `${"#".repeat(Number(headingMatch[1]))} ${text}`;
  if (/<w:numPr\b/.test(paragraph)) return `- ${text}`;
  return text;
}

function extractDocxRuns(xml: string): string {
  const runs = [...xml.matchAll(/<w:r[\s\S]*?<\/w:r>/g)];
  if (runs.length === 0) return decodeXml(stripXmlTags(xml));
  return runs.map((run) => formatDocxRun(run[0])).join("");
}

function formatDocxRun(runXml: string): string {
  const text = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("");
  if (!text) return "";
  const bold = /<w:b\b/.test(runXml);
  const italic = /<w:i\b/.test(runXml);
  if (bold && italic) return `***${text}***`;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}

function collectDocxTables(xml: string): string[] {
  const tables: string[] = [];
  for (const tableMatch of xml.matchAll(/<w:tbl[\s\S]*?<\/w:tbl>/g)) {
    const rows = collectDocxRows(tableMatch[0]);
    const markdown = rowsToMarkdownTable(rows);
    if (markdown) tables.push(markdown);
  }
  return tables;
}

function collectDocxRows(tableXml: string): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of tableXml.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<w:tc[\s\S]*?<\/w:tc>/g)) {
      cells.push(extractDocxRuns(cellMatch[0]).trim());
    }
    if (cells.some((cell) => cell.length > 0)) rows.push(cells);
  }
  return rows;
}

async function extractPptxMarkdown(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const slideNames = readZipEntries(bytes)
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(compareSlideNames);
  const slides = slideNames.map((slideName, index) => formatSlide(bytes, slideName, index + 1));
  return slides.filter(Boolean).join("\n\n");
}

function compareSlideNames(left: string, right: string): number {
  return slideNumber(left) - slideNumber(right);
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? "0");
}

function formatSlide(bytes: Buffer, slideName: string, slideNumberValue: number): string {
  const xml = readZipText(bytes, slideName);
  if (!xml) return "";
  const lines = collectPresentationParagraphs(xml);
  if (lines.length === 0) return `## Slide ${slideNumberValue}`;
  return [`## Slide ${slideNumberValue}`, "", ...lines].join("\n");
}

function collectPresentationParagraphs(xml: string): string[] {
  const lines: string[] = [];
  for (const match of xml.matchAll(/<a:p[\s\S]*?<\/a:p>/g)) {
    const paragraph = match[0];
    const text = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((textMatch) => decodeXml(textMatch[1] ?? ""))
      .join("")
      .trim();
    if (!text) continue;
    lines.push(/<a:bu/.test(paragraph) ? `- ${text}` : text);
  }
  return lines;
}

async function extractPdfMarkdown(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  try {
    const result = await pdfParse(buffer);
    return result.text.trim();
  } catch {
    return "";
  }
}

function extractSpreadsheetMarkdown(filePath: string): string {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return "";
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    const table = rowsToMarkdownTable(normalizeRows(rows));
    return table ? `## ${sheetName}\n\n${table}` : `## ${sheetName}`;
  });
  return sections.filter(Boolean).join("\n\n");
}

function normalizeRows(rows: string[][]): string[][] {
  return rows
    .map((row) => row.map((cell) => String(cell).trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
}

function rowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => padRow(row, width));
  const [header, ...body] = normalized;
  return [
    markdownTableRow(header ?? []),
    markdownTableRow(Array.from({ length: width }, () => "---")),
    ...body.map(markdownTableRow),
  ].join("\n");
}

function padRow(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? "");
}

function markdownTableRow(row: string[]): string {
  return `| ${row.map(escapeTableCell).join(" | ")} |`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
