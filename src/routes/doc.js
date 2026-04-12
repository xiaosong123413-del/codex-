/**
 * Document Routes
 */
export function setupDocRoutes(router, client) {
  // Document operations

  // Create document
  router.post('/feishu/doc/create', async (req, res, next) => {
    try {
      const { title, type = 'doc', folder_token } = req.body;

      if (!title) {
        res.status(400).json({
          ok: false,
          message: 'title is required',
        });
        return;
      }

      const result = await client.doc.createDocument(title, type, folder_token);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get document
  router.get('/feishu/doc/:documentId', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const result = await client.doc.getDocument(documentId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update document title
  router.post('/feishu/doc/:documentId/title', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { title } = req.body;

      if (!title) {
        res.status(400).json({
          ok: false,
          message: 'title is required',
        });
        return;
      }

      const result = await client.doc.updateDocumentTitle(documentId, title);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete document
  router.delete('/feishu/doc/:documentId', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const result = await client.doc.deleteDocument(documentId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get document content
  router.get('/feishu/doc/:documentId/content', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const result = await client.doc.getDocumentContent(documentId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update document content (batch operations)
  router.post('/feishu/doc/:documentId/content', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { operations } = req.body;

      if (!operations || !Array.isArray(operations)) {
        res.status(400).json({
          ok: false,
          message: 'operations array is required',
        });
        return;
      }

      const result = await client.doc.updateDocumentContent(documentId, operations);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Append block to document
  router.post('/feishu/doc/:documentId/blocks', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { block } = req.body;

      if (!block) {
        res.status(400).json({
          ok: false,
          message: 'block is required',
        });
        return;
      }

      const result = await client.doc.appendBlock(documentId, block);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get block
  router.get('/feishu/doc/:documentId/blocks/:blockId', async (req, res, next) => {
    try {
      const { documentId, blockId } = req.params;
      const result = await client.doc.getBlock(documentId, blockId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update block
  router.post('/feishu/doc/:documentId/blocks/:blockId', async (req, res, next) => {
    try {
      const { documentId, blockId } = req.params;
      const { block } = req.body;

      if (!block) {
        res.status(400).json({
          ok: false,
          message: 'block is required',
        });
        return;
      }

      const result = await client.doc.updateBlock(documentId, blockId, block);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete block
  router.delete('/feishu/doc/:documentId/blocks/:blockId', async (req, res, next) => {
    try {
      const { documentId, blockId } = req.params;
      const result = await client.doc.deleteBlock(documentId, blockId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Share document
  router.post('/feishu/doc/:documentId/share', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { type, id, permission = 'view' } = req.body;

      if (!type || !id) {
        res.status(400).json({
          ok: false,
          message: 'type and id are required',
        });
        return;
      }

      const result = await client.doc.shareDocument(documentId, { type, id }, permission);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Export document
  router.get('/feishu/doc/:documentId/export', async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { format = 'markdown' } = req.query;
      const result = await client.doc.exportDocument(documentId, format);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Spreadsheet operations

  // Create spreadsheet
  router.post('/feishu/sheet/create', async (req, res, next) => {
    try {
      const { title, folder_token } = req.body;

      if (!title) {
        res.status(400).json({
          ok: false,
          message: 'title is required',
        });
        return;
      }

      const result = await client.doc.createSpreadsheet(title, folder_token);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get spreadsheet
  router.get('/feishu/sheet/:spreadsheetToken', async (req, res, next) => {
    try {
      const { spreadsheetToken } = req.params;
      const result = await client.doc.getSpreadsheet(spreadsheetToken);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get sheet values
  router.get('/feishu/sheet/:spreadsheetToken/values', async (req, res, next) => {
    try {
      const { spreadsheetToken } = req.params;
      const { range, sheet_id } = req.query;

      if (!range || !sheet_id) {
        res.status(400).json({
          ok: false,
          message: 'range and sheet_id are required',
        });
        return;
      }

      const result = await client.doc.getSheetValues(spreadsheetToken, sheet_id, range);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update sheet values
  router.put('/feishu/sheet/:spreadsheetToken/values', async (req, res, next) => {
    try {
      const { spreadsheetToken } = req.params;
      const { range, sheet_id, values } = req.body;

      if (!range || !sheet_id || !values) {
        res.status(400).json({
          ok: false,
          message: 'range, sheet_id and values are required',
        });
        return;
      }

      const result = await client.doc.updateSheetValues(spreadsheetToken, sheet_id, range, values);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Append rows
  router.post('/feishu/sheet/:spreadsheetToken/rows/append', async (req, res, next) => {
    try {
      const { spreadsheetToken } = req.params;
      const { sheet_id, values } = req.body;

      if (!sheet_id || !values) {
        res.status(400).json({
          ok: false,
          message: 'sheet_id and values are required',
        });
        return;
      }

      const result = await client.doc.appendSheetRows(spreadsheetToken, sheet_id, values);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Batch update
  router.post('/feishu/sheet/:spreadsheetToken/batch-update', async (req, res, next) => {
    try {
      const { spreadsheetToken } = req.params;
      const operations = req.body;

      if (!operations) {
        res.status(400).json({
          ok: false,
          message: 'operations are required',
        });
        return;
      }

      const result = await client.doc.batchUpdate(spreadsheetToken, operations);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
