/**
 * Core Client for Feishu API
 * Manages authentication tokens and provides access to all services
 */

import { HttpClient } from './http.js';
import { AuthService } from '../services/auth.js';
import { IMService } from '../services/im.js';
import { ContactService } from '../services/contact.js';
import { DriveService } from '../services/drive.js';
import { DocumentService } from '../services/doc.js';
import { CalendarService } from '../services/calendar.js';
import { MeetingService } from '../services/meeting.js';
import { TaskService } from '../services/task.js';
import { ApprovalService } from '../services/approval.js';
import { BotService } from '../services/bot.js';
import { KnowledgeService } from '../services/knowledge.js';
import { KnowledgeCliService } from '../services/knowledgeCli.js';

const TENANT_BUFFER_MS = 60 * 1000; // Refresh 1 minute before expiry

export class FeishuClient {
  constructor(config = {}) {
    this.appId = config.appId || process.env.FEISHU_APP_ID;
    this.appSecret = config.appSecret || process.env.FEISHU_APP_SECRET;
    this.baseURL = config.baseURL || 'https://open.feishu.cn';

    if (!this.appId || !this.appSecret) {
      throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
    }

    this._tenantToken = null;
    this._tenantTokenExpiresAt = 0;

    // Initialize HTTP client
    this.http = new HttpClient({
      baseURL: this.baseURL,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
    });

    // Initialize services
    this.auth = new AuthService(this.http);
    this.auth.init(this.appId, this.appSecret);
    this.im = new IMService(this);
    this.contact = new ContactService(this);
    this.drive = new DriveService(this);
    this.doc = new DocumentService(this);
    this.calendar = new CalendarService(this);
    this.meeting = new MeetingService(this);
    this.task = new TaskService(this);
    this.approval = new ApprovalService(this);
    this.bot = new BotService(this);
    this.knowledge = new KnowledgeService(this);
    this.knowledgeCli = new KnowledgeCliService();
  }

  _computeExpireAt(expireSeconds = 7200) {
    return Date.now() + (expireSeconds * 1000);
  }

  async _refreshTenantToken() {
    const response = await this.auth.getTenantToken();
    const expireAt = this._computeExpireAt(response.expire);
    this._tenantToken = response.token;
    this._tenantTokenExpiresAt = expireAt;
    this.http.setToken(response.token, expireAt);
    return response.token;
  }

  async ensureTenantToken() {
    const now = Date.now();
    if (this._tenantToken && now < this._tenantTokenExpiresAt - TENANT_BUFFER_MS && this.http.isTokenValid()) {
      return this._tenantToken;
    }

    return this._refreshTenantToken();
  }

  async getTenantToken() {
    await this.ensureTenantToken();
    return this._tenantToken;
  }

  setTenantToken(token, expiresIn) {
    const expireAt = Date.now() + (expiresIn * 1000);
    this._tenantToken = token;
    this._tenantTokenExpiresAt = expireAt;
    this.http.setToken(token, expireAt);
  }

  clearTenantToken() {
    this._tenantToken = null;
    this._tenantTokenExpiresAt = 0;
    this.http.setToken(null, 0);
  }

  async request(config) {
    await this.ensureTenantToken();
    return this.http.request(config);
  }

  get(url, config = {}) {
    return this.request({ ...config, method: 'GET', url });
  }

  post(url, data, config = {}) {
    return this.request({ ...config, method: 'POST', url, data });
  }

  put(url, data, config = {}) {
    return this.request({ ...config, method: 'PUT', url, data });
  }

  patch(url, data, config = {}) {
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  delete(url, config = {}) {
    return this.request({ ...config, method: 'DELETE', url });
  }

  async health() {
    try {
      await this.ensureTenantToken();
      return {
        ok: true,
        authenticated: true,
        services: {
          auth: true,
        },
      };
    } catch (error) {
      return {
        ok: false,
        authenticated: false,
        error: error.message,
      };
    }
  }
}
