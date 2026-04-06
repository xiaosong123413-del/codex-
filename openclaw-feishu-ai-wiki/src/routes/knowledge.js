export function setupKnowledgeRoutes(router, client) {
  router.get('/feishu/knowledge/roots', async (_req, res, next) => {
    try {
      res.json({
        ok: true,
        roots: client.knowledge.getConfiguredRoots(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/feishu/knowledge/schema/plan', async (_req, res, next) => {
    try {
      res.json({
        ok: true,
        tables: client.knowledge.buildSchemaPlan(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/scan', async (req, res, next) => {
    try {
      const roots = req.body?.roots;
      const result = await client.knowledge.scanRoots(roots);
      res.json({ ok: true, roots: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/bootstrap', async (req, res, next) => {
    try {
      const result = await client.knowledge.bootstrapGraphStore(req.body ?? {});
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/collect', async (req, res, next) => {
    try {
      const { nodeToken, includeBlocks = false, blockId } = req.body ?? {};
      if (!nodeToken) {
        res.status(400).json({
          ok: false,
          message: 'nodeToken is required',
        });
        return;
      }

      const result = await client.knowledge.collectNodeContent(nodeToken, {
        includeBlocks,
        blockId,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/artifacts', async (req, res, next) => {
    try {
      const artifacts = client.knowledge.buildKnowledgeArtifacts(req.body ?? {});
      res.json({ ok: true, ...artifacts });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/graph/sync', async (req, res, next) => {
    try {
      const result = await client.knowledge.syncArtifactsToGraphStore(req.body ?? {});
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/markdown', async (req, res, next) => {
    try {
      const markdown = client.knowledge.buildAiKnowledgePageMarkdown(req.body ?? {});
      res.json({ ok: true, markdown });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/user/import-node', async (req, res, next) => {
    try {
      const result = await client.knowledgeCli.importNodeWithPublish(req.body ?? {});
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/user/maintain-ai-wiki', async (req, res, next) => {
    try {
      const result = await client.knowledgeCli.maintainAiWikiEntry(req.body ?? {});
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/feishu/knowledge/user/maintain-ai-wiki/journals', async (req, res, next) => {
    try {
      const result = await client.knowledgeCli.maintainAiWikiFromJournals(req.body ?? {});
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
