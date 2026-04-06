/**
 * Authentication service for Feishu
 */

import { AuthenticationError } from '../core/errors.js';

export class AuthService {
  constructor(http) {
    this.http = http;
    this.appId = null;
    this.appSecret = null;
  }

  /**
   * Initialize with app credentials
   */
  init(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
  }

  /**
   * Get tenant access token
   * Uses caching and auto-refresh via HttpClient
   */
  async getTenantToken() {
    if (!this.appId || !this.appSecret) {
      throw new AuthenticationError('App credentials not set');
    }

    // Request fresh token
    const response = await this.http.post(
      '/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: this.appId,
        app_secret: this.appSecret,
      }
    );

    const { data } = response;

    // Calculate expiry time (subtract 5 minutes for safety)
    const expireAt = Date.now() + (data.expire || 7200) * 1000 - 5 * 60 * 1000;

    return {
      token: data.tenant_access_token,
      expire: data.expire,
      expireAt,
    };
  }

  /**
   * Ensure client has valid token
   */
  async ensureToken() {
    if (!this.http.isTokenValid()) {
      const { token, expireAt } = await this.getTenantToken();
      this.http.setToken(token, expireAt);
    }
    return this.http.tenantAccessToken;
  }
}
