# @openislands/storage

[![npm version](https://img.shields.io/npm/v/@openislands/storage?color=2dd4bf)](https://www.npmjs.com/package/@openislands/storage)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> Swappable storage ports for OpenIslands, so server-side I/O never touches the filesystem directly.

OpenIslands reads and writes through three ports instead of calling `node:fs`: a `ContentStore` for app content, an `AppStateStore` for the tool's own `.openislands/` state, and a `VersionStore` for editor file history. Each ships with a local-disk adapter, and `configureStorage()` swaps in a different backend at boot, without changing a single call site.

`@openislands/storage` is part of [OpenIslands](https://github.com/lukaisailovic/openislands). The compiler, runtime, and MCP server all sit on top of it, so it usually arrives transitively through `npx openislands`. Install it directly when you're writing a custom backend: a database- or cloud-backed store in place of local disk.

## Install

```bash
npm i @openislands/storage
```

Zero runtime dependencies. The bundled adapters use `node:fs`, so they're server-side only. ESM-only, Node ≥ 20.

## Usage

```ts
import { getContentStore, configureStorage } from "@openislands/storage";

// Default: the local-disk adapter, keyed by project directory.
const content = getContentStore("/path/to/my-app");
await content.writeText("data/x.csv", "a,b\n1,2\n");
const text = await content.readText("data/x.csv");

// Swap in your own backend once at boot. Omitted ports keep their default.
configureStorage({
  content: (appKey) => new MyContentStore(appKey),
  versions: (appKey) => new MyVersionStore(appKey),
});
```

Every store is resolved by an opaque app key (today, the project directory). `getContentStore` and `getAppStateStore` fall back to local disk; `getVersionStore` has no default and throws until you configure one.

## The three ports

| Port | Backs |
|---|---|
| `ContentStore` | App content: your data files, SQL transforms, manifest. |
| `AppStateStore` | The tool's internal state under `.openislands/`. |
| `VersionStore` | File-version history for the editor and rollback. |

`LocalContentStore` and `LocalAppStateStore` are the default disk adapters. `VersionStore` ships as an interface only; its disk implementation lives in the runtime, registered at boot.

## Documentation

- [OpenIslands docs](https://openislands.sh)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
