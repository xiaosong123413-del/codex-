/**
 * Bot Routes
 */
export function setupBotRoutes(router, client) {
  // Get bot info
  router.get('/feishu/bot/info', async (req, res, next) => {
    try {
      const result = await client.bot.getBotInfo();
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update bot info
  router.post('/feishu/bot/info', async (req, res, next) => {
    try {
      const { ...updateData } = req.body;

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'update data is required',
        });
        return;
      }

      const result = await client.bot.updateBotInfo(updateData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get bot chat members
  router.get('/feishu/bot/members', async (req, res, next) => {
    try {
      const { page_size, page_token } = req.query;
      const result = await client.bot.getBotChatMembers({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get bot chat member count
  router.get('/feishu/bot/members/count', async (req, res, next) => {
    try {
      const result = await client.bot.getBotChatMemberCount();
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Set bot help text
  router.post('/feishu/bot/help', async (req, res, next) => {
    try {
      const { help_text } = req.body;

      if (!help_text) {
        res.status(400).json({
          ok: false,
          message: 'help_text is required',
        });
        return;
      }

      const result = await client.bot.setBotHelpText(help_text);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Set bot description
  router.post('/feishu/bot/description', async (req, res, next) => {
    try {
      const { description } = req.body;

      if (!description) {
        res.status(400).json({
          ok: false,
          message: 'description is required',
        });
        return;
      }

      const result = await client.bot.setBotDescription(description);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Set outgoing webhook URL
  router.post('/feishu/bot/webhook', async (req, res, next) => {
    try {
      const { url } = req.body;

      if (!url) {
        res.status(400).json({
          ok: false,
          message: 'url is required',
        });
        return;
      }

      const result = await client.bot.setOutgoingWebhook(url);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get outgoing webhook URL
  router.get('/feishu/bot/webhook', async (req, res, next) => {
    try {
      const result = await client.bot.getOutgoingWebhook();
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
