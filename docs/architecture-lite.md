# lich13studio Lite architecture

The desktop package uses Tauri for window, filesystem, backup, native HTTP and protocol handling. The React renderer owns assistants, topics, messages, quick phrases and provider settings. Shared OpenTelemetry helpers live in `packages/trace`.

## Model requests

Providers are grouped by `ProviderPlatform = openai | grok | anthropic`. OpenAI and grok use Responses, Anthropic uses Messages. Each platform owns one model catalog. Stored providers contain credentials and configuration, while runtime selectors attach the current catalog and CLI version. Saved model references retain their provider ID and resolve current definitions before requests; missing providers/models produce a selection error.

Provider types are `openai-response` (Responses) and `anthropic`. There are no built-in providers. The AI SDK constructs requests and the Tauri native HTTP transport streams them. The unused Rust Chat Completions/Gemini chat and health-check commands have been removed.

Reasoning levels are `low / medium / high / xhigh / max`, defaulting to `max`. Responses forwards the value without fallback. Anthropic maps only where model capabilities require it; older thinking budgets stay below the total output limit. SDK request tests cover the actual serialized payloads.

## Imports and persistence

The installed app registers `ccswitch://v1/import`. A native queue retains every pending provider link in memory until the main renderer is ready; mini windows cannot drain it. A renderer queue serializes confirmation dialogs. Only provider resources for codex (OpenAI), grokbuild (grok) and claude (Anthropic) are accepted. Both Sub2API and New API CCS links are supported, including `model`, `haikuModel`, `sonnetModel` and `opusModel`. Platform, normalized address and key define import identity. Confirmation allows platform correction; duplicate imports may add catalog models. Only `ccswitch` is registered, never `cherrystudio`. Keys are masked at confirmation and never placed in routes or import logs. Usage scripts are ignored.

Redux persistence version 217 merges old provider models into platform catalogs in original provider order, then appends missing seed models. Existing definitions take precedence. It repairs addresses and removes per-provider model copies, UA overrides and detection state. Both startup and backup restore share idempotent migration. Version 216 still clears providers and invalid references for backups older than 216. Every rehydrate and backup restore sanitizes removed configuration. New providers survive restart and current-version backups. Chat messages, assistants and quick phrases remain intact.

## CLI identity and endpoint handling

`packages/shared/cliIdentity.ts` filters stable official Codex/Claude GitHub releases and Grok's stable endpoint. Startup checks cached versions once they are at least an hour old, followed by an hourly timer. Queries time out after ten seconds, contain no provider credentials, and never downgrade a cached/bundled version. Platform identity headers are applied after SDK request construction, including retries. A trailing `#` routes directly to the explicit endpoint; ordinary addresses normalize to a base URL with one version suffix.

The release catalog and initial CLI versions are pinned to Codex `rust-v0.156.1`, Claude Code `v2.1.281`, Grok `1.0.41`, and Sub2API `a3eb7ef302961cba716dc78b39b93b60c467db0e`. Catalogs update only through application migrations or user edits, not network synchronization.

Model health probes and individual/batch API Key connection tests have no services, types or UI entries. Key management and ordinary request errors remain.

## Removed MCP functionality

There are no MCP settings, server runtimes, OAuth flows, installers, Redux slice, IPC/preload API, Tauri commands or HTTP routes. Historical tool messages keep their existing storage key and render as read-only records. Agent SDK configuration explicitly excludes external MCP configuration; native WebSearch/WebFetch remains available.

## Validation

`pnpm test:upgrade`, `pnpm test:renderer`, `pnpm typecheck`, `pnpm openapi:check`, `pnpm build:tauri:web`, and `cargo test --manifest-path src-tauri/Cargo.toml`. Local acceptance uses a loopback mock; real provider/API billing is outside that acceptance.
