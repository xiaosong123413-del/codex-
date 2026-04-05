/**
 * Task Service
 */

import { HttpClient } from '../core/http.js';

export class TaskService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Create task list
   */
  async createTaskList(name, description = '', members = []) {
    return this.client.post('/open-apis/task/v2/task_lists', {
      name,
      description,
      members,
    });
  }

  /**
   * Get task list
   */
  async getTaskList(taskListId) {
    return this.client.get(`/open-apis/task/v2/task_lists/${encodeURIComponent(taskListId)}`);
  }

  /**
   * Update task list
   */
  async updateTaskList(taskListId, updates) {
    return this.client.post(
      `/open-apis/task/v2/taskLists/${encodeURIComponent(taskListId)}`,
      updates
    );
  }

  /**
   * Delete task list
   */
  async deleteTaskList(taskListId) {
    return this.client.delete(`/open-apis/task/v2/task_lists/${encodeURIComponent(taskListId)}`);
  }

  /**
   * List task lists
   */
  async listTaskLists(options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get('/open-apis/task/v2/task_lists', { params });
  }

  /**
   * Create task
   */
  async createTask(taskListId, taskData) {
    return this.client.post(
      `/open-apis/task/v2/task_lists/${encodeURIComponent(taskListId)}/tasks`,
      taskData
    );
  }

  /**
   * Get task
   */
  async getTask(taskId) {
    return this.client.get(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * Update task
   */
  async updateTask(taskId, updates) {
    return this.client.post(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}`, updates);
  }

  /**
   * Delete task
   */
  async deleteTask(taskId) {
    return this.client.delete(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * List tasks
   */
  async listTasks(taskListId, options = {}) {
    const { pageSize = 100, pageToken, status } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    if (status) params.status = status;

    return this.client.get(
      `/open-apis/task/v2/task_lists/${encodeURIComponent(taskListId)}/tasks`,
      { params }
    );
  }

  /**
   * Assign task to members
   */
  async assignTask(taskId, memberIds) {
    return this.client.post(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/assign`, {
      member_ids: memberIds,
    });
  }

  /**
   * Unassign task
   */
  async unassignTask(taskId, memberIds) {
    return this.client.post(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/unassign`, {
      member_ids: memberIds,
    });
  }

  /**
   * Add task comment
   */
  async addTaskComment(taskId, content) {
    return this.client.post(
      `/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/comments`,
      { content }
    );
  }

  /**
   * Get task comments
   */
  async getTaskComments(taskId, options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;

    return this.client.get(
      `/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/comments`,
      { params }
    );
  }

  /**
   * Complete task
   */
  async completeTask(taskId) {
    return this.client.post(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/complete`);
  }

  /**
   * Reopen task
   */
  async reopenTask(taskId) {
    return this.client.post(`/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}/reopen`);
  }
}
