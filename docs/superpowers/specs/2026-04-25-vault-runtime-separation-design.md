# Vault Runtime Separation Design

## Goal

Make `D:\Desktop\ai的仓库` the only source of truth and turn Peiweipedia into a read-only wiki projection.

This design keeps the user's maintained content in the Obsidian vault while moving machine-generated runtime artifacts out of the vault.

## Decision

The source-of-truth model is fixed as:

- `D:\Desktop\ai的仓库` is the only editable knowledge root.
- `D:\Desktop\ai的仓库\wiki\...` remains editable source content, not generated output.
- Peiweipedia does not own a second copy of the knowledge base.
- Generated runtime artifacts live under the compiler workspace, not inside the vault.

## Problem

The current structure mixes two different responsibilities inside the vault:

1. human-maintained knowledge
2. machine-generated runtime output

This creates the feeling that the same knowledge exists twice:

- once as editable Obsidian content
- again as wiki/runtime output for Peiweipedia

That duplication makes the vault feel bloated and weakens the user's mental model of what is safe to edit.

## Source Of Truth Boundaries

The following paths inside `D:\Desktop\ai的仓库` are treated as source content and stay in the vault:

- `wiki/`
- `raw/`
- `聊天记录/`
- `inbox/`
- `task plan/`
- `.obsidian/`
- top-level source markdown files that the user edits directly

Anything the user edits in these locations is authoritative.

## Runtime Artifact Boundaries

The following paths are reclassified as runtime artifacts and must move out of the vault:

- `.llmwiki/`
- `.wiki-system/`
- `audit/`
- `sources/`
- `sources_full/`
- `.llmwiki-batch-state.json`
- `raw_import_manifest.json`
- `raw_import_manifest.csv`
- `raw_asset_manifest.csv`
- any generated search index, taxonomy, page meta, review cache, or compile state file

These files are not source content and must be safe to delete and rebuild.

## Runtime Output Root

All generated runtime output should move to a dedicated compiler-owned directory:

- `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault\`

Recommended substructure:

- `.runtime\ai-vault\wiki\`
- `.runtime\ai-vault\.llmwiki\`
- `.runtime\ai-vault\.wiki-system\`
- `.runtime\ai-vault\audit\`
- `.runtime\ai-vault\sources\`
- `.runtime\ai-vault\sources_full\`
- `.runtime\ai-vault\manifests\`

The exact subfolder names may stay aligned with the current runtime expectations, but they must be rooted under `.runtime\ai-vault\` instead of the source vault.

## Read / Write Model

### Source writes

All direct edits go only to:

- `D:\Desktop\ai的仓库\wiki\...`
- other source folders inside `D:\Desktop\ai的仓库`

### Runtime writes

All generated content and runtime state go only to:

- `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault\...`

### Forbidden writes

The compile pipeline must stop writing generated wiki/runtime artifacts back into:

- `D:\Desktop\ai的仓库\wiki\index.md`
- `D:\Desktop\ai的仓库\wiki\MOC.md`
- `D:\Desktop\ai的仓库\.llmwiki\...`
- `D:\Desktop\ai的仓库\.wiki-system\...`
- other runtime/cache/state paths inside the vault

The only exception is user-authored content explicitly stored in the vault as source.

## Peiweipedia Reading Model

Peiweipedia should read from two roots with different responsibilities:

### Source root

- `D:\Desktop\ai的仓库`

Used for:

- authoritative article markdown under `wiki/`
- user-authored CRM pages
- user-authored procedure pages
- user-authored chat record pages
- other user-maintained markdown content

### Runtime root

- `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault`

Used for:

- search index
- taxonomy
- page meta
- backlinks
- compile state
- review data
- audit data
- generated navigation helpers
- generated special pages that are not authoritative source content

## Special Page Rules

There are two classes of wiki pages:

### Source-backed pages

These are real files in `D:\Desktop\ai的仓库\wiki\...` and remain editable source:

- `concepts/...`
- `crm/...`
- `episodes/...`
- `procedures/...`
- `聊天记录/...`
- any other user-authored article page

### Generated pages

These are runtime pages that should no longer be written back into the vault:

- wiki home page
- generated MOC
- generated navigation overview pages
- compile-only helper pages

These pages should be served from the runtime root as virtual or runtime-backed pages.

`wiki/index.md` and `wiki/MOC.md` should therefore stop being treated as authoritative vault content unless the user explicitly chooses to author them manually.

## Compile Pipeline Changes

The compile pipeline must be restructured around separate input and output roots:

- source root: `D:\Desktop\ai的仓库`
- runtime output root: `D:\Desktop\llm-wiki-compiler-main\.runtime\ai-vault`

Required behavior:

1. read source content from the source vault
2. build indexes and generated outputs into the runtime root
3. never publish generated runtime state back into the source vault
4. keep runtime outputs fully rebuildable from source + config

## Configuration Model

The configuration must stop assuming that the target vault is also the runtime output destination.

The config model should separate:

- `source_vault_root`
- `runtime_output_root`
- optional source folders for imports or sync

The current `target_vault` semantics should be replaced or redefined so that it no longer means both "source of truth" and "publish destination".

## Migration Rules

Migration must be one-way and conservative:

1. keep existing source content in `D:\Desktop\ai的仓库`
2. create `.runtime\ai-vault\`
3. redirect generated outputs there
4. stop creating new runtime files inside the vault
5. remove or ignore old runtime directories in the vault only after the new runtime path is confirmed working

No source markdown should be relocated or rewritten during this migration.

## UI And Product Impact

The user-facing behavior should remain:

- Obsidian remains the place where source knowledge is maintained
- Peiweipedia keeps the current visual reading experience
- comments, search, navigation, directory views, and article jumps continue to work

The user should experience Peiweipedia as a view over the vault, not as a separate competing knowledge base.

## Out Of Scope

This design does not include:

- redesigning the Peiweipedia UI
- changing the wiki information architecture
- removing `D:\Desktop\ai的仓库\wiki\...` as source content
- replacing compiled runtime output with fully dynamic on-demand rendering

## Success Criteria

The system is correct only if all of the following are true:

1. `D:\Desktop\ai的仓库` remains the only authoritative knowledge source
2. user-maintained pages under `wiki/` remain editable source content
3. machine-generated runtime artifacts no longer clutter the vault
4. deleting `.runtime\ai-vault\` does not lose knowledge, only rebuildable output
5. Peiweipedia still renders the same wiki reading experience from source + runtime data
6. the user never needs to wonder whether a generated file inside the vault is safe to edit

## Recommended Implementation Direction

The implementation should follow the shortest path:

1. separate source and runtime roots in config
2. redirect all generated output writes to `.runtime\ai-vault`
3. update Peiweipedia read paths to use source markdown plus runtime indexes
4. stop publishing generated special pages back into the vault

This preserves the current product model while removing the structural duplication that makes the vault feel heavier than it should.
