# 同步检测前后端联动执行记录

日期：2026-05-04

## 目标

修复“前端已经配置同步文件夹，但点击同步时后端新源料检测没有纳入该文件夹”的问题。正确方向是配置驱动扫描，而不是后端硬编码某个目录。

## 执行记录

- 2026-05-04：用户指出当前修复方向错误，不能写死 `raw/个人信息`，应以后端实时读取前端同步文件夹配置为准。
- 2026-05-04：创建本执行记录。后续每个关键修改、验证和未完成项都记录在这里。
- 2026-05-04：撤回刚才新增的 `personal` 硬编码 intake 类型，避免继续沿用错误方向。
- 2026-05-04：梳理发现前端设置页会保存 `/api/sync/config`，服务端会写入 `sync-compile-config.json.source_folders`，但 `/api/intake/scan` 没有读取这份配置。
- 2026-05-04：修改 `/api/intake/scan`，读取 `source_folders` 并传给 intake 扫描；扫描服务新增通用 `source` 类型，来源标签取配置文件夹名。
- 2026-05-04：修改同步写入 manifest 的元数据，非内置队列的配置文件夹写为 `source_kind: "source"`，`source_channel` 为文件夹名。
- 2026-05-04：补充测试方向：scan 接口、scan 服务、前端弹窗、manifest 元数据都覆盖配置驱动同步源。
- 2026-05-04：移除任务计划页底部“领域与项目推进”roadmap 展示和中间分隔条，布局改为 AI 智能排期助手占满主区域。
- 2026-05-04：聚焦验证通过：`web-intake-summary`、`web-intake-route`、`web-intake-sync`、`intake-manifest` 测试通过；`rtk tsc --noEmit` 无类型错误。
- 2026-05-04：更新任务计划页测试，去掉旧 roadmap / 分割条契约，改为验证 AI 智能排期助手主体展开且旧区域不渲染。
- 2026-05-04：完整验证通过：`rtk test npm test`、`rtk tsc --noEmit`、`rtk err npm run build`、`rtk err fallow` 均通过。全量测试首次出现一次 `lint-autofix-orchestrator` 并发隔离型失败，单测通过，复跑全量通过。

## 当前待办

- 后续 UI 大改仍需继续遵守本次规则：前端新增入口或选择器时，必须明确后端读取哪份配置、调用哪个接口、数据最终流到哪里。
