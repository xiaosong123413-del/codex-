/**
 * HTTP client wrapper for Feishu API
 */

import fetch from 'node-fetch';
import { parseFeishuError, FeishuError } from './errors.js';

const DEFAULT_OPTIONS = {
  baseURL: 'https://open.feishu.cn',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
};

export class HttpClient {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tenantAccessToken = null;
    this.tokenExpireAt = 0;
  }

  /**
   * Set the authentication token
   */
  setToken(token, expireAt = 0) {
    this.tenantAccessToken = token;
    this.tokenExpireAt = expireAt;
  }

  /**
   * Check if token is valid (not expired)
   */
  isTokenValid() {
    if (!this.tenantAccessToken) return false;
    // Refresh 5 minutes before expiry
    return Date.now() < this.tokenExpireAt - 5 * 60 * 1000;
  }

  /**
   * Make HTTP request with retry logic
   */
  async request(config) {
    const { method, url, headers = {}, data, params } = config;

    const queryString = params
      ? '?' + new URLSearchParams(params).toString()
      : '';

    const fullUrl = this.options.baseURL + url + queryString;
    const tokenHeaders = this.tenantAccessToken
      ? { Authorization: `Bearer ${this.tenantAccessToken}` }
      : {};

    const requestHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
      ...tokenHeaders,
    };

    const body = data ? JSON.stringify(data) : undefined;

    let lastError;
    let response;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        response = await fetch(fullUrl, {
          method,
          headers: requestHeaders,
          body,
        });

        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        const responseData = isJson ? await response.json() : null;

        // Handle rate limiting with Retry-After header
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After')) || 1;
          await this.delay(retryAfter * 1000);
          continue;
        }

        // Handle server errors (5xx)
        if (response.status >= 500) {
          const error = new FeishuError(
            `Server error: ${response.status}`,
            'HTTP_' + response.status,
            { status: response.status }
          );
          lastError = error;
          await this.delay(this.options.retryDelay * Math.pow(2, attempt));
          continue;
        }

        // Handle Feishu API errors (non-2xx with code)
        if (!response.ok || (responseData && responseData.code !== 0)) {
          const error = responseData
            ? parseFeishuError(responseData)
            : new FeishuError(`HTTP ${response.status}`, 'HTTP_' + response.status);

          // Some errors should not be retried
          if ([20001, 20002, 20003, 230001].includes(responseData?.code)) {
            throw error;
          }

          lastError = error;
          await this.delay(this.options.retryDelay * Math.pow(2, attempt));
          continue;
        }

        // Success
        return {
          status: response.status,
          data: responseData?.data || responseData,
          raw: responseData,
        };

      } catch (error) {
        if (error instanceof FeishuError) {
          lastError = error;
        } else {
          lastError = new FeishuError(error.message, 'NETWORK_ERROR', { original: error });
        }

        // Network errors should be retried
        if (attempt < this.options.maxRetries - 1) {
          await this.delay(this.options.retryDelay * Math.pow(2, attempt));
          continue;
        }
      }
    }

    throw lastError;
  }

  /**
   * Helper methods for common HTTP verbs
   */
  async get(url, config = {}) {
    return this.request({ ...config, method: 'GET', url });
  }

  async post(url, data, config = {}) {
    return this.request({ ...config, method: 'POST', url, data });
  }

  async put(url, data, config = {}) {
    return this.request({ ...config, method: 'PUT', url, data });
  }

  async patch(url, data, config = {}) {
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  async delete(url, config = {}) {
    return this.request({ ...config, method: 'DELETE', url });
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update options
   */
  configure(options) {
    this.options = { ...this.options, ...options };
  }
}
