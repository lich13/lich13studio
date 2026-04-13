# lich13studio Delete List

## 删除策略

- 先删除入口，再删除组件，再删除状态，再删除 IPC / API / 数据结构。
- 任何 `remove` 之前，都要先把仍需保留的能力迁走。
- 删除时同步处理路由、侧边栏、设置页、输入框工具、消息工具、store、i18n、测试。

## 1. 翻译相关删除清单

### 可直接删除的页面 / 组件

- `src/renderer/src/pages/translate/TranslatePage.tsx`
- `src/renderer/src/pages/translate/TranslateHistory.tsx`
- `src/renderer/src/pages/translate/TranslateSettings.tsx`
- `src/renderer/src/pages/settings/TranslateSettingsPopup/TranslateSettingsPopup.tsx`
- `src/renderer/src/pages/settings/TranslateSettingsPopup/TranslatePromptSettings.tsx`
- `src/renderer/src/pages/settings/TranslateSettingsPopup/CustomLanguageModal.tsx`
- `src/renderer/src/pages/settings/TranslateSettingsPopup/CustomLanguageSettings.tsx`
- `src/renderer/src/windows/mini/translate/TranslateWindow.tsx`
- `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx`
- `src/renderer/src/components/TranslateButton.tsx`
- `src/renderer/src/pages/home/Messages/MessageTranslate.tsx`

### 需要配套清理的状态 / 服务 / 类型

- `src/renderer/src/store/translate.ts`
- `src/renderer/src/services/TranslateService.ts`
- `src/renderer/src/hooks/useTranslate.ts`
- `src/renderer/src/config/translate.ts`
- `src/renderer/src/utils/translate.ts`
- `src/renderer/src/store/llm.ts`
- `src/renderer/src/store/migrate.ts`
- `src/renderer/src/hooks/useMessageOperations.ts`
- `src/renderer/src/store/selectionStore.ts`
- `src/renderer/src/types/index.ts`
- `src/renderer/src/i18n/locales/*.json`

### 需要同步改的入口

- `src/renderer/src/Router.tsx`
- `src/renderer/src/config/sidebar.ts`
- `src/renderer/src/i18n/label.ts`

### 删除后需要补的替代逻辑

- 选择助手只保留通用动作，不再出现翻译专属动作。
- 全局默认模型与 assistant 默认模型继续生效，不再保留 `translateModel`。
- 聊天消息只保留原消息与正常工具块，不再生成翻译块。
- 若某些地方仅想做“解释文本”，统一通过正常 chat assistant 完成，而不是独立翻译子系统。

## 2. 知识库相关删除清单

### 可直接删除的页面 / 组件

- `src/renderer/src/pages/knowledge/**/*`
- `src/renderer/src/components/Popups/SaveToKnowledgePopup.tsx`
- `src/renderer/src/pages/settings/AssistantSettings/AssistantKnowledgeBaseSettings.tsx`
- `src/renderer/src/pages/home/Inputbar/KnowledgeBaseInput.tsx`
- `src/renderer/src/pages/home/Inputbar/tools/knowledgeBaseTool.tsx`
- `src/renderer/src/pages/home/Inputbar/tools/components/KnowledgeBaseButton.tsx`
- `src/renderer/src/pages/home/Messages/Tools/MessageKnowledgeSearch.tsx`

### 可直接删除的状态 / 服务 / Hook

- `src/renderer/src/store/knowledge.ts`
- `src/renderer/src/store/thunk/knowledgeThunk.ts`
- `src/renderer/src/services/KnowledgeService.ts`
- `src/renderer/src/hooks/useKnowledge.ts`
- `src/renderer/src/hooks/useKnowledgeBaseForm.ts`
- `src/renderer/src/hooks/useKnowledgeFiles.tsx`
- `src/renderer/src/queue/KnowledgeQueue.ts`
- `src/renderer/src/utils/knowledge.ts`
- `src/renderer/src/types/knowledge.ts`
- `src/renderer/src/aiCore/tools/KnowledgeSearchTool.ts`

### 可直接删除的主进程 / API / IPC

- `src/main/services/KnowledgeService.ts`
- `src/main/knowledge/**/*`
- `src/main/apiServer/routes/knowledge/**/*`
- `src/main/utils/knowledge.ts`

### 需要配套改的桥接层

- `packages/shared/IpcChannel.ts`
- `src/preload/index.ts`
- `src/main/ipc.ts`
- `src/renderer/src/Router.tsx`
- `src/renderer/src/config/sidebar.ts`

### 删除后需要补的替代逻辑

- 上传图片或文档入口继续保留，但只作为聊天附件，不再进入知识库索引链。
- 若文档预处理仅服务知识库，短期内隐藏对应设置并在 `docs/migration-notes.md` 标注 TODO。
- assistant 上历史遗留的 `knowledge_bases` 字段在迁移时忽略或清空，不能导致运行时报错。
- WebSearch、MCP、模型切换、快捷短语继续保留，不能因为删知识库连带下线。

## 3. market 相关删除清单

### assistants market

#### 可直接删除

- `src/renderer/src/pages/store/assistants/presets/AssistantPresetsPage.tsx`
- `src/renderer/src/pages/store/assistants/presets/assistantPresetGroupTranslations.ts`
- `resources/data/agents-en.json`
- `resources/data/agents-zh.json`

#### 先改后删

- `src/renderer/src/pages/store/assistants/presets/index.ts`
- `src/renderer/src/pages/store/assistants/presets/components/AssistantPresetCard.tsx`
- `src/renderer/src/pages/store/assistants/presets/components/AddAssistantPresetPopup.tsx`
- `src/renderer/src/pages/store/assistants/presets/components/ImportAssistantPresetPopup.tsx`
- `src/renderer/src/pages/store/assistants/presets/components/ManageAssistantPresetsPopup.tsx`
- `src/renderer/src/hooks/useAssistantPresets.ts`
- `src/renderer/src/store/assistants.ts`

#### 替代逻辑

- 把“单个助手导入 / 导出”迁到 `AssistantSettings` 或助手三点菜单。
- 不再保留精选、分类、在线推荐、市场分页。
- 如果仍沿用 preset JSON 结构，只保留本地文件导入 / 导出，不保留市场列表。

### MCP market / discover / auto-install

#### 可直接删除

- `src/renderer/src/pages/settings/MCPSettings/McpMarketList.tsx`
- `src/renderer/src/pages/settings/MCPSettings/SyncServersPopup.tsx`
- `src/renderer/src/pages/settings/MCPSettings/NpxSearch.tsx`
- `src/renderer/src/pages/settings/MCPSettings/providers/302ai.ts`
- `src/renderer/src/pages/settings/MCPSettings/providers/bailian.ts`
- `src/renderer/src/pages/settings/MCPSettings/providers/lanyun.ts`
- `src/renderer/src/pages/settings/MCPSettings/providers/mcprouter.ts`
- `src/renderer/src/pages/settings/MCPSettings/providers/modelscope.ts`
- `src/renderer/src/pages/settings/MCPSettings/providers/tokenflux.ts`
- `src/main/services/urlschema/mcp-install.ts`

#### 先改后删

- `src/renderer/src/pages/settings/MCPSettings/index.tsx`
- `src/renderer/src/store/mcp.ts`
- `src/main/services/MCPService.ts`
- `src/main/ipc.ts`
- `packages/shared/IpcChannel.ts`
- `src/preload/index.ts`
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/NavigateTool.tsx`

#### 替代逻辑

- 保留 `AddMcpServerModal` + `McpServersList` + `McpSettings` 作为唯一 MCP 配置路径。
- 手动输入 `command/args/env` 或远程 URL，即可添加本地 / 远程 MCP server。
- 保留连接测试、启用禁用、重启、绑定到 assistant。
- 如需保留部分内置 MCP server，只保留“无需在线发现 / 不自动安装”的离线项。

## 4. 删除动作的统一扫尾清单

- 路由: `src/renderer/src/Router.tsx`
- 侧边栏: `src/renderer/src/config/sidebar.ts`
- 设置页菜单: `src/renderer/src/pages/settings/SettingsPage.tsx`
- 输入框工具注册: `src/renderer/src/pages/home/Inputbar/tools/index.ts`
- store 汇总: `src/renderer/src/store/index.ts`
- IPC 常量: `packages/shared/IpcChannel.ts`
- preload bridge: `src/preload/index.ts`
- 主进程 handler: `src/main/ipc.ts`
- 迁移脚本: `src/renderer/src/store/migrate.ts`
- i18n: `src/renderer/src/i18n/label.ts`, `src/renderer/src/i18n/locales/*.json`
- 相关测试: `src/renderer/src/utils/__tests__/topicKnowledge.test.ts`, `src/renderer/src/store/thunk/__tests__/knowledgeThunk.test.ts`

## 5. 本轮已落地删除清单

### 设置页全局记忆

- 已删除设置入口、设置路由、助手记忆子页入口
- 已删除文件:
  - `src/renderer/src/pages/settings/AssistantSettings/AssistantMemorySettings.tsx`
  - `src/renderer/src/pages/settings/MemorySettings/*`
- 已切断初始化:
  - `src/renderer/src/hooks/useAppInit.ts`
  - `src/renderer/src/store/migrate.ts`
- 已切断后端桥接:
  - `src/preload/index.ts`
  - `src/main/ipc.ts`

### 设置页 API 服务器

- 已删除设置入口、设置路由、消息导航映射
- 已删除文件:
  - `src/renderer/src/pages/settings/ToolSettings/ApiServerSettings/*`
  - `src/main/services/ApiServerService.ts`
- 已停止后台启动与 IPC 注册:
  - `src/main/index.ts`
  - `src/main/ipc.ts`
  - `src/preload/index.ts`

### 设置页快捷键

- 已删除设置入口、设置路由、相关导航映射
- 已删除文件:
  - `src/renderer/src/pages/settings/ShortcutSettings.tsx`
  - `src/main/services/ShortcutService.ts`
- 已移除划词助手中的快捷键触发入口，并将旧 `shortcut` 触发模式迁回 `selected`
- 已切断后端桥接:
  - `src/preload/index.ts`
  - `src/main/ipc.ts`
