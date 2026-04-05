/**
 * Drive (File) Service
 */

import { HttpClient } from '../core/http.js';

export class DriveService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Upload file
   */
  async uploadFile(filePath, fileName, folderToken = null, options = {}) {
    const fs = await import('fs');
    const path = await import('path');

    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;

    // Prepare upload request
    const requestData = {
      file_name: fileName,
      size: fileSize,
      file: {
        file_token: null,
      },
    };

    if (folderToken) {
      requestData.parent_node = { token: folderToken, type: 'folder' };
    }

    // Get upload URL
    const { data } = await this.client.post('/open-apis/drive/v1/files/upload', requestData);
    const { upload_url, file } = data;

    // Upload file content
    const uploadResponse = await fetch(upload_url, {
      method: 'POST',
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`File upload failed: ${uploadResponse.statusText}`);
    }

    return file;
  }

  /**
   * Upload file from buffer
   */
  async uploadFileFromBuffer(buffer, fileName, folderToken = null) {
    const requestData = {
      file_name: fileName,
      size: buffer.length,
      file: { file_token: null },
    };

    if (folderToken) {
      requestData.parent_node = { token: folderToken, type: 'folder' };
    }

    const { data } = await this.client.post('/open-apis/drive/v1/files/upload', requestData);
    const { upload_url, file } = data;

    const uploadResponse = await fetch(upload_url, {
      method: 'POST',
      body: buffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`File upload failed: ${uploadResponse.statusText}`);
    }

    return file;
  }

  /**
   * Download file
   */
  async downloadFile(fileToken) {
    const response = await this.client.get(
      `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/download`,
      { responseType: 'buffer' }
    );

    return response.data;
  }

  /**
   * Get file info
   */
  async getFile(fileToken) {
    return this.client.get(`/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}`);
  }

  /**
   * Delete file
   */
  async deleteFile(fileToken) {
    return this.client.delete(`/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}`);
  }

  /**
   * Update file
   */
  async updateFile(fileToken, updates) {
    return this.client.post(
      `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}`,
      updates
    );
  }

  /**
   * Move file
   */
  async moveFile(fileToken, targetFolderToken) {
    return this.client.post(
      `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/move`,
      {
        destination_folder_token: targetFolderToken,
      }
    );
  }

  /**
   * Copy file
   */
  async copyFile(fileToken, targetFolderToken) {
    return this.client.post(
      `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/copy`,
      {
        destination_folder_token: targetFolderToken,
      }
    );
  }

  /**
   * Create folder
   */
  async createFolder(name, folderToken = null) {
    const requestData = {
      name,
      folder_type: 0,
    };

    if (folderToken) {
      requestData.parent_folder_token = folderToken;
    }

    return this.client.post('/open-apis/drive/v1/folders/create', requestData);
  }

  /**
   * Get folder info
   */
  async getFolder(folderToken) {
    return this.client.get(`/open-apis/drive/v1/folders/${encodeURIComponent(folderToken)}`);
  }

  /**
   * List folder contents
   */
  async listFolder(folderToken, options = {}) {
    const { pageSize = 100, pageToken } = options;

    const params = {
      folder_token: folderToken,
      page_size: pageSize,
    };
    if (pageToken) params.page_token = pageToken;

    return this.client.get('/open-apis/drive/v1/files/list', { params });
  }

  /**
   * Search files
   */
  async searchFiles(query, options = {}) {
    const { pageSize = 100, pageToken, fileExtension, ownerId, createdTimeRange } = options;

    const requestData = {
      query,
      page_size: pageSize,
    };

    if (pageToken) requestData.page_token = pageToken;
    if (fileExtension) requestData.file_extension = fileExtension;
    if (ownerId) requestData.owner_id = ownerId;
    if (createdTimeRange) requestData.created_time_range = createdTimeRange;

    return this.client.post('/open-apis/drive/v1/files/search', requestData);
  }
}
