# 飞书双库知识系统 V1

## 已实现能力

- 固定三类个人知识库根节点：
  - `Area/Project/Task/Action`
  - `Resource`
  - `Archive`
- `Resource`、`Archive` 支持递归扫描所有子节点
- `Area/Project/Task/Action` 默认只作为上下文锚点，不递归摄入
- 可以读取 wiki 节点对应的 `docx raw_content`
- 可以读取 `docx` 的块级后代，用于后续块级双链
- 可以生成图谱底层 schema：
  - `Nodes`
  - `Edges`
  - `Sources`
  - `Mappings`
  - `IngestionJobs`
  - `Rules`
- 可以自动创建多维表底座
- 可以把 `Nodes / Edges / Sources / Mappings` 写入多维表
- 可以生成 AI 知识页 markdown 模板

## 新增接口

### 读取配置
- `GET /feishu/knowledge/roots`
- `GET /feishu/knowledge/schema/plan`

### 扫描与采集
- `POST /feishu/knowledge/scan`
- `POST /feishu/knowledge/collect`

### 图谱与 AI 页
- `POST /feishu/knowledge/bootstrap`
- `POST /feishu/knowledge/artifacts`
- `POST /feishu/knowledge/graph/sync`
- `POST /feishu/knowledge/markdown`
- `POST /feishu/knowledge/user/import-node`

## 推荐调用顺序

1. 调 `GET /feishu/knowledge/roots` 确认当前根配置
2. 调 `POST /feishu/knowledge/bootstrap` 创建图谱多维表
3. 调 `POST /feishu/knowledge/scan` 获取递归节点清单
4. 对目标节点调 `POST /feishu/knowledge/collect` 拉正文和块
5. 调 `POST /feishu/knowledge/artifacts` 生成 `Nodes / Edges / Sources / Mappings`
6. 调 `POST /feishu/knowledge/graph/sync` 把图谱写入多维表
7. 调 `POST /feishu/knowledge/markdown` 生成 AI 知识页内容
8. 或直接调 `POST /feishu/knowledge/user/import-node` 走用户身份闭环导入并发布 AI 页

## 当前边界

- 还没有做个人库页面自动回填“相关 AI 页面”区块
- 已支持基于 `lark-cli` 的用户身份单页导入并创建 AI 整理页，但还没有做整棵 `Resource/Archive` 子树批量自动发布
- 还没有做消息/文件白名单自动采集
- 基于 `lark-cli` 的用户身份导入已支持按唯一键幂等 upsert；旧的应用身份 `syncArtifactsToGraphStore` 仍然是直接写入

## 代码位置

- `src/knowledge/config.js`
- `src/knowledge/graph.js`
- `src/services/knowledge.js`
- `src/services/knowledgeCli.js`
- `src/routes/knowledge.js`
