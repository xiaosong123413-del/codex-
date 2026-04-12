/**
 * Bot Service
 */

import { HttpClient } from '../core/http.js';

export class BotService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get bot info
   */
  async getBotInfo() {
    return this.client.get('/open-apis/bot/v4/info');
  }

  /**
   * Update bot info
   */
  async updateBotInfo(data) {
    return this.client.post('/open-apis/bot/v4/info', data);
  }

  /**
   * Get bot chat members
   */
  async getBotChatMembers(options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get('/open-apis/bot/v4/members', { params });
  }

  /**
   * Get bot chat member count
   */
  async getBotChatMemberCount() {
    return this.client.get('/open-apis/bot/v4/members/count');
  }

  /**
   * Set bot help text
   */
  async setBotHelpText(helpText) {
    return this.client.post('/open-apis/bot/v4/help', { help_text: helpText });
  }

  /**
   * Set bot description
   */
  async setBotDescription(description) {
    return this.client.post('/open-apis/bot/v4/description', { description });
  }

  /**
   * Set bot outgoing webhook URL
   */
  async setOutgoingWebhook(url) {
    return this.client.post('/open-apis/bot/v4/webhook', { url });
  }

  /**
   * Get outgoing webhook URL
   */
  async getOutgoingWebhook() {
    return this.client.get('/open-apis/bot/v4/webhook');
  }
}
