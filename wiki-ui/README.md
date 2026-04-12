# Wiki UI

## Local Run

1. `node ../scripts/generate-wiki-system.mjs`
2. `node ../scripts/sync-wiki-ui-generated.mjs`
3. `npm install`
4. `npm run db:generate`
5. `npm run dev`

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
