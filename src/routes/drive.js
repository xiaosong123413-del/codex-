/**
 * Drive (Files) Routes
 */
export function setupDriveRoutes(router, client) {
  // Upload file
  router.post('/feishu/drive/upload', async (req, res, next) => {
    try {
      const { file_path, file_name, folder_token } = req.body;

      if (!file_path || !file_name) {
        res.status(400).json({
          ok: false,
          message: 'file_path and file_name are required',
        });
        return;
      }

      const result = await client.drive.uploadFile(file_path, file_name, folder_token);
      res.json({ ok: true, file: result });
    } catch (error) {
      next(error);
    }
  });

  // Upload file from base64
  router.post('/feishu/drive/upload/base64', async (req, res, next) => {
    try {
      const { file_name, base64_content, folder_token } = req.body;

      if (!file_name || !base64_content) {
        res.status(400).json({
          ok: false,
          message: 'file_name and base64_content are required',
        });
        return;
      }

      const buffer = Buffer.from(base64_content, 'base64');
      const result = await client.drive.uploadFileFromBuffer(buffer, file_name, folder_token);
      res.json({ ok: true, file: result });
    } catch (error) {
      next(error);
    }
  });

  // Download file
  router.get('/feishu/drive/file/:fileToken/download', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const buffer = await client.drive.downloadFile(fileToken);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileToken}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  // Get file info
  router.get('/feishu/drive/file/:fileToken', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const result = await client.drive.getFile(fileToken);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete file
  router.delete('/feishu/drive/file/:fileToken', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const result = await client.drive.deleteFile(fileToken);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update file
  router.post('/feishu/drive/file/:fileToken', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const updates = req.body;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'update data is required',
        });
        return;
      }

      const result = await client.drive.updateFile(fileToken, updates);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Move file
  router.post('/feishu/drive/file/:fileToken/move', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const { destination_folder_token } = req.body;

      if (!destination_folder_token) {
        res.status(400).json({
          ok: false,
          message: 'destination_folder_token is required',
        });
        return;
      }

      const result = await client.drive.moveFile(fileToken, destination_folder_token);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Copy file
  router.post('/feishu/drive/file/:fileToken/copy', async (req, res, next) => {
    try {
      const { fileToken } = req.params;
      const { destination_folder_token } = req.body;

      if (!destination_folder_token) {
        res.status(400).json({
          ok: false,
          message: 'destination_folder_token is required',
        });
        return;
      }

      const result = await client.drive.copyFile(fileToken, destination_folder_token);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create folder
  router.post('/feishu/drive/folder', async (req, res, next) => {
    try {
      const { name, parent_folder_token } = req.body;

      if (!name) {
        res.status(400).json({
          ok: false,
          message: 'name is required',
        });
        return;
      }

      const result = await client.drive.createFolder(name, parent_folder_token);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get folder info
  router.get('/feishu/drive/folder/:folderToken', async (req, res, next) => {
    try {
      const { folderToken } = req.params;
      const result = await client.drive.getFolder(folderToken);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List folder contents
  router.get('/feishu/drive/folder/:folderToken/contents', async (req, res, next) => {
    try {
      const { folderToken } = req.params;
      const { page_size, page_token } = req.query;
      const result = await client.drive.listFolder(folderToken, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Search files
  router.post('/feishu/drive/search', async (req, res, next) => {
    try {
      const { query } = req.body;

      if (!query) {
        res.status(400).json({
          ok: false,
          message: 'query is required',
        });
        return;
      }

      const result = await client.drive.searchFiles(query, req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
