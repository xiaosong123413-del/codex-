# Cloudflare Remote Brain Worker

Cloudflare Worker template for LLM Wiki Remote Brain, publish storage, and the
real service endpoints used by local Cloudflare adapters.

## Endpoints

- `GET /status` reports whether `DB`, `WIKI_BUCKET`, `MEDIA_BUCKET`, `VECTORIZE`, `AI`, and `WIKI_PUBLISH_EVENTS` bindings exist.
- `GET /wiki/events` opens the public wiki WebSocket channel for publish notifications.
- `POST /publish` accepts the local publish payload with `publishVersion`, writes `publish_runs` through `running -> published/failed`, writes `wiki_pages` to D1, stores page Markdown in R2 when `WIKI_BUCKET` is bound, and broadcasts `wiki-published` after a successful publish.
- `POST /push` accepts a lightweight manifest and records a run when D1 is bound.
- `POST /pull` returns a small structured snapshot from D1 when available.
- `POST /mcp` exposes a minimal JSON-RPC MCP surface with `tools/list` and `tools/call` for `get_page` and `search_wiki`.
- `POST /llm` calls Workers AI with `{ model?, messages? | prompt? }` and returns `{ text }`.
- `POST /ocr` calls `OCR_MODEL` with base64 media and returns `{ text }`, or a structured error if AI/model execution is unavailable.
- `POST /transcribe` calls `TRANSCRIBE_MODEL` with base64 audio/video and returns `{ text }`.
- `POST /embed` calls the embedding model with `{ text }` and returns `{ vector }`.
- `POST /vector/query` calls Vectorize with `{ vector, topK }` and returns `{ matches }`.
- `POST /search` performs a D1 `wiki_pages` LIKE search and returns `{ results: [{ title, url, snippet }] }`.
- `POST /auth/register` creates an account with an email or phone identity and returns a session token.
- `POST /auth/login` logs in with the same email or phone identity and returns a session token.
- `POST /auth/wechat/mini-login/start` creates a short-lived QR login challenge for desktop/browser clients.
- `POST /auth/wechat/mini-login/confirm` lets the WeChat mini program confirm that challenge with a `wx.login` code.
- `POST /auth/wechat/mini-login/poll` lets the desktop/browser client poll until the confirmed account session is ready.
- `POST /auth/session` reads the current account from `Authorization: Bearer <session token>`.
- `POST /account/workspaces/bind` binds a workspace to the current account session.
- `POST /account/workspaces/list` lists workspaces owned by the current account session.
- `POST /account/sync-location/save` saves the account-owned sync location metadata. The first supported backend is `local_directory`; the data remains in the user's configured location.
- `POST /account/sync-location/get` reads that workspace sync location for another logged-in desktop or mobile client.
- `POST /user/publish` publishes wiki pages with `Authorization: Bearer <session token>` into an account/workspace-scoped path instead of the global wiki table namespace.
- `POST /user/mobile/entries*` mirrors the mobile entry routes but derives `ownerUid` from the session account, not from client-provided input.
- `POST /user/mobile/wiki/list` and `POST /user/mobile/wiki/page` read only wiki pages under the authenticated account and workspace.
- `POST /mobile/chat/list` returns mobile chat threads with persisted `mode` and typed `sources`.
- `POST /mobile/chat/send` accepts `{ ownerUid, chatId?, message, mode }` where `mode` is `wiki | web | hybrid`.
- `POST /media/upload` writes base64 media to `MEDIA_BUCKET` and returns `{ key }`.

Account endpoints under `/auth/*` are public, while `/account/*` endpoints require
`Authorization: Bearer <session token>`. Public desktop/mobile clients should use
`/user/*` routes with the same session token. The legacy non-`/user` POST endpoints
still accept `Authorization: Bearer <REMOTE_TOKEN>` for existing admin/development
flows, but release clients should not ship or share that token.

## Setup

1. Copy `wrangler.jsonc.example` to `wrangler.jsonc`.
2. Create these Cloudflare resources and fill in the binding ids/names:
   - D1 database `DB` for `publish_runs` and `wiki_pages`.
   - R2 bucket `WIKI_BUCKET` for published Markdown page bodies.
   - R2 bucket `MEDIA_BUCKET` for local adapter media uploads.
   - Vectorize index `VECTORIZE` for vector query.
   - Workers AI binding `AI`.
   - Durable Object binding `WIKI_PUBLISH_EVENTS` for public wiki publish events.
3. Apply the versioned D1 migrations with `wrangler d1 migrations apply llm-wiki-remote-brain --remote` or `npm run db:migrate`.
   - Existing deployments must run the migration so `publish_runs` is rebuilt with `publish_version`, `status`, and `error`.
   - `schema.sql` remains the latest schema snapshot for reference and fresh local inspection.
4. Set `REMOTE_TOKEN` with `wrangler secret put REMOTE_TOKEN`.
5. Set model vars in `wrangler.jsonc`: `LLM_MODEL`, `OCR_MODEL`, `TRANSCRIBE_MODEL`, and `EMBEDDING_MODEL`.
6. Configure WeChat mini-program login credentials:
   - Set `WECHAT_MINI_PROGRAM_APP_ID` in `wrangler.jsonc`.
   - Set `WECHAT_MINI_PROGRAM_APP_SECRET` with `wrangler secret put WECHAT_MINI_PROGRAM_APP_SECRET`.
   - `WECHAT_WEB_APP_ID` / `WECHAT_WEB_APP_SECRET` are only needed for the optional WeChat Open Platform website OAuth path.
7. For mobile `web` / `hybrid` chat, configure `CLOUDFLARE_SEARCH_ENDPOINT` and optionally `CLOUDFLARE_SEARCH_MODEL`; if the endpoint needs a separate bearer token, set `CLOUDFLARE_SEARCH_TOKEN` as a Worker secret.
8. Run `npm run typegen` after changing bindings.
9. Deploy with `npm run deploy`.

Configure the local app with:

```bash
LLMWIKI_REMOTE_PROVIDER=cloudflare
LLMWIKI_PROVIDER=cloudflare
CLOUDFLARE_WORKER_URL=https://your-worker.example.workers.dev
CLOUDFLARE_REMOTE_TOKEN=the-same-token
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct
CLOUDFLARE_OCR_MODEL=@cf/llava-hf/llava-1.5-7b-hf
CLOUDFLARE_TRANSCRIBE_MODEL=@cf/openai/whisper
CLOUDFLARE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
CLOUDFLARE_SEARCH_ENDPOINT=https://api.tavily.com
CLOUDFLARE_SEARCH_MODEL=
```

`REMOTE_TOKEN` is only configured as a Worker secret and as the local
`CLOUDFLARE_REMOTE_TOKEN`; the Worker never includes it in JSON responses.

## Publish State

- `publish_runs` is the source of truth for Cloudflare release state.
- `/mobile/wiki/list` reports `currentWikiVersion` from the latest `publish_runs.publish_version` where `status='published'`.
- Failed publish attempts remain visible in `publish_runs`, but they do not advance the APK-visible version.
