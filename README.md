# lich13studio

`lich13studio` is a simplified desktop AI workspace focused on the pieces that matter most:

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

Version 0.1.17 groups providers by OpenAI, grok and Anthropic, with one editable model catalog per platform. Sub2API and New API “Import to CCS” links preserve platform identity and normalize addresses. Official CLI identities synchronize hourly with offline caching. Five reasoning levels still default to `max`. Upgrades from 0.1.16 preserve providers, credentials and chats; the existing provider reset only applies to versions older than 0.1.16.

MCP configuration and execution have been removed. Existing tool messages remain as read-only history.

## Docs

- [Scope Freeze](./docs/scope-freeze.md)
- [Module Map](./docs/module-map.md)
- [Delete List](./docs/delete-list.md)
- [Rename Plan](./docs/rename-plan.md)
- [Icon Concept](./docs/icon-concept.md)
- [Architecture Lite](./docs/architecture-lite.md)
- [Migration Notes](./docs/migration-notes.md)

## Upstream Source

This project is currently derived from the upstream [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) repository.

That upstream reference is kept only as source acknowledgement and migration context.

## Build And Release

- Local dev: `pnpm dev`
- Local mac bundle: `pnpm build:mac`
- Local Windows bundle:
  - `pnpm build:windows:x64`
  - `pnpm build:windows:arm64`
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
