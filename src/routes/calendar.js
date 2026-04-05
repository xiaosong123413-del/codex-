/**
 * Calendar Routes
 */
export function setupCalendarRoutes(router, client) {
  // List calendars
  router.get('/feishu/calendar/calendars', async (req, res, next) => {
    try {
      const { page_size, page_token } = req.query;
      const result = await client.calendar.listCalendars({
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get calendar
  router.get('/feishu/calendar/calendar/:calendarId', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const result = await client.calendar.getCalendar(calendarId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create calendar
  router.post('/feishu/calendar/calendar', async (req, res, next) => {
    try {
      const { ...calendarData } = req.body;

      if (!calendarData.title) {
        res.status(400).json({
          ok: false,
          message: 'calendar title is required',
        });
        return;
      }

      const result = await client.calendar.createCalendar(calendarData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update calendar
  router.post('/feishu/calendar/calendar/:calendarId', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const updates = req.body;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'update data is required',
        });
        return;
      }

      const result = await client.calendar.updateCalendar(calendarId, updates);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete calendar
  router.delete('/feishu/calendar/calendar/:calendarId', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const result = await client.calendar.deleteCalendar(calendarId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List events
  router.get('/feishu/calendar/calendar/:calendarId/events', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const {
        page_size,
        page_token,
        time_min,
        time_max,
        updated_min,
        single_events,
      } = req.query;

      const result = await client.calendar.listEvents(calendarId, {
        pageSize: parseInt(page_size) || 100,
        pageToken: page_token,
        timeMin: time_min,
        timeMax: time_max,
        updatedMin: updated_min,
        singleEvents: single_events !== undefined ? single_events === 'true' : true,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Get event
  router.get('/feishu/calendar/calendar/:calendarId/event/:eventId', async (req, res, next) => {
    try {
      const { calendarId, eventId } = req.params;
      const result = await client.calendar.getEvent(calendarId, eventId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create event
  router.post('/feishu/calendar/calendar/:calendarId/event', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const eventData = req.body;

      if (!eventData.summary) {
        res.status(400).json({
          ok: false,
          message: 'event summary is required',
        });
        return;
      }

      const result = await client.calendar.createEvent(calendarId, eventData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Update event
  router.post('/feishu/calendar/calendar/:calendarId/event/:eventId', async (req, res, next) => {
    try {
      const { calendarId, eventId } = req.params;
      const eventData = req.body;

      if (Object.keys(eventData).length === 0) {
        res.status(400).json({
          ok: false,
          message: 'event data is required',
        });
        return;
      }

      const result = await client.calendar.updateEvent(calendarId, eventId, eventData);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete event
  router.delete('/feishu/calendar/calendar/:calendarId/event/:eventId', async (req, res, next) => {
    try {
      const { calendarId, eventId } = req.params;
      const result = await client.calendar.deleteEvent(calendarId, eventId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Quick add event
  router.post('/feishu/calendar/calendar/:calendarId/quick-add', async (req, res, next) => {
    try {
      const { calendarId } = req.params;
      const { text, time_zone = 'Asia/Shanghai' } = req.body;

      if (!text) {
        res.status(400).json({
          ok: false,
          message: 'text is required',
        });
        return;
      }

      const result = await client.calendar.quickAdd(calendarId, text, time_zone);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Free/busy check
  router.post('/feishu/calendar/freebusy', async (req, res, next) => {
    try {
      const { calendar_ids, time_min, time_max, time_zone = 'Asia/Shanghai' } = req.body;

      if (!calendar_ids || !time_min || !time_max) {
        res.status(400).json({
          ok: false,
          message: 'calendar_ids, time_min and time_max are required',
        });
        return;
      }

      const result = await client.calendar.freeBusy(calendar_ids, time_min, time_max, time_zone);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Create meeting for event
  router.post('/feishu/calendar/calendar/:calendarId/event/:eventId/meeting', async (req, res, next) => {
    try {
      const { calendarId, eventId } = req.params;
      const meetingConfig = req.body;

      const result = await client.calendar.createMeeting(calendarId, eventId, meetingConfig);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // Delete meeting
  router.delete('/feishu/calendar/calendar/:calendarId/event/:eventId/meeting', async (req, res, next) => {
    try {
      const { calendarId, eventId } = req.params;
      const result = await client.calendar.deleteMeeting(calendarId, eventId);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  // List resources (rooms)
  router.get('/feishu/calendar/resources', async (req, res, next) => {
    try {
      const result = await client.calendar.listResources();
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
