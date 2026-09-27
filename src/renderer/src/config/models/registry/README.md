# Cherry Studio model capabilities

This reduced snapshot and the local OpenAI light/dark SVGs are derived from
[Cherry Studio 5846b0e6b71adfd46baf094259823e1519e3afd6](https://github.com/CherryHQ/cherry-studio/tree/5846b0e6b71adfd46baf094259823e1519e3afd6).
See `CHERRY-STUDIO-LICENSE.txt` (AGPL-3.0) and the upstream authors' copyright notices.
The application is also distributed under AGPL-3.0.

Reproduce with `node scripts/update-model-capabilities.mjs`; verify byte-for-byte
against the pinned upstream files with `node scripts/update-model-capabilities.mjs --check`.
The snapshot includes only IDs, input/output modalities and capabilities used here.
Source revision and SHA-256 are recorded in the JSON. The source model registry is
`packages/provider-registry/data/models.json`; icons are
`packages/ui/icons/models/{light,dark}/openai.svg`.

This is release-time data, never a runtime network service. Resolution never writes
inferred fields to user catalogs. Explicit capability switches take precedence;
unknown IDs use existing declarations and conservative legacy rules. Aliases affect
lookups only, never the model ID sent to a provider. Audio/video modality metadata
does not add audio/video API support.
