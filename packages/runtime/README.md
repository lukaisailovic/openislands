# @openislands/runtime

[![npm version](https://img.shields.io/npm/v/@openislands/runtime?color=2dd4bf)](https://www.npmjs.com/package/@openislands/runtime)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The TanStack Start SSR app, island registry, and React renderers behind `openislands serve`.

When you run `openislands serve`, this is what boots: a server-rendered TanStack Start app that maps each island type in your manifest (`metric.kpi`, `timeseries.line`, `table.grid`, and the rest) to a React renderer, queries the DuckDB core per request, and pushes updates over SSE so the page refetches as your files change.

`@openislands/runtime` is part of [OpenIslands](https://github.com/lukaisailovic/openislands). It isn't really a standalone package. You get it through `npx openislands serve`, which loads its prebuilt server bundle for you. There are two reasons you'd import it directly: you're embedding a single live island in another React app, or you're a contributor working on the renderers.

## Install

```bash
npm i @openislands/runtime
```

React 19, ESM-only, Node ≥ 20.

## Embedding an island

The browser-safe registry lives under the `/islands` subpath, which carries the renderers without the server's `node:fs` and DuckDB modules:

```tsx
import { Suspense } from "react";
import { resolveRenderer, type IslandConfig, type QueryPayload } from "@openislands/runtime/islands";

const config: IslandConfig = { type: "metric.kpi", dataset: "nw", value: "net_worth_eur" };
const data: QueryPayload = { dataset: "nw", columns: [], rows: [{ net_worth_eur: 42000 }] };
const Renderer = resolveRenderer(config.type);

// Renderers load on demand (echarts, Lexical, and the world map are lazy chunks),
// so every render site needs a Suspense boundary.
<Suspense fallback={null}>
  <Renderer config={config} data={data} />
</Suspense>
```

You supply `data` yourself here; in the running dashboard a TanStack Query client fetches it from `/api/query`. An unknown island type resolves to a placeholder rather than throwing.

## Subpath exports

| Import | What you get |
|---|---|
| `@openislands/runtime` | The full surface, including server modules (pulls in `node:fs` and DuckDB; server-only). |
| `@openislands/runtime/islands` | The browser-safe registry and renderers: `resolveRenderer`, `registerIsland`, `formatValue`, `IslandCard`. |
| `@openislands/runtime/server` | The prebuilt SSR fetch handler (`{ fetch }`) the CLI mounts. |

Custom islands are file-based, not registered through an API: drop `components/custom/<type>/index.tsx` into your project and `serve` bundles it on demand.

## Documentation

- [OpenIslands docs](https://openislands.sh)
- [Data app model](https://github.com/lukaisailovic/openislands/blob/main/docs/data-app-model.md)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
