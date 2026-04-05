/**
 * Task Routes
 */
export function setupTaskRoutes(router, client) {
  // Task List operations

  // List task lists
  router.get('/feishu/task/lists', async (req, res, next) => {
    try {
      const { page_size, page_token } = req.query;
      const result = await client.task.listTaskLists({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create task list
  router.post('/feishu/task/list', async (req, res, next) => {
    try {
      const { name, description = '', members = [] } = req.body;

      if (!name) {
        res.status(400).json({
          ok: false,
          message: 'name is required',
        });
        return;
      }

      const result = await client.task.createTaskList(name, description, members);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get task list
  router.get('/feishu/task/list/:taskListId', async (req, res, next) => {
    try {
      const { taskListId } = req.params;
      const result = await client.task.getTaskList(taskListId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update task list
  router.post('/feishu/task/list/:taskListId', async (req, res, next) => {
    try {
      const { taskListId } = req.params;
      const updates = req.body;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'update data is required',
        });
        return;
      }

      const result = await client.task.updateTaskList(taskListId, updates);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete task list
  router.delete('/feishu/task/list/:taskListId', async (req, res, next) => {
    try {
      const { taskListId } = req.params;
      const result = await client.task.deleteTaskList(taskListId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Task operations

  // Create task
  router.post('/feishu/task/list/:taskListId/task', async (req, res, next) => {
    try {
      const { taskListId } = req.params;
      const taskData = req.body;

      if (!taskData.title) {
        res.status(400).json({
          ok: false,
          message: 'task title is required',
        });
        return;
      }

      const result = await client.task.createTask(taskListId, taskData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get task
  router.get('/feishu/task/:taskId', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.task.getTask(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update task
  router.post('/feishu/task/:taskId', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const updates = req.body;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'update data is required',
        });
        return;
      }

      const result = await client.task.updateTask(taskId, updates);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete task
  router.delete('/feishu/task/:taskId', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.task.deleteTask(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List tasks in task list
  router.get('/feishu/task/list/:taskListId/tasks', async (req, res, next) => {
    try {
      const { taskListId } = req.params;
      const { page_size, page_token, status } = req.query;
      const result = await client.task.listTasks(taskListId, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        status,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Assign task
  router.post('/feishu/task/:taskId/assign', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { member_ids } = req.body;

      if (!member_ids || !Array.isArray(member_ids)) {
        res.status(400).json({
          ok: false,
          message: 'member_ids array is required',
        });
        return;
      }

      const result = await client.task.assignTask(taskId, member_ids);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Unassign task
  router.post('/feishu/task/:taskId/unassign', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { member_ids } = req.body;

      if (!member_ids || !Array.isArray(member_ids)) {
        res.status(400).json({
          ok: false,
          message: 'member_ids array is required',
        });
        return;
      }

      const result = await client.task.unassignTask(taskId, member_ids);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Complete task
  router.post('/feishu/task/:taskId/complete', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.task.completeTask(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Reopen task
  router.post('/feishu/task/:taskId/reopen', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await client.task.reopenTask(taskId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Add task comment
  router.post('/feishu/task/:taskId/comment', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { content } = req.body;

      if (!content) {
        res.status(400).json({
          ok: false,
          message: 'comment content is required',
        });
        return;
      }

      const result = await client.task.addTaskComment(taskId, content);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get task comments
  router.get('/feishu/task/:taskId/comments', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { page_size, page_token } = req.query;
      const result = await client.task.getTaskComments(taskId, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
