/**
 * Approval Service
 */

import { HttpClient } from '../core/http.js';

export class ApprovalService {
  constructor(client) {
    this.client = client;
  }

  /**
   * List approval definitions (templates)
   */
  async listApprovalDefinitions(options = {}) {
    const { pageSize = 100, pageToken, name } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (name) params.name = name;

    return this.client.get('/open-apis/approval/v4/approval_templates', { params });
  }

  /**
   * Get approval definition by ID
   */
  async getApprovalDefinition(definitionId) {
    return this.client.get(
      `/open-apis/approval/v4/approval_templates/${encodeURIComponent(definitionId)}`
    );
  }

  /**
   * Create approval instance
   */
  async createInstance(definitionId, instanceData) {
    return this.client.post('/open-apis/approval/v4/instances', {
      approval_template_id: definitionId,
      ...instanceData,
    });
  }

  /**
   * Get approval instance
   */
  async getInstance(instanceId) {
    return this.client.get(`/open-apis/approval/v4/instances/${encodeURIComponent(instanceId)}`);
  }

  /**
   * Cancel approval instance
   */
  async cancelInstance(instanceId, reason = '') {
    return this.client.post(
      `/open-apis/approval/v4/instances/${encodeURIComponent(instanceId)}/cancel`,
      { reason }
    );
  }

  /**
   * List approval instances
   */
  async listInstances(options = {}) {
    const {
      pageSize = 100,
      pageToken,
      status,
      approvalTemplateId,
      createdAtRange,
    } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (status) params.status = status;
    if (approvalTemplateId) params.approval_template_id = approvalTemplateId;
    if (createdAtRange) params.created_at_range = createdAtRange;

    return this.client.get('/open-apis/approval/v4/instances', { params });
  }

  /**
   * Get approval tasks (user's pending approvals)
   */
  async getApprovalTasks(taskId) {
    return this.client.get(`/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * List approval tasks
   */
  async listApprovalTasks(options = {}) {
    const { pageSize = 100, pageToken, status, userId } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (status) params.status = status;
    if (userId) params.user_id = userId;

    return this.client.get('/open-apis/approval/v4/tasks', { params });
  }

  /**
   * Approve task
   */
  async approveTask(taskId, comment = '') {
    return this.client.post(
      `/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}/approve`,
      { comment }
    );
  }

  /**
   * Reject task
   */
  async rejectTask(taskId, comment = '') {
    return this.client.post(
      `/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}/reject`,
      { comment }
    );
  }

  /**
   * Transfer task
   */
  async transferTask(taskId, toUserId, comment = '') {
    return this.client.post(
      `/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}/transfer`,
      {
        to_user_id: toUserId,
        comment,
      }
    );
  }

  /**
   * Add comment to task
   */
  async addTaskComment(taskId, comment) {
    return this.client.post(
      `/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}/comments`,
      { comment }
    );
  }

  /**
   * Get task details
   */
  async getTaskDetail(taskId) {
    return this.client.get(`/open-apis/approval/v4/tasks/${encodeURIComponent(taskId)}/detail`);
  }
}
