# The data-app model

How an OpenIslands app is described. Read this when editing a manifest (a template,
an example, or a user's dashboard) or adding/changing an island. The authoritative
config schema is always `packages/schema/src/index.ts`; the public prose version of
this lives in the docs site under `apps/docs/src/pages/`.

## The manifest

```jsonc
{
  "version": 1,
  "title": "Finance Overview",
  "icon": "wallet",                                            // optional — the app's tile in the workspace app rail
  "datasets": { "nw": { "source": "data/net_worth.csv" } },   // or { "sql": "models/x.sql" },
                                                               // or a SQLite table (writable via actions/connectors):
                                                               // { "source": "data/library.sqlite", "table": "tracks" }
                                                               // (a .sqlite/.db source requires "table"; "table" anywhere else is an error)
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

### Layout: spans, pages, groups

`span` is a 1–12 grid column count; each group gets its own 12-column grid. Every island type
has a minimum span below which it stops being legible (`ISLAND_MIN_SPAN` in
`packages/schema/src/index.ts`): `metric.kpi`/`source.doc`/`gauge.goal` 2, `note.card`/`gauge.meter`/`search.box` 3, `table.grid` 5,
everything else 4. An explicit `span` below its type's minimum is a named validation error
(e.g. "span 1 is below the minimum 4 for timeseries.line"). The runtime additionally floors
spans responsively — below ~640px every tile goes full-width, and in a middle band spans render
at `max(span, 6)` — so a tile never renders narrower than its minimum usable width.

Multiple pages render a sidebar (single-page apps stay chrome-free); groups render as tabs under
the page header, deep-linked via `?group=<id>`. Island errors are indexed flat across a page's
groups in declared order — a `layout.row` is transparent to that indexing: the row itself takes no
index, its child islands take sequential flat indices as if declared inline, and the row only
forces them onto their own full-width grid row.

### Page filters (shared date range)

A page's optional `filters` declare a shared date range, rendered as a control in the page
header. Each filter's `bind` maps a dataset to the date column the range applies to; islands
on the page bound to one of those datasets re-query together when the range changes (state
lives in `?from=&to=` as `YYYY-MM-DD`), and every other island ignores it. The bound column
is validated against the live data exactly like an island binding — a missing column fails
`validate`/`propose_edit` naming the page, filter id, dataset, and column. The range compares
correctly whether the column is a `DATE`/`TIMESTAMP` or a string: a `YYYY-MM` month string is
matched against the `YYYY-MM` prefix of the bound, so a `from`/`to` inside a month still
includes that month.

## Built-in islands and their required fields

Get any island's exact config schema with `get_island_schema(type)` (MCP) or read
`packages/schema/src/index.ts`.

| type | required | notes |
|---|---|---|
| `metric.kpi` | `dataset`, `value` | `compareTo: "prev"` for a delta; `format: eur\|kg\|int\|pct\|date\|datetime\|time` (`date` → `Jun 11, 2026`, `datetime` → `Jun 11, 21:30`, `time` → `21:30`) |
| `timeseries.line` | `dataset`, `x`, `y` | `y` may be a string or array; `options.goalField` for a goal line; with `series`, many distinct values auto-show a searchable picker (`options.seriesPicker` forces/disables it) |
| `category.bar` | `dataset`, `x`, `y` | `group`, `stacked` optional |
| `breakdown.treemap` | `dataset`, `label`, `value` | a treemap of (optionally hierarchical) parts of a whole |
| `category.pie` | `dataset`, `label`, `value` | a pie or donut of one series' share; `donut: true` for a hole, slices sum by `label`, only positive values render |
| `correlation.scatter` | `dataset`, `x`, `y` | `series` colors point groups, `size` scales bubbles, `label` names points; `xFormat`/`format` style the x/y axes + tooltip |
| `distribution.heatmap` | `dataset`, `x`, `y`, `value` | a value across x × y categories, shaded on a continuous scale; pre-aggregate to one value per cell (last value wins) |
| `activity.calendar` | `dataset`, `date`, `value` | a daily value over weeks/months, GitHub-contributions style; same-day rows sum, any parseable date |
| `funnel.steps` | `dataset`, `label`, `value` | sequential stages sized by share; `sort` (none/descending/ascending) reorders, default keeps row order; only finite, non-negative values |
| `compare.radar` | `dataset`, `metrics` | each `metrics` field is an axis, each row a polygon (named by `series`, else numbered); `max` fixes the axis scale, else per-axis peak |
| `table.grid` | `dataset` | optional `columns: [{field,label,format}]`; `details: [{field,label?,format?}]` hides fields from the row and reveals them in a click-to-open dialog; `groupBy: {field,titleField?,subtitleField?}` renders rows as collapsible sections by `field` (title/subtitle read from each group's first row); `drilldown: {island, match}` embeds an island in the details dialog, its rows filtered by `match: {<drilldown column>: <clicked-row field>}` (one level — a drilldown island has no drilldown of its own; it never shows a see-all dialog, every row renders inline); `expand: false` drops the see-all / expand dialog and renders every row inline (default true) |
| `timeline.feed` | `dataset`, `ts`, `titleField` | `detail`, `kind` optional; `ts` renders smartly with no config (a date-only/midnight value as `Jun 11, 2026`, a real timestamp as `Jun 11, 21:30`); `details: [{field,label?,format?}]` makes rows clickable, revealing those fields in a dialog; `groupBy: {field,titleField?,subtitleField?}` renders rows as collapsible sections by `field`; rich rows via `highlight: {field,format?,unit?}` (emphasized value, right of the title), `stats: [{field,label?,format?,unit?,color?}]` (labeled stats under the title; label colors default to a palette, `color` pins a CSS color), `footer: [{field,label?,format?,unit?,pill?}]` (meta line led by the timestamp; `pill: true` renders a badge) — any of the three switches the row from a one-liner to the header/stats/footer layout; `drilldown: {island, match}` and `expand: false` as on `table.grid` |
| `gauge.rings` | `dataset`, `rings` | concentric goal rings off the last row; `rings: [{value, max, label?, color?, direction?}]`, `max` a column or a number; `direction: atLeast` (default, fills toward a goal) \| `atMost` (a budget — over the limit turns the ring danger-red) |
| `gauge.goal` | `dataset`, `value`, `goal` | single ring vs a goal off the last row; `goal: {min?, max?}` (each a column or a number, at least one — both = a target band); within the goal is success-green, under is amber, over is danger-red; hover shows `value (goal …)` |
| `gauge.meter` | `dataset`, `meters` | one or more horizontal usage bars off the last row; `meters: [{value, max, label?, color?}]`, `max` a column or a number; each meter shows `value / max` and fills proportionally in its own color (built-in palette by default) |
| `search.box` | `dataset`, `fields`, `titleField` | a search input over a dataset — typing matches rows case-insensitively across `fields` (client-side substring), results drop down as an autocomplete showing `titleField` (+ optional `detail` secondary line); selecting a result opens the full row in a details dialog; `placeholder?`, `limit?` (default 10) caps visible results |
| `note.card` | `markdown` | no dataset |
| `source.doc` | — | `file` or `href`; `kind: pdf\|markdown\|image\|link` |
| `layout.row` | `islands` | a full-width structural row holding other islands — children render on their own 12-column grid row; no `span`/`title`, no nesting, no data binding |

## Custom islands

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
