# lich13studio Module Map

## Scan summary

- Upstream baseline: `main @ e54cfe97ea63149be723cb1281eee2fdc719b132`
- Scope: change-driving paths only
- Legend:
  - `keep`: Lite 版明确保留
  - `remove`: Lite 版明确删除
  - `refactor`: 能力保留，但实现/入口/命名/状态需要拆分或瘦身
  - `investigate`: 当前不在冻结核心里，后续判断是否裁剪

## assistant

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/store/assistants.ts` | `refactor` | 核心 assistant/topic 状态保留，但 `presets` 市场态需要拆出 |
| `src/renderer/src/services/AssistantService.ts` | `keep` | 默认助手、默认话题、默认模型覆盖逻辑都在这里 |
| `src/renderer/src/hooks/useAssistant.ts` | `keep` | assistant CRUD 入口 |
| `src/renderer/src/pages/settings/AssistantSettings/index.tsx` | `keep` | 助手设置页主入口 |
| `src/renderer/src/pages/home/Tabs/components/AssistantList.tsx` | `keep` | 助手列表 |
| `src/renderer/src/pages/home/components/AssistantsDrawer.tsx` | `keep` | 单窗口助手抽屉 |
| `src/renderer/src/pages/home/components/ChatNavBar/Tools/SettingsTab/AssistantSettingsTab.tsx` | `keep` | 聊天内助手设置页签 |
| `src/renderer/src/pages/store/assistants/presets/AssistantPresetsPage.tsx` | `remove` | `/store` 是市场化入口，不属于 Lite 保留面 |
| `src/renderer/src/pages/store/assistants/presets/components/ImportAssistantPresetPopup.tsx` | `refactor` | 复用为“单个助手导入”对话框 |
| `src/renderer/src/pages/store/assistants/presets/components/ManageAssistantPresetsPopup.tsx` | `refactor` | 复用为“单个助手导出 / 管理”而不是市场管理 |
| `src/renderer/src/pages/store/assistants/presets/components/AddAssistantPresetPopup.tsx` | `refactor` | 可改造成“从当前助手导出模板” |
| `src/renderer/src/hooks/useAssistantPresets.ts` | `refactor` | 从“预设市场”收敛为“单助手导入导出” |
| `resources/data/agents-en.json` | `remove` | 上游内置精选助手库，本质是市场素材 |
| `resources/data/agents-zh.json` | `remove` | 同上 |
| `resources/builtin-agents/cherry-assistant/agent.json` | `investigate` | 保留内置支持助手或改名为 lich13studio 内置助手 |

## topic / conversation

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/pages/home/HomePage.tsx` | `keep` | Lite 单窗口主工作区 |
| `src/renderer/src/pages/home/Chat.tsx` | `keep` | 聊天主容器 |
| `src/renderer/src/pages/home/Tabs/components/Topics.tsx` | `keep` | 话题列表 |
| `src/renderer/src/hooks/useTopic.ts` | `keep` | 当前话题选择 / 重命名 / 更新 |
| `src/renderer/src/store/newMessage.ts` | `keep` | 话题级消息索引与清空能力 |
| `src/renderer/src/store/thunk/messageThunk.ts` | `keep` | 流式消息、清上下文、重试、切模型都依赖这里 |
| `src/renderer/src/services/ConversationService.ts` | `keep` | 会话组装 |
| `src/renderer/src/services/MessagesService.ts` | `keep` | 消息创建与转换 |
| `src/renderer/src/pages/history/components/TopicsHistory.tsx` | `keep` | 历史话题浏览 |
| `src/renderer/src/pages/history/components/TopicMessages.tsx` | `keep` | 历史消息查看 |
| `src/renderer/src/pages/home/Inputbar/tools/newTopicTool.tsx` | `keep` | 新话题 |
| `src/renderer/src/pages/home/Inputbar/tools/clearTopicTool.tsx` | `keep` | 清空当前话题消息 |
| `src/renderer/src/pages/home/Messages/MessageTokens.tsx` | `keep` | Token 预估展示 |
| `src/renderer/src/services/TokenService.ts` | `keep` | Token 统计服务 |

## provider / model service

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/store/llm.ts` | `refactor` | 保留全局默认模型 / 快捷模型，删除 `translateModel` |
| `src/renderer/src/services/ProviderService.ts` | `keep` | provider CRUD 主服务 |
| `src/renderer/src/services/ModelService.ts` | `keep` | 模型列表与管理 |
| `src/renderer/src/pages/settings/ProviderSettings/index.ts` | `keep` | provider 设置入口 |
| `src/renderer/src/pages/settings/ProviderSettings/ProviderList.tsx` | `keep` | provider 列表 |
| `src/renderer/src/pages/settings/ProviderSettings/ModelList/ManageModelsList.tsx` | `keep` | 模型列表管理 |
| `src/renderer/src/pages/settings/ProviderSettings/ModelList/HealthCheckPopup.tsx` | `keep` | 连通性检查 |
| `src/renderer/src/pages/settings/ModelSettings/ModelSettings.tsx` | `keep` | 全局默认模型设置 |
| `src/renderer/src/pages/settings/ModelSettings/DefaultAssistantSettings.tsx` | `keep` | assistant 默认模型覆盖全局默认模型 |
| `src/renderer/src/pages/home/components/SelectModelButton.tsx` | `keep` | 聊天区模型切换 |
| `src/renderer/src/config/models/default.ts` | `keep` | 默认模型配置 |
| `src/renderer/src/config/providers.ts` | `refactor` | 服务商文案、官方链接、品牌触点需要替换 |
| `src/main/apiServer/routes/models.ts` | `keep` | 对外模型接口 |
| `packages/aiCore/src/core/providers/**/*` | `keep` | 后续 Rust 迁移前的 provider 适配核心 |

## quick phrase

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/pages/settings/QuickPhraseSettings.tsx` | `keep` | 快捷短语设置页 |
| `src/renderer/src/services/QuickPhraseService.ts` | `keep` | CRUD 主服务 |
| `src/renderer/src/databases/index.ts` | `keep` | `quick_phrases` 表保留 |
| `src/renderer/src/pages/home/Inputbar/tools/quickPhrasesTool.tsx` | `keep` | 聊天输入框工具 |
| `src/renderer/src/pages/home/Inputbar/tools/components/QuickPhrasesButton.tsx` | `keep` | 插入入口 |
| `src/renderer/src/types/index.ts` | `refactor` | `QuickPhrase` 与变量插值类型继续保留 |

## mcp

| Path | Status | Note |
| --- | --- | --- |
| `src/main/services/MCPService.ts` | `refactor` | 保留手动添加 / 启停 / 测试 / 绑定助手，去掉 auto-install 市场流程 |
| `src/renderer/src/store/mcp.ts` | `refactor` | 去掉 `mcpAutoInstall` 内置项与市场安装元数据 |
| `src/renderer/src/pages/settings/MCPSettings/AddMcpServerModal.tsx` | `keep` | 手动添加 MCP 核心入口 |
| `src/renderer/src/pages/settings/MCPSettings/McpServersList.tsx` | `keep` | MCP server 列表 |
| `src/renderer/src/pages/settings/MCPSettings/McpSettings.tsx` | `keep` | 单个 server 配置 / 测试 |
| `src/renderer/src/pages/settings/MCPSettings/McpServerCard.tsx` | `keep` | 单卡片展示 |
| `src/renderer/src/pages/settings/MCPSettings/BuiltinMCPServerList.tsx` | `refactor` | 如保留，只保留离线 / 手动配置友好的内置 server |
| `src/renderer/src/pages/settings/MCPSettings/McpPrompt.tsx` | `keep` | MCP prompt 读取 |
| `src/renderer/src/pages/settings/MCPSettings/McpResource.tsx` | `keep` | MCP resource 读取 |
| `src/renderer/src/pages/settings/MCPSettings/index.tsx` | `refactor` | 删除 `marketplaces` / `discover` 菜单，保留 servers 主线 |
| `src/renderer/src/pages/settings/MCPSettings/NpxSearch.tsx` | `remove` | 依赖在线 npm 搜索与安装，不符合 Lite 范围 |
| `src/renderer/src/pages/settings/MCPSettings/McpMarketList.tsx` | `remove` | MCP market 页面 |
| `src/renderer/src/pages/settings/MCPSettings/SyncServersPopup.tsx` | `remove` | 平台发现 / 同步流程 |
| `src/renderer/src/pages/settings/MCPSettings/providers/config.ts` | `remove` | 在线平台发现配置 |
| `src/renderer/src/pages/settings/MCPSettings/providers/302ai.ts` | `remove` | 在线发现 provider |
| `src/renderer/src/pages/settings/MCPSettings/providers/bailian.ts` | `remove` | 在线发现 provider |
| `src/renderer/src/pages/settings/MCPSettings/providers/lanyun.ts` | `remove` | 在线发现 provider |
| `src/renderer/src/pages/settings/MCPSettings/providers/mcprouter.ts` | `remove` | 在线发现 provider |
| `src/renderer/src/pages/settings/MCPSettings/providers/modelscope.ts` | `remove` | 在线发现 provider |
| `src/renderer/src/pages/settings/MCPSettings/providers/tokenflux.ts` | `remove` | 在线发现 provider |
| `src/main/services/urlschema/mcp-install.ts` | `remove` | deeplink 自动安装 MCP 流程 |
| `src/renderer/src/pages/home/Inputbar/tools/mcpToolsTool.tsx` | `keep` | 聊天区 MCP 工具入口保留 |
| `src/renderer/src/pages/home/Inputbar/tools/components/MCPToolsButton.tsx` | `keep` | 聊天区 MCP 按钮保留 |
| `src/main/ipc.ts` | `refactor` | 清除 install/discover 相关 handler，保留 CRUD / test / call |
| `packages/shared/IpcChannel.ts` | `refactor` | 同上 |
| `src/preload/index.ts` | `refactor` | 同上 |
| `src/main/mcpServers/hub/**/*` | `investigate` | Hub 模式是否保留取决于 Lite 是否继续保留自动聚合模式 |

## backup

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/pages/settings/DataSettings/DataSettings.tsx` | `refactor` | 收敛为本地 / Nutstore / S3 主线，第三方导入页单独评估 |
| `src/renderer/src/pages/settings/DataSettings/LocalBackupSettings.tsx` | `keep` | 本地备份与恢复 |
| `src/renderer/src/pages/settings/DataSettings/NutstoreSettings.tsx` | `keep` | 坚果云 WebDAV |
| `src/renderer/src/pages/settings/DataSettings/S3Settings.tsx` | `keep` | S3 兼容存储 |
| `src/renderer/src/pages/settings/DataSettings/WebDavSettings.tsx` | `investigate` | 通用 WebDAV 当前不是 Lite 明确保留项 |
| `src/renderer/src/services/BackupService.ts` | `keep` | 本地 / WebDAV / S3 备份总入口 |
| `src/renderer/src/services/NutstoreService.ts` | `keep` | 坚果云适配 |
| `src/renderer/src/store/backup.ts` | `keep` | 备份同步状态 |
| `src/renderer/src/store/nutstore.ts` | `keep` | Nutstore 状态 |
| `src/renderer/src/store/settings.ts` | `refactor` | 精简备份配置字段，保留本地 / Nutstore / S3 |
| `src/main/services/BackupManager.ts` | `keep` | 主进程备份执行器 |
| `src/main/services/WebDav.ts` | `keep` | Nutstore 仍依赖 WebDAV transport |
| `src/main/services/S3Storage.ts` | `keep` | S3 兼容存储 |
| `src/main/services/NutstoreService.ts` | `keep` | Nutstore SSO / 解密 |

## translation

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/Router.tsx` | `refactor` | 删除 `/translate` 路由 |
| `src/renderer/src/config/sidebar.ts` | `refactor` | 删除侧边栏翻译图标 |
| `src/renderer/src/pages/translate/TranslatePage.tsx` | `remove` | 翻译主页 |
| `src/renderer/src/pages/translate/TranslateHistory.tsx` | `remove` | 翻译历史 |
| `src/renderer/src/pages/translate/TranslateSettings.tsx` | `remove` | 翻译页设置 |
| `src/renderer/src/pages/settings/TranslateSettingsPopup/TranslateSettingsPopup.tsx` | `remove` | 翻译设置弹窗 |
| `src/renderer/src/pages/settings/TranslateSettingsPopup/TranslatePromptSettings.tsx` | `remove` | 翻译 prompt 设置 |
| `src/renderer/src/pages/settings/TranslateSettingsPopup/CustomLanguageModal.tsx` | `remove` | 翻译语言自定义 |
| `src/renderer/src/pages/settings/TranslateSettingsPopup/CustomLanguageSettings.tsx` | `remove` | 翻译语言设置 |
| `src/renderer/src/windows/mini/translate/TranslateWindow.tsx` | `remove` | Mini window 翻译窗口 |
| `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx` | `remove` | 划词翻译动作 |
| `src/renderer/src/components/TranslateButton.tsx` | `remove` | 独立翻译按钮 |
| `src/renderer/src/pages/home/Messages/MessageTranslate.tsx` | `remove` | 消息级翻译面板 |
| `src/renderer/src/store/translate.ts` | `remove` | 翻译状态 |
| `src/renderer/src/services/TranslateService.ts` | `remove` | 翻译服务 |
| `src/renderer/src/hooks/useTranslate.ts` | `remove` | 翻译 hook |
| `src/renderer/src/config/translate.ts` | `remove` | 翻译语言配置 |
| `src/renderer/src/utils/translate.ts` | `remove` | 翻译工具函数 |
| `src/renderer/src/store/llm.ts` | `refactor` | 删除 `translateModel` |
| `src/renderer/src/hooks/useMessageOperations.ts` | `refactor` | 去掉翻译块初始化与更新 |
| `src/renderer/src/store/selectionStore.ts` | `refactor` | 去掉 `translate` 内建动作 |
| `src/renderer/src/store/migrate.ts` | `refactor` | 清理翻译迁移逻辑 |
| `src/renderer/src/types/index.ts` | `refactor` | 移除 TranslateAssistant / TranslateLanguage 等类型 |
| `src/renderer/src/i18n/locales/*.json` | `refactor` | 清理翻译菜单与设置文案 |

## knowledge base

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/Router.tsx` | `refactor` | 删除 `/knowledge` 路由 |
| `src/renderer/src/config/sidebar.ts` | `refactor` | 删除侧边栏知识库图标 |
| `src/renderer/src/pages/knowledge/**/*` | `remove` | 知识库 UI 整体删除 |
| `src/renderer/src/components/Popups/SaveToKnowledgePopup.tsx` | `remove` | 保存到知识库弹窗 |
| `src/renderer/src/pages/settings/AssistantSettings/AssistantKnowledgeBaseSettings.tsx` | `remove` | 助手绑定知识库设置 |
| `src/renderer/src/pages/home/Inputbar/KnowledgeBaseInput.tsx` | `remove` | 输入框知识库输入部件 |
| `src/renderer/src/pages/home/Inputbar/tools/knowledgeBaseTool.tsx` | `remove` | 输入框知识库工具 |
| `src/renderer/src/pages/home/Inputbar/tools/components/KnowledgeBaseButton.tsx` | `remove` | 输入框知识库按钮 |
| `src/renderer/src/pages/home/Messages/Tools/MessageKnowledgeSearch.tsx` | `remove` | 消息内知识搜索工具 |
| `src/renderer/src/store/knowledge.ts` | `remove` | 知识库状态 |
| `src/renderer/src/store/thunk/knowledgeThunk.ts` | `remove` | 知识库 thunk |
| `src/renderer/src/services/KnowledgeService.ts` | `remove` | renderer 知识库服务 |
| `src/renderer/src/hooks/useKnowledge.ts` | `remove` | 知识库 hook |
| `src/renderer/src/hooks/useKnowledgeBaseForm.ts` | `remove` | 知识库表单 hook |
| `src/renderer/src/hooks/useKnowledgeFiles.tsx` | `remove` | 知识库文件 hook |
| `src/renderer/src/queue/KnowledgeQueue.ts` | `remove` | 知识库异步队列 |
| `src/renderer/src/utils/knowledge.ts` | `remove` | 知识库工具 |
| `src/renderer/src/types/knowledge.ts` | `remove` | 知识库类型 |
| `src/renderer/src/aiCore/tools/KnowledgeSearchTool.ts` | `remove` | 知识检索 AI tool |
| `src/main/services/KnowledgeService.ts` | `remove` | 主进程知识库主服务 |
| `src/main/knowledge/**/*` | `remove` | 向量化 / preprocess / rerank 全链路 |
| `src/main/apiServer/routes/knowledge/**/*` | `remove` | API 层知识库路由 |
| `src/main/utils/knowledge.ts` | `remove` | 主进程知识库辅助工具 |
| `packages/shared/IpcChannel.ts` | `refactor` | 删除 KnowledgeBase IPC |
| `src/preload/index.ts` | `refactor` | 删除 knowledge bridge |
| `src/main/ipc.ts` | `refactor` | 删除 knowledge handlers |
| `src/renderer/src/pages/settings/DocProcessSettings/**/*` | `investigate` | 与知识库文档预处理强耦合，需判断整体下线还是拆分为聊天附件能力 |
| `src/renderer/src/store/preprocess.ts` | `investigate` | 同上 |

## market

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/Router.tsx` | `refactor` | 删除 `/store` |
| `src/renderer/src/config/sidebar.ts` | `refactor` | 删除 `store` 图标 |
| `src/renderer/src/pages/store/assistants/presets/AssistantPresetsPage.tsx` | `remove` | assistants 市场主入口 |
| `src/renderer/src/pages/store/assistants/presets/index.ts` | `refactor` | 保留导入导出工具时需要拆分加载逻辑 |
| `src/renderer/src/pages/store/assistants/presets/components/AssistantPresetCard.tsx` | `refactor` | 去掉精选 / 分类 / 市场展示，仅保留导入导出动作 |
| `src/renderer/src/pages/store/assistants/presets/components/AssistantPresetGroupIcon.tsx` | `remove` | 仅服务市场分组 |
| `src/renderer/src/pages/store/assistants/presets/assistantPresetGroupTranslations.ts` | `remove` | 仅服务市场分组 |
| `resources/data/agents-en.json` | `remove` | 精选助手素材 |
| `resources/data/agents-zh.json` | `remove` | 精选助手素材 |
| `src/renderer/src/pages/settings/MCPSettings/McpMarketList.tsx` | `remove` | MCP market |
| `src/renderer/src/pages/settings/MCPSettings/SyncServersPopup.tsx` | `remove` | MCP 平台发现 |
| `src/renderer/src/pages/settings/MCPSettings/NpxSearch.tsx` | `remove` | MCP 自动安装搜索 |
| `src/main/services/urlschema/mcp-install.ts` | `remove` | URL Schema MCP 自动安装 |
| `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/NavigateTool.tsx` | `refactor` | 删除 MCP market / install 的导航标签 |

## branding / product name / icon

| Path | Status | Note |
| --- | --- | --- |
| `package.json` | `refactor` | `name` / `desktopName` / homepage 等 |
| `electron-builder.yml` | `refactor` | `appId` / `productName` / executable / protocol / artifact name |
| `packages/shared/config/constant.ts` | `refactor` | `HOME_CHERRY_DIR` / `APP_NAME` / redirect URI / update feed |
| `src/renderer/src/config/env.ts` | `refactor` | 渲染层应用名常量 |
| `src/renderer/index.html` | `refactor` | 页面 title |
| `src/renderer/selectionAction.html` | `refactor` | 划词窗口 title |
| `build/icon.icns` | `refactor` | mac 主图标 |
| `build/icon.ico` | `refactor` | Windows 主图标 |
| `build/icon.png` | `refactor` | 通用主图标 |
| `build/icons/*` | `refactor` | 多尺寸图标 |
| `build/tray_icon.png` | `refactor` | 托盘图标 |
| `build/tray_icon_dark.png` | `refactor` | 深色托盘图标 |
| `build/tray_icon_light.png` | `refactor` | 浅色托盘图标 |
| `README.md` | `refactor` | 产品名、截图、文案、链接 |
| `resources/cherry-studio/privacy-en.html` | `refactor` | 隐私文案与产品名 |
| `src/main/utils/init.ts` | `refactor` | `~/.cherrystudio`、portable 名、appimage 名 |
| `src/main/utils/file.ts` | `refactor` | temp / config / mcp 目录命名 |
| `src/main/services/BackupManager.ts` | `refactor` | 备份文件前缀、metadata.appName、temp dir |
| `src/main/services/NutstoreService.ts` | `refactor` | Nutstore app key / path 前缀 |
| `src/main/services/ProtocolClient.ts` | `refactor` | `cherrystudio://` 深链协议 |
| `src/main/services/AppService.ts` | `refactor` | desktop file 名与 Linux 启动项 |
| `src/main/services/SelectionService.ts` | `refactor` | 自进程 bundle id 识别 |
| `src/main/services/LocalTransferService.ts` | `refactor` | 局域网服务名 |
| `src/main/apiServer/app.ts` | `refactor` | OpenAPI title / contact |
| `src/main/apiServer/generated/openapi-spec.json` | `refactor` | 重新生成 |
| `dev-app-update.yml` | `refactor` | updater cache 命名 |
| `app-upgrade-config.json` | `refactor` | 上游 releases 链接与镜像 |

## extra upstream surfaces outside Lite core

| Path | Status | Note |
| --- | --- | --- |
| `src/renderer/src/pages/agents/**/*` | `investigate` | 上游 autonomous agents，不在 Lite 冻结核心 |
| `src/main/services/agents/**/*` | `investigate` | 同上 |
| `src/renderer/src/pages/files/**/*` | `investigate` | 文件管理页不在当前保留清单 |
| `src/renderer/src/pages/notes/**/*` | `investigate` | 笔记模块不在当前保留清单 |
| `src/renderer/src/pages/paintings/**/*` | `investigate` | 图片生成专区不在当前保留清单 |
| `src/renderer/src/pages/minapps/**/*` | `investigate` | 小程序系统不在当前保留清单 |
| `src/renderer/src/pages/code/**/*` | `investigate` | Code tools 不在当前保留清单 |
| `src/renderer/src/pages/openclaw/**/*` | `investigate` | OpenClaw 专区不在当前保留清单 |
| `src/renderer/src/pages/launchpad/**/*` | `investigate` | Launchpad 不在当前保留清单 |
| `src/renderer/src/pages/settings/ChannelsSettings/**/*` | `investigate` | 多渠道接入不在当前保留清单 |
| `src/renderer/src/pages/settings/SkillsSettings/**/*` | `investigate` | 技能 / 插件体系不在当前保留清单 |
| `src/renderer/src/pages/settings/TasksSettings.tsx` | `investigate` | 定时任务属于暂缓项 |
