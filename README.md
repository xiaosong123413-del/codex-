# Feishu Connect API

全面的飞书(Lark)开放平台集成SDK，覆盖所有主要API模块。

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ Features

### 🎯 Complete API Coverage
- ✅ **Authentication** - Tenant access token with auto-refresh
- ✅ **Instant Messaging** - Text, cards, images, files, audio
- ✅ **Contacts** - Users, departments, chats management
- ✅ **Documents** - Docs & Sheets CRUD operations
- ✅ **Drive** - File upload/download, folders, search
- ✅ **Calendar** - Events, scheduling, resources
- ✅ **Meetings** - Video conference management
- ✅ **Tasks** - Task lists, tasks, assignments
- ✅ **Approval** - Workflow and approval automation
- ✅ **Search** - Global search across all content
- ✅ **Bot** - Bot configuration and management

### 🏗️ Architecture
- **Modular Design** - Each API in separate service class
- **Express.js** - RESTful API endpoints
- **Auto Token Refresh** - Handles token expiry automatically
- **Retry Logic** - Exponential backoff on failures
- **Error Handling** - Unified error responses
- **TypeScript Ready** - Easy to add types

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Feishu/Lark developer account
- App credentials (APP_ID and APP_SECRET)

### Installation

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local and add your credentials
```

### Configuration

Create `.env.local`:

```env
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
PORT=3000
```

### Start Server

```bash
npm start
# or
node server.js
```

Server will start at `http://localhost:3000`

## 📚 API Documentation

### Health Check

```http
GET /health
```

Response:
```json
{
  "ok": true,
  "service": "feishu-connect",
  "version": "2.0.0",
  "authenticated": true,
  "services": {
    "auth": true
  }
}
```

### Authentication

#### Get Tenant Access Token
```http
GET /feishu/token
```

#### Refresh Token
```http
POST /feishu/token/refresh
```

### Instant Messaging (IM)

#### Send Text Message
```http
POST /feishu/message/text
Content-Type: application/json

{
  "receive_id_type": "open_id",
  "receive_id": "ou_xxx",
  "text": "Hello from Feishu Connect!"
}
```

#### Send Card Message
```http
POST /feishu/message/card
Content-Type: application/json

{
  "receive_id_type": "chat_id",
  "receive_id": "oc_xxx",
  "card": {
    "config": {
      "wide_screen_mode": true
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "content": "Card content here",
          "tag": "lark_md"
        }
      }
    ]
  }
}
```

#### Send Image
```http
POST /feishu/message/image
Content-Type: application/json

{
  "receive_id_type": "open_id",
  "receive_id": "ou_xxx",
  "image_key": "img_xxx"
}
```

#### Send File
```http
POST /feishu/message/file
Content-Type: application/json

{
  "receive_id_type": "chat_id",
  "receive_id": "oc_xxx",
  "file_key": "file_xxx"
}
```

#### Send Audio
```http
POST /feishu/message/audio
Content-Type: application/json

{
  "receive_id_type": "open_id",
  "receive_id": "ou_xxx",
  "audio_key": "audio_xxx",
  "duration": 10
}
```

#### Generic Send (any type)
```http
POST /feishu/message
Content-Type: application/json

{
  "receive_id_type": "chat_id",
  "receive_id": "oc_xxx",
  "msg_type": "text",
  "content": {
    "text": "Generic message"
  }
}
```

#### Recall Message
```http
DELETE /feishu/message/:messageId
```

#### Get Message
```http
GET /feishu/message/:messageId
```

#### Forward Message
```http
POST /feishu/message/:messageId/forward
Content-Type: application/json

{
  "receive_id_type": "open_id",
  "receive_id": "ou_xxx"
}
```

### Contacts

#### Get User
```http
GET /feishu/contact/user/:userId
```

#### Batch Get Users
```http
POST /feishu/contact/users/batch
Content-Type: application/json

{
  "user_ids": ["ou_xxx", "ou_yyy"]
}
```

#### List Users
```http
GET /feishu/contact/users?page_size=100&page_token=&department_id=
```

#### Search Users
```http
POST /feishu/contact/users/search
Content-Type: application/json

{
  "query": "张三"
}
```

#### Get Department
```http
GET /feishu/contact/department/:departmentId
```

#### List Departments
```http
GET /feishu/contact/departments?page_size=100&page_token=&fetch_child=true
```

#### Get Department Users
```http
GET /feishu/contact/department/:departmentId/users?page_size=100&page_token=&fetch_child=true
```

#### List Chats (Groups)
```http
GET /feishu/contact/chats?page_size=100&page_token=
```

#### Get Chat Info
```http
GET /feishu/contact/chat/:chatId
```

#### Get Chat Members
```http
GET /feishu/contact/chat/:chatId/members?page_size=100&page_token=
```

### Drive (Files)

#### Upload File
```http
POST /feishu/drive/upload
Content-Type: application/json

{
  "file_path": "/path/to/file.pdf",
  "file_name": "file.pdf",
  "folder_token": "fld_xxx"
}
```

#### Upload from Base64
```http
POST /feishu/drive/upload/base64
Content-Type: application/json

{
  "file_name": "image.png",
  "base64_content": "base64...",
  "folder_token": "fld_xxx"
}
```

#### Download File
```http
GET /feishu/drive/file/:fileToken/download
```

#### Get File Info
```http
GET /feishu/drive/file/:fileToken
```

#### Delete File
```http
DELETE /feishu/drive/file/:fileToken
```

#### Update File
```http
POST /feishu/drive/file/:fileToken
Content-Type: application/json

{
  "name": "New Name"
}
```

#### Move File
```http
POST /feishu/drive/file/:fileToken/move
Content-Type: application/json

{
  "destination_folder_token": "fld_xxx"
}
```

#### Copy File
```http
POST /feishu/drive/file/:fileToken/copy
Content-Type: application/json

{
  "destination_folder_token": "fld_xxx"
}
```

#### Create Folder
```http
POST /feishu/drive/folder
Content-Type: application/json

{
  "name": "New Folder",
  "parent_folder_token": "fld_xxx"
}
```

#### Get Folder
```http
GET /feishu/drive/folder/:folderToken
```

#### List Folder Contents
```http
GET /feishu/drive/folder/:folderToken/contents?page_size=100&page_token=
```

#### Search Files
```http
POST /feishu/drive/search
Content-Type: application/json

{
  "query": "report.pdf"
}
```

### Documents

#### Create Document
```http
POST /feishu/doc/create
Content-Type: application/json

{
  "title": "My Document",
  "type": "doc",
  "folder_token": "fld_xxx"
}
```

#### Get Document
```http
GET /feishu/doc/:documentId
```

#### Update Document Title
```http
POST /feishu/doc/:documentId/title
Content-Type: application/json

{
  "title": "New Title"
}
```

#### Delete Document
```http
DELETE /feishu/doc/:documentId
```

#### Get Document Content
```http
GET /feishu/doc/:documentId/content
```

#### Update Document Content
```http
POST /feishu/doc/:documentId/content
Content-Type: application/json

{
  "operations": [
    {
      "operation": "insert",
      "position": "end",
      "block": {
        "type": "paragraph",
        "paragraph": {
          "elements": [
            {
              "text_run": {
                "content": "New paragraph"
              }
            }
          ]
        }
      }
    }
  ]
}
```

#### Append Block
```http
POST /feishu/doc/:documentId/blocks
Content-Type: application/json

{
  "block": {
    "type": "paragraph",
    "paragraph": {
      "elements": [...]
    }
  }
}
```

#### Get Block
```http
GET /feishu/doc/:documentId/blocks/:blockId
```

#### Update Block
```http
POST /feishu/doc/:documentId/blocks/:blockId
Content-Type: application/json

{
  "block": { ... }
}
```

#### Delete Block
```http
DELETE /feishu/doc/:documentId/blocks/:blockId
```

#### Share Document
```http
POST /feishu/doc/:documentId/share
Content-Type: application/json

{
  "type": "user",
  "id": "ou_xxx",
  "permission": "view"
}
```

#### Export Document
```http
GET /feishu/doc/:documentId/export?format=markdown
```

### Spreadsheets (Sheets)

#### Create Spreadsheet
```http
POST /feishu/sheet/create
Content-Type: application/json

{
  "title": "My Spreadsheet",
  "folder_token": "fld_xxx"
}
```

#### Get Spreadsheet
```http
GET /feishu/sheet/:spreadsheetToken
```

#### Get Sheet Values
```http
GET /feishu/sheet/:spreadsheetToken/values?sheet_id=Sheet1&range=A1:Z1000
```

#### Update Sheet Values
```http
PUT /feishu/sheet/:spreadsheetToken/values
Content-Type: application/json

{
  "sheet_id": "Sheet1",
  "range": "A1:B2",
  "values": [
    ["Name", "Age"],
    ["Alice", 25]
  ]
}
```

#### Append Rows
```http
POST /feishu/sheet/:spreadsheetToken/rows/append
Content-Type: application/json

{
  "sheet_id": "Sheet1",
  "values": [
    ["Bob", 30],
    ["Charlie", 35]
  ]
}
```

#### Batch Update
```http
POST /feishu/sheet/:spreadsheetToken/batch-update
Content-Type: application/json

{
  "value_ranges": [...],
  "data_filters": [...],
  "data": {...}
}
```

### Calendar

#### List Calendars
```http
GET /feishu/calendar/calendars?page_size=100&page_token=
```

#### Get Calendar
```http
GET /feishu/calendar/calendar/:calendarId
```

#### Create Calendar
```http
POST /feishu/calendar/calendar
Content-Type: application/json

{
  "title": "Team Calendar",
  "description": "Team events",
  "color": 1
}
```

#### Update Calendar
```http
POST /feishu/calendar/calendar/:calendarId
Content-Type: application/json

{
  "title": "Updated Title"
}
```

#### Delete Calendar
```http
DELETE /feishu/calendar/calendar/:calendarId
```

#### List Events
```http
GET /feishu/calendar/calendar/:calendarId/events?page_size=100&page_token=&time_min=&time_max=&single_events=true
```

#### Get Event
```http
GET /feishu/calendar/calendar/:calendarId/event/:eventId
```

#### Create Event
```http
POST /feishu/calendar/calendar/:calendarId/event
Content-Type: application/json

{
  "summary": "Team Meeting",
  "description": "Weekly sync",
  "start_time": {
    "timestamp": "2025-01-15T10:00:00+08:00"
  },
  "end_time": {
    "timestamp": "2025-01-15T11:00:00+08:00"
  },
  "attendees": [
    {
      "user_id": "ou_xxx"
    }
  ]
}
```

#### Update Event
```http
POST /feishu/calendar/calendar/:calendarId/event/:eventId
Content-Type: application/json

{
  "summary": "Updated Title"
}
```

#### Delete Event
```http
DELETE /feishu/calendar/calendar/:calendarId/event/:eventId
```

#### Quick Add Event
```http
POST /feishu/calendar/calendar/:calendarId/quick-add
Content-Type: application/json

{
  "text": "Meeting tomorrow at 10am",
  "time_zone": "Asia/Shanghai"
}
```

#### Free/Busy Check
```http
POST /feishu/calendar/freebusy
Content-Type: application/json

{
  "calendar_ids": ["cal_xxx"],
  "time_min": "2025-01-15T00:00:00+08:00",
  "time_max": "2025-01-16T00:00:00+08:00",
  "time_zone": "Asia/Shanghai"
}
```

#### Create Meeting for Event
```http
POST /feishu/calendar/calendar/:calendarId/event/:eventId/meeting
Content-Type: application/json

{
  "meeting": {
    "topic": "Video Call"
  }
}
```

#### Delete Meeting
```http
DELETE /feishu/calendar/calendar/:calendarId/event/:eventId/meeting
```

#### List Resources (Meeting Rooms)
```http
GET /feishu/calendar/resources
```

### Approval

#### List Approval Definitions
```http
GET /feishu/approval/definitions?page_size=100&page_token=&name=
```

#### Get Approval Definition
```http
GET /feishu/approval/definition/:definitionId
```

#### Create Approval Instance
```http
POST /feishu/approval/instance
Content-Type: application/json

{
  "approval_template_id": "template_xxx",
  "title": "Leave Request",
  "form": [
    {
      "name": "reason",
      "type": "text",
      "value": "Annual leave"
    }
  ],
  "user_ids": ["ou_xxx"]
}
```

#### Get Approval Instance
```http
GET /feishu/approval/instance/:instanceId
```

#### Cancel Instance
```http
POST /feishu/approval/instance/:instanceId/cancel
Content-Type: application/json

{
  "reason": "No longer needed"
}
```

#### List Instances
```http
GET /feishu/approval/instances?page_size=100&page_token=&status=&approval_template_id=&created_at_range=
```

#### List Approval Tasks
```http
GET /feishu/approval/tasks?page_size=100&page_token=&status=&user_id=
```

#### Get Task
```http
GET /feishu/approval/task/:taskId
```

#### Get Task Detail
```http
GET /feishu/approval/task/:taskId/detail
```

#### Approve Task
```http
POST /feishu/approval/task/:taskId/approve
Content-Type: application/json

{
  "comment": "Approved"
}
```

#### Reject Task
```http
POST /feishu/approval/task/:taskId/reject
Content-Type: application/json

{
  "comment": "Rejected - need more info"
}
```

#### Transfer Task
```http
POST /feishu/approval/task/:taskId/transfer
Content-Type: application/json

{
  "to_user_id": "ou_xxx",
  "comment": "Transferring to manager"
}
```

#### Add Comment
```http
POST /feishu/approval/task/:taskId/comment
Content-Type: application/json

{
  "comment": "Please review the documents"
}
```

### Tasks

#### List Task Lists
```http
GET /feishu/task/lists?page_size=100&page_token=
```

#### Create Task List
```http
POST /feishu/task/list
Content-Type: application/json

{
  "name": "Project Tasks",
  "description": "Tasks for Q1 project",
  "members": ["ou_xxx", "ou_yyy"]
}
```

#### Get Task List
```http
GET /feishu/task/list/:taskListId
```

#### Update Task List
```http
POST /feishu/task/list/:taskListId
Content-Type: application/json

{
  "name": "Updated Name"
}
```

#### Delete Task List
```http
DELETE /feishu/task/list/:taskListId
```

#### Create Task
```http
POST /feishu/task/list/:taskListId/task
Content-Type: application/json

{
  "title": "Review PR",
  "description": "Review the new feature PR",
  "due": "2025-01-20T18:00:00+08:00",
  "priority": 1
}
```

#### Get Task
```http
GET /feishu/task/:taskId
```

#### Update Task
```http
POST /feishu/task/:taskId
Content-Type: application/json

{
  "title": "Updated Title"
}
```

#### Delete Task
```http
DELETE /feishu/task/:taskId
```

#### List Tasks
```http
GET /feishu/task/list/:taskListId/tasks?page_size=100&page_token=&status=
```

#### Assign Task
```http
POST /feishu/task/:taskId/assign
Content-Type: application/json

{
  "member_ids": ["ou_xxx"]
}
```

#### Unassign Task
```http
POST /feishu/task/:taskId/unassign
Content-Type: application/json

{
  "member_ids": ["ou_xxx"]
}
```

#### Complete Task
```http
POST /feishu/task/:taskId/complete
```

#### Reopen Task
```http
POST /feishu/task/:taskId/reopen
```

#### Add Comment
```http
POST /feishu/task/:taskId/comment
Content-Type: application/json

{
  "content": "Progress update: 50% complete"
}
```

#### Get Comments
```http
GET /feishu/task/:taskId/comments?page_size=100&page_token=
```

### Meetings

#### Create Meeting
```http
POST /feishu/meeting
Content-Type: application/json

{
  "title": "Team Sync",
  "start_time": "2025-01-15T10:00:00+08:00",
  "end_time": "2025-01-15T11:00:00+08:00",
  "description": "Weekly team meeting",
  "participants": [
    {
      "user_id": "ou_xxx"
    }
  ]
}
```

#### Get Meeting
```http
GET /feishu/meeting/:meetingId
```

#### Update Meeting
```http
POST /feishu/meeting/:meetingId
Content-Type: application/json

{
  "title": "Updated Title"
}
```

#### Cancel Meeting
```http
DELETE /feishu/meeting/:meetingId?reason=
```

#### Register Material
```http
POST /feishu/meeting/:meetingId/materials
Content-Type: application/json

{
  "materials": [
    {
      "type": "file",
      "file": {
        "file_token": "file_xxx"
      }
    }
  ]
}
```

#### Get Participants
```http
GET /feishu/meeting/:meetingId/participants
```

#### Get Meeting by External ID
```http
GET /feishu/meeting/external/:externalMeetingId
```

#### Get Meeting Statistics
```http
GET /feishu/meeting/stats?start_time=&end_time=
```

### Bot

#### Get Bot Info
```http
GET /feishu/bot/info
```

#### Update Bot Info
```http
POST /feishu/bot/info
Content-Type: application/json

{
  "name": "My Bot",
  "description": "Bot description"
}
```

#### Get Bot Chat Members
```http
GET /feishu/bot/members?page_size=100&page_token=
```

#### Get Bot Member Count
```http
GET /feishu/bot/members/count
```

#### Set Bot Help Text
```http
POST /feishu/bot/help
Content-Type: application/json

{
  "help_text": "Commands: /help, /status"
}
```

#### Set Bot Description
```http
POST /feishu/bot/description
Content-Type: application/json

{
  "description": "This is my bot"
}
```

#### Set Outgoing Webhook
```http
POST /feishu/bot/webhook
Content-Type: application/json

{
  "url": "https://your-server.com/webhook"
}
```

#### Get Outgoing Webhook
```http
GET /feishu/bot/webhook
```

## 🧪 Testing

Run health check:
```bash
npm test
```

Run IM API tests:
```bash
npm run test:im
```

Run comprehensive test suite:
```bash
npm run test:all
```

## 📁 Project Structure

```
feishu-connect/
├── src/
│   ├── core/
│   │   ├── client.js       # Main client, manages tokens
│   │   ├── http.js         # HTTP client with retry
│   │   └── errors.js       # Error classes
│   ├── services/
│   │   ├── auth.js         # Authentication
│   │   ├── im.js           # Messaging
│   │   ├── contact.js      # Contacts & chats
│   │   ├── drive.js        # Files & folders
│   │   ├── doc.js          # Docs & sheets
│   │   ├── calendar.js     # Calendar events
│   │   ├── meeting.js      # Video meetings
│   │   ├── task.js         # Tasks management
│   │   ├── approval.js     # Approval workflows
│   │   ├── search.js       # Search APIs
│   │   └── bot.js          # Bot management
│   ├── routes/
│   │   ├── auth.js         # Auth endpoints
│   │   ├── im.js           # IM endpoints
│   │   ├── contact.js      # Contact endpoints
│   │   ├── drive.js        # Drive endpoints
│   │   ├── doc.js          # Document endpoints
│   │   ├── calendar.js     # Calendar endpoints
│   │   ├── approval.js     # Approval endpoints
│   │   ├── task.js         # Task endpoints
│   │   ├── bot.js          # Bot endpoints
│   │   └── meeting.js      # Meeting endpoints
│   ├── middleware/
│   │   ├── errorHandler.js # Error middleware
│   │   └── jsonParser.js   # JSON body parser
│   └── index.js            # Main exports
├── tests/
│   └── examples/
│       ├── health.js       # Health test
│       ├── im.js           # IM tests
│       └── all.js          # Full test suite
├── server.js               # Express server
├── package.json
├── .env.example
├── .env.local              # Your credentials (gitignored)
└── README.md
```

## 🔧 Usage as SDK

You can also use this as a library in your own projects:

```javascript
import { FeishuClient } from './src/core/client.js';

const client = new FeishuClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
});

// Auto-refresh token management
await client.ensureToken();

// Use any service
const users = await client.contact.listUsers();
const doc = await client.doc.createDocument('My Doc');
await client.im.sendText('open_id', 'ou_xxx', 'Hello!');
```

## ⚠️ Error Handling

All API errors return consistent format:

```json
{
  "ok": false,
  "code": 12345,
  "msg": "Error message",
  "details": {}
}
```

Common error codes:
- `AUTH_ERROR` - Invalid or expired token
- `VALIDATION_ERROR` - Invalid request parameters
- `RATE_LIMIT` - Too many requests
- `PERMISSION_DENIED` - Missing API permissions
- `NOT_FOUND` - Resource not found
- `NETWORK_ERROR` - Network issues

## 🔐 Permissions Required

Make sure your Feishu app has the following permissions enabled in [Feishu Open Platform](https://open.feishu.cn/):

### Required
- `im:message` - Send messages
- `contact:contact` - Access user/department info
- `drive:drive` - File operations
- `docx:doc` - Document operations
- `sheet:sheet` - Spreadsheet operations
- `calendar:calendar` - Calendar access
- `approval:approval` - Approval workflows
- `task:task` - Task management
- `meeting:meeting` - Meeting creation
- `bot:bot` - Bot configuration

### Optional
- `search:search` - Search APIs
- `evection:event` - Event subscription

## 🚢 Deployment

### Environment Variables
Set these in your deployment environment:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `PORT` (optional, default 3000)

### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start server.js --name feishu-connect
pm2 save
pm2 startup
```

### Using Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
```

### Using Express Static Files
You can also serve a frontend:
```javascript
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});
```

## 🐛 Troubleshooting

### "Missing FEISHU_APP_ID or FEISHU_APP_SECRET"
- Check your `.env.local` file
- Ensure credentials are correct
- Verify app is published in Feishu console

### "No permission" errors
- Enable required permissions in Feishu Open Platform
- Re-publish your application after permission changes
- Some permissions require admin approval

### "Robot not in chat" (230002)
- Add your bot to the target chat/group manually
- Or use the chat API to invite the bot

### "Bot not enabled" (230006)
- Enable "Bot" capability in Feishu console
- Re-publish the application

### Rate limiting
- API automatically retries with exponential backoff
- Implement request queuing for high volume
- Consider batch operations where available

### Webhooks not receiving events
- Set outgoing webhook URL in bot settings
- Ensure your server is publicly accessible (use ngrok for local dev)
- Implement event validation challenge response

## 📝 Development

### Adding New API Endpoints

1. Add method to appropriate service in `src/services/`
2. Create route in `src/routes/`
3. Test with curl or Postman

Example:
```javascript
// In src/services/custom.js
export class CustomService {
  async customMethod(params) {
    return this.client.post('/open-apis/custom/v1/endpoint', params);
  }
}

// In src/routes/custom.js
export function setupCustomRoutes(router, client) {
  router.post('/feishu/custom/method', async (req, res, next) => {
    try {
      const result = await client.custom.customMethod(req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });
}
```

4. Import and register in `server.js`

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit PR with description

## 📄 License

MIT

## 🔗 Links

- [Feishu Open Platform](https://open.feishu.cn/)
- [API Documentation](https://open.feishu.cn/document/ukTMukTMukTM)
- [Community Forum](https://www.feishu.cn/)

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/)
- Uses [Feishu Node SDK](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
- Error handling with custom classes

---

**Generated with [Claude Code](https://claude.com/claude-code)**
