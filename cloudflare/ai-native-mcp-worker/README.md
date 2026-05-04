# LLM Wiki AI Native MCP Worker

Built-in Cloudflare Worker remote MCP gateway for LLM Wiki.

This is the Worker-side successor to the standalone `ai-native-cli` skeleton:

- Codex connects to this Worker as a remote MCP server.
- OpenClaw can route personal WeChat messages into the same MCP tools.
- The Worker can read published wiki data directly from D1 or proxy to the existing `remote-brain-worker`.
- Full local CLI actions are forwarded to a local bridge URL, because Cloudflare Workers cannot run local filesystem CLI processes.

## Tools

- `llmwiki_status`
- `llmwiki_search_wiki`
- `llmwiki_get_page`
- `llmwiki_chat`
- `llmwiki_run_cli`
- `llmwiki_webui`
- `llmwiki_wechat_message`

## Setup

1. Edit `wrangler.jsonc`, or replace it with `wrangler.jsonc.example`.
2. Configure `LLMWIKI_REMOTE_BRAIN_URL` if this Worker should proxy the existing remote brain service.
3. Configure `LLMWIKI_WEBUI_URL` if Codex/OpenClaw should return a WebUI entry URL.
4. Configure D1 `DB` if this Worker should search/read published wiki pages directly.
5. Set the public MCP gate secret:

```bash
wrangler secret put LLMWIKI_MCP_SHARED_SECRET
```

6. If proxying the existing remote brain service, set its token:

```bash
wrangler secret put LLMWIKI_REMOTE_TOKEN
```

7. If forwarding local CLI operations, set the local bridge URL:

```bash
wrangler secret put LLMWIKI_LOCAL_BRIDGE_URL
```

## Codex

Preferred remote target:

```json
{
  "mcpServers": {
    "llmwiki-ai-native": {
      "url": "https://your-worker.example.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${LLMWIKI_MCP_SHARED_SECRET}"
      }
    }
  }
}
```

If the host only supports stdio MCP, use `mcp-remote` as the local adapter:

```json
{
  "mcpServers": {
    "llmwiki-ai-native": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-worker.example.workers.dev/mcp"
      ],
      "env": {
        "LLMWIKI_MCP_SHARED_SECRET": "replace-with-secret"
      }
    }
  }
}
```

## OpenClaw / WeChat

Route personal WeChat text to `llmwiki_wechat_message`.

Command-style messages:

- `/compile`
- `/lint`
- `/query your question`
- `/ingest https://example.com/source`

Plain text is sent to `llmwiki_chat` in `hybrid` mode.
