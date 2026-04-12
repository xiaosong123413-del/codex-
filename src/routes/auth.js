/**
 * Auth Routes
 */
export function setupAuthRoutes(router, client) {
  // Health check
  router.get('/health', async (req, res, next) => {
    try {
      const health = await client.health();
      res.json({
        ok: true,
        service: 'feishu-connect',
        version: '2.0.0',
        ...health,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get tenant access token
  router.get('/feishu/token', async (req, res, next) => {
    try {
      const result = await client.auth.getTenantToken();
      res.json({
        ok: true,
        token: result.token,
        expire: result.expire,
        expireAt: result.expireAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // Refresh tenant token
  router.post('/feishu/token/refresh', async (req, res, next) => {
    try {
      client.clearTenantToken();
      const result = await client.auth.getTenantToken();
      res.json({
        ok: true,
        token: result.token,
        expire: result.expire,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get bot info
  router.get('/feishu/bot/info', async (req, res, next) => {
    try {
      const result = await client.bot.getBotInfo();
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
