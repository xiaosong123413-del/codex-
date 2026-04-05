/**
 * Meeting Service
 */

import { HttpClient } from '../core/http.js';

export class MeetingService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Create meeting (video conference)
   */
  async createMeeting(meetingData) {
    return this.client.post('/open-apis/meeting/v1/meetings', meetingData);
  }

  /**
   * Get meeting info
   */
  async getMeeting(meetingId) {
    return this.client.get(`/open-apis/meeting/v1/meetings/${encodeURIComponent(meetingId)}`);
  }

  /**
   * Update meeting
   */
  async updateMeeting(meetingId, meetingData) {
    return this.client.post(
      `/open-apis/meeting/v1/meetings/${encodeURIComponent(meetingId)}`,
      meetingData
    );
  }

  /**
   * Cancel meeting
   */
  async cancelMeeting(meetingId, reason = null) {
    const data = reason ? { reason } : {};
    return this.client.delete(`/open-apis/meeting/v1/meetings/${encodeURIComponent(meetingId)}`, { data });
  }

  /**
   * Register meeting material (upload slides, etc.)
   */
  async registerMaterial(meetingId, materials) {
    return this.client.post(
      `/open-apis/meeting/v1/meetings/${encodeURIComponent(meetingId)}/materials`,
      { materials }
    );
  }

  /**
   * Get meeting participants
   */
  async getMeetingParticipants(meetingId) {
    return this.client.get(
      `/open-apis/meeting/v1/meetings/${encodeURIComponent(meetingId)}/participants`
    );
  }

  /**
   * Create meeting from calendar event
   */
  async createMeetingFromEvent(calendarId, eventId, meetingConfig = {}) {
    return this.client.post(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/conference`,
      meetingConfig
    );
  }

  /**
   * Get meeting by external ID
   */
  async getMeetingByExternalId(externalMeetingId) {
    return this.client.get(
      `/open-apis/meeting/v1/meetings/by_external_id/${encodeURIComponent(externalMeetingId)}`
    );
  }

  /**
   * Get meeting statistics
   */
  async getMeetingStats(startTime, endTime) {
    return this.client.get('/open-apis/meeting/v1/meetings/stats', {
      params: { start_time: startTime, end_time: endTime },
    });
  }
}
