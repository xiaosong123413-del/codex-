# llmwiki

Compile raw sources into an interlinked markdown wiki.

Inspired by Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: instead of re-discovering knowledge at query time, compile it once into a persistent, browsable artifact that compounds over time.

![llmwiki demo](docs/images/demo.gif)

## Who this is for

- **AI researchers and engineers** building persistent knowledge from papers, docs, and notes
- **Technical writers** compiling scattered sources into a structured, interlinked reference
- **Anyone with too many bookmarks** who wants a wiki instead of a graveyard of tabs

## Quick start

```bash
npm install -g llm-wiki-compiler
export ANTHROPIC_API_KEY=sk-...
# Or use ANTHROPIC_AUTH_TOKEN if your Anthropic-compatible gateway expects it.
# Or use a different provider:
# export LLMWIKI_PROVIDER=openai
# export OPENAI_API_KEY=sk-...

llmwiki ingest https://some-article.com
llmwiki compile
llmwiki query "what is X?"
```

## Configuration

llmwiki configures providers via environment variables. The default provider is Anthropic.

- `LLMWIKI_PROVIDER`: The provider to use: `anthropic` | `openai` | `gemini` | `ollama` | `minimax` | `cloudflare`
- `LLMWIKI_MODEL`: The model name to override the provider default.

### Anthropic (Default)

Configuration precedence: shell env / `.env` → Claude Code settings fallback (`~/.claude/settings.json` env block) → built-in defaults.

- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`: Required.
- `ANTHROPIC_BASE_URL`: Optional. Custom endpoint for proxies.

```bash
export LLMWIKI_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-...
# Or zero exports if Claude Code already has credentials configured
```

### OpenAI

```bash
export LLMWIKI_PROVIDER=openai
export OPENAI_API_KEY=sk-proj-...
# export LLMWIKI_OPENAI_BASE_URL=https://api.openai.com/v1/  # optional
```

### Google Gemini

```bash
export LLMWIKI_PROVIDER=gemini
export GOOGLE_API_KEY=...
# export GEMINI_BASE_URL=https://generativelanguage.googleapis.com  # optional
```

### Ollama (local models)

```bash
export LLMWIKI_PROVIDER=ollama
export OLLAMA_HOST=http://localhost:11434/v1  # default
```

### MiniMax

```bash
export LLMWIKI_PROVIDER=minimax
export MINIMAX_API_KEY=...
# export MINIMAX_BASE_URL=https://api.minimax.io/anthropic  # optional
```

MiniMax uses its Anthropic-compatible Messages endpoint and bearer-token
authentication.

### Cloudflare Workers AI

```bash
# Option 1: Direct API
export LLMWIKI_PROVIDER=cloudflare
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...

# Option 2: Worker proxy
export CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev
export CLOUDFLARE_REMOTE_TOKEN=...
```

See `.env.example` for a complete reference of all environment variables.

## MCP Server

llmwiki ships with an MCP server for agent integration. It exposes `ingest`, `compile`, `query`, and `lint` as MCP tools.

### Claude Code

Add to `.claude/mcp.json` in your project:

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "node",
      "args": ["path/to/llm-wiki-compiler/dist/mcp-server.js"]
    }
  }
}
```

### Codex CLI

```bash
codex mcp add llmwiki -- node path/to/llm-wiki-compiler/dist/mcp-server.js
```

### Running directly

```bash
npm run mcp  # starts the MCP server on stdio
```

## Why not just RAG?

RAG retrieves chunks at query time. Every question re-discovers the same relationships from scratch. Nothing accumulates.

llmwiki **compiles** your sources into a wiki. Concepts get their own pages. Pages link to each other. When you ask a question with `--save`, the answer becomes a new page, and future queries use it as context. Your explorations compound.

This is complementary to RAG, not a replacement. RAG is great for ad-hoc retrieval over large corpora. llmwiki gives you a persistent, structured artifact to retrieve from.

```
RAG:     query → search chunks → answer → forget
llmwiki: sources → compile → wiki → query → save → richer wiki → better answers
```

## How it works

```
sources/  →  SHA-256 hash check  →  LLM concept extraction  →  wiki page generation  →  [[wikilink]] resolution  →  index.md
```

**Two-phase pipeline.** Phase 1 extracts all concepts from all sources. Phase 2 generates pages. This eliminates order-dependence, catches failures before writing anything, and merges concepts shared across multiple sources into single pages.

**Incremental.** Only changed sources go through the LLM. Everything else is skipped via hash-based change detection.

**Compounding queries.** `llmwiki query --save` writes the answer as a wiki page and immediately rebuilds the index. Saved answers show up in future queries as context.

### What it produces

A raw source like a Wikipedia article on knowledge compilation becomes a structured wiki page:

```yaml
---
title: Knowledge Compilation
summary: Techniques for converting knowledge representations into forms that support efficient reasoning.
sources:
  - knowledge-compilation.md
createdAt: "2026-04-05T12:00:00Z"
updatedAt: "2026-04-05T12:00:00Z"
---
```

```markdown
Knowledge compilation refers to a family of techniques for pre-processing
a knowledge base into a target language that supports efficient queries.

Related concepts: [[Propositional Logic]], [[Model Counting]]
```

Pages include source attribution in frontmatter. Paragraphs are annotated with `^[filename.md]` markers pointing back to the source file that contributed the content.

## Commands

| Command | What it does |
|---------|-------------|
| `llmwiki ingest <url\|file>` | Fetch a URL or copy a local file into `sources/` |
| `llmwiki compile` | Incremental compile: extract concepts, generate wiki pages |
| `llmwiki query "question"` | Ask questions against your compiled wiki |
| `llmwiki query "question" --save` | Answer and save the result as a wiki page |
| `llmwiki lint` | Check wiki quality (broken links, orphans, empty pages, etc.) |
| `llmwiki watch` | Auto-recompile when `sources/` changes |

## Output

```
wiki/
  concepts/     one .md file per concept, with YAML frontmatter
  queries/      saved query answers, included in index and retrieval
  index.md      auto-generated table of contents
```

Obsidian-compatible. `[[wikilinks]]` resolve to concept titles.

## Integrated Companion Tooling

This repo also vendors the companion modules from `llm-wiki-skill` so the compiler can evolve toward a full feedback-driven wiki workflow:

- `llm-wiki/` - skill documents, references, and helper Python scripts
- `audit-shared/` - shared audit schema and anchor logic
- `web/` - local wiki preview + audit feedback server
- `plugins/obsidian-audit/` - Obsidian audit plugin

Convenience commands from the project root:

```bash
npm run audit-shared:build
npm run web:build
npm run web:start -- --wiki "/path/to/wiki-root" --port 4175
npm run obsidian-audit:build
```

## Demo

Try it on any article or document:

```bash
mkdir my-wiki && cd my-wiki
llmwiki ingest https://en.wikipedia.org/wiki/Andrej_Karpathy
llmwiki compile
llmwiki query "What terms did Andrej coin?"
```

See `examples/basic/` in the repo for pre-generated output you can browse without an API key.

## Limitations

Early software. Best for small, high-signal corpora (a few dozen sources). Query routing is index-based.

**Honest about truncation.** Sources that exceed the character limit are truncated on ingest with `truncated: true` and the original character count recorded in frontmatter, so downstream consumers know they're working with partial content.

## Karpathy's LLM Wiki pattern vs this compiler

Karpathy describes an abstract pattern for turning raw data into compiled knowledge. Here's how llmwiki maps to it:

| Karpathy's concept | llmwiki | Status |
|---|---|---|
| Data ingest | `llmwiki ingest` | Implemented |
| Compile wiki | `llmwiki compile` | Implemented |
| Q&A | `llmwiki query` | Implemented |
| Output filing (save answers back) | `llmwiki query --save` | Implemented |
| Auto-recompile | `llmwiki watch` | Implemented |
| Linting / health-check pass | `llmwiki lint` | Implemented |
| MCP server for agent integration | `dist/mcp-server.js` | Implemented |
| Image support | — | Not yet implemented |
| Marp slides | — | Not yet implemented |
| Fine-tuning | — | Not yet implemented |

## Roadmap

- ✅ Better provenance (paragraph-level source attribution)
- ✅ Linting pass for wiki quality checks
- ✅ MCP server for agent integration (Codex & Claude Code)
- ✅ Multi-provider support (Anthropic, OpenAI, Gemini, Ollama, MiniMax, Cloudflare)
- Larger-corpus query strategy (semantic search, embeddings)
- Deeper Obsidian integration

If you want to contribute, these are the highest-leverage areas right now. Issues and PRs are welcome.

## Requirements

Node.js >= 18, plus provider credentials (for Anthropic: `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`).

## License

MIT


## Disclaimer

No LLMs were harmed in the making of this repo.
