# lich13studio Architecture Lite

## 目标

- 保留单窗口聊天核心
- 保留 assistant / topic / provider / quick phrase / MCP / backup
- 内置 provider 收敛为 `openai` / `anthropic` / `gemini`
- 删除 translation / knowledge / market
- 为后续 `Rust + Tauri + Web Frontend` 迁移准备清晰边界

## 当前已落地骨架

```text
lich13studio/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    build.rs
    capabilities/
      default.json
    src/
      lib.rs
      main.rs
    index.html
    app.css
    app.js
```

- `src-tauri/` 已经是实际可编译的 Rust + Tauri 入口，不再只是文档规划。
- 现有 Electron Lite 仍保留在仓库中，作为功能迁移过渡层；后续按模块逐步从 Electron 迁到 Tauri command。

## 当前上游结构摘要

- 前端: React + Redux + Dexie + Electron preload bridge
- 主进程: Electron IPC + 本地文件系统 + 备份 + MCP + 各类服务
- 数据: renderer store + local DB + userData 目录
- 问题:
  - 能力散在 renderer service、store、ipc、main service 中
  - translation / knowledge / market 跨层耦合严重
  - 产品命名与路径大量硬编码

## Lite 目标结构

```text
lich13studio/
  apps/
    desktop-web/
      src/
        pages/
        components/
        features/
        store/
        services/
    desktop-tauri/
      src-tauri/
        Cargo.toml
        tauri.conf.json
        src/
          main.rs
          commands/
            app.rs
            assistant.rs
            backup.rs
            mcp.rs
            provider.rs
          bridge/
            dto.rs
            error.rs
  crates/
    lich13studio-domain/
    lich13studio-application/
    lich13studio-storage/
    lich13studio-backup/
    lich13studio-mcp/
    lich13studio-models/
```

## 分层边界

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Frontend | 页面、表单、状态展示、输入交互 | 不直接操作文件系统，不写平台路径 |
| Command layer | Tauri command / invoke 接口 | 不承载业务规则 |
| Core application | assistant / topic / provider / mcp / backup 用例编排 | 不依赖 UI，不依赖具体平台 API |
| Storage layer | SQLite、settings、files、migration | 不做业务决策 |
| Backup layer | zip/export/import、WebDAV | 不关心 UI 组件 |
| MCP layer | local stdio / remote HTTP(SSE) / test connectivity / tool listing | 不关心聊天页面布局 |

## 推荐模块映射

| 保留模块 | 当前上游位置 | Lite 新归属 |
| --- | --- | --- |
| Assistant CRUD | `store/assistants.ts`, `hooks/useAssistant.ts`, `services/AssistantService.ts` | `crates/lich13studio-domain::assistant`, `crates/lich13studio-application::assistant_service`, `commands/assistant.rs` |
| Topic / conversation | `hooks/useTopic.ts`, `store/newMessage.ts`, `services/ConversationService.ts` | `domain::conversation`, `application::conversation_service`, `storage::messages` |
| Provider / model service | `store/llm.ts`, `services/ProviderService.ts`, `services/ModelService.ts` | `domain::provider`, `application::provider_service`, `models::*` |
| Quick phrase | `services/QuickPhraseService.ts`, `databases/index.ts` | `domain::quick_phrase`, `storage::quick_phrase_repo` |
| MCP | `main/services/MCPService.ts`, `pages/settings/MCPSettings/*` | `mcp::server_registry`, `mcp::transport_stdio`, `mcp::transport_remote`, `commands/mcp.rs` |
| Backup | `renderer/services/BackupService.ts`, `main/services/BackupManager.ts` | `backup::exporter`, `backup::importer`, `backup::webdav`, `commands/backup.rs` |
| Chat stream | `store/thunk/messageThunk.ts`, `services/ModelMessageService.ts` | `application::chat_runtime`, `models::stream_adapter` |

## 不进入新架构的模块

- Translation
- Knowledge base / RAG / preprocess / rerank
- Assistant market
- MCP market / discover / auto-install

## 前端建议

- 保持 React Web 前端，先不在 Phase 0 重写 UI
- 把 Electron `window.api.*` 访问逐步收口到单一 adapter
- Phase 4 再把 adapter 从 Electron IPC 换成 Tauri invoke
- 允许短期继续使用 Redux；长期可按 feature 切分为更轻的状态层

## 命令层建议

### `commands/app.rs`

- app info
- path resolution
- relaunch / reset
- log level / diagnostics

### `commands/assistant.rs`

- assistant CRUD
- assistant import / export
- topic CRUD
- default model override

### `commands/provider.rs`

- provider CRUD
- model list CRUD
- health check
- global default model

### `commands/mcp.rs`

- add / update / remove server
- enable / disable
- connectivity test
- bind/unbind assistant
- list tools / prompts / resources

### `commands/backup.rs`

- export local backup
- import local backup
- backup / restore WebDAV

## 存储建议

- assistant / topic / message / quick phrase / provider / mcp config 统一落 SQLite
- 大文件与备份包留文件系统
- settings 分离为稳定 schema，不再把市场/翻译/知识库状态混在主配置里
- 提前设计迁移表，把旧 `Cherry Studio` userData 导入到新 `lich13studio` 目录

## 迁移策略

### Step 1

- 先在现有 React/Electron 上完成范围裁剪与品牌重命名

### Step 2

- 提炼 domain model:
  - Assistant
  - Topic
  - Message
  - Provider
  - ModelSpec
  - QuickPhrase
  - McpServer
  - BackupTarget

### Step 3

- 把主进程服务逻辑迁到 Rust crate：
  - backup
  - mcp
  - path / config
  - provider health check

### Step 4

- 再把 renderer 通过 Tauri commands 接到新后端
- 优先迁移 `app / provider / mcp / backup` 四组 command，再推进 chat runtime

## 最小可运行骨架建议

- 单窗口
- 一个 chat page
- 一个 settings page
- 五个 command group:
  - `assistant`
  - `provider`
  - `mcp`
  - `backup`
  - `app`
- 一个 SQLite 文件
- 一个统一 `AppPaths` 结构管理：
  - config dir
  - data dir
  - logs dir
  - temp dir
  - backups dir

## Phase 4 之前不要做的事

- 不要把上游全部 Electron API 等比例搬进 Tauri
- 不要先迁 translation / knowledge / market 再删
- 不要把 UI 重写与业务重写绑定成一个大提交
- 不要在 domain 层保留 `Cherry Studio` 命名
