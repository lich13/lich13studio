# lich13studio Migration Notes

## Phase 0 已确认的事实

- 本次盘点基于上游 `main @ e54cfe97ea63149be723cb1281eee2fdc719b132`。
- 当前会话无法直接读取 `~/Documents`，因此工作副本克隆到 `/Users/gosu/build/lich13studio` 继续推进。
- 上游仓库中已经存在大量 `v2 refactor` 标记文件，后续改动会与上游进行中的重构交叉。

## 当前不能一步完成的事项

### 2026-04-13 本轮已完成

- 设置页 `全局记忆 / API 服务器 / 快捷键` 已从前端菜单、路由、导航映射移除。
- 对应 Electron preload bridge 与主进程 IPC 已改为明确报错的 removed feature handler，避免静默调用。
- `ShortcutService`、`ApiServerService` 以及对应设置页源码已删除。
- 设置页新增 wildcard 重定向，旧地址如 `#/settings/memory` 会自动回到 `#/settings/provider`，避免空白死链。
- 迁移版本已提升到 `208`，首启会强制关闭 `globalMemoryEnabled`、关闭 `apiServer.enabled`，并把选择助手旧 `shortcut` 触发模式改回 `selected`。

### 0. 当前运行时已切到 Tauri，但源码仍有 Electron 兼容层

- 当前可测试 mac 包已经是 Tauri bundle，不再依赖 Electron Framework。
- 源码中仍保留 Electron 兼容桥和 legacy build 链，用于承接原始 renderer。
- 本轮会继续删除不再服务 Tauri 主路径的旧发布链、旧 workflow 和无用目录，但不会盲删仍被现有源码编译引用的兼容层。

### 1. 翻译删除不是简单删页面

- 翻译功能穿过 `Router`、`sidebar`、`selection assistant`、`mini window`、`message block`、`llm store`、`migrate`、`i18n`。
- 必须先删入口，再清类型和迁移逻辑，否则编译会断在 `TranslateLanguage` / `translateModel` / `MessageTranslate`。

### 2. 知识库删除是跨层级手术

- 相关代码分布在 renderer、main、apiServer、preload、IpcChannel、aiCore、queue、types。
- `DocProcessSettings` 与 `preprocess` store 和知识库深度耦合，不能只删页面不清主进程。

### 3. assistants 市场与“单助手导入导出”当前耦合在同一套 preset 代码里

- `/store` 页面、精选素材、分组 icon、导入导出弹窗共用 `AssistantPreset` 流程。
- 正确做法是先提取本地单助手导入导出，再删市场页面和精选素材库。

### 4. MCP market 与手动 MCP 管理当前混在同一个设置模块

- `MCPSettings/index.tsx` 同时承载手动 server、builtin、marketplaces、discover providers。
- 正确做法是保留 `servers` 主路径，删除 `marketplaces / NpxSearch / SyncServersPopup / urlschema auto-install`。

### 5. 品牌替换会影响数据兼容

- `~/.cherrystudio`
- `cherrystudio://`
- `cherry-studio.*.zip`
- `metadata.appName === "Cherry Studio"`

这些都需要兼容迁移，而不是直接硬切。

### 6. 模型服务收缩不仅是 UI 删除

- 仅把 provider 列表隐藏掉不够，历史持久化状态会把旧 provider 再带回来。
- 当前已增加 Lite provider 白名单迁移：内置 provider 仅保留 `openai` / `anthropic` / `gemini`，其余内置项在迁移时剔除。
- 自定义 provider 仍然保留，因为它属于 Lite 范围内的“自定义服务商”。

## 强耦合导致暂时无法直接保留或删除的项

| Item | Current state | Temporary decision |
| --- | --- | --- |
| `DocProcessSettings` | 与知识库 preprocess 强耦合 | 先标记 `investigate` |
| 通用 WebDAV 备份 | Lite 明确保留的是 Nutstore WebDAV，不是泛 WebDAV | 先保留底层 transport，UI 后续再定 |
| `agents / channels / skills / tasks` | 上游大模块，但不在 Lite 冻结核心 | Phase 0 只做 `investigate` |
| `notes / files / paintings / minapps / code / openclaw / launchpad` | 不在当前保留清单 | Phase 0 不硬删，避免误伤编译 |
| workspace scope `@cherrystudio/*` | 内部依赖面太大 | 品牌先改用户可见面，scope 后续单独处理 |

## 后续阶段建议

### Phase 1

- 品牌重命名
- 新图标落位
- README / About / Title / Bundle ID / Executable name 更新
- 保持编译不变差

### Phase 2

- 删除 translation
- 删除 knowledge
- 删除 assistants market
- 删除 MCP market / auto-install
- 同步清 IPC / store / i18n / tests

### Phase 3

- 加固 assistant / topic / provider / quick phrase / mcp / backup 主线
- 把单助手导入导出从旧 preset 页面迁到正式助手设置入口

### Phase 4

- 起 Tauri + Rust 最小骨架
- 抽离 assistant / provider / backup / mcp 边界
- 保持 React Web 前端，优先替换后端桥接层

## 编译风险提醒

- `src/renderer/src/store/migrate.ts` 仍然是高风险文件，翻译 / 知识库字段清理时必须同步迁移兼容。
- `src/main/ipc.ts`、`packages/shared/IpcChannel.ts`、`src/preload/index.ts` 是跨层删改的闭环，不能只改其中一层。
- `src/main/apiServer/generated/openapi-spec.json` 需要在重命名或删路由后重生成。

## 当前 Phase 0 输出边界

- 已产出: scope freeze、module map、delete list、rename plan、icon concept、architecture lite、migration notes、图标草稿资源、真实 `src-tauri/` 骨架。
- 未产出: 核心业务的完整 Tauri 迁移版。
- 原因: 当前阶段先把运行时和模块边界立住，再逐步搬迁 assistant / provider / mcp / backup / chat 主线。
