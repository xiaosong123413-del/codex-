# Quick Start Guide

## Setup (1 minute)

1. **Install dependencies**
   ```bash
   cd "C:\Users\Administrator\Documents\New project"
   npm install
   ```

2. **Configure environment**
   ```bash
   # Edit .env.local or create new one
   FEISHU_APP_ID=your_app_id
   FEISHU_APP_SECRET=your_app_secret
   PORT=3000
   ```

   Get credentials from: https://open.feishu.cn/

3. **Start server**
   ```bash
   npm start
   # or
   npm run dev
   ```

## Test API

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. Get Token
```bash
curl http://localhost:3000/feishu/token
```

### 3. Send Message
```bash
curl -X POST http://localhost:3000/feishu/message/text \
  -H "Content-Type: application/json" \
  -d '{
    "receive_id_type": "open_id",
    "receive_id": "ou_xxxxxxxx",
    "text": "Hello from Feishu Connect! 🎉"
  }'
```

### 4. Run All Examples
```bash
npm test
# or individually:
node tests/examples/health.js
node tests/examples/contact.js
node tests/examples/im.js
node tests/examples/document.js
node tests/examples/drive.js
node tests/examples/calendar.js
node tests/examples/task.js
node tests/examples/approval.js
node tests/examples/search.js
node tests/examples/bot.js
```

## Available Modules

| Module | Status | Endpoints |
|--------|--------|-----------|
| **Authentication** | ✅ Complete | `GET /feishu/token` |
| **IM (Messaging)** | ✅ Complete | `/feishu/message/*` |
| **Contacts** | ✅ Complete | `/feishu/users`, `/feishu/departments`, `/feishu/chats` |
| **Documents** | ✅ Complete | `/feishu/documents`, `/feishu/spreadsheets` |
| **Drive (Files)** | ✅ Complete | `/feishu/files/*`, `/feishu/folders/*` |
| **Calendar** | ✅ Complete | `/feishu/calendar/events` |
| **Meeting** | ✅ Complete | `/feishu/meetings/*` |
| **Tasks** | ✅ Complete | `/feishu/tasks`, `/feishu/tasklists` |
| **Approval** | ✅ Complete | `/feishu/approval/*` |
| **Search** | ✅ Complete | `/feishu/search/*` |
| **Bot** | ✅ Complete | `/feishu/bot/*` |

## API Reference

See [README.md](README.md) for full documentation.

## Troubleshooting

**"Missing FEISHU_APP_ID"**
→ Check your `.env.local` file exists and contains correct values

**"app bot not in chat" (230002)**
→ Add your bot to the target chat/group first

**"Invalid parameters" (230001)**
→ Check receive_id_type matches your receive_id format

**"Permission denied"**
→ Ensure your app has required permissions in Feishu admin console

**Rate limit errors**
→ The SDK auto-retries with exponential backoff. For heavy usage, add delays between requests.

## Project Structure

```
feishu-connect/
├── src/
│   ├── core/          # HTTP client, errors
│   ├── services/      # API service modules
│   └── index.js       # Main client facade
├── server.js          # Express server with all routes
├── tests/examples/    # Example scripts for each module
├── .env.example       # Environment template
├── .env.local         # Your credentials (gitignored)
├── package.json
└── README.md
```

## Need Help?

- Check the example scripts in `tests/examples/`
- Visit [Feishu Open Platform Docs](https://open.feishu.cn/document)
- Review the error message in API response

Enjoy your full-featured Feishu integration! 🚀
