import { HttpClient } from './http.js';
import { AuthService } from '../services/auth.js';
import { KnowledgeService } from '../services/knowledge.js';
import { KnowledgeCliService } from '../services/knowledgeCli.js';

const TENANT_BUFFER_MS = 60 * 1000;

export class OpenclawFeishuAiWikiClient {
  constructor(config = {}) {
    this.appId = config.appId || process.env.FEISHU_APP_ID || '';
    this.appSecret = config.appSecret || process.env.FEISHU_APP_SECRET || '';
    this.baseURL = config.baseURL || process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';

    this._tenantToken = null;
    this._tenantTokenExpiresAt = 0;

    this.http = new HttpClient({
      baseURL: this.baseURL,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
    });

    this.auth = new AuthService(this.http);
    if (this.appId && this.appSecret) {
      this.auth.init(this.appId, this.appSecret);
    }

    this.knowledge = new KnowledgeService(this);
    this.knowledgeCli = new KnowledgeCliService();
  }

  hasBotCredentials() {
    return Boolean(this.appId && this.appSecret);
  }

  async _refreshTenantToken() {
    const response = await this.auth.getTenantToken();
    const expireAt = Date.now() + (response.expire * 1000);
    this._tenantToken = response.token;
    this._tenantTokenExpiresAt = expireAt;
    this.http.setToken(response.token, expireAt);
    return response.token;
  }

  async ensureTenantToken() {
    if (!this.hasBotCredentials()) {
      throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET. These are only required for scan/bootstrap/graph endpoints.');
    }

    const now = Date.now();
    if (this._tenantToken && now < this._tenantTokenExpiresAt - TENANT_BUFFER_MS && this.http.isTokenValid()) {
      return this._tenantToken;
    }

    return this._refreshTenantToken();
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
    const cliReady = await this.knowledgeCli.isLarkCliAvailable();
    return {
      ok: true,
      cliReady,
      hasBotCredentials: this.hasBotCredentials(),
    };
  }
}
