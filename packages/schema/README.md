# @openislands/schema

[![npm version](https://img.shields.io/npm/v/@openislands/schema?color=2dd4bf)](https://www.npmjs.com/package/@openislands/schema)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The OpenIslands manifest and island schemas: one source of truth for types, validation, and JSON Schema.

Every OpenIslands app is a typed manifest: datasets, pages, and visual islands bound to your data. This package is the Zod definition of that contract. One set of schemas produces three things: a runtime validator, inferred TypeScript types, and a lossless JSON Schema for editor autocomplete and agent grounding.

It's the keystone of [OpenIslands](https://github.com/lukaisailovic/openislands): the compiler, runtime, CLI, and MCP server all depend on it, and adding an island starts here. You rarely install it directly; `npx openislands` brings it along. You'd reach for it when you're building your own manifest tooling, generating JSON Schema for an editor, or type-checking manifests in your own code.

## Install

```bash
npm i @openislands/schema
```

ESM-only, Node ≥ 20. Ships with Zod 4.

## Usage

```ts
import { validateManifest, manifestJsonSchema, jsonSchemaFor } from "@openislands/schema";

const result = validateManifest({
  version: 1,
  title: "Finance Overview",
  datasets: { net_worth: { source: "data/net_worth.csv" } },
  pages: [{
    id: "overview",
    islands: [
      { type: "metric.kpi", title: "Net worth", dataset: "net_worth", value: "net_worth_eur" },
      { type: "timeseries.line", dataset: "net_worth", x: "month", y: "net_worth_eur" },
    ],
  }],
});

if (!result.ok) {
  for (const e of result.errors) {
    console.error(`${e.page}[${e.index}] ${e.type}: ${e.message}`);
  }
}

// JSON Schema for editor autocomplete or agent grounding:
const schema = manifestJsonSchema();
const kpiSchema = jsonSchemaFor("metric.kpi");
```

`validateManifest` takes `unknown` and never throws. On bad input it returns `{ ok: false, errors }`, where each error names the page, island index, type, and field. Unknown island types aren't errors; they're reported as custom islands, the extension point for renderers you supply yourself.

## What's in here

| Export | Purpose |
|---|---|
| `validateManifest(input)` | Parse and validate a manifest; applies defaults, returns named errors. |
| `lintManifest(manifest)` | Advisory layout warnings (a lone KPI, a compact island set too wide). Never blocks. |
| `manifestJsonSchema()` / `jsonSchemaFor(type)` | JSON Schema for the whole manifest or a single island type. |
| `flattenPageIslands(page)` | Normalize a page to its flat island list, the single source of island indexing. |
| `Manifest`, `Island`, `Page`, … | Inferred TypeScript types for every part of the contract. |
| `BUILTIN_ISLAND_TYPES`, `ISLAND_MIN_SPAN`, … | The island registry and grid-span metadata. |

Validation here is structural. Whether a bound field exists in your data is checked downstream by [`@openislands/compiler`](https://www.npmjs.com/package/@openislands/compiler) against the live files.

## Documentation

- [OpenIslands docs](https://openislands.sh)
- [Data app model](https://github.com/lukaisailovic/openislands/blob/main/docs/data-app-model.md)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
