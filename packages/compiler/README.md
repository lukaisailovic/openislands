# @openislands/compiler

[![npm version](https://img.shields.io/npm/v/@openislands/compiler?color=2dd4bf)](https://www.npmjs.com/package/@openislands/compiler)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The DuckDB query core behind OpenIslands: local files become typed, contract-checked data.

This is the engine that reads your files. It registers each dataset in your manifest as a DuckDB view (CSV, JSON, Parquet, SQLite, or markdown), runs your SQL transforms and queries live, and checks every island binding against the real column types. Bind a chart to a column that doesn't exist and you get a named compile error, not a silently wrong chart.

`@openislands/compiler` is part of [OpenIslands](https://github.com/lukaisailovic/openislands). It sits on top of [`@openislands/schema`](https://www.npmjs.com/package/@openislands/schema) and is driven by the `openislands` CLI and the MCP server, so you rarely install it directly. You'd reach for it when you want to embed the file-to-typed-rows engine, or run the contract check, in your own Node tooling.

## Install

```bash
npm i @openislands/compiler
```

Server-side and ESM-only, Node ≥ 20. Pulls in a native DuckDB binding (`@duckdb/node-api`), so `npm i` downloads a prebuilt binary for your platform. Not browser-safe.

## Usage

```ts
import { compile, query, inferFile } from "@openislands/compiler";

// Compile a project (a directory holding app/manifest.json):
// validates the manifest and checks every island binding against the live files.
const report = await compile(projectDir);
if (!report.ok) {
  // e.g. "[overview#0 timeseries.line] missing field 'value' in dataset 'nw'. Available: month, total"
  console.error(report.errors.join("\n"));
}

// Query a registered dataset: read-only, row-capped, plain JSON rows back.
const result = await query(projectDir, "nw", { limit: 10 });
result.columns; // [{ name: "month", type: "string" }, { name: "value", type: "number" }]
result.rows;    // [{ month: "2026-01", value: 100 }, ...]

// Infer a loose file's schema with no manifest at all.
const schema = await inferFile("/abs/path/metrics.csv");
```

## What's in here

| Export | Purpose |
|---|---|
| `compile(projectDir)` | Validate the manifest and check every island binding against the live data. |
| `query` / `queryRaw` / `queryWithParams` | Read-only queries over registered datasets (a single `SELECT` only). |
| `queryArrow` | The same result, serialized as Arrow IPC. |
| `validateSql(projectDir, sql)` | Dry-run a `SELECT`; returns the result columns or the exact DuckDB error. |
| `inferSchema` / `inferFile` | Column names and types for a dataset or a raw file. |
| `checkManifestContracts(...)` | The binding check, shared with the MCP server so the rules can't drift. |

Queries are read-only by design: anything but a single `SELECT` is rejected. Filter fields are checked against the live schema before they're interpolated, and values bind as prepared-statement params. The engine is cached per project, so call `resetEngine(projectDir)` after files change (`compile` does this for you).

## Documentation

- [OpenIslands docs](https://openislands.sh)
- [Data app model](https://github.com/lukaisailovic/openislands/blob/main/docs/data-app-model.md)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
