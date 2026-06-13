<h1 align="center">OpenIslands</h1>

<p align="center"><strong>Agent-built dashboards over data you own — that don't rot.</strong></p>

<p align="center">
  Point your AI coding agent at a folder of files. Get a typed, durable dashboard
  it can keep maintaining. Everything stays on your machine.
</p>

<p align="center">
  <code>MIT</code> · <code>local-first</code> · <code>npx openislands</code> · <code>MCP</code>
</p>

---

AI agents are great at building a dashboard once. Then your data changes a column,
a new export lands, you ask a new question — and the hand-generated app silently
breaks or quietly lies. OpenIslands fixes the *maintenance* problem.

It is a **local-first compiler and runtime** where an app is a typed **manifest** of
reusable visual **islands** (KPI cards, charts, tables, timelines, treemaps…) bound
to **typed data contracts** built from your files. An agent edits the manifest — not
fragile rendering code — through a validated, diffed, reversible pipeline. When the
data and an island disagree, the build **fails loudly and names the island** instead
of rendering something wrong.

```bash
npx openislands init --template finance   # scaffold a dashboard
openislands validate                      # check the manifest + every data binding
openislands serve                         # run it as a live local app over your files
```

## Why it's different

|  | OpenIslands |
|---|---|
| **Your data** | Plain files you own — git it, zip it, runs locally. No account, no cloud. |
| **Durable** | Typed islands + a closed registry. No 300-line React component to rot. |
| **Agent-maintained** | A CLI + an MCP server, so Claude Code / Cursor build *and keep maintaining* it. |
| **Fails loudly** | Incompatible data fails validation with a named error — never a silent wrong chart. |
| **Live** | Edit the manifest or drop a new export — the dashboard updates over your live files, no rebuild. |

This is not a hosted app builder, not a WYSIWYG dashboard tool, and not a BI platform.
It is the typed, file-based layer an agent edits safely.

## How it works

```
files (CSV/JSON/Parquet/md)  →  native DuckDB query core (runs transforms/queries LIVE)
                                       │
        manifest (typed islands)  →  serve runtime (TanStack Start SSR)  →  your dashboard
                                       ↑              │ SSE on file change → islands refetch
        AI agent  ──(MCP: propose → validate → diff → apply → rollback)──┘
```

- **`@openislands/schema`** — Zod schemas for the manifest + islands → also emits JSON
  Schema for editor autocomplete and agent grounding. The single source of truth.
- **`@openislands/compiler`** — the DuckDB query core: turns files into typed data
  contracts and runs transforms/queries live; checks every island binding against the data.
- **`@openislands/runtime`** — the island registry and renderer (the `serve` runtime).
- **`openislands`** — the CLI (`init` / `validate` / `serve` / `add`).
- **`@openislands/mcp`** — the MCP server: read-many / write-one, so an agent edits your
  dashboard without it rotting.

## Templates

`finance` (net worth / portfolio), `health` (macros, biomarkers, wearables — pairs with
[health-mcp](https://github.com/lukaisailovic/health-mcp)), and `operations` (a non-personal
breadth-prover). The same engine renders all three with no domain-specific hacks.

## Status

Early, and live-first (no static export in v1 — it's deferred with a future publish tier).
The schema, compiler, runtime, CLI, MCP server, and three templates work today, and
`pnpm test` is green. `openislands serve` boots the production runtime (**TanStack Start**
SSR + React islands + TanStack Query + SSE live updates) and queries your files live through
the DuckDB core on every request. An optional hosted sync/publish tier comes later.

## Develop

```bash
pnpm install
pnpm build      # tsdown (rolldown / Oxc) across packages
pnpm test       # vitest
pnpm lint       # oxlint
pnpm format     # oxfmt
pnpm validate:templates
```

Toolchain: pnpm + Turborepo + Changesets, **tsdown (rolldown/Oxc)** for builds,
**oxlint** + **oxfmt** for lint/format, Vitest, Node ≥ 20, ESM-only.

## License

MIT © Luka Isailovic
