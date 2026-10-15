# lich13studio

基于 Tauri 的 macOS、Windows 与 Android AI 工作区，源自 [Cherry Studio](https://github.com/CherryHQ/cherry-studio)。当前版本 **0.1.36**，使用 AGPL-3.0，保留上游版权和第三方许可，详见 [NOTICE](NOTICE.md)。

## 功能范围

- 助手、话题、聊天记录和快捷短语；普通聊天支持全局流式／非流式选择。
- OpenAI、grok、Anthropic 三平台共享模型目录；模型与提供商分别选择，不自动替换提供商。OpenAI、grok 使用 Responses，Anthropic 使用 Messages。
- 官方公开模型目录、CLI 版本与兼容的 ModelTrace 指纹库自动同步，支持离线缓存和手动检查。
- ModelTrace 先运行第一组，模型匹配概率达到 99% 提前结束；否则按已选并发数运行剩余组。结果不进入聊天记录，离开页面后继续执行。
- 图片附件、本地／WebDAV 备份及恢复。含凭据备份必须设置密码；默认备份不含凭据。
- 桌面托盘与快捷助手；Android 支持 Android 12（API 31）以上、ARM64，提供后台任务通知和停止操作。
- 接管 `ccswitch://v1/import`，兼容 Sub2API 与 New API。确认后才保存，地址规范化、模型合并和去重由两端共用规则处理。

已移除内置翻译、知识库／RAG、助手市场、MCP、网页搜索、健康探测和手机导出服务器。旧记录及迁移兼容类型继续保留，不代表相关功能重新启用。

## 数据与隐私

聊天和设置默认保存在本机；模型请求发往用户配置的提供商，WebDAV 使用用户指定的服务器。公共目录、指纹库和版本查询不附带提供商凭据或聊天内容。应用不提供自有遥测或隐藏上传。详情见 [数据与隐私](docs/privacy.md)。

Android 使用 Keystore 保护凭据，桌面凭据目前仍在本地普通持久化存储中；两者不能视为相同的静态存储保护。备份采用独立随机盐和 nonce 的 Argon2id／AES-256-GCM 容器，密码不保存。请保护设备和备份密码。

## 构建与检查

Node 版本以 [`.nvmrc`](.nvmrc) 为准，pnpm 版本以 [`package.json`](package.json) 的 `packageManager` 为准。使用已安装的 Rust stable，原生依赖与 Android 环境见开发文档。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm run ci
```

`pnpm run ci` 是本地和 CI 的检查定义：`ci:frontend` 包含静态检查、类型、测试和 Web 构建，`ci:rust` 包含 Rust fmt、clippy 和测试。CI 按平台拆分执行，依赖审计仅报告。

```sh
pnpm build:mac
pnpm build:windows:x64
pnpm build:windows:arm64
pnpm tauri:build:android
```

发布打包使用 Tauri。`electron.vite.config.ts` 仍承担 renderer 与兼容源码构建；`build/` 中仍有托盘及兼容窗口资源，不能按目录整体删除。Electron Builder 已不作为发布打包入口。

## 文档与反馈

- [文档索引](docs/README.md)、[开发与检查](docs/zh/guides/development.md)、[Android 构建](docs/android.md)
- [当前范围](docs/scope-freeze.md)、[模块地图](docs/module-map.md)、[架构](docs/architecture-lite.md)、[迁移规则](docs/migration-notes.md)
- [最新发布说明](docs/releases/v0.1.36.zh-CN.md)、[早期版本记录](docs/releases/early-versions.zh-CN.md)
- [贡献指南](CONTRIBUTING.md)、[问题反馈](https://github.com/lich13/lich13studio/issues)、[安全报告](SECURITY.md)

手动执行 `release-build.yml` 时留空 version 只构建制品；推送标签或填写 version 会发布 Release。
