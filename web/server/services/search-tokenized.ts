/**
 * Tokenized local retrieval scoring copied from the legacy Tauri query path.
 *
 * This module keeps Chinese bigram tokenization, English stop-word filtering,
 * phrase bonuses, and exact filename boosts independent from the router so
 * keyword, hybrid, and vector fusion can share one deterministic lexical rank.
 */
import path from "node:path";
import type { SearchIndexEntry } from "./search-index.js";
import type { RankedHit } from "./search-hybrid.js";

const FILENAME_EXACT_BONUS = 200;
const PHRASE_IN_TITLE_BONUS = 50;
const PHRASE_IN_CONTENT_PER_OCC = 20;
const MAX_PHRASE_OCC_COUNTED = 10;
const TITLE_TOKEN_WEIGHT = 5;
const CONTENT_TOKEN_WEIGHT = 1;

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
]);

const SPLIT_RE = /[\s,，。！？、；：""''（）()\-_/\\·~～…]+/u;
const TRIM_PUNCT_RE = /^[\s,，。！？、；：""''（）()\-_/\\·~～…]+|[\s,，。！？、；：""''（）()\-_/\\·~～…]+$/gu;

/** Splits English and Chinese queries into recall-oriented retrieval tokens. */
function tokenizeQuery(query: string): string[] {
  const rawTokens = query.toLowerCase().split(SPLIT_RE)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return [...new Set(rawTokens.flatMap(expandToken))];
}

/** Ranks indexed pages with the legacy token and phrase scoring model. */
export function tokenizedSearch(entries: readonly SearchIndexEntry[], query: string): RankedHit[] {
  const queryPhrase = query.trim().toLowerCase().replace(TRIM_PUNCT_RE, "");
  const tokens = tokenizeQuery(query);
  const effectiveTokens = tokens.length > 0 ? tokens : [queryPhrase].filter(Boolean);
  return entries
    .map((entry) => scoreEntry(entry, queryPhrase, effectiveTokens))
    .filter((hit): hit is RankedHit => Boolean(hit))
    .sort(compareRankedHits);
}

function expandToken(token: string): string[] {
  if (!/[\u3400-\u4dbf\u4e00-\u9fff]/u.test(token) || token.length <= 2) {
    return [token];
  }
  const chars = [...token];
  const bigrams = chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
  const singles = chars.filter((char) => !STOP_WORDS.has(char));
  return [...bigrams, ...singles, token];
}

function scoreEntry(
  entry: SearchIndexEntry,
  queryPhrase: string,
  tokens: readonly string[],
): RankedHit | null {
  const titleText = `${entry.title} ${entry.path}`;
  const titleLower = titleText.toLowerCase();
  const contentLower = `${entry.excerpt}\n${entry.searchText ?? ""}`.toLowerCase();
  const fileStem = path.basename(entry.path, path.extname(entry.path)).toLowerCase();
  const filenameExact = Boolean(queryPhrase) && fileStem === queryPhrase;
  const titleHasPhrase = Boolean(queryPhrase) && titleLower.includes(queryPhrase);
  const contentPhraseOcc = Math.min(countOccurrences(contentLower, queryPhrase), MAX_PHRASE_OCC_COUNTED);
  const titleTokenScore = tokenMatchScore(titleLower, tokens);
  const contentTokenScore = tokenMatchScore(contentLower, tokens);
  const score = computeScore(filenameExact, titleHasPhrase, contentPhraseOcc, titleTokenScore, contentTokenScore)
    + pathIntentScore(entry.path, tokens);
  return score > 0 ? { ...entry, score, retrievalSources: ["token"] } : null;
}

function computeScore(
  filenameExact: boolean,
  titleHasPhrase: boolean,
  contentPhraseOcc: number,
  titleTokenScore: number,
  contentTokenScore: number,
): number {
  return (filenameExact ? FILENAME_EXACT_BONUS : 0)
    + (titleHasPhrase ? PHRASE_IN_TITLE_BONUS : 0)
    + contentPhraseOcc * PHRASE_IN_CONTENT_PER_OCC
    + titleTokenScore * TITLE_TOKEN_WEIGHT
    + contentTokenScore * CONTENT_TOKEN_WEIGHT;
}

function tokenMatchScore(text: string, tokens: readonly string[]): number {
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

function pathIntentScore(pathValue: string, tokens: readonly string[]): number {
  const wantsProcedure = tokens.some((token) => ["procedure", "workflow", "runbook", "playbook", "triage"].includes(token));
  if (!wantsProcedure) return 0;
  const normalized = pathValue.toLowerCase().replaceAll("\\", "/");
  if (normalized.startsWith("wiki/procedures/")) return 80;
  if (normalized.startsWith("wiki/concepts/")) return -20;
  return 0;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < haystack.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    count += 1;
    cursor = found + needle.length;
  }
  return count;
}

function compareRankedHits(left: RankedHit, right: RankedHit): number {
  return right.score - left.score || (left.path ?? left.id).localeCompare(right.path ?? right.id);
}
