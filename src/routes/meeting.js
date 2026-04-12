/**
 * Meeting Routes
 */
export function setupMeetingRoutes(router, client) {
  // Create meeting
  router.post('/feishu/meeting', async (req, res, next) => {
    try {
      const meetingData = req.body;

      if (!meetingData.title || !meetingData.start_time || !meetingData.end_time) {
        res.status(400).json({
          ok: false,
          message: 'title, start_time and end_time are required',
        });
        return;
      }

      const result = await client.meeting.createMeeting(meetingData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get meeting
  router.get('/feishu/meeting/:meetingId', async (req, res, next) => {
    try {
      const { meetingId } = req.params;
      const result = await client.meeting.getMeeting(meetingId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update meeting
  router.post('/feishu/meeting/:meetingId', async (req, res, next) => {
    try {
      const { meetingId } = req.params;
      const meetingData = req.body;

      if (Object.keys(meetingData).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'meeting data is required',
        });
        return;
      }

      const result = await client.meeting.updateMeeting(meetingId, meetingData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Cancel meeting
  router.delete('/feishu/meeting/:meetingId', async (req, res, next) => {
    try {
      const { meetingId } = req.params;
      const { reason } = req.query;
      const result = await client.meeting.cancelMeeting(meetingId, reason);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Register meeting material
  router.post('/feishu/meeting/:meetingId/materials', async (req, res, next) => {
    try {
      const { meetingId } = req.params;
      const { materials } = req.body;

      if (!materials || !Array.isArray(materials)) {
        res.status(400).json({
          ok: false,
          message: 'materials array is required',
        });
        return;
      }

      const result = await client.meeting.registerMaterial(meetingId, materials);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get meeting participants
  router.get('/feishu/meeting/:meetingId/participants', async (req, res, next) => {
    try {
      const { meetingId } = req.params;
      const result = await client.meeting.getMeetingParticipants(meetingId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get meeting by external ID
  router.get('/feishu/meeting/external/:externalMeetingId', async (req, res, next) => {
    try {
      const { externalMeetingId } = req.params;
      const result = await client.meeting.getMeetingByExternalId(externalMeetingId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get meeting statistics
  router.get('/feishu/meeting/stats', async (req, res, next) => {
    try {
      const { start_time, end_time } = req.query;

      if (!start_time || !end_time) {
        res.status(400).json({
          ok: false,
          message: 'start_time and end_time are required',
        });
        return;
      }

      const result = await client.meeting.getMeetingStats(start_time, end_time);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
