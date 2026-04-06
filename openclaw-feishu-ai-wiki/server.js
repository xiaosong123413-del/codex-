import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';

import { OpenclawFeishuAiWikiClient } from './src/core/client.js';
import { getDeploymentConfigSummary } from './src/knowledge/config.js';
import { jsonBodyParser } from './src/middleware/jsonParser.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import { setupKnowledgeRoutes } from './src/routes/knowledge.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

const app = express();
const port = process.env.PORT || 3111;

const client = new OpenclawFeishuAiWikiClient();

app.use(jsonBodyParser);
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'openclaw-feishu-ai-wiki',
    version: '0.1.0',
    description: 'Feishu AI wiki maintenance service for journal splitting and block-level citations',
    endpoints: {
      health: 'GET /health',
      config: 'GET /config',
      roots: 'GET /feishu/knowledge/roots',
      schemaPlan: 'GET /feishu/knowledge/schema/plan',
      scan: 'POST /feishu/knowledge/scan',
      bootstrap: 'POST /feishu/knowledge/bootstrap',
      collect: 'POST /feishu/knowledge/collect',
      artifacts: 'POST /feishu/knowledge/artifacts',
      graphSync: 'POST /feishu/knowledge/graph/sync',
      markdown: 'POST /feishu/knowledge/markdown',
      maintainEntry: 'POST /feishu/knowledge/user/maintain-ai-wiki',
      maintainJournals: 'POST /feishu/knowledge/user/maintain-ai-wiki/journals',
    },
  });
});

app.get('/health', async (_req, res) => {
  const health = await client.health();
  res.json({
    ok: true,
    service: 'openclaw-feishu-ai-wiki',
    version: '0.1.0',
    ...health,
  });
});

app.get('/config', (_req, res) => {
  res.json({
    ok: true,
    config: getDeploymentConfigSummary(),
  });
});

setupKnowledgeRoutes(app, client);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`openclaw-feishu-ai-wiki listening on http://localhost:${port}`);
});
