/**
 * Instant Messaging (IM) Service
 */

import { HttpClient } from '../core/http.js';

export class IMService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Send text message
   */
  async sendText(receiveIdType, receiveId, text) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }
    );
  }

  /**
   * Send interactive card message
   */
  async sendCard(receiveIdType, receiveId, card) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }
    );
  }

  /**
   * Send image message
   */
  async sendImage(receiveIdType, receiveId, imageKey) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      }
    );
  }

  /**
   * Send file message
   */
  async sendFile(receiveIdType, receiveId, fileKey) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
      }
    );
  }

  /**
   * Send audio message
   */
  async sendAudio(receiveIdType, receiveId, audioKey, duration) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: 'audio',
        content: JSON.stringify({
          audio_key: audioKey,
          duration: duration || 0,
        }),
      }
    );
  }

  /**
   * Send generic message (for any type)
   */
  async send(receiveIdType, receiveId, msgType, content) {
    return this.client.post(
      `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        receive_id: receiveId,
        msg_type: msgType,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      }
    );
  }

  /**
   * Recall (delete) a message
   */
  async recall(messageId) {
    return this.client.delete(`/open-apis/im/v1/messages/${messageId}`);
  }

  /**
   * Get message info
   */
  async get(messageId) {
    return this.client.get(`/open-apis/im/v1/messages/${messageId}`);
  }

  /**
   * Forward message
   */
  async forward(messageId, receiveIdType, receiveId) {
    return this.client.post(
      `/open-apis/im/v1/messages/${messageId}/forward`,
      {
        receive_id_type: receiveIdType,
        receive_id: receiveId,
      }
    );
  }
}
