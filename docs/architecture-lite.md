# lich13studio Lite architecture

The desktop package uses Tauri for window, filesystem, backup, native HTTP and protocol handling. The React renderer owns assistants, topics, messages, quick phrases and provider settings. Shared OpenTelemetry helpers live in `packages/trace`.

## Model requests

Provider types are `openai-response` (Responses) and `anthropic`. There are no built-in providers. The AI SDK constructs requests and the Tauri native HTTP transport streams them. The unused Rust Chat Completions/Gemini chat and health-check commands have been removed.

Reasoning levels are `low / medium / high / xhigh / max`, defaulting to `max`. Responses forwards the value without fallback. Anthropic maps only where model capabilities require it; older thinking budgets stay below the total output limit. SDK request tests cover the actual serialized payloads.

## Imports and persistence

The installed app registers `ccswitch://v1/import`. A startup listener retains pending provider links in memory until the UI is ready. Only provider resources for codex/grokbuild (Responses) and claude (Anthropic) are accepted. Keys are masked at confirmation and never placed in routes or import logs. Usage scripts are ignored.

Redux persistence version 216 clears pre-upgrade providers and invalid model references once. Every rehydrate and backup restore sanitizes removed configuration. New providers survive restart and current-version backups. Chat messages, assistants and quick phrases remain intact.

## Removed MCP functionality

There are no MCP settings, server runtimes, OAuth flows, installers, Redux slice, IPC/preload API, Tauri commands or HTTP routes. Historical tool messages keep their existing storage key and render as read-only records. Agent SDK configuration explicitly excludes external MCP configuration; native WebSearch/WebFetch remains available.

## Validation

`pnpm test:upgrade`, `pnpm test:renderer`, `pnpm typecheck`, `pnpm openapi:check`, `pnpm build:tauri:web`, and `cargo test --manifest-path src-tauri/Cargo.toml`. Local acceptance uses a loopback mock; real provider/API billing is outside that acceptance.
