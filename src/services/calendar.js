/**
 * Calendar Service
 */

import { HttpClient } from '../core/http.js';

export class CalendarService {
  constructor(client) {
    this.client = client;
  }

  /**
   * List calendars
   */
  async listCalendars(options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get('/open-apis/calendar/v4/calendars', { params });
  }

  /**
   * Get calendar by ID
   */
  async getCalendar(calendarId) {
    return this.client.get(`/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Create calendar
   */
  async createCalendar(data) {
    return this.client.post('/open-apis/calendar/v4/calendars', data);
  }

  /**
   * Update calendar
   */
  async updateCalendar(calendarId, data) {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}`,
      data
    );
  }

  /**
   * Delete calendar
   */
  async deleteCalendar(calendarId) {
    return this.client.delete(`/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}`);
  }

  /**
   * List events
   */
  async listEvents(calendarId, options = {}) {
    const {
      pageSize = 100,
      pageToken,
      timeMin,
      timeMax,
      updatedMin,
      singleEvents = true,
    } = options;

    const params = {
      calendar_id: calendarId,
      page_size: pageSize,
      single_events: singleEvents,
    };

    if (pageToken) params.page_token = pageToken;
    if (timeMin) params.time_min = timeMin;
    if (timeMax) params.time_max = timeMax;
    if (updatedMin) params.updated_min = updatedMin;

    return this.client.get('/open-apis/calendar/v4/events', { params });
  }

  /**
   * Get event by ID
   */
  async getEvent(calendarId, eventId) {
    return this.client.get(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  }

  /**
   * Create event
   */
  async createEvent(calendarId, eventData) {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      eventData
    );
  }

  /**
   * Update event
   */
  async updateEvent(calendarId, eventId, eventData) {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      eventData
    );
  }

  /**
   * Delete event
   */
  async deleteEvent(calendarId, eventId) {
    return this.client.delete(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  }

  /**
   * Quick add event (simple text parsing)
   */
  async quickAdd(calendarId, text, timeZone = 'Asia/Shanghai') {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/quick_add`,
      {
        text,
        time_zone: timeZone,
      }
    );
  }

  /**
   * Free/busy check
   */
  async freeBusy(calendarIds, timeMin, timeMax, timeZone = 'Asia/Shanghai') {
    return this.client.post('/open-apis/calendar/v4/freebusy', {
      calendar_ids: calendarIds,
      time_min: timeMin,
      time_max: timeMax,
      time_zone: timeZone,
    });
  }

  /**
   * Create meeting (with conference data)
   */
  async createMeeting(calendarId, eventId, meetingConfig = {}) {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/conference`,
      meetingConfig
    );
  }

  /**
   * Delete meeting
   */
  async deleteMeeting(calendarId, eventId) {
    return this.client.delete(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/conference`
    );
  }

  /**
   * List free/busy for resources (rooms)
   */
  async listResources() {
    return this.client.get('/open-apis/calendar/v4/resources');
  }

  /**
   * Get resource details
   */
  async getResource(resourceId) {
    return this.client.get(`/open-apis/calendar/v4/resources/${encodeURIComponent(resourceId)}`);
  }
}
