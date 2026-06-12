# Working in OpenIslands (agent guide)

This file teaches an AI coding agent how to work with OpenIslands — both this repo
and a user's dashboard project. Read it before editing.

## What OpenIslands is

A local-first compiler + runtime for **agent-maintained data apps**. An app is a typed
**manifest** of reusable visual **islands** bound to **typed data contracts** built from
local files. You edit the manifest; you never write rendering code. The point is that an
agent can maintain a dashboard for months without it rotting.

## The golden rules

1. **Edit the manifest, transforms, schemas, and content — never build output.**
   `dist/` is rebuildable; the build owns it. Never hand-edit it. There are no
   `generated/` snapshots — the runtime queries your files live.
2. **Bind islands only to fields that exist in the data.** Run `validate` after every edit.
   If a binding references a missing field, the build fails and names the island. That is
   the safety net — respect it, don't work around it.
3. **Prefer the built-in islands.** Unknown types are accepted as *custom* islands but render
   a placeholder until someone adds a renderer in `components/custom/`.
4. **Keep the manifest declarative.** No transforms inside island configs — data shaping lives
   in the data/SQL layer, not the manifest.

## Editing a user's dashboard (the safe loop)

Use the MCP server (`@openislands/mcp`) — it is read-many / write-one:

- **Read first:** `list_islands` (built-in types + required fields), `get_island_schema(type)`,
  `get_manifest`, `get_data_schema(dataset)`, `query_data({ dataset } | { sql }, limit)` —
  pass a `dataset` name for a whole dataset *or* a read-only `sql` SELECT over the registered
  dataset views, not both — `validate_manifest`, and `list_checkpoints` (rollback points, newest last).
- **Then the manifest write path:** `propose_edit(manifest)` takes the **full** manifest, validates it
  + checks every binding against the live data, and returns a `diff` — but does **not** write. If the
  data check fails it returns `{ ok: false, errors }` (each error names the page, island index, type,
  and missing field) with **no** `proposal_id`; fix the binding and propose again. On success it
  returns a `proposal_id`. Review the diff, then `apply_edit(proposal_id)` writes the manifest and
  snapshots the prior version as a checkpoint — its result includes `checkpoint_id`. A proposal is
  rejected if unknown or **stale** (the manifest on disk changed since it was proposed); re-run
  `propose_edit`. `rollback(checkpoint_id?)` restores a checkpoint byte-for-byte (latest if omitted) —
  it restores manifest *and* data checkpoints; the id encodes the target file. There is no raw
  file-write tool and no git dependency by design — rollback safety is `.openislands/history/`
  snapshots (count + byte capped, oldest pruned first).
- **The data write path — Actions:** a manifest-declared, typed append into a `source` dataset
  (CSV / JSON(L) only; `sql` datasets are derived and never writable). Discover with `list_actions`
  (declared actions + their resolved row JSON Schema, derived from the live data merged with the
  action's `fields` overrides), then `run_action(name, rows)` — every row is validated first; a bad
  row rejects the whole call with an error naming the row index + field and nothing is written.
  The target file is snapshotted to `.openislands/history/` before the append, so `rollback`
  covers data writes too. Declare an action in the manifest:

  ```jsonc
  "actions": {
    "log_meal": { "dataset": "meals", "mode": "append",
      "fields": { "meal_type": { "enum": ["breakfast", "lunch", "dinner", "snack"] } } }
  }
  ```

Without MCP, the same loop is: edit `app/manifest.json` → `openislands validate` → `openislands serve`.

## Workspaces (multiple apps, one process)

`openislands serve <dir>` serves either a single app project (the dir holds `app/manifest.json`)
or a **workspace**: a directory whose immediate subdirectories are app projects (e.g. this
repo's `apps/examples/`). A workspace runs in ONE process on ONE port — the UI gets a
Discord-style left rail of app tiles to switch apps; with a single app the rail hides.

- URLs are always `/<appId>/<pageId>`; the app id is the subdirectory name (single-app serve
  derives it from the project dir's basename). `/` redirects to the first app's first page.
- An app's rail tile uses the manifest's optional top-level `icon` (same curated set as page
  icons), falling back to a letter tile from its `title`.
- An optional root `openislands.json` holds workspace overrides — `{ "order": [..],
  "hidden": [..] }`. `serve` writes a default (the scanned app list as `order`) when absent.
  The app registry is derived live from disk: dropping a new app directory into the workspace
  shows up on the next page load, no restart.
- A workspace app whose manifest fails validation still serves: its tile gets an error badge
  and the page shows the named errors; fix the file and live reload recovers it. Single-app
  serve keeps the strict behavior (refuses to boot on compile errors).
- Every data API is app-scoped (`/api/query?app=..&dataset=..`, `/api/events?app=..`,
  `/api/file?app=..`, `/api/connectors/..?app=..`); DuckDB engines, file watchers, SSE
  broadcasters, and connector schedulers are all per-app. Watchers start lazily on an app's
  first SSE client. OAuth callback paths stay app-agnostic — the callback finds the app by
  matching the flow's `state`.

## Connectors

A **connector** is a vendored integration that syncs a provider's data into `source`
datasets — through the same checkpointed write path actions use, so `rollback` covers
connector writes too. The code lives in the **user's** project at `connectors/<name>/index.ts`
(the directory name *is* the connector name, mirroring custom islands), default-exporting
`defineConnector({ ... })` from `@openislands/connector-kit`. Dropping one in is: copy the
directory into `connectors/`, add a manifest `connectors` entry, set its `.env` keys.

Declare it in the manifest parallel to `actions`:

```jsonc
"connectors": {
  "whoop": {
    "module": "connectors/whoop",                  // dir relative to project root
    "datasets": { "recovery": "whoop_recovery" },  // connector output → manifest source dataset
    "schedule": "6h",                              // optional, overrides the connector's default
    "config": { "lookbackDays": 30 }               // validated against the connector's own zod schema
  }
}
```

Each `datasets` value must name a writable `source` dataset (never `sql`); each key must be
one of the connector's declared `outputs`. `validate` loads the module, parses `config`, and
checks the outputs — a bad config, unknown output, or invalid schedule is a named error.

**The agent loop** (auth itself stays human-only — OAuth runs in the dashboard browser):

- `list_connectors` → each connector's status: `connected`, `missingSecrets`, `lastSync`,
  `lastError`, effective `schedule`, `loadError`. This is how you discover auth is missing.
- `run_sync({ name })` → pulls from the provider and writes rows; returns rows-per-dataset,
  mode (`append` / `replace`), and a `checkpoint_id` (so a sync is reversible with `rollback`).
  If a connector isn't connected (OAuth not completed, or secrets missing), tell the user to
  open the dashboard and click **Connect** — do **not** attempt to authorize from the agent.

A connector picks append vs replace per output by which context method it calls: `ctx.append`
(immutable records; advance a cursor in `ctx.state`) vs `ctx.replace` (records that get
revised — e.g. Whoop recovery scores — rewrite the whole file each sync). Tokens + cursor
state persist at `.openislands/connectors/<name>.json` (gitignored). See
`apps/examples/health/connectors/whoop/` for a complete OAuth2 reference connector.

A project's `package.json`/`tsconfig.json` (scaffolded by `init`) exist for **editor types
only** — `npm install` once and connector/custom-island files typecheck against
`@openislands/connector-kit`; the runtime never needs the project's `node_modules` and
always bundles against its own copies.

## The manifest

```jsonc
{
  "version": 1,
  "title": "Finance Overview",
  "icon": "wallet",                                            // optional — the app's tile in the workspace app rail
  "datasets": { "nw": { "source": "data/net_worth.csv" } },   // or { "sql": "models/x.sql" }
  "pages": [{
    "id": "overview",                                          // one sidebar entry per page
    "icon": "house",                                           // optional, curated set (PAGE_ICONS)
    "filters": [                                               // optional page-level shared filters
      { "id": "period", "type": "daterange", "label": "Period",
        "bind": { "nw": "month", "transactions": "ts" } }      // dataset → date column
    ],
    "islands": [
      { "type": "timeseries.line", "title": "Net worth", "dataset": "nw", "x": "month", "y": "net_worth_eur",
        "options": { "goalField": "target_eur" }, "span": 7 }
    ]
  }, {
    "id": "holdings",                                          // a page holds EITHER flat `islands`
    "groups": [                                                // OR tabbed `groups` — never both
      { "id": "positions", "title": "Positions", "islands": [/* ... */] },
      { "id": "activity", "title": "Activity", "islands": [/* ... */] }
    ]
  }]
}
```

`span` is a 1–12 grid column count; each group gets its own 12-column grid. Every island type
has a minimum span below which it stops being legible (`ISLAND_MIN_SPAN` in
`packages/schema/src/index.ts`): `metric.kpi`/`source.doc`/`gauge.goal` 2, `note.card` 3, `table.grid` 5,
everything else 4. An explicit `span` below its type's minimum is a named validation error
(e.g. "span 1 is below the minimum 4 for timeseries.line"). The runtime additionally floors
spans responsively — below ~640px every tile goes full-width, and in a middle band spans render
at `max(span, 6)` — so a tile never renders narrower than its minimum usable width. Multiple pages
render a sidebar (single-page apps stay chrome-free); groups render as tabs under the page
header, deep-linked via `?group=<id>`. Island errors are indexed flat across a page's groups
in declared order — a `layout.row` is transparent to that indexing: the row itself takes no
index, its child islands take sequential flat indices as if declared inline, and the row only
forces them onto their own full-width grid row. Get any island's exact config schema with
`get_island_schema(type)` or read `packages/schema/src/index.ts`.

A page's optional `filters` declare a shared date range, rendered as a control in the page
header. Each filter's `bind` maps a dataset to the date column the range applies to; islands
on the page bound to one of those datasets re-query together when the range changes (state
lives in `?from=&to=` as `YYYY-MM-DD`), and every other island ignores it. The bound column
is validated against the live data exactly like an island binding — a missing column fails
`validate`/`propose_edit` naming the page, filter id, dataset, and column. The range compares
correctly whether the column is a `DATE`/`TIMESTAMP` or a string: a `YYYY-MM` month string is
matched against the `YYYY-MM` prefix of the bound, so a `from`/`to` inside a month still
includes that month.

### Built-in islands and their required fields

| type | required | notes |
|---|---|---|
| `metric.kpi` | `dataset`, `value` | `compareTo: "prev"` for a delta; `format: eur\|kg\|int\|pct\|date\|datetime\|time` (`date` → `Jun 11, 2026`, `datetime` → `Jun 11, 21:30`, `time` → `21:30`) |
| `timeseries.line` | `dataset`, `x`, `y` | `y` may be a string or array; `options.goalField` for a goal line; with `series`, many distinct values auto-show a searchable picker (`options.seriesPicker` forces/disables it) |
| `category.bar` | `dataset`, `x`, `y` | `group`, `stacked` optional |
| `breakdown.treemap` | `dataset`, `label`, `value` | the one island that uses ECharts (Plot has no treemap) |
| `table.grid` | `dataset` | optional `columns: [{field,label,format}]`; `details: [{field,label?,format?}]` hides fields from the row and reveals them in a click-to-open dialog; `groupBy: {field,titleField?,subtitleField?}` renders rows as collapsible sections by `field` (title/subtitle read from each group's first row); `drilldown: {island, match}` embeds an island in the details dialog, its rows filtered by `match: {<drilldown column>: <clicked-row field>}` (one level — a drilldown island has no drilldown of its own; it never shows a see-all dialog, every row renders inline); `expand: false` drops the see-all / expand dialog and renders every row inline (default true) |
| `timeline.feed` | `dataset`, `ts`, `titleField` | `detail`, `kind` optional; `ts` renders smartly with no config (a date-only/midnight value as `Jun 11, 2026`, a real timestamp as `Jun 11, 21:30`); `details: [{field,label?,format?}]` makes rows clickable, revealing those fields in a dialog; `groupBy: {field,titleField?,subtitleField?}` renders rows as collapsible sections by `field`; rich rows via `highlight: {field,format?,unit?}` (emphasized value, right of the title), `stats: [{field,label?,format?,unit?,color?}]` (labeled stats under the title; label colors default to a palette, `color` pins a CSS color), `footer: [{field,label?,format?,unit?,pill?}]` (meta line led by the timestamp; `pill: true` renders a badge) — any of the three switches the row from a one-liner to the header/stats/footer layout; `drilldown: {island, match}` and `expand: false` as on `table.grid` |
| `gauge.rings` | `dataset`, `rings` | concentric goal rings off the last row; `rings: [{value, max, label?, color?, direction?}]`, `max` a column or a number; `direction: atLeast` (default, fills toward a goal) \| `atMost` (a budget — over the limit turns the ring danger-red) |
| `gauge.goal` | `dataset`, `value`, `goal` | single ring vs a goal off the last row; `goal: {min?, max?}` (each a column or a number, at least one — both = a target band); within the goal is success-green, under is amber, over is danger-red; hover shows `value (goal …)` |
| `note.card` | `markdown` | no dataset |
| `source.doc` | — | `file` or `href`; `kind: pdf\|markdown\|image\|link` |
| `layout.row` | `islands` | a full-width structural row holding other islands — children render on their own 12-column grid row; no `span`/`title`, no nesting, no data binding |

### Custom islands

When a built-in doesn't fit, register a renderer in the **user's** project under
`components/custom/<type>/` — the directory name *is* the island type (e.g.
`components/custom/heatmap.calendar/`):

```
components/custom/<type>/
  index.tsx    # default-exports a React component; it receives the same { config, data } props
               # the built-ins get (config = the manifest island, data = the queried rows).
  schema.ts    # default-exports a Zod object for the island config; imports from "zod".
```

`serve` bundles `index.tsx` on demand (no build step, no node_modules in the project) and
registers it alongside the built-ins; `validate` checks the island's manifest config against
`schema.ts` with the **same** machinery that guards the built-ins, so a bad custom config is
a named compile error — not a silent placeholder. A custom type *without* `index.tsx` still
renders the placeholder; one *without* `schema.ts` is accepted unchecked. Edits under
`components/` hot-reload (the island remounts on the next SSE event). The custom-island
fixtures in `packages/runtime/test/custom.test.ts` show the minimal shape end to end.

## This repo

```
packages/schema      # the contract — Zod → types + JSON Schema. Everything depends on it.
packages/compiler    # the DuckDB query core: files → typed contracts; runs transforms/queries live
packages/runtime     # TanStack Start app (SSR): island registry + React renderers
packages/cli         # the `openislands` command (init / validate / serve / add)
packages/mcp-server  # the MCP edit loop
templates/           # finance, health, operations
```

v1 is **live-only**: `openislands serve` boots the TanStack Start SSR runtime, which
queries your files through the DuckDB core on every request and pushes live updates over
SSE as the files change. There is no static export and no `generated/` snapshots; static
export is deferred to a future publish tier.

- **`schema` is the keystone.** Change an island's config there and the CLI, runtime, and MCP all
  follow. Add a new island: add its Zod schema + register it in `BUILTIN_ISLAND_SCHEMAS`, add a
  renderer in `runtime`, add its field requirements in `compiler`'s `islandRequirements`.
- **UI uses Kumo UI** (`@cloudflare/kumo`, docs at https://kumo-ui.com): whenever Kumo has an
  equivalent component, use it; write custom markup only when it doesn't.
- **Tests live in `test/`** (not `src/`, so the bundler doesn't ship them). Run `pnpm test`.
- **Toolchain:** pnpm + Turborepo, **tsdown (rolldown/Oxc)** builds, **oxlint** + **oxfmt**, Vitest,
  ESM-only, Node ≥ 20. `pnpm build && pnpm test && pnpm lint` before you call something done.

## Commands

```bash
pnpm install && pnpm build
pnpm test            # vitest
pnpm lint            # oxlint
pnpm validate:templates
node_modules/.bin/tsx packages/cli/src/index.ts serve templates/finance
```
