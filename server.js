import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';

// Prefer local development secrets, then fall back to default .env if present.
const rootDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config();

// Import client
import { FeishuClient } from './src/core/client.js';

// Import routes
import { setupAuthRoutes } from './src/routes/auth.js';
import { setupIMRoutes } from './src/routes/im.js';
import { setupContactRoutes } from './src/routes/contact.js';
import { setupDriveRoutes } from './src/routes/drive.js';
import { setupDocRoutes } from './src/routes/doc.js';
import { setupCalendarRoutes } from './src/routes/calendar.js';
import { setupApprovalRoutes } from './src/routes/approval.js';
import { setupTaskRoutes } from './src/routes/task.js';
import { setupBotRoutes } from './src/routes/bot.js';
import { setupMeetingRoutes } from './src/routes/meeting.js';
import { setupKnowledgeRoutes } from './src/routes/knowledge.js';

// Import middleware
import { errorHandler } from './src/middleware/errorHandler.js';
import { jsonBodyParser } from './src/middleware/jsonParser.js';

const app = express();
const port = process.env.PORT || 3000;

// Credentials
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

// Middleware
app.use(jsonBodyParser);
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Initialize Feishu client
let feishu;
try {
  if (appId && appSecret) {
    feishu = new FeishuClient({
      appId,
      appSecret,
    });
    console.log('✅ Feishu client initialized with credentials');
  } else {
    console.warn('⚠️  FEISHU_APP_ID or FEISHU_APP_SECRET not set.');
    feishu = null;
  }
} catch (error) {
  console.error('❌ Failed to initialize Feishu client:', error.message);
  feishu = null;
}

// Make client available to routes
app.locals.feishu = feishu;

// Health check
app.get('/health', async (req, res) => {
  if (!feishu) {
    return res.json({
      ok: false,
      service: 'feishu-connect',
      hasCredentials: false,
      message: 'Feishu client not initialized - missing credentials',
    });
  }

  try {
    const health = await feishu.health();
    res.json({
      ok: true,
      service: 'feishu-connect',
      version: '2.0.0',
      hasCredentials: true,
      ...health,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      service: 'feishu-connect',
      hasCredentials: true,
      error: error.message,
    });
  }
});

// API info
app.get('/', (req, res) => {
  res.json({
    name: 'Feishu Connect API',
    version: '2.0.0',
    description: 'Comprehensive Feishu/Lark integration with all major APIs',
    endpoints: {
      health: 'GET /health',
      auth: {
        'Get Token': 'GET /feishu/token',
        'Refresh Token': 'POST /feishu/token/refresh',
        'Bot Info': 'GET /feishu/bot/info',
      },
      im: {
        'Send Text': 'POST /feishu/message/text',
        'Send Card': 'POST /feishu/message/card',
        'Send Image': 'POST /feishu/message/image',
        'Send File': 'POST /feishu/message/file',
        'Send Audio': 'POST /feishu/message/audio',
        'Generic Send': 'POST /feishu/message',
        'Recall Message': 'DELETE /feishu/message/:messageId',
        'Get Message': 'GET /feishu/message/:messageId',
        'Forward Message': 'POST /feishu/message/:messageId/forward',
      },
      contacts: {
        'Get User': 'GET /feishu/contact/user/:userId',
        'Batch Get Users': 'POST /feishu/contact/users/batch',
        'List Users': 'GET /feishu/contact/users',
        'Search Users': 'POST /feishu/contact/users/search',
        'Get Department': 'GET /feishu/contact/department/:departmentId',
        'List Departments': 'GET /feishu/contact/departments',
        'Get Department Users': 'GET /feishu/contact/department/:departmentId/users',
        'List Chats': 'GET /feishu/contact/chats',
        'Get Chat': 'GET /feishu/contact/chat/:chatId',
        'Get Chat Members': 'GET /feishu/contact/chat/:chatId/members',
      },
      drive: {
        'Upload File': 'POST /feishu/drive/upload',
        'Upload Base64': 'POST /feishu/drive/upload/base64',
        'Download File': 'GET /feishu/drive/file/:fileToken/download',
        'Get File': 'GET /feishu/drive/file/:fileToken',
        'Delete File': 'DELETE /feishu/drive/file/:fileToken',
        'Update File': 'POST /feishu/drive/file/:fileToken',
        'Move File': 'POST /feishu/drive/file/:fileToken/move',
        'Copy File': 'POST /feishu/drive/file/:fileToken/copy',
        'Create Folder': 'POST /feishu/drive/folder',
        'Get Folder': 'GET /feishu/drive/folder/:folderToken',
        'List Folder': 'GET /feishu/drive/folder/:folderToken/contents',
        'Search Files': 'POST /feishu/drive/search',
      },
      documents: {
        'Create Doc': 'POST /feishu/doc/create',
        'Get Doc': 'GET /feishu/doc/:documentId',
        'Update Doc Title': 'POST /feishu/doc/:documentId/title',
        'Delete Doc': 'DELETE /feishu/doc/:documentId',
        'Get Doc Content': 'GET /feishu/doc/:documentId/content',
        'Update Doc Content': 'POST /feishu/doc/:documentId/content',
        'Append Block': 'POST /feishu/doc/:documentId/blocks',
        'Get Block': 'GET /feishu/doc/:documentId/blocks/:blockId',
        'Update Block': 'POST /feishu/doc/:documentId/blocks/:blockId',
        'Delete Block': 'DELETE /feishu/doc/:documentId/blocks/:blockId',
        'Share Doc': 'POST /feishu/doc/:documentId/share',
        'Export Doc': 'GET /feishu/doc/:documentId/export',
        'Create Spreadsheet': 'POST /feishu/sheet/create',
        'Get Spreadsheet': 'GET /feishu/sheet/:spreadsheetToken',
        'Get Sheet Values': 'GET /feishu/sheet/:spreadsheetToken/values',
        'Update Sheet Values': 'PUT /feishu/sheet/:spreadsheetToken/values',
        'Append Rows': 'POST /feishu/sheet/:spreadsheetToken/rows/append',
        'Batch Update': 'POST /feishu/sheet/:spreadsheetToken/batch-update',
      },
      calendar: {
        'List Calendars': 'GET /feishu/calendar/calendars',
        'Get Calendar': 'GET /feishu/calendar/calendar/:calendarId',
        'Create Calendar': 'POST /feishu/calendar/calendar',
        'Update Calendar': 'POST /feishu/calendar/calendar/:calendarId',
        'Delete Calendar': 'DELETE /feishu/calendar/calendar/:calendarId',
        'List Events': 'GET /feishu/calendar/calendar/:calendarId/events',
        'Get Event': 'GET /feishu/calendar/calendar/:calendarId/event/:eventId',
        'Create Event': 'POST /feishu/calendar/calendar/:calendarId/event',
        'Update Event': 'POST /feishu/calendar/calendar/:calendarId/event/:eventId',
        'Delete Event': 'DELETE /feishu/calendar/calendar/:calendarId/event/:eventId',
        'Quick Add': 'POST /feishu/calendar/calendar/:calendarId/quick-add',
        'Free/Busy': 'POST /feishu/calendar/freebusy',
        'Create Meeting': 'POST /feishu/calendar/calendar/:calendarId/event/:eventId/meeting',
        'Delete Meeting': 'DELETE /feishu/calendar/calendar/:calendarId/event/:eventId/meeting',
        'List Resources': 'GET /feishu/calendar/resources',
      },
      approval: {
        'List Definitions': 'GET /feishu/approval/definitions',
        'Get Definition': 'GET /feishu/approval/definition/:definitionId',
        'Create Instance': 'POST /feishu/approval/instance',
        'Get Instance': 'GET /feishu/approval/instance/:instanceId',
        'Cancel Instance': 'POST /feishu/approval/instance/:instanceId/cancel',
        'List Instances': 'GET /feishu/approval/instances',
        'List Tasks': 'GET /feishu/approval/tasks',
        'Get Task': 'GET /feishu/approval/task/:taskId',
        'Get Task Detail': 'GET /feishu/approval/task/:taskId/detail',
        'Approve Task': 'POST /feishu/approval/task/:taskId/approve',
        'Reject Task': 'POST /feishu/approval/task/:taskId/reject',
        'Transfer Task': 'POST /feishu/approval/task/:taskId/transfer',
        'Add Comment': 'POST /feishu/approval/task/:taskId/comment',
      },
      tasks: {
        'List Task Lists': 'GET /feishu/task/lists',
        'Create Task List': 'POST /feishu/task/list',
        'Get Task List': 'GET /feishu/task/list/:taskListId',
        'Update Task List': 'POST /feishu/task/list/:taskListId',
        'Delete Task List': 'DELETE /feishu/task/list/:taskListId',
        'Create Task': 'POST /feishu/task/list/:taskListId/task',
        'Get Task': 'GET /feishu/task/:taskId',
        'Update Task': 'POST /feishu/task/:taskId',
        'Delete Task': 'DELETE /feishu/task/:taskId',
        'List Tasks': 'GET /feishu/task/list/:taskListId/tasks',
        'Assign Task': 'POST /feishu/task/:taskId/assign',
        'Unassign Task': 'POST /feishu/task/:taskId/unassign',
        'Complete Task': 'POST /feishu/task/:taskId/complete',
        'Reopen Task': 'POST /feishu/task/:taskId/reopen',
        'Add Comment': 'POST /feishu/task/:taskId/comment',
        'Get Comments': 'GET /feishu/task/:taskId/comments',
      },
      meetings: {
        'Create Meeting': 'POST /feishu/meeting',
        'Get Meeting': 'GET /feishu/meeting/:meetingId',
        'Update Meeting': 'POST /feishu/meeting/:meetingId',
        'Cancel Meeting': 'DELETE /feishu/meeting/:meetingId',
        'Register Material': 'POST /feishu/meeting/:meetingId/materials',
        'Get Participants': 'GET /feishu/meeting/:meetingId/participants',
        'Get by External ID': 'GET /feishu/meeting/external/:externalMeetingId',
        'Get Statistics': 'GET /feishu/meeting/stats',
      },
      bot: {
        'Get Bot Info': 'GET /feishu/bot/info',
        'Update Bot Info': 'POST /feishu/bot/info',
        'Get Bot Members': 'GET /feishu/bot/members',
        'Get Bot Member Count': 'GET /feishu/bot/members/count',
        'Set Help Text': 'POST /feishu/bot/help',
        'Set Description': 'POST /feishu/bot/description',
        'Set Webhook': 'POST /feishu/bot/webhook',
        'Get Webhook': 'GET /feishu/bot/webhook',
      },
      knowledge: {
        'List Roots': 'GET /feishu/knowledge/roots',
        'Schema Plan': 'GET /feishu/knowledge/schema/plan',
        'Scan Roots': 'POST /feishu/knowledge/scan',
        'Bootstrap Graph Store': 'POST /feishu/knowledge/bootstrap',
        'Collect Node': 'POST /feishu/knowledge/collect',
        'Build Artifacts': 'POST /feishu/knowledge/artifacts',
        'Sync Graph': 'POST /feishu/knowledge/graph/sync',
        'Build Markdown': 'POST /feishu/knowledge/markdown',
        'Import Node As User': 'POST /feishu/knowledge/user/import-node',
      },
    },
  });
});

// Setup all routes (only if client initialized)
if (feishu) {
  setupAuthRoutes(app, feishu);
  setupIMRoutes(app, feishu);
  setupContactRoutes(app, feishu);
  setupDriveRoutes(app, feishu);
  setupDocRoutes(app, feishu);
  setupCalendarRoutes(app, feishu);
  setupApprovalRoutes(app, feishu);
  setupTaskRoutes(app, feishu);
  setupBotRoutes(app, feishu);
  setupMeetingRoutes(app, feishu);
  setupKnowledgeRoutes(app, feishu);
}

// Error handling
app.use(errorHandler);

// Start server
app.listen(port, () => {
  console.log(`\n🚀 Feishu Connect API v2.0.0`);
  console.log(`📍 Server running at http://localhost:${port}`);
  console.log(`📚 API documentation at http://localhost:${port}/`);
  console.log(`💚 Health check at http://localhost:${port}/health`);
  if (appId && appSecret) {
    console.log(`✅ Credentials loaded\n`);
  } else {
    console.log(`⚠️  No credentials - set FEISHU_APP_ID and FEISHU_APP_SECRET\n`);
  }
});
