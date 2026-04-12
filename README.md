# codex-

This repository contains the Feishu/Lark integration codebase plus the second-brain web workspace.

## Main Areas

- `src/`: Feishu/Lark API services and server routes
- `src/knowledge/wikiSystem/`: derived wiki-system generator
- `wiki-ui/`: login-protected `llm_wiki`-style web workspace built with Next.js

## Vercel Deployment

For the second-brain workspace, import this repository into Vercel with:

- Branch: `main`
- Root Directory: `wiki-ui`

Required environment variables for `wiki-ui`:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `ALLOWED_GOOGLE_EMAILS`
- `DATABASE_URL`
