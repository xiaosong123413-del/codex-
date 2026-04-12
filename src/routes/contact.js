/**
 * Contact (Users & Departments & Chats) Routes
 */
export function setupContactRoutes(router, client) {
  // Get user by ID
  router.get('/feishu/contact/user/:userId', async (req, res, next) => {
    try {
      const { userId } = req.params;
      const result = await client.contact.getUser(userId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Batch get users
  router.post('/feishu/contact/users/batch', async (req, res, next) => {
    try {
      const { user_ids } = req.body;

      if (!user_ids || !Array.isArray(user_ids)) {
        res.status(400).json({
          ok: false,
          message: 'user_ids array is required',
        });
        return;
      }

      const result = await client.contact.batchGetUsers(user_ids);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List all users
  router.get('/feishu/contact/users', async (req, res, next) => {
    try {
      const { page_size, page_token, department_id } = req.query;
      const result = await client.contact.listUsers({
        pageSize: parseInt(page_size) || 100,
        pageToken,
        departmentId: department_id,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Search users
  router.post('/feishu/contact/users/search', async (req, res, next) => {
    try {
      const { query } = req.body;

      if (!query) {
        res.status(400).json({
          ok: false,
          message: 'query is required',
        });
        return;
      }

      const result = await client.contact.searchUsers(query, req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get department
  router.get('/feishu/contact/department/:departmentId', async (req, res, next) => {
    try {
      const { departmentId } = req.params;
      const result = await client.contact.getDepartment(departmentId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List all departments
  router.get('/feishu/contact/departments', async (req, res, next) => {
    try {
      const { page_size, page_token, fetch_child } = req.query;
      const result = await client.contact.listDepartments({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        fetchChild: fetch_child !== undefined ? fetch_child === 'true' : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get department users
  router.get('/feishu/contact/department/:departmentId/users', async (req, res, next) => {
    try {
      const { departmentId } = req.params;
      const { page_size, page_token, fetch_child } = req.query;
      const result = await client.contact.getDepartmentUsers(departmentId, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        fetchChild: fetch_child !== undefined ? fetch_child === 'true' : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get user's departments
  router.get('/feishu/contact/user/:userId/departments', async (req, res, next) => {
    try {
      const { userId } = req.params;
      const result = await client.contact.getUserDepartments(userId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List chats
  router.get('/feishu/contact/chats', async (req, res, next) => {
    try {
      const { page_size, page_token } = req.query;
      const result = await client.contact.listChats({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get chat info
  router.get('/feishu/contact/chat/:chatId', async (req, res, next) => {
    try {
      const { chatId } = req.params;
      const result = await client.contact.getChat(chatId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get chat members
  router.get('/feishu/contact/chat/:chatId/members', async (req, res, next) => {
    try {
      const { chatId } = req.params;
      const { page_size, page_token } = req.query;
      const result = await client.contact.getChatMembers(chatId, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
