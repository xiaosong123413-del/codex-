#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const queriesPath = args.queries ?? path.resolve("search/queries.sample.json");
const qrelsPath = args.qrels ?? path.resolve("search/qrels.sample.json");
const k = Number.isFinite(Number(args.k)) ? Math.max(1, Number(args.k)) : 5;

const queriesData = readJson(queriesPath);
const qrels = readJson(qrelsPath);
const documents = Array.isArray(queriesData.documents) ? queriesData.documents : [];
const queries = Array.isArray(queriesData.queries) ? queriesData.queries : [];

if (documents.length === 0 || queries.length === 0) {
  throw new Error("queries file must contain non-empty documents and queries arrays.");
}

const evaluations = queries.map((query) => evaluateQuery(documents, query, qrels[query.id] ?? {}, k));
const summary = summarize(evaluations, k);

console.log(`Evaluated ${queries.length} queries against ${documents.length} documents`);
console.log(`P@${k}: ${summary.precision.toFixed(2)}`);
console.log(`Recall@${k}: ${summary.recall.toFixed(2)}`);
console.log(`MRR: ${summary.mrr.toFixed(2)}`);
console.log(`nDCG@${k}: ${summary.ndcg.toFixed(2)}`);

// fallow-ignore-next-line complexity
function evaluateQuery(documents, query, rels, kValue) {
  const mode = query.mode ?? chooseSearchMode(query.query);
  const ranked = rankDocuments(documents, query.query, mode);
  const topK = ranked.slice(0, kValue);
  const relevantIds = Object.entries(rels).filter(([, gain]) => Number(gain) > 0).map(([id]) => id);
  const hits = topK.filter((doc) => Number(rels[doc.id] ?? 0) > 0);

  let firstRelevantRank = 0;
  for (let i = 0; i < ranked.length; i += 1) {
    if (Number(rels[ranked[i].id] ?? 0) > 0) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  return {
    precision: topK.length === 0 ? 0 : hits.length / kValue,
    recall: relevantIds.length === 0 ? 0 : hits.length / relevantIds.length,
    mrr: firstRelevantRank === 0 ? 0 : 1 / firstRelevantRank,
    ndcg: ndcg(topK, rels, kValue),
  };
}

// fallow-ignore-next-line complexity
function summarize(evaluations, kValue) {
  const count = evaluations.length || 1;
  return {
    precision: evaluations.reduce((sum, item) => sum + item.precision, 0) / count,
    recall: evaluations.reduce((sum, item) => sum + item.recall, 0) / count,
    mrr: evaluations.reduce((sum, item) => sum + item.mrr, 0) / count,
    ndcg: evaluations.reduce((sum, item) => sum + item.ndcg, 0) / count,
  };
}

// fallow-ignore-next-line complexity
function rankDocuments(documents, query, mode) {
  const normalizedQuery = normalize(query);
  const expansions = mode === "hybrid" ? buildExpansions(normalizedQuery) : [normalizedQuery];
  const rankedLists = expansions.map((expansion) =>
    documents
      .map((doc) => ({ doc, score: scoreDocument(doc, expansion, mode) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score),
  );

  // fallow-ignore-next-line complexity
  return rrfFuse(rankedLists).map((item) => item.doc);
}

// fallow-ignore-next-line complexity
function scoreDocument(doc, query, mode) {
  const haystack = [
    doc.id,
    doc.title,
    doc.path,
    doc.excerpt,
    ...(Array.isArray(doc.tags) ? doc.tags : []),
  ].map(normalize).join(" ");

  const tokens = query.split(/\s+/).filter(Boolean);
  let score = 0;

  if (haystack.includes(query)) score += 5;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }

  if (mode === "direct" && matchesDirect(doc, query)) score += 10;
  if (doc.layer === "wiki") score += 1.2;
  if (doc.layer === "source") score += 0.7;
  if (doc.layer === "raw") score += 0.2;

  return score;
}

// fallow-ignore-next-line complexity
function matchesDirect(doc, query) {
  const pathValue = normalize(doc.path).replaceAll("\\", "/");
  const title = normalize(doc.title);
  const id = normalize(doc.id);
  const baseName = pathValue.split("/").pop() ?? "";
  const trimmed = query.replace(/\.md$/, "");
  return query === pathValue
    || query === title
    || query === id
    || query === baseName
    || trimmed === baseName.replace(/\.md$/, "")
    || pathValue.endsWith(`/${query}`)
    || pathValue.endsWith(`/${trimmed}`);
}

// fallow-ignore-next-line complexity
function buildExpansions(query) {
  const tokens = query.split(/[\s,，。！？?/.\\_-]+/).map((token) => token.trim()).filter(Boolean);
  const values = [query];
  if (tokens.length > 1) values.push(tokens.join(" "));
  values.push(...tokens);
  return [...new Set(values)];
}

// fallow-ignore-next-line complexity
function rrfFuse(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const { doc, score } = list[rank];
      const key = doc.id;
      const current = scores.get(key) ?? { doc, score: 0 };
      current.score += (1 / (k + rank)) * layerBoost(doc.layer) * Math.max(1, score / 5);
      scores.set(key, current);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

// fallow-ignore-next-line complexity
function layerBoost(layer) {
  if (layer === "wiki") return 1.35;
  if (layer === "source") return 1.1;
  return 1.0;
}

// fallow-ignore-next-line complexity
function chooseSearchMode(query) {
  const normalized = normalize(query);
  if (normalized.includes("/") || normalized.endsWith(".md")) return "direct";
  if (normalized.length <= 24 && !/[？?。.!]/.test(normalized) && !normalized.includes(" ")) return "keyword";
  return "hybrid";
}

// fallow-ignore-next-line complexity
function ndcg(rankedDocs, rels, kValue) {
  const dcg = rankedDocs.slice(0, kValue).reduce((sum, doc, index) => {
    const gain = Number(rels[doc.id] ?? 0);
    return sum + ((Math.pow(2, gain) - 1) / Math.log2(index + 2));
  }, 0);

  const idealGains = Object.values(rels).map((gain) => Number(gain)).filter((gain) => gain > 0).sort((a, b) => b - a);
  const idcg = idealGains.slice(0, kValue).reduce((sum, gain, index) => sum + ((Math.pow(2, gain) - 1) / Math.log2(index + 2)), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

// fallow-ignore-next-line complexity
function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

// fallow-ignore-next-line complexity
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
