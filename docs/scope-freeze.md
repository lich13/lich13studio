# lich13studio Scope Freeze

## Phase 0 baseline

- Upstream base: `CherryHQ/cherry-studio`
- Scan baseline: `main @ e54cfe97ea63149be723cb1281eee2fdc719b132`
- Current workspace: `/Users/gosu/build/lich13studio`
- Goal: build a Lite desktop app named `lich13studio`, keep core chat usefulness, remove non-core clutter, and prepare a Rust/Tauri migration path.

## 最终保留项

### 1. 助手体系

- assistant CRUD
- assistant settings
- assistant 下属多个话题 / 对话
- assistant 默认模型
- assistant 配置导入导出
- 至少保留“单个助手”的导入导出能力

### 2. MCP

- 手动添加 MCP server
- 本地 MCP server
- 远程 MCP server
- 连接测试
- 启用 / 禁用
- 绑定到助手

### 3. 模型服务

- provider CRUD
- 自定义服务商
- 内置 provider 仅保留 `openai` / `anthropic` / `gemini`
- 模型列表管理
- 连通性检查
- 全局默认模型
- assistant 默认模型覆盖全局默认模型

### 4. 快捷短语

- 快捷短语 CRUD
- 变量占位
- 插入聊天输入框

### 5. 备份

- 本地导出 / 导入
- 坚果云 WebDAV 备份与恢复
- S3 兼容存储备份与恢复
- 备份配置管理

### 6. 聊天核心

- 单窗口
- 流式对话
- Markdown 渲染
- 基础消息持久化
- 话题内消息清空
- 模型切换
- 清除上下文
- Token 预估显示
- 图片或文档上传入口保留
- 文档深解析链允许后置

## 最终删除项

### 1. 内置翻译

- 翻译页面
- 翻译按钮
- 翻译逻辑
- 翻译设置
- 翻译模型专属状态
- 选择助手里的翻译动作
- 消息级翻译块 / 翻译结果面板

### 2. 知识库

- 知识库入口
- 知识库页面
- 知识库相关路由
- 知识库相关 IPC
- 知识库相关数据结构
- 知识库相关设置
- 聊天输入框里的知识库选择器
- 文档预处理 / 向量检索 / RAG 专属链路

### 3. 市场类能力

- assistants 市场
- MCP market
- 在线推荐 / 在线订阅 / 在线发现入口
- 自动安装 MCP 的市场化流程
- MCP 平台发现页 / 同步页 / 一键安装页

### 4. 本轮额外确认删除

- 设置页 `全局记忆`
- 设置页 `API 服务器`
- 设置页 `快捷键`
- 上述三项对应的前端入口、设置路由、Electron preload bridge、主进程 IPC handler

## 暂缓项

- 定时自动备份
- 后台同步
- 多窗口
- OCR
- TTS
- 插件系统
- Deep Research
- 复杂文档解析链
- 市场化在线内容发现

## 规则

1. 未明确删除的聊天框其他功能默认保留。
2. 保留优先级高于重做；能解耦保留就不先删。
3. 如果某个保留项与删除项强耦合，先做解耦；实在无法立刻解耦时，写入 `docs/migration-notes.md`，不要静默删除。
4. 任何删除动作都必须同时覆盖路由、菜单、设置页、组件、状态管理、IPC / 命令层、数据结构、文案、图标。
5. Phase 1 / 2 的硬删除以“翻译 / 知识库 / 市场类能力”为主，不在这里额外扩张删除面，以免误伤核心聊天能力。
6. 上游存在的额外产品面，如 `agents / notes / files / paintings / minapps / code / openclaw / launchpad / skills / channels`，暂不纳入 Lite 核心保留清单；这些模块在 Phase 0 标记为 `investigate`，后续根据编译影响和产品目标决定是否裁剪。
