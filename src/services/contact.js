/**
 * Contact (Users & Departments) Service
 */

import { HttpClient } from '../core/http.js';

export class ContactService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get user info by ID
   */
  async getUser(userId) {
    return this.client.get(`/open-apis/contact/v3/users/${encodeURIComponent(userId)}`);
  }

  /**
   * Batch get users
   */
  async batchGetUsers(userIds) {
    return this.client.post('/open-apis/contact/v3/users/batch_get', {
      user_ids: userIds,
    });
  }

  /**
   * List all users (with pagination)
   */
  async listUsers(options = {}) {
    const { pageSize = 100, pageToken, departmentId } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (departmentId) params.department_id = departmentId;

    return this.client.get('/open-apis/contact/v3/users', { params });
  }

  /**
   * Search users
   */
  async searchUsers(query, options = {}) {
    return this.client.post('/open-apis/contact/v3/users/search', {
      query,
      ...options,
    });
  }

  /**
   * Get department info
   */
  async getDepartment(departmentId) {
    return this.client.get(`/open-apis/contact/v3/departments/${encodeURIComponent(departmentId)}`);
  }

  /**
   * List all departments
   */
  async listDepartments(options = {}) {
    const { pageSize = 100, pageToken, fetchChild } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (fetchChild !== undefined) params.fetch_child = fetchChild;

    return this.client.get('/open-apis/contact/v3/departments', { params });
  }

  /**
   * Get department users
   */
  async getDepartmentUsers(departmentId, options = {}) {
    const { pageSize = 100, pageToken, fetchChild } = options;

    const params = { department_id: departmentId, page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (fetchChild !== undefined) params.fetch_child = fetchChild;

    return this.client.get('/open-apis/contact/v3/users/find_by_department', { params });
  }

  /**
   * Get user's direct departments
   */
  async getUserDepartments(userId) {
    return this.client.get(`/open-apis/contact/v3/users/${encodeURIComponent(userId)}/departments`);
  }

  /**
   * List all chats (groups)
   */
  async listChats(options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get('/open-apis/im/v1/chats', { params });
  }

  /**
   * Get chat info
   */
  async getChat(chatId) {
    return this.client.get(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`);
  }

  /**
   * Get chat members
   */
  async getChatMembers(chatId, options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members`, { params });
  }
}
