# Development

The maintained build and check instructions are in the [development guide](../../zh/guides/development.md). Use the current stable Node.js, pnpm and Rust toolchains with the committed dependency lockfiles.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm run ci
```

CI executes the same `ci:frontend` and `ci:rust` definitions. Android prerequisites and signing are documented in [Android](../../android.md). A manual release workflow with an empty version builds artifacts without publishing.
