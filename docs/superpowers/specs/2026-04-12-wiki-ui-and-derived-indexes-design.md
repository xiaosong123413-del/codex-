# Second Brain Wiki UI And Derived Indexes Design

Date: 2026-04-12
Status: Approved for spec drafting
Owner: Codex

## Summary

Build a public-hosted but login-protected web UI for the existing second-brain knowledge base, using the current Markdown wiki as the source of truth. Add a derived system layer that generates:

- natural-growth taxonomy for UI navigation
- `_backlinks.json` for reverse-link navigation and related-page graphing
- `_absorb_log.json` for raw-to-source-to-article absorption tracking
- supporting metadata indexes for search and page rendering

The UI should feel as close to Wikipedia as practical while remaining a private personal wiki. Deployment target is Vercel. Authentication target is Auth.js with Google sign-in and an email allowlist.

## Goals

- Keep the current second-brain Markdown corpus as the authoritative knowledge source.
- Add machine-readable derived indexes without forcing a destructive migration.
- Support a Wikipedia-style reading experience:
  - article pages
  - backlinks
  - search
  - category or taxonomy browsing
  - source references
  - recent updates
- Make the site publicly reachable on the internet but usable only after login.
- Preserve the current maintenance workflow so future curation updates both Markdown and derived indexes.

## Non-Goals

- Do not replace the current second-brain directory layout as the primary authoring structure.
- Do not expose raw or first-brain read-only sources directly to site visitors.
- Do not make the site publicly readable without authentication.
- Do not introduce a second manually maintained wiki in parallel with the current one.

## Current State

The current knowledge base already has a stable authoring structure built around:

- `人物/`
- `概念/`
- `工具/`
- `项目/`
- `想法/`
- `写作/`
- `来源/`
- `收件箱/`
- `归档/`
- root entry files such as `README.md`, `index.md`, `log.md`, `AI维护指令.md`

There is also a raw read-only layer and a first-brain read-only layer. The current workflow already distinguishes:

- raw source storage
- absorbed source summaries in `来源/`
- compiled knowledge pages in the primary content directories

This is already a functioning knowledge system. The missing pieces are derived system indexes and a web UI.

## Design Decision

Use a three-layer model:

1. Authoring layer
   - existing Markdown wiki
   - human-maintained and AI-maintained
   - source of truth
2. Derived system layer
   - generated JSON indexes and normalized page metadata
   - used for UI features and maintenance visibility
3. Presentation layer
   - a separate Next.js application
   - reads Markdown plus generated indexes
   - deployed to Vercel with login protection

This avoids destructive migration while still enabling the taxonomy and system files requested by the user.

## Proposed Directory Layout

### Existing second-brain root

```text
ai知识库（第二大脑）/
  人物/
  概念/
  工具/
  项目/
  想法/
  写作/
  来源/
  收件箱/
  归档/
  README.md
  index.md
  log.md
  AI维护指令.md
  .wiki-system/
    taxonomy.json
    _backlinks.json
    _absorb_log.json
    page-meta.json
    search-index.json
    aliases.json
```

### New UI application

```text
wiki-ui/
  app/
  components/
  lib/
  scripts/
  public/
  generated/
  package.json
  next.config.ts
  auth.ts
```

`generated/` inside the UI app is a deployable copy of the latest derived indexes and normalized page artifacts. It is safe to regenerate from the source knowledge base at any time.

## Why The Existing Directory Layout Stays

The current top-level structure remains the primary authoring structure because it already encodes a stable MECE content model for maintenance:

- humans and AI can reason about it consistently
- existing links and indexes already depend on it
- current maintenance rules are written around it

The requested natural-growth taxonomy will exist as a derived navigation tree, not as a mandatory on-disk folder migration.

## Derived System Layer

### 1. `taxonomy.json`

Purpose:

- expose a Wikipedia-like browse tree that emerges from actual content rather than from a manually frozen filesystem tree
- support topic navigation without forcing the authoring structure to mirror the display structure

Generation inputs:

- file path and top-level category
- frontmatter tags
- frontmatter sources
- normalized wikilinks
- heading structure
- co-link frequency across pages
- recent update frequency

Output shape:

```json
{
  "version": 1,
  "generatedAt": "2026-04-12T22:00:00+08:00",
  "roots": [
    {
      "id": "ai-toolchain",
      "title": "AI Toolchain",
      "children": [
        {
          "id": "openclaw",
          "title": "OpenClaw",
          "pages": ["工具/OpenClaw.md"]
        },
        {
          "id": "obsidian-workflows",
          "title": "Obsidian Workflows",
          "pages": [
            "概念/Obsidian生产力系统.md",
            "工具/Obsidian-Web-Clipper.md"
          ]
        }
      ]
    }
  ]
}
```

Rules:

- a page may appear in multiple taxonomy branches
- taxonomy is display-oriented, not storage-oriented
- taxonomy can evolve as the corpus evolves
- taxonomy generation must be deterministic from the current corpus plus explicit overrides if needed

Optional extension:

- support a small manual override file later if auto-grouping needs curation

### 2. `_backlinks.json`

Purpose:

- support Wikipedia-style "What links here"
- power backlinks sections on article pages
- support related-page recommendations and graph views

Generation inputs:

- all explicit `[[wikilinks]]`
- Markdown links that resolve to local pages
- normalized title and alias resolution
- source-to-article and article-to-source relationships

Output shape:

```json
{
  "version": 1,
  "generatedAt": "2026-04-12T22:00:00+08:00",
  "pages": {
    "概念/Obsidian生产力系统.md": {
      "title": "Obsidian生产力系统",
      "incoming": [
        "来源/2026-04-12-第一大脑剪藏与记录规则.md",
        "概念/个人学习管理.md"
      ],
      "outgoing": [
        "工具/Obsidian-Web-Clipper.md",
        "项目/飞书记录系统.md"
      ],
      "related": [
        "工具/Obsidian-CodeX-Agent.md"
      ]
    }
  }
}
```

Rules:

- backlinks are generated from resolved page identity, not raw string matching
- aliases must map to canonical pages before the graph is built
- broken links should be reported separately during generation

### 3. `_absorb_log.json`

Purpose:

- track ingestion and absorption state from raw material into the wiki
- make maintenance status queryable instead of relying only on prose logs
- expose provenance chains for future QA and UI visibility

Primary states:

- `pending`
- `read`
- `absorbed`
- `expanded`
- `skipped`

Output shape:

```json
{
  "version": 1,
  "generatedAt": "2026-04-12T22:00:00+08:00",
  "entries": {
    "raw/某来源/xxx.md": {
      "status": "expanded",
      "sourcePage": "来源/2026-04-12-某主题.md",
      "compiledInto": [
        "概念/AI知识库构建.md",
        "项目/飞书记录系统.md"
      ],
      "lastAbsorbedAt": "2026-04-12T21:30:00+08:00",
      "notes": "Already entered source layer and expanded into two formal knowledge pages"
    }
  }
}
```

Data sources for backfill:

- file path mapping from `raw`
- source pages in `来源/`
- `sources:` frontmatter in formal pages
- historical records in `log.md`

Rules:

- raw and first-brain inputs remain read-only
- the absorb log records interpretation results and mappings, not rewrites of the source materials
- skipped items must carry a reason

### 4. Supporting Indexes

#### `page-meta.json`

Contains normalized per-page metadata:

- canonical path
- title
- category
- aliases
- tags
- updated date
- source references
- abstract
- headings

#### `search-index.json`

Contains the normalized search corpus:

- title terms
- aliases
- abstract
- headings
- high-value body terms
- category and tag filters

#### `aliases.json`

Maps alternative names and ambiguous link text to canonical pages.

## UI Design

### Product Position

The site is not a generic blog and not a raw vault browser. It is a private, Wikipedia-like reader for the curated second brain.

### Primary UX Goals

- immediate article readability
- dense internal linking
- strong navigation
- transparent provenance
- obvious backlinks
- fast search

### Primary Pages

1. Home
   - featured entry points
   - recent updates
   - major taxonomy roots
   - maintenance summary
2. Article page
   - title
   - infobox-like metadata block
   - table of contents
   - rendered Markdown body
   - source references
   - backlinks
   - related pages
3. Search
   - instant results
   - filters by category, tag, and update date
4. Taxonomy browse
   - browse natural-growth topic tree
5. Recent changes
   - driven by `log.md` and page metadata
6. Sources view
   - browse source summaries without exposing raw read-only files

### Visual Direction

The UI should be strongly inspired by Wikipedia:

- restrained typography
- left-side navigation and content hierarchy
- tight reading column
- blue-link interaction language
- infobox and metadata affordances
- dense but controlled internal navigation

It should not be a literal trademarked clone, but the interaction model and content density should feel familiar to Wikipedia users.

## Authentication And Access Control

Chosen approach:

- deployment on Vercel
- Auth.js
- Google provider
- email allowlist

Requirements:

- all content routes require authentication
- only explicitly allowed Google accounts may access the site
- robots indexing should be disabled
- unauthenticated users see only the sign-in flow, not article content

Optional extension later:

- multiple roles such as reader and editor, though editor is not required for v1

## Deployment Model

Target:

- Vercel-hosted Next.js app
- private custom domain or Vercel domain
- accessible from any device over the public internet after login

Build model:

- the UI app bundles generated indexes at build time
- optionally, a sync step copies the latest generated artifacts from the second-brain workspace into the UI workspace before deploy

Recommended repository organization:

- keep `wiki-ui/` in the current repo
- treat the second-brain source path as an external input during local generation

## Maintenance Flow

### Current workflow to preserve

- raw read-only material is absorbed into `来源/`
- source summaries are compiled into formal knowledge pages
- `index.md` and `log.md` are updated after maintenance

### New workflow after this project

Each maintenance cycle should also:

1. regenerate `.wiki-system/page-meta.json`
2. regenerate `.wiki-system/aliases.json`
3. regenerate `.wiki-system/taxonomy.json`
4. regenerate `.wiki-system/_backlinks.json`
5. update `.wiki-system/_absorb_log.json`
6. export or sync generated artifacts to the UI app

This ensures the web UI stays aligned with the wiki without making the UI its own source of truth.

## Conversion Strategy

### Phase 1: Derived index generator

Create a generator that scans the current second-brain root and produces:

- `page-meta.json`
- `aliases.json`
- `taxonomy.json`
- `_backlinks.json`
- `_absorb_log.json`
- `search-index.json`

### Phase 2: Historical backfill

Reconstruct existing absorption history from:

- current `raw` structure
- source pages in `来源/`
- existing `sources:` references
- `log.md`

The first backfill will not be perfect, so the generator should support partial certainty and explicit notes.

### Phase 3: UI implementation

Build the Wikipedia-like web reader on top of the generated data.

### Phase 4: Ongoing synchronization

Integrate generator execution into the future maintenance workflow so each curation pass refreshes the site data.

## Risks And Mitigations

### Risk: taxonomy quality is noisy early on

Mitigation:

- start with deterministic heuristics
- allow later introduction of a manual override layer

### Risk: historical absorb mapping is incomplete

Mitigation:

- record confidence and notes in the absorb log when backfilling
- allow later correction during maintenance

### Risk: page identity collisions

Mitigation:

- normalize aliases
- keep canonical path identity
- flag ambiguous titles during generation

### Risk: leaking private content through deployment

Mitigation:

- all routes require auth
- robots disabled
- no raw layer exposed
- allowlist enforcement at auth boundary

### Risk: UI and source wiki drift apart

Mitigation:

- UI remains read-only
- derived indexes are regenerated from source
- no editing inside the UI in v1

## Implementation Boundaries For v1

Must include:

- generated taxonomy
- generated backlinks
- generated absorb log
- article rendering
- search
- Google login with allowlist
- public deployment after login

Can wait until later:

- graph visualization
- manual taxonomy editor
- inline editing
- multi-user permissions
- raw-layer diagnostics dashboard

## Acceptance Criteria

- the current second-brain Markdown corpus remains intact and authoritative
- `.wiki-system/` can be regenerated from the source corpus
- article pages show backlinks and source references
- the UI offers a natural-growth taxonomy browser
- the UI is reachable from other devices over the internet
- every page requires successful Google sign-in
- only allowlisted Google accounts can access the site
- future maintenance can update both Markdown content and derived indexes without structural conflict

## Recommendation

Proceed with the derived-system-layer architecture. It satisfies the user's new requirements without discarding the current knowledge base or forcing a risky full migration to the gist's on-disk model.
