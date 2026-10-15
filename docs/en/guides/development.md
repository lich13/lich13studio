# Development

The maintained build and check instructions are in the [development guide](../../zh/guides/development.md). Node is selected by `.nvmrc`, pnpm by `package.json#packageManager`, and native checks use the installed Rust stable toolchain.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm run ci
```

CI executes the same `ci:frontend` and `ci:rust` definitions. Android prerequisites and signing are documented in [Android](../../android.md). A manual release workflow with an empty version builds artifacts without publishing.
