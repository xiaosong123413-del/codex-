# Wiki UI

## Local Run

1. `node ../scripts/generate-wiki-system.mjs`
2. `node ../scripts/sync-wiki-ui-generated.mjs`
3. `npm install`
4. `npm run db:generate`
5. Set `.env` from `.env.example`
6. `npm run db:push`
7. `npm run dev`

## Build

1. Set `DATABASE_URL`
2. Run `npm run build`

## Deploy To Vercel

1. Import `wiki-ui` as the project root
2. Set `AUTH_SECRET`
3. Set `AUTH_GOOGLE_ID`
4. Set `AUTH_GOOGLE_SECRET`
5. Set `ALLOWED_GOOGLE_EMAILS`
6. Set `DATABASE_URL`
7. In Google OAuth, add callback URL: `https://<your-domain>/api/auth/callback/google`
8. Run `npm run db:push` against the production database before first login

## Runtime Behavior

- `/` redirects to `/workspace` when authenticated, otherwise `/signin`
- `Chat` stores threads/messages in PostgreSQL and returns a grounded fallback answer based on indexed wiki pages
- `Review` merges persisted review items with lint and absorb-log derived queue items
- `Deep Research` stores a structured research brief in PostgreSQL
- All wiki content is read from `generated/*.json`, which is synced from `.wiki-system`
