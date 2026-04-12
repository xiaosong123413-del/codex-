# Feishu Wiki To Obsidian Sync Design

## Goal

Provide a one-click local script that imports all `docx` cloud documents from one Feishu wiki space into an Obsidian folder while preserving the wiki hierarchy.

Confirmed constraints:

- Sync scope is one Feishu wiki space.
- Keep the original parent-child hierarchy.
- Write into `C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\飞书同步`.
- Only add new files. Do not modify existing Markdown files or asset folders.
- Export document body plus images and attachments.
- First version uses local `lark-cli` user authorization instead of pure `APP_ID` / `APP_SECRET`.
- Triggered manually by clicking a local script.

## Recommended Approach

Use a Node.js orchestration script that shells out to `lark-cli` for Feishu access.

Why this approach:

- `lark-cli` already handles the user-authenticated access pattern needed for personal wiki content.
- `docs +fetch` returns Markdown directly, which avoids rebuilding a docx-to-Markdown converter.
- `docs +media-download` provides a practical path for downloading referenced media.
- The local Node layer can focus on traversal, path mapping, duplicate handling, and file output.

Alternatives considered:

1. Pure Feishu OpenAPI client in Node.
   - Rejected for v1 because it increases implementation cost and authentication risk.
2. Mixed SDK + `lark-cli`.
   - Viable, but not worth the extra complexity for the first deliverable.

## Architecture

### 1. Config Layer

A local config module defines:

- `spaceId` or root wiki node token for the target space traversal
- output root path
- `larkCliExecutable`
- optional logging path

The first version should keep config local in a simple JSON or JS config file plus a click-to-run PowerShell wrapper.

### 2. Lark CLI Adapter

This module wraps all external command execution and JSON parsing.

Responsibilities:

- run `lark-cli wiki` commands for node resolution and child listing
- run `lark-cli docs +fetch` for Markdown export
- run `lark-cli docs +media-download` for referenced media
- normalize stdout/stderr into typed results
- surface actionable auth/config failures

### 3. Wiki Crawler

This module recursively traverses the configured wiki space tree.

Responsibilities:

- resolve the configured root
- list descendant nodes page by page
- preserve ancestry information for each node
- filter to `docx` nodes for export
- record skipped node types such as sheets, bitable, or unsupported objects

Output per document:

- wiki node token
- doc token
- title
- ancestor path segments
- source URL

### 4. Document Exporter

This module converts one Feishu document into local sync artifacts.

Responsibilities:

- fetch Markdown for a `docx` document
- scan Markdown for Feishu media tags such as `<image ...>`, `<file ...>`, and `<whiteboard ...>`
- download supported referenced assets
- replace media tags or remote references with local relative paths
- emit final Markdown text and a list of downloaded asset files

Handling rules:

- images and files are downloaded
- whiteboards are logged as unsupported in v1 unless `docs +media-download` returns a usable preview artifact
- if media download fails, keep the original marker in Markdown and write a warning to the log

### 5. Obsidian Writer

This module maps wiki hierarchy into Windows-safe local paths.

Rules:

- folder nodes become directories
- document nodes become `Title.md`
- assets live beside the document in `Title.assets\`
- illegal filename characters are stripped or replaced
- duplicate names inside one folder get a deterministic short suffix
- if `Title.md` already exists, skip the whole document and do not touch its asset folder

### 6. Click-To-Run Entry Point

Provide:

- a Node entry script, for example `scripts/feishu-sync-obsidian.js`
- a PowerShell launcher, for example `run-feishu-sync.ps1`
- optionally a `.bat` wrapper that launches the PowerShell script for double-click usage

The launcher should:

- switch to the project directory
- check whether `node` and `lark-cli` are available
- run the sync script
- keep the console open long enough for the user to see the summary or failure

## Data Flow

1. User double-clicks the launcher.
2. Launcher validates local prerequisites.
3. Sync script loads config.
4. Wiki crawler traverses the configured root.
5. For each `docx` node:
   - compute output path from ancestor hierarchy
   - if target Markdown already exists, mark as skipped
   - otherwise fetch Markdown, download assets, rewrite references, and write files
6. Emit a summary with counts for exported, skipped, failed, and unsupported items.

## File And Naming Rules

### Local Path Mapping

- Use the wiki hierarchy as the local folder hierarchy.
- Use the document title as the Markdown filename.
- Use a sibling asset folder named `DocumentTitle.assets`.

Example:

- Feishu path: `Product / Specs / Search Upgrade`
- Local Markdown:
  `C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\飞书同步\Product\Specs\Search Upgrade.md`
- Local assets:
  `C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\飞书同步\Product\Specs\Search Upgrade.assets\`

### Existing File Rule

The sync is append-only:

- if the Markdown file exists, skip that document completely
- do not merge, overwrite, or patch existing Markdown
- do not backfill missing assets for skipped documents

This preserves the output folder as a read-only ingest area.

## Error Handling

Failures should be isolated per document.

Behavior:

- one document failing must not abort the entire sync unless auth or root traversal is broken
- maintain a log file with document token, title, path, and failure reason
- return a non-zero process exit code only for fatal failures such as missing CLI, missing auth, or invalid root config

Common failure classes:

- `lark-cli` not installed
- `lark-cli` installed but not logged in
- target root token invalid
- unsupported node type
- path collision after sanitization
- media download failure
- write permission failure on local disk

## Testing Strategy

### Automated

- unit tests for path sanitization and duplicate naming
- unit tests for media tag extraction and reference rewriting
- unit tests for skip-if-exists behavior
- adapter tests with mocked `lark-cli` responses

### Manual

- run against a small wiki subtree with nested folders
- verify Markdown opens in Obsidian
- verify images and files resolve locally
- verify existing files are skipped untouched
- verify unsupported nodes are logged, not silently dropped

## Open Decisions Deferred From V1

These are intentionally not in scope for the first version:

- two-way sync
- overwrite or update mode
- deletion handling when source docs are removed
- syncing sheets or bitable as Markdown
- background scheduled sync
- pure application auth without user login

## Implementation Readiness

This design is scoped for one implementation cycle. The highest-risk dependency is the exact shape of `lark-cli` output for wiki traversal and media download, but that risk is bounded and can be handled with adapter-level parsing and fixtures.
