/**
 * Search Service
 */

import { HttpClient } from '../core/http.js';

export class SearchService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Global search across messages, docs, users, etc.
   */
  async searchAll(query, options = {}) {
    const {
      pageSize = 20,
      pageToken,
      searchTypes = ['message', 'doc', 'user', 'chat'],
    } = options;

    return this.client.post('/open-apis/search/v1/search', {
      query,
      search_types: searchTypes,
      page_size: pageSize,
      page_token: pageToken,
    });
  }

  /**
   * Search messages
   */
  async searchMessages(query, options = {}) {
    const { pageSize = 20, pageToken, chatId, fromTime, toTime } = options;

    const params = {
      query,
      page_size: pageSize,
    };
    if (pageToken) params.page_token = pageToken;
    if (chatId) params.chat_id = chatId;
    if (fromTime) params.from_time = fromTime;
    if (toTime) params.to_time = toTime;

    return this.client.get('/open-apis/im/v1/messages/search', { params });
  }

  /**
   * Search documents
   */
  async searchDocuments(query, options = {}) {
    const { pageSize = 20, pageToken, docType, ownerId } = options;

    const params = {
      query,
      page_size: pageSize,
    };
    if (pageToken) params.page_token = pageToken;
    if (docType) params.doc_type = docType;
    if (ownerId) params.owner_id = ownerId;

    return this.client.get('/open-apis/docx/v1/documents/search', { params });
  }

  /**
   * Search users
   */
  async searchUsers(query, options = {}) {
    const { pageSize = 20, pageToken, departmentId } = options;

    const params = {
      query,
      page_size: pageSize,
    };
    if (pageToken) params.page_token = pageToken;
    if (departmentId) params.department_id = departmentId;

    return this.client.get('/open-apis/contact/v3/users/search', { params });
  }

  /**
   * Search files in Drive
   */
  async searchFiles(query, options = {}) {
    const { pageSize = 100, pageToken, fileExtension } = options;

    const requestData = {
      query,
      page_size: pageSize,
    };
    if (pageToken) requestData.page_token = pageToken;
    if (fileExtension) requestData.file_extension = fileExtension;

    return this.client.post('/open-apis/drive/v1/files/search', requestData);
  }

  /**
   * Search chats
   */
  async searchChats(query, options = {}) {
    const { pageSize = 20, pageToken, chatType } = options;

    const params = {
      query,
      page_size: pageSize,
    };
    if (pageToken) params.page_token = pageToken;
    if (chatType) params.chat_type = chatType;

    return this.client.get('/open-apis/im/v1/chats/search', { params });
  }
}
