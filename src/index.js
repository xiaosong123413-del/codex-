/**
 * Main Feishu Client - Facade for all services
 * This is the primary entry point for the Feishu integration SDK
 */

import { FeishuClient as CoreClient } from './core/client.js';

// Re-export the core client as the main interface
export { CoreClient as FeishuClient };
export { CoreClient };

// Also export all services for advanced usage
export { AuthService } from './services/auth.js';
export { IMService } from './services/im.js';
export { ContactService } from './services/contact.js';
export { DocumentService } from './services/doc.js';
export { DriveService } from './services/drive.js';
export { CalendarService } from './services/calendar.js';
export { MeetingService } from './services/meeting.js';
export { TaskService } from './services/task.js';
export { ApprovalService } from './services/approval.js';
export { SearchService } from './services/search.js';
export { BotService } from './services/bot.js';
export { KnowledgeService } from './services/knowledge.js';
export { KnowledgeCliService, CliBaseStore, LarkCliRunner } from './services/knowledgeCli.js';
