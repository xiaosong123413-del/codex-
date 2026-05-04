# LLM Wiki Compiler

把零散资料、个人记录、网页、文档、图片和工作流沉淀为一个可搜索、可审查、可发布的第二大脑知识库。

这个仓库不是单一网页项目，而是一套围绕“知识编译”的完整工作台：CLI 负责采集和编译资料，Web UI 负责浏览、搜索、审查和工作流操作，桌面入口负责本地使用体验，Cloudflare Worker 负责远程同步、移动端接口和公开发布，MCP/Obsidian/静态站点工具负责把知识库连接到外部工具链。

## 项目目标

LLM Wiki Compiler 的目标是把“原始信息”变成“可长期维护的知识系统”。传统 RAG 通常在回答问题时临时检索片段；这个项目更强调把资料编译成稳定的 Markdown wiki，让内容可以直接查看、编辑、审查、同步和发布。

核心原则：

- 原始资料进入系统后，被提取、摘要、链接、分层和索引。
- 编译结果是可读的 Markdown 页面，不是只能由程序解释的黑盒向量库。
- 个人记录、项目记录、任务记录、知识概念分层管理，同时允许通过桥接记录互相连接。
- 本地 CLI、Web 工作台、桌面入口和 Cloudflare 远程能力围绕同一套知识流转模型工作。

## 适合谁使用

- 想把网页、PDF、笔记、研究资料整理成长期 wiki 的个人用户。
- 想维护个人第二大脑、项目工作台、任务池和复盘记录的知识工作者。
- 想让 AI 助手基于自己资料回答问题，而不是只依赖通用互联网知识的开发者。
- 想把本地知识库同步到 Web、Cloudflare 或移动端的用户。
- 想研究“LLM + Wiki + 工作流 + 个人知识管理”一体化系统的工程实践者。

## 核心能力

### 知识采集

系统支持从本地 Markdown、文本、网页文章、PDF、图片 OCR、文档图片、Flash Diary 闪念日记、小红书/抖音同步流、项目工作区、任务池和执行记录中收集资料。采集时会尽量保留来源、路径、时间、媒体信息和后续审查所需的上下文。

### Wiki 编译

编译流程会把原始资料转为结构化 wiki：生成概念页、主题页、索引页和入口页；建立页面链接；保留来源引用和 claim 级别证据；支持 tiered memory，把短期记录、长期知识和个人事实分层管理；对低置信度内容保留审查状态，避免直接污染长期知识库。

### 搜索与问答

项目内置 Markdown/wiki 页面搜索、混合搜索、图扩展搜索、Cloudflare Vectorize 相关向量搜索、本地 embedding 服务发现和本地向量搜索模块。问答逻辑强调个人信息和通用知识的双通道检索：先找个人事实，再找通用知识，再找项目、任务、案例、方法、工具等桥接记录。

### Web 工作台

`web/` 是主要本地工作区，包含 Wiki、Chat、Review、Graph、Flash Diary、Sources、Runs、Automation、Workflow、Settings、项目工作区、任务池、执行记录等页面和服务。它不是展示型首页，而是实际使用的知识工作台。

### 桌面入口

`desktop-webui/` 和 `desktop-webui-launcher/` 提供桌面化入口，用于启动本地 Web UI、桥接本地能力、管理工作区身份、同步配置、截图/闪念采集等桌面工作流。

### Cloudflare 远程能力

`cloudflare/remote-brain-worker/` 提供远程发布、D1/R2/Vectorize/Workers AI 集成、移动端聊天/日记/任务/文档/账户接口、微信小程序登录挑战、远程搜索、向量查询、状态检查和 MCP JSON-RPC 接口。

### MCP 与外部工具

项目包含 MCP Server，可供 Claude Code、Codex CLI 或其他 MCP 客户端读取 wiki 页面和搜索知识库。项目也包含 `plugins/obsidian-audit/` 和 `audit-shared/`，用于把 wiki 审查、锚点和反馈流程接入 Obsidian。

## 仓库结构

```text
.
├── src/                         # CLI、编译器、采集、搜索、provider、MCP server
├── web/                         # 本地 Web 工作台：前端、服务端路由、页面和服务
├── desktop-webui/               # 桌面 WebUI/Electron 入口相关代码
├── desktop-webui-launcher/      # Windows 桌面启动器
├── cloudflare/                  # Cloudflare Worker、D1 schema、远程同步和移动端接口
├── functions/                   # Pages/Functions 风格的公开 wiki API
├── scripts/                     # 构建、同步、静态站点、搜索评估、桌面启动等脚本
├── plugins/obsidian-audit/      # Obsidian 审查插件
├── audit-shared/                # 审查插件和 Web 共享的数据结构/锚点逻辑
├── docs/                        # 项目日志、设计方案、需求和执行记录
├── search/                      # 搜索评估 query/qrels 数据
├── test/                        # Vitest 测试
├── examples/                    # 示例 wiki
├── wiki-clone/                  # wiki clone 相关实验/页面
└── project-log-assets/          # 项目日志界面截图资产
```

## 主要工作流

### 工作流 1：把资料编译为 wiki

```bash
npm install
npm run build
copy .env.example .env
node dist/cli.js ingest https://example.com/article
node dist/cli.js compile
node dist/cli.js query "这里写你的问题"
```

如果使用全局命令：

```bash
llmwiki ingest https://example.com/article
llmwiki compile
llmwiki query "这里写你的问题"
```

### 工作流 2：启动本地 Web 工作台

```bash
npm run web:build
npm run web:start -- --wiki "/path/to/wiki-root" --port 4175
```

适合日常浏览 wiki、搜索知识库、审查编译结果、管理闪念日记、查看图谱、操作项目工作区、配置 LLM provider 和远程发布。

### 工作流 3：启动桌面 WebUI

```bash
npm run desktop:webui:install
npm run desktop:webui:build
npm run desktop:webui:launch
```

开发模式：

```bash
npm run desktop:webui:dev
```

### 工作流 4：构建公开静态 wiki

```bash
npm run wiki:static
npm run pages:deploy
```

### 工作流 5：启动 MCP Server

```bash
npm run build
npm run mcp
```

## 环境变量

复制模板：

```bash
copy .env.example .env
```

`.env.example` 只应该保存占位符，不应该保存真实 key。真实密钥写入 `.env`，而 `.env` 已经被 `.gitignore` 忽略。

### 通用配置

```env
LLMWIKI_PROVIDER=anthropic
LLMWIKI_MODEL=claude-sonnet-4-20250514
```

支持的 provider：`anthropic`、`openai`、`gemini`、`ollama`、`minimax`、`cloudflare`。

### Anthropic

```env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_AUTH_TOKEN=...
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### OpenAI

```env
OPENAI_API_KEY=sk-proj-...
LLMWIKI_OPENAI_BASE_URL=https://api.openai.com/v1/
```

### Google Gemini

```env
GOOGLE_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
```

### Ollama

```env
OLLAMA_HOST=http://localhost:11434/v1
```

Ollama 是本地模型方案，通常不需要云端 API key。

### MiniMax

```env
MINIMAX_API_KEY=...
MINIMAX_BASE_URL=https://api.minimax.io/anthropic
```

### Cloudflare

```env
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev
CLOUDFLARE_REMOTE_TOKEN=...
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct
CLOUDFLARE_VECTORIZE_INDEX=...
CLOUDFLARE_SEARCH_TOKEN=...
CLOUDFLARE_SEARCH_MODEL=...
CLOUDFLARE_SEARCH_ENDPOINT=...
```

### 微信和代理

```env
WECHAT_MINI_PROGRAM_APP_ID=wx...
WECHAT_MINI_PROGRAM_APP_SECRET=...
WECHAT_WEB_APP_ID=wx...
WECHAT_WEB_APP_SECRET=...
GLOBAL_AGENT_HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

生产环境中，微信 secret 更适合放在 Worker secret store，而不是写入仓库文件。

## 常用命令

```bash
npm install
npm run build
npm test
npx tsc --noEmit
```

```bash
node dist/cli.js --help
node dist/cli.js ingest <source>
node dist/cli.js compile
node dist/cli.js query "question"
```

```bash
npm run web:build
npm run web:start -- --wiki "/path/to/wiki-root" --port 4175
npm run desktop:webui:install
npm run desktop:webui:build
npm run desktop:webui:launch
npm run desktop:webui:launcher:build
npm run obsidian-audit:build
npm run public-package:check
npm run search:eval
npm run search:eval:benchmark
```

## 模块说明

### CLI 与编译器

`src/` 是核心 CLI 和编译器目录：

- `src/cli.ts`：命令行入口。
- `src/mcp-server.ts`：MCP Server 入口。
- `src/commands/`：`compile`、`ingest`、`lint`、`query`、`watch` 等命令。
- `src/compiler/`：概念页、claim、索引、摘要、分层记忆和 Obsidian 输出。
- `src/ingest/`：网页、本地文件、文档、图片和 zip 采集。
- `src/linter/`：wiki 质量检查和自动修复。
- `src/providers/`：Anthropic、OpenAI、Gemini、Ollama、MiniMax、Cloudflare provider。
- `src/services/` 和 `src/utils/`：搜索、向量、配置读取、LLM 调用、Cloudflare HTTP、内容图片等工具。

### Web

`web/client/` 包含浏览器端页面、样式和交互；`web/server/` 包含服务端路由和领域服务。主要能力包括 Chat、Search、Review、Sources、Flash Diary、Automation、Workspace、Graph、Settings、LLM 配置、远程同步、项目工作区和执行记录。

Web UI 承担端到端产品流：用户输入、本地状态、API 路由、服务层逻辑、文件持久化、下游页面刷新和结果展示。

### Cloudflare

`cloudflare/remote-brain-worker/` 是远程同步和移动端能力核心：

- `src/index.ts`：Worker 主入口。
- `schema.sql` 和 `migrations/`：D1 数据结构和迁移。
- `src/mobile-*.ts`：移动端聊天、日记、任务、文档、入口等接口。
- `src/account-*.ts`：账户、登录、同步位置、AI 设置等接口。
- `src/wiki-publish-events.ts`：wiki 发布事件。

典型远程接口包括 `/status`、`/publish`、`/push`、`/pull`、`/search`、`/vector/query` 和 `/mcp`。

## 运行时数据和安全边界

仓库默认不应该提交真实运行时数据和密钥：

- `.env`：真实环境变量，已忽略。
- `.secrets/`：本地密钥目录，已忽略。
- `.runtime/`：运行时 wiki 和本地状态，已忽略。
- `tmp/`、`.tmp/`：临时文件，已忽略。
- `.llmwiki-webui.log`：本地日志，已忽略。
- `.models/Qwen3-Embedding-8B/*.safetensors`：本地大模型权重，已忽略。

如果误提交真实 API key，需要立即从 Git 历史中移除并到对应平台轮换密钥。GitHub 普通仓库不适合存放数 GB 的模型文件；大文件需要单独设计下载或发布方案。

## 开发规范

这个仓库偏向“可长期维护”的代码风格：TypeScript 代码需要严格、明确、最小化；文件和函数应尽量保持小而清晰；用户可见工作流要端到端连接；涉及编译、同步、审查、知识流转的变化，需要同步维护 `docs/project-log.md`；不把临时输出、缓存、运行时数据和大模型权重混入源码提交。

完成代码变更前应运行：

```bash
npx tsc --noEmit
npm run build
npm test
fallow
```

## 项目现状

当前项目已经具备 CLI 编译器、多 provider LLM 支持、MCP Server、本地 Web 工作台、桌面 WebUI 入口、Cloudflare 远程 Worker、Obsidian 审查插件、静态 wiki 构建、Pages 部署脚本、搜索评估脚本和大量 Vitest 覆盖。

仍在持续演进的方向包括：更稳定的本地向量搜索和 embedding 服务、更完整的移动端同步体验、更细的个人事实确认和审查流、更清晰的项目工作区/任务池/执行记录联动，以及更完整的公开 wiki 发布体验。

## License

MIT

## Disclaimer

这个项目会处理个人资料、知识库、任务记录和可能包含敏感信息的运行时数据。使用前请确认 `.env`、`.runtime/`、`.secrets/`、本地模型和个人 wiki 内容不会被误提交或公开发布。
