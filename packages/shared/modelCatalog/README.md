# Official platform catalogs

The bundled data contains factual model IDs, aliases, modalities and supported capabilities. It does not contain upstream prompts, tool definitions or executable code.

- OpenAI: `openai/codex`, stable release resolved to a commit. Model data comes from `codex-rs/models-manager/models.json` (older releases use `codex-rs/core/models.json`). Codex is Apache-2.0; see https://github.com/openai/codex/blob/main/LICENSE.
- grok: the public JSON assignment `__XAI_PUBLIC_MODELS__` on https://docs.x.ai/developers/models. Only text language models are imported; regional copies must agree. The data is parsed as JSON, never evaluated.
- Anthropic: https://platform.claude.com/docs/en/models/overview.md and its explicitly listed current / still-available model specifications, plus the effort table. Only Claude API identifiers are imported.

`bundled.json` records each source URL and SHA-256, the immutable OpenAI commit, normalized-data digest and parser version. Official documentation is used for factual metadata; no documentation prose is bundled or relicensed. Existing Cherry capability / logo attribution remains in its registry directory.

Run `pnpm catalog:update --openai-ref rust-v0.159.1` to refresh all three snapshots while fixing the OpenAI release (omit the option for the latest stable release). Documentation sources are live and identified by their recorded content hashes. Run `pnpm catalog:check` to reproduce validation and normalized digests offline. Updating a parser requires reviewing its recorded fixtures and incrementing the parser version when old caches are incompatible.

Runtime cache is an independent `lich13studio-model-catalog-cache` IndexedDB database, not the chat database or backup payload. User directory entries and explicit deletions stay in normal configuration. Synchronization never removes existing entries or changes selected targets.
