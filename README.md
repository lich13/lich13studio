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

Version 0.1.16 supports Responses and Anthropic, five reasoning levels with `max` as the default, and Sub2API's “Import to CCS” links. The first upgrade removes all old providers and credentials; chats, assistants and quick phrases are preserved. Add or import a provider to select a new model.

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

## 0.1.16

- Five reasoning levels: low, medium, high, xhigh, max (default max).
- Responses and Anthropic providers only; upgrade clears old provider credentials while preserving chat history.
- Sub2API “Import to CCS” via `ccswitch://v1/import`.
- MCP execution, configuration, installers and endpoints removed; historical records remain read-only.
