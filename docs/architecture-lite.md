# lich13studio Lite architecture

The desktop package uses Tauri for window, filesystem, backup, native HTTP and protocol handling. The React renderer owns assistants, topics, messages, quick phrases and provider settings. Shared OpenTelemetry helpers live in `packages/trace`.

## Model requests

Providers are grouped by `ProviderPlatform = openai | grok | anthropic`. OpenAI and grok use Responses, Anthropic uses Messages. Each platform owns one model catalog. Stored providers contain credentials and configuration, while runtime selectors attach the current catalog and CLI version. Saved model references retain their provider ID and resolve current definitions before requests; missing providers/models produce a selection error.

Provider types are `openai-response` (Responses) and `anthropic`. There are no built-in providers. The AI SDK constructs requests and the Tauri native HTTP transport streams them. The unused Rust Chat Completions/Gemini chat and health-check commands have been removed.

Reasoning levels are `low / medium / high / xhigh / max`, defaulting to `max`. Responses forwards the value without fallback. Anthropic maps only where model capabilities require it; older thinking budgets stay below the total output limit. SDK request tests cover the actual serialized payloads.

## Model testing

ModelTrace is available from the home chat toolbar at `/model-test`; the old settings path redirects there. Separate model and provider preferences are persisted globally without changing chat selections. A route-independent `ModelTestSessionService` owns one runner and retains its progress/results in memory. Leaving the page only unsubscribes the view; it does not abort requests or retries. Draft selection changes affect the next run. Only explicit Stop or application exit ends an active test.

ModelTrace runs directly against the selected provider; no third-party test relay exists. A session freezes the provider credentials, actual model ID and all three challenges. Its requests disable reasoning, tools and SDK retries, use incremental text events, and have no model-request timeout. Cancellation ends active requests and scheduled retries.

Each attempt has its own answer collector. Complete text events replace snapshots, native reasoning and explicit commentary stay outside the answer, and inline thought tags are isolated across chunks. A provider-confirmed finish (including an output limit) completes the request independently of answer quality. Missing terminal events and real provider/transport errors remain failures. Count and range differences never abort or retry a completed request.

Automatic and pasted outputs share one analysis parser. Complete integer sequences retain their original text, order and duplicates; only the scoring array excludes values outside 1–355. Prose, decimals, exponents and malformed thought tags are not mined for numbers. A group with at least 80 usable integers contributes to the unchanged bundled scoring algorithm, using the bank's calibration for one, two or three available groups. The report refreshes after each completed group; no usable samples produces an empty result, not a request failure.

Temporary request failures get at most two extra attempts after 1 and 3 seconds. Authentication, missing-model and other permanent request errors stop immediately. Retrying failed groups skips every completed request, including completed answers that cannot be analyzed. Results are memory-only and never create chat records. Persistence remains version 219. The page places test controls and attribution side by side at a 960px content width, followed by the full-width challenges; narrower layouts stack all three areas.

## Imports and persistence

The installed app registers `ccswitch://v1/import`. A native queue retains every pending provider link in memory until the main renderer is ready; mini windows cannot drain it. A renderer queue serializes confirmation dialogs. Only provider resources for codex (OpenAI), grokbuild (grok) and claude (Anthropic) are accepted. Both Sub2API and New API CCS links are supported, including `model`, `haikuModel`, `sonnetModel` and `opusModel`. Platform, normalized address and key define import identity. Confirmation allows platform correction; duplicate imports may add catalog models. Only `ccswitch` is registered, never `cherrystudio`. Keys are masked at confirmation and never placed in routes or import logs. Usage scripts are ignored.

Redux persistence version 219 initializes independent model-test selection from the existing default model once, including backup restore. Invalid selections remain visible for explicit correction. Version 218 removes persisted web-search settings, search credentials and assistant search toggles while preserving historical chat blocks as read-only content. Version 217 merges old provider models into platform catalogs in original provider order, then appends missing seed models. Existing definitions take precedence. It repairs addresses and removes per-provider model copies, UA overrides and detection state. Both startup and backup restore share idempotent migration. Version 216 still clears providers and invalid references for backups older than 216. Every rehydrate and backup restore sanitizes removed configuration. New providers survive restart and current-version backups. Chat messages, assistants and quick phrases remain intact.

## CLI identity and endpoint handling

`packages/shared/cliIdentity.ts` filters stable official Codex/Claude GitHub releases and Grok's stable endpoint. Startup checks cached versions once they are at least an hour old, followed by an hourly timer. Queries time out after ten seconds, contain no provider credentials, and never downgrade a cached/bundled version. Platform identity headers are applied after SDK request construction, including retries. A trailing `#` routes directly to the explicit endpoint; ordinary addresses normalize to a base URL with one version suffix.

The release catalog and initial CLI versions are pinned to Codex `rust-v0.156.1`, Claude Code `v2.1.281`, Grok `1.0.41`, and Sub2API `a3eb7ef302961cba716dc78b39b93b60c467db0e`. Catalogs update only through application migrations or user edits, not network synchronization.

Model health probes and individual/batch API Key connection tests have no services, types or UI entries. Key management and ordinary request errors remain.

## Removed MCP functionality

There are no MCP settings, server runtimes, OAuth flows, installers, Redux slice, IPC/preload API, Tauri commands or HTTP routes. Historical tool messages keep their existing storage key and render as read-only records. Agent SDK configuration explicitly excludes external MCP configuration. The removed network-search feature has no provider, tool factory, request injection, UI entry, IPC path or API route; ordinary URL opening and historical citation rendering remain.

## Validation

`pnpm test:upgrade`, `pnpm test:renderer`, `pnpm typecheck`, `pnpm i18n:check`, `pnpm openapi:check`, `pnpm build:tauri:web`, and `cargo test --manifest-path src-tauri/Cargo.toml`. Automated transport tests use local mocks. The v0.1.20 installed-app acceptance additionally uses the explicitly authorized Happy Code provider and actual `gpt-6-sol` model ID; no other provider is called.
