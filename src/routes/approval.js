/**
 * Approval Routes
 */
export function setupApprovalRoutes(router, client) {
  // List approval definitions (templates)
  router.get('/feishu/approval/definitions', async (req, res, next) => {
    try {
      const { page_size, page_token, name } = req.query;
      const result = await client.approval.listApprovalDefinitions({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        name,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get approval definition
  router.get('/feishu/approval/definition/:definitionId', async (req, res, next) => {
    try {
      const { definitionId } = req.params;
      const result = await client.approval.getApprovalDefinition(definitionId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create approval instance
  router.post('/feishu/approval/instance', async (req, res, next) => {
    try {
      const { approval_template_id, ...instanceData } = req.body;

      if (!approval_template_id) {
        res.status(400).json({
          ok: false,
          message: 'approval_template_id is required',
        });
        return;
      }

      const result = await client.approval.createInstance(approval_template_id, instanceData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get approval instance
  router.get('/feishu/approval/instance/:instanceId', async (req, res, next) => {
    try {
      const { instanceId } = req.params;
      const result = await client.approval.getInstance(instanceId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Cancel approval instance
  router.post('/feishu/approval/instance/:instanceId/cancel', async (req, res, next) => {
    try {
      const { instanceId } = req.params;
      const { reason = '' } = req.body;
      const result = await client.approval.cancelInstance(instanceId, reason);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List approval instances
  router.get('/feishu/approval/instances', async (req, res, next) => {
    try {
      const {
        page_size,
        page_token,
        status,
        approval_template_id,
        created_at_range,
      } = req.query;

      const result = await client.approval.listInstances({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        status,
        approvalTemplateId: approval_template_id,
        createdAtRange: created_at_range,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List approval tasks
  router.get('/feishu/approval/tasks', async (req, res, next) => {
    try {
      const { page_size, page_token, status, user_id } = req.query;
      const result = await client.approval.listApprovalTasks({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        status,
        userId: user_id,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get approval task
  router.get('/feishu/approval/task/:taskId', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.approval.getApprovalTasks(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get task detail
  router.get('/feishu/approval/task/:taskId/detail', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.approval.getTaskDetail(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Approve task
  router.post('/feishu/approval/task/:taskId/approve', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { comment = '' } = req.body;
      const result = await client.approval.approveTask(taskId, comment);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Reject task
  router.post('/feishu/approval/task/:taskId/reject', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { comment = '' } = req.body;
      const result = await client.approval.rejectTask(taskId, comment);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Transfer task
  router.post('/feishu/approval/task/:taskId/transfer', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { to_user_id, comment = '' } = req.body;

      if (!to_user_id) {
        res.status(400).json({
          ok: false,
          message: 'to_user_id is required',
        });
        return;
      }

      const result = await client.approval.transferTask(taskId, to_user_id, comment);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Add comment to task
  router.post('/feishu/approval/task/:taskId/comment', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { comment } = req.body;

      if (!comment) {
        res.status(400).json({
          ok: false,
          message: 'comment is required',
        });
        return;
      }

      const result = await client.approval.addTaskComment(taskId, comment);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
