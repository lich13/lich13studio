# lich13studio

`lich13studio` is a simplified desktop AI workspace focused on the pieces that matter most:

- assistants and topics
- provider and model management
- MCP manual configuration
- quick phrases
- local, Nutstore WebDAV, and S3 backup
- single-window streaming chat

## Scope

This repository is being reduced from a larger upstream baseline into a smaller product with a stricter feature boundary.

Included:

- assistant CRUD
- topic and message persistence
- global default model and assistant model override
- provider CRUD and model list management
- manual MCP server configuration and testing
- quick phrase CRUD with variables
- backup and restore

Excluded:

- built-in translation
- knowledge base / RAG
- assistant marketplace
- MCP marketplace / discover / auto-install

## Current Phase

The repository currently contains:

- Phase 0 planning docs
- branding replacement groundwork
- new purple icon assets
- initial Phase 1 rename work
- initial Phase 2 entry-point cleanup

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
