/**
 * Core type definitions for the llmwiki knowledge compiler.
 * All shared interfaces live here to keep the module boundary clean.
 */

/** A single concept extracted from a source by the LLM. */
export type ClaimType = "decision" | "fact" | "pattern" | "incident" | "workflow";

export interface ExtractedClaim {
  claim_key?: string;
  claim_text: string;
  claim_type?: ClaimType;
  observed_at?: string;
}

export interface ExtractedConcept {
  concept: string;
  summary: string;
  is_new: boolean;
  tags?: string[];
  claims?: ExtractedClaim[];
}

/** Per-source entry in .llmwiki/state.json. */
export interface SourceState {
  hash: string;
  concepts: string[];
  compiledAt: string;
}

/** Root shape of .llmwiki/state.json. */
export interface WikiState {
  version: 1 | 2;
  indexHash: string;
  sources: Record<string, SourceState>;
  /** Concept slugs frozen across batches to preserve content from deleted sources. */
  frozenSlugs?: string[];
}

export interface ClaimCandidate {
  candidateId: string;
  conceptSlug: string;
  claimKey: string;
  claimText: string;
  claimType: ClaimType;
  source: ClaimSourceReference;
  observedAt: string;
}

/** Source metadata retained directly on claims for provenance. */
export interface ClaimSourceReference {
  file: string;
  title: string;
  kind: string;
  channel: string;
  url?: string;
  observedAt: string;
}

export interface ClaimRecord {
  id: string;
  conceptSlug: string;
  claimKey: string;
  claimText: string;
  claimType: ClaimType;
  sourceFiles: string[];
  sources: ClaimSourceReference[];
  firstSeenAt: string;
  lastConfirmedAt: string;
  lastAccessedAt?: string;
  supportCount: number;
  contradictionCount: number;
  confidence: number;
  retention: number;
  status: "active" | "contested" | "superseded" | "stale";
  supersedes: string[];
  supersededBy?: string;
  halfLifeDays: number;
}

export interface ProcedureRecord {
  id: string;
  conceptSlug: string;
  procedureKey: string;
  title: string;
  summary: string;
  supportingClaimIds: string[];
  sourceFiles: string[];
  confidence: number;
  lastConfirmedAt: string;
}

interface FinalCompileResult {
  status: "succeeded" | "failed";
  syncedMarkdownCount: number;
  syncedAssetCount: number;
  completedFilesCount: number;
  internalBatchCount: number;
  batchLimit: number;
  claimsUpdated: number;
  proceduresUpdated: number;
  wikiOutputDir: string;
  publishedAt?: string;
  error?: string;
}

/** Change detection result for a single source file. */
export interface SourceChange {
  file: string;
  status: "new" | "changed" | "unchanged" | "deleted";
}

/** Wiki page frontmatter parsed from YAML. */
interface WikiFrontmatter {
  title: string;
  sources: string[];
  summary: string;
  orphaned?: boolean;
  tags?: string[];
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Summary entry used in index.md generation. */
export interface PageSummary {
  title: string;
  slug: string;
  summary: string;
}
