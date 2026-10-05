# lich13studio

`lich13studio` is a AI workspace for macOS, Windows and Android focused on the pieces that matter most:

- assistants and topics
- provider and model management
- quick phrases
- local and WebDAV backup
- single-window streaming chat

## Scope

This repository is being reduced from a larger upstream baseline into a smaller product with a stricter feature boundary.

Included:

- assistant CRUD
- topic and message persistence
- global default model and assistant model override
- provider CRUD and model list management
- quick phrase CRUD with variables
- backup and restore

Excluded:

- built-in translation
- knowledge base / RAG
- assistant marketplace

## Current release

**0.1.32** 修复快捷助手布局，模型和提供商保持横向排列；发现新版本后直接打开对应 GitHub Release 页面。Android 使用系统列表选择模型和提供商，避免下拉层瞬间关闭。主聊天工具栏中的 Waves 按钮继续控制全局流式模式，快捷助手自动跟随。

Android includes chat, assistants, topics, images, quick phrases, platform catalogs, ModelTrace and backup/restore. Active chat and test requests continue in a foreground service with a Stop notification. Force-stop or process loss ends the task without resending it. Android's system foreground-service limits still apply.

Both desktop and Android handle `ccswitch://v1/import` from Sub2API and New API. Imports require confirmation, normalize endpoints and deduplicate providers. No other application protocol is registered.

Android credentials are encrypted with Android Keystore; ordinary state stores references. Backups omit credentials by default. Including credentials requires a password and produces an Argon2id/AES-256-GCM encrypted backup that can be restored on either platform. Keep this password: it is not stored by the app.

OpenAI, grok and Anthropic model catalogs and CLI identities synchronize independently from official public sources. User edits, order, deletion choices and current selections are retained. The local capability registry and OpenAI brand icons work offline.

ModelTrace supports 1–3 concurrent challenges and compatible fingerprint updates from Hanmo123/ModelTrace. Tests stay local to the selected provider, send no reasoning parameters or tools, and never create chat history. Output guards and finite retries remain enabled; model requests have no application timeout. Persistence is version **223**; the global request mode is migrated from legacy assistant settings once.

MCP, web search, health probes and phone-export servers remain removed. Existing history is preserved.

## Docs

- [Scope Freeze](./docs/scope-freeze.md)
- [Module Map](./docs/module-map.md)
- [Delete List](./docs/delete-list.md)
- [Rename Plan](./docs/rename-plan.md)
- [Icon Concept](./docs/icon-concept.md)
- [Architecture Lite](./docs/architecture-lite.md)
- [Migration Notes](./docs/migration-notes.md)
- [v0.1.30 中文发布说明](./docs/releases/v0.1.30.zh-CN.md)
- [v0.1.31 中文发布说明](./docs/releases/v0.1.31.zh-CN.md)
- [v0.1.32 中文发布说明](./docs/releases/v0.1.32.zh-CN.md)

## Upstream Source

This project is currently derived from the upstream [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) repository.

That upstream reference is kept only as source acknowledgement and migration context.

## Build And Release

- Local dev: `pnpm dev`
- Local mac bundle: `pnpm build:mac`
- Local Windows bundle:
  - `pnpm build:windows:x64`
  - `pnpm build:windows:arm64`
- Android: see [Android build and storage](./docs/android.md)
- GitHub release build: push a tag or run `.github/workflows/release-build.yml`

The repository now uses a Tauri-first release flow. Legacy Electron Builder packaging files and workflows have been removed.

## 0.1.17

- Shared platform model catalogs with add, edit, remove and reorder controls.
- Sub2API and New API CCS imports, including multiple Claude models and editable platform selection.
- Address normalization fixes duplicate slashes and `/v1`; a trailing `#` preserves explicit endpoints.
- Official Codex CLI, Grok CLI and Claude Code UA synchronization, with stable-version filtering and offline caching.
- Model health checks and API Key connection tests removed.
- Migration 217 merges existing models without replacing user edits; subsequent requests resolve the latest catalog and retain the selected provider.

## 0.1.16

- Five reasoning levels: low, medium, high, xhigh, max (default max).
- Responses and Anthropic providers only; upgrade clears old provider credentials while preserving chat history.
- Sub2API “Import to CCS” via `ccswitch://v1/import`.
- MCP execution, configuration, installers and endpoints removed; historical records remain read-only.
