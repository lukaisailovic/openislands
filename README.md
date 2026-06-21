<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lukaisailovic/openislands/main/apps/docs/public/logo-light.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/lukaisailovic/openislands/main/apps/docs/public/logo-dark.svg">
  <img alt="OpenIslands" src="https://raw.githubusercontent.com/lukaisailovic/openislands/main/apps/docs/public/logo-light.svg" width="84" height="84">
</picture>

# OpenIslands

**Dashboards your AI agent builds and keeps maintaining, over data that never leaves your machine.**

Point a coding agent at a folder of files. It builds a typed, durable dashboard
and keeps it healthy for months as the data changes. No cloud, no account,
no rendering code to rot.

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-2dd4bf.svg"></a>
  <img alt="Node &gt;= 20" src="https://img.shields.io/badge/Node-%3E%3D_20-2dd4bf.svg">
  <img alt="ESM only" src="https://img.shields.io/badge/Module-ESM-2dd4bf.svg">
  <img alt="Status: alpha" src="https://img.shields.io/badge/Status-alpha-f59e0b.svg">
  <a href="./CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-2dd4bf.svg"></a>
</p>

<p>
  <a href="#quickstart">Quickstart</a> &nbsp;·&nbsp;
  <a href="#why-openislands">Why</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a> &nbsp;·&nbsp;
  <a href="#islands">Islands</a> &nbsp;·&nbsp;
  <a href="#documentation">Docs</a> &nbsp;·&nbsp;
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

</div>

---

AI agents are great at building a dashboard once. Then a column gets renamed, a new
export lands, you ask a different question, and the generated app quietly breaks or,
worse, keeps rendering the wrong number. OpenIslands fixes the part agents are bad at:
keeping it alive.

It's a local-first compiler and runtime. An app is a typed **manifest** of reusable
visual **islands** (KPI cards, charts, tables, gauges, timelines) bound to **typed data
contracts** built from your files. Your agent edits the manifest, never the rendering
code, through a pipeline that validates, diffs, and can roll back every change. When the
data and an island disagree, the build fails loudly and names the island instead of
drawing something wrong.

## Quickstart

Scaffold a project, then serve it over your files:

```bash
npx openislands init my-dashboard            # blank starter (the empty template)
cd my-dashboard
npx openislands serve                        # http://127.0.0.1:4321
```

With no flag, `init` scaffolds the `empty` template: a blank starter you build up from your
own files. Want a populated example? Pass `--template finance` (the flagship: net worth,
allocation, holdings, and transactions over CSVs you own). `health` and `operations` ship
too.

Now hand it to an agent. Add the MCP server to your tool of choice (Claude Code, Cursor,
and friends), pointed at the project directory:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "openislands": {
      "command": "npx",
      "args": ["-y", "@openislands/mcp", "."]
    }
  }
}
```

Then just ask:

> Drop `data/spending.csv` into the project and add a page charting monthly spend by category.

The agent reads your data, proposes the change so you see a diff before anything is
written, applies it with a snapshot of the prior version, and rolls back if the result
is wrong. Leave `serve` running and the page live-updates over SSE as each edit lands.

### Agents and skills

`init` sets this up for you. Every scaffolded project ships a local `.mcp.json`, an
`AGENTS.md`, and the OpenIslands skill under `.agents/skills/openislands/`, so an agent
that opens the folder picks up the MCP tools and the conventions with no extra wiring.

Want the skill in another project or in your own agent setup? Install it anywhere:

```bash
npx skills add lukaisailovic/openislands --skill openislands
```

Or skip the scaffold entirely and let an agent drive from a single paste:

> Read https://openislands.sh/start.md then help me build my first agent-maintained dashboard.

## Why OpenIslands

|  |  |
|---|---|
| **Your data, your disk** | Plain files you own. No account, no cloud, nothing to sign into. |
| **Built to last** | Typed islands from a closed registry. There's no 300-line React component to rot. |
| **Agent-maintained** | A CLI and an MCP server, so Claude Code or Cursor build the dashboard and keep it healthy. |
| **Fails loudly** | Bind an island to a field that doesn't exist and validation stops with a named error. You never get a silently wrong chart. |
| **Always live** | Edit the manifest or drop a new export and the dashboard updates over your live files. No rebuild, no snapshot to drift. |

It isn't a hosted app builder or a BI platform. It's the typed, file-based layer your
agent edits safely.

## How it works

```text
 files (CSV / JSON / Parquet / md)
        │
        ▼
 DuckDB query core  ──  runs transforms + queries live  ──┐
        │                                                 │
 manifest (typed islands)  ──►  serve runtime  ──►  your dashboard
                                (TanStack Start SSR)      ▲
                                       │ SSE on file change → islands refetch
        AI agent  ──(MCP: propose → validate → diff → apply → rollback)──┘
```

The pieces, smallest contract first:

| Package | Role |
|---|---|
| `@openislands/schema` | The keystone. Zod schemas for the manifest and islands, emitted as TypeScript types and JSON Schema for editor autocomplete and agent grounding. Everything else depends on it. |
| `@openislands/compiler` | The DuckDB query core. Turns files into typed data contracts, runs transforms and queries live, and checks every island binding against the data. |
| `@openislands/runtime` | The island registry and renderers behind `serve` (TanStack Start SSR + React islands + live updates). |
| `openislands` | The CLI: `init`, `validate`, `serve`, `add`, `infer`. |
| `@openislands/mcp` | The MCP server. Read many, write one, so an agent edits the manifest without breaking it. |

## Islands

An island is a reusable, typed visual block. You declare it in the manifest, bind it to
fields that exist in your data, and the runtime renders it. The built-ins cover most of a
dashboard:

- **Metrics & gauges:** KPI cards, scorecards, goal rings, meters, status grids.
- **Charts:** line, bar, combo, and pie, over time or category.
- **Tables & feeds:** sortable grids and activity feeds.
- **Content & layout:** Markdown notes, a rich content editor, and rows that group islands.

Need something the registry doesn't have? Drop a renderer under `components/custom/` and
bind to it like any other island. The full catalog, with required fields and live
previews, lives in the [docs](#documentation).

## Templates

Three templates ship with the repo, and the same engine renders all of them with no
domain-specific hacks:

- **`finance`:** net worth, portfolio allocation, holdings, transactions.
- **`health`:** macros, biomarkers, and wearables (pairs with [health-mcp](https://github.com/lukaisailovic/health-mcp)).
- **`operations`:** a non-personal template that proves the breadth of the island set.

## Status

Alpha, and live-first. The schema, compiler, runtime, CLI, MCP server, and all three
templates work today, and `pnpm test` is green. There's no static export in v1: `serve`
boots the production runtime and queries your files on every request. A hosted
publish/sync tier may come later.

## Documentation

- [Data app model](./docs/data-app-model.md): the manifest, the island catalog, data contracts, and workspaces.
- [Agent edit loop](./docs/agent-edit-loop.md): the read-many/write-one MCP loop, actions, queries, and connectors.
- [Contributing](./CONTRIBUTING.md): adding an island, the PR gate, releases.

The full docs site lives in [`apps/docs`](./apps/docs) (built with Vocs).

## Develop

```bash
pnpm install
pnpm build                 # tsdown (rolldown / Oxc) across packages
pnpm test                  # vitest
pnpm typecheck             # tsc --noEmit per package
pnpm lint                  # oxlint
pnpm validate:templates    # every template's manifest + bindings
pnpm demo                  # serve the finance template locally
```

Toolchain: pnpm + Turborepo + Changesets, tsdown for builds, oxlint and oxfmt for
lint/format, Vitest, Node ≥ 20, ESM only. See [CONTRIBUTING.md](./CONTRIBUTING.md) before
opening a PR.

## License

[MIT](./LICENSE) © Luka Isailovic
