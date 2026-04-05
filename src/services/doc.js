/**
 * Document Service
 */

import { HttpClient } from '../core/http.js';

export class DocumentService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Create a new document
   */
  async createDocument(title, type = 'doc', folderToken = null) {
    return this.client.post('/open-apis/docx/v1/documents', {
      title,
      type,
      folder_token: folderToken,
    });
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId) {
    return this.client.get(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`);
  }

  /**
   * Update document title
   */
  async updateDocumentTitle(documentId, title) {
    return this.client.post(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
      { title }
    );
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId) {
    return this.client.delete(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`);
  }

  /**
   * Get document content
   */
  async getDocumentContent(documentId) {
    const response = await this.client.get(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/content`
    );
    return response.data;
  }

  /**
   * Update document content (block operations)
   */
  async updateDocumentContent(documentId, operations) {
    return this.client.post(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/content`,
      { operations }
    );
  }

  /**
   * Add block to document
   */
  async appendBlock(documentId, block) {
    return this.client.post(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
      { block }
    );
  }

  /**
   * Get block by ID
   */
  async getBlock(documentId, blockId) {
    return this.client.get(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`
    );
  }

  /**
   * Update block
   */
  async updateBlock(documentId, blockId, block) {
    return this.client.post(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`,
      { block }
    );
  }

  /**
   * Delete block
   */
  async deleteBlock(documentId, blockId) {
    return this.client.delete(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`
    );
  }

  /**
   * Share document (update permissions)
   */
  async shareDocument(documentId, shareWith, permission = 'view') {
    return this.client.post(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/share`,
      {
        type: shareWith.type,
        id: shareWith.id,
        permission,
      }
    );
  }

  /**
   * Export document (as markdown, html, etc.)
   */
  async exportDocument(documentId, format = 'markdown') {
    const response = await this.client.get(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/export`,
      { params: { export_type: format } }
    );
    return response.data;
  }

  /**
   * Create a new spreadsheet (sheets)
   */
  async createSpreadsheet(title, folderToken = null) {
    return this.client.post('/open-apis/sheets/v2/spreadsheets', {
      title,
      folder_token: folderToken,
    });
  }

  /**
   * Get spreadsheet
   */
  async getSpreadsheet(spreadsheetToken) {
    return this.client.get(`/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}`);
  }

  /**
   * Get sheet data
   */
  async getSheetValues(spreadsheetToken, sheetIdOrName, range) {
    const params = {
      spreadsheet_token: spreadsheetToken,
      range: `${sheetIdOrName}!${range}`,
    };
    return this.client.get('/open-apis/sheets/v2/spreadsheets/values', { params });
  }

  /**
   * Update sheet values
   */
  async updateSheetValues(spreadsheetToken, sheetIdOrName, range, values) {
    return this.client.put('/open-apis/sheets/v2/spreadsheets/values', {
      spreadsheet_token: spreadsheetToken,
      range: `${sheetIdOrName}!${range}`,
      values,
    });
  }

  /**
   * Append rows to sheet
   */
  async appendSheetRows(spreadsheetToken, sheetIdOrName, values) {
    return this.client.post('/open-apis/sheets/v2/spreadsheets/values/append', {
      spreadsheet_token: spreadsheetToken,
      sheet_id: sheetIdOrName,
      values,
    });
  }

  /**
   * Batch update sheet (with multiple operations)
   */
  async batchUpdate(spreadsheetToken, operations) {
    return this.client.post('/open-apis/sheets/v2/spreadsheets/batch_update', {
      spreadsheet_token: spreadsheetToken,
      ...operations,
    });
  }
}
