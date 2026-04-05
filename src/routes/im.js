/**
 * IM (Messaging) Routes
 */
export function setupIMRoutes(router, client) {
  // Send text message
  router.post('/feishu/message/text', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, text } = req.body;

      if (!receive_id || !text) {
        res.status(400).json({
          ok: false,
          message: 'receive_id and text are required',
        });
        return;
      }

      const result = await client.im.sendText(receive_id_type, receive_id, text);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Send card message
  router.post('/feishu/message/card', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, card } = req.body;

      if (!receive_id || !card) {
        res.status(400).json({
          ok: false,
          message: 'receive_id and card are required',
        });
        return;
      }

      const result = await client.im.sendCard(receive_id_type, receive_id, card);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Send image message
  router.post('/feishu/message/image', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, image_key } = req.body;

      if (!receive_id || !image_key) {
        res.status(400).json({
          ok: false,
          message: 'receive_id and image_key are required',
        });
        return;
      }

      const result = await client.im.sendImage(receive_id_type, receive_id, image_key);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Send file message
  router.post('/feishu/message/file', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, file_key } = req.body;

      if (!receive_id || !file_key) {
        res.status(400).json({
          ok: false,
          message: 'receive_id and file_key are required',
        });
        return;
      }

      const result = await client.im.sendFile(receive_id_type, receive_id, file_key);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Send audio message
  router.post('/feishu/message/audio', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, audio_key, duration = 0 } = req.body;

      if (!receive_id || !audio_key) {
        res.status(400).json({
          ok: false,
          message: 'receive_id and audio_key are required',
        });
        return;
      }

      const result = await client.im.sendAudio(receive_id_type, receive_id, audio_key, duration);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Generic send (for any message type)
  router.post('/feishu/message', async (req, res, next) => {
    try {
      const { receive_id_type = 'open_id', receive_id, msg_type, content } = req.body;

      if (!receive_id || !msg_type || content === undefined) {
        res.status(400).json({
          ok: false,
          message: 'receive_id, msg_type and content are required',
        });
        return;
      }

      const result = await client.im.send(receive_id_type, receive_id, msg_type, content);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Recall message
  router.delete('/feishu/message/:messageId', async (req, res, next) => {
    try {
      const { messageId } = req.params;
      const result = await client.im.recall(messageId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get message
  router.get('/feishu/message/:messageId', async (req, res, next) => {
    try {
      const { messageId } = req.params;
      const result = await client.im.get(messageId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Forward message
  router.post('/feishu/message/:messageId/forward', async (req, res, next) => {
    try {
      const { messageId } = req.params;
      const { receive_id_type, receive_id } = req.body;

      if (!receive_id_type || !receive_id) {
        res.status(400).json({
          ok: false,
          message: 'receive_id_type and receive_id are required',
        });
        return;
      }

      const result = await client.im.forward(messageId, receive_id_type, receive_id);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
