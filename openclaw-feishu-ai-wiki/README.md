# openclaw-feishu-ai-wiki

一个可直接下载部署的飞书 AI 维基服务，专门用来做这几件事：

- 从飞书日记页读取“今日日记”
- 先按块级拆分，再判断 `个人信息 / 混合 / 非个人信息`
- 只把可沉淀的非个人内容写入主题文档、项目文档、人物文档、方法文档
- 在目标句段旁写 `引自：[来源块链接]`
- 在今日日记中为继承内容写 `来源：[已有文档块链接]`
- 维护索引页、时间线和个人根页的每日建议视图

这份目录是独立交付单元。别人拿到仓库后，只进入这个目录就能部署，不需要理解整个宿主仓库。

## 适用场景

- 飞书个人知识库
- AI 维基百科维护
- 日记自动拆分沉淀
- 句段级来源引用，而不是粗糙的页面互链

## 快速开始

### 1. 进入目录

```bash
cd openclaw-feishu-ai-wiki
```

### 2. 安装依赖

```bash
npm install
```

### 3. 安装并登录 `lark-cli`

```bash
npm install -g @larksuite/cli
npx skills add larksuite/cli -y -g
lark-cli config init --new
lark-cli auth login --recommend
```

主维护链路依赖 `lark-cli` 的用户身份。  
如果你要跑“日记 -> AI 维基维护”，这一步是必须的。

### 4. 配置飞书节点

先复制模板：

```bash
copy config\\wiki.config.example.json config\\wiki.config.json
```

然后把下面这些 token 换成你自己的：

- `knowledgeRoots.apta.wikiToken`
- `knowledgeRoots.resource.wikiToken`
- `knowledgeRoots.archive.wikiToken`
- `aiWiki.personalInfoRoot`
- `aiWiki.genericInfoRoot`
- `aiWiki.allPagesIndex`
- `aiWiki.timelinePage`
- `aiWiki.maintenanceGuide`
- `aiWiki.aiIndexRoot`
- `journalInput.journalMemoryRootToken`

### 5. 可选环境变量

先复制模板：

```bash
copy .env.example .env.local
```

如果你还要启用图谱扫描、Base 建表、图谱同步等能力，再填写：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

它们主要用于这些接口：

- `/feishu/knowledge/scan`
- `/feishu/knowledge/bootstrap`
- `/feishu/knowledge/collect`
- `/feishu/knowledge/graph/sync`

如果你只跑 AI 维基维护主链路，可以先不填。

### 6. 启动服务

```bash
npm start
```

默认地址：

```text
http://localhost:3111
```

## 核心接口

### 健康检查

```http
GET /health
```

### 查看部署配置摘要

```http
GET /config
```

### 直接维护一段内容

```http
POST /feishu/knowledge/user/maintain-ai-wiki
Content-Type: application/json

{
  "title": "2026-04-05 日记",
  "content": "今天我因为飞书记录系统这件事有点烦，但我后来想明白了，问题不在模板，而在内容分类和引用机制没有分开设计。",
  "date": "2026-04-05",
  "sourceUrl": "https://www.feishu.cn/wiki/your-journal-node"
}
```

### 从日记根批量维护

```http
POST /feishu/knowledge/user/maintain-ai-wiki/journals
Content-Type: application/json

{
  "nodeTokens": ["your_today_journal_node_token"]
}
```

也可以按时间范围跑：

```json
{
  "since": "2026-04-01",
  "until": "2026-04-06"
}
```

## 结构约定

默认日记输入规则是：

`Resource -> 61 的日记 / Memory -> 日期页 -> 日期页下面的子页面`

真正落地时，由 `journalInput.journalMemoryRootToken` 控制。  
系统只会把这个根下面的日记页当成日记输入，避免误扫普通资源页。

## 当前交付包含什么

- 独立 Node 服务入口
- 飞书 AI 维基维护路由
- 日记块级拆分与分类
- 句段级 `引自 / 来源` 引用
- 索引页、时间线、个人根页维护
- 可选图谱扫描和同步能力
- 单元测试

## 目录结构

```text
openclaw-feishu-ai-wiki/
├─ config/
│  └─ wiki.config.example.json
├─ src/
│  ├─ core/
│  ├─ knowledge/
│  ├─ middleware/
│  ├─ routes/
│  └─ services/
├─ tests/
│  └─ knowledge/
├─ .env.example
├─ package.json
├─ README.md
└─ server.js
```

## 测试

```bash
npm test
```

## 说明

这份交付优先保证三件事：

- 其他 OpenClaw / Codex 用户可以直接下载
- 换成自己的飞书 token 后就能部署
- 句段级来源引用逻辑完整保留

如果后面要把它继续拆成真正独立仓库，也可以直接把这个目录单独迁出去。
