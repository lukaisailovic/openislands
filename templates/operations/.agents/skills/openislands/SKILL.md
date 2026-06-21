---
name: openislands
description: Build and maintain OpenIslands data dashboards — typed manifests of visual islands bound to local files (CSV / JSON / Parquet / SQLite / markdown), edited safely over the OpenIslands MCP server. Use whenever a project has an app/manifest.json or an .mcp.json naming the openislands MCP server, and you are adding or changing datasets, islands, pages, actions, queries, or connectors, fixing a validation or binding error, or authoring a SQL transform.
---

# Working with OpenIslands

An OpenIslands app is a **manifest** (`app/manifest.json`) of reusable visual **islands** bound to
**typed data contracts** built from local files. You edit the manifest — never rendering code. The
data stays in the project's files; `serve` queries them live. The whole point is that the dashboard
**fails loudly** when a binding and the data disagree, instead of silently rendering a wrong number,
so an agent can keep it healthy for months.

You make every change through the **OpenIslands MCP server** (`@openislands/mcp`, already wired in
`.mcp.json`). It is a safety boundary: **read freely, write through one validated pipeline.** Nothing
is written until you apply a validated proposal, and every write is snapshotted for rollback.

## The loop

1. **Read** — `get_manifest`, `list_islands`, `get_island_schema`, `get_data_schema`, `query_data`.
2. **Edit** — `patch_manifest` for one section at a time (preferred), or `propose_edit` for a full
   rewrite. Both return a `proposal_id` + a diff and write **nothing** yet.
3. **It already validated** — the edit tools dry-run the result against the live data. If `ok` is
   `false`, read `errors` (each names the page, island, and field) and fix the edit. Do **not** work
   around a binding error — it is the safety net.
4. **Apply** — `apply_edit({ proposal_id })`. This writes the manifest and returns a `checkpoint_id`.
5. **Undo if needed** — `rollback({ checkpoint_id })` (or latest). Restores byte-for-byte.

Prefer **`patch_manifest`** over `propose_edit`: it merges one section into the current manifest, so
you never re-send (or re-typo) the whole document. Pass JSON **objects**, not JSON strings.

## The manifest model

```jsonc
{
  "version": 1,
  "title": "My dashboard",
  "datasets": { "<name>": { "source": "data/x.csv" } },   // or { "sql": "models/x.sql" }
  "pages":    [ { "id": "overview", "islands": [ /* islands */ ] } ],
  "actions":  { "<name>": { "dataset": "<name>", "mode": "insert" } },   // optional, typed writes
  "queries":  { "<name>": { "dataset": "<name>", "select": [], "where": [] } },  // optional, typed reads
  "connectors": { "<name>": { "module": "connectors/x", "datasets": {} } }       // optional, external pulls
}
```

- **datasets** — a named map. Exactly one of `source` (a `.csv` / `.json` / `.parquet` / `.sqlite` /
  `.md` file) **or** `sql` (a path to a DuckDB transform). SQLite sources need a `table`. Source files
  live under `data/`, `models/`, `docs/`, or `app/`.
- **pages → islands** — each island has a `type`, an optional `span` (1–12 grid columns), and type-specific
  fields. Data islands name a `dataset` and the columns they bind (e.g. `value`, `x`, `y`, `label`).
  A page uses either a flat `islands` array or tabbed `groups`, not both.
- **actions** — declare a typed `insert` into a writable dataset; run rows through `run_action`.
- **queries** — declare a typed, parameterized read; run it through `run_query`. No raw SQL in queries —
  heavy shaping lives in a `sql` transform the query reads from.

Don't put transforms inside island configs. **The manifest stays declarative; data shaping lives in the
SQL/data layer.**

## Discover the island catalog — don't guess

Island configs are the keystone schema and can change. Always ground an edit in the live contract:

- `list_islands` → every built-in type with its required fields and a one-line description.
- `get_island_schema({ type })` → the full JSON Schema for one type.

Built-ins span metrics (`metric.kpi`, `metric.scorecard`), charts (`timeseries.line`, `category.bar`,
`category.combo`, `category.pie`, `waterfall.bars`, `breakdown.treemap`, `correlation.scatter`,
`distribution.heatmap`, `compare.radar`, `map.choropleth`, `funnel.steps`), gauges (`gauge.goal`,
`gauge.rings`, `gauge.meter`), tables/feeds (`table.grid`, `timeline.feed`, `rank.list`,
`status.grid`, `activity.calendar`), content (`note.card`, `source.doc`, `content.editor`), and input
(`search.box`, `form.entry`). Prefer a built-in; an unknown type renders a placeholder until a custom
renderer exists under `components/custom/`.

## Recipes

**Add a chart to a page.** Read the current page, append the island, send just that page:

```jsonc
// patch_manifest
{ "pages": [ { "id": "overview", "title": "Overview", "islands": [
    /* ...existing islands... */,
    { "type": "rank.list", "title": "Top assets", "dataset": "allocation",
      "label": "class", "value": "value_eur", "span": 6 }
] } ] }
```

A page in `pages` is **upserted by `id`** (same id replaces, new id appends). `remove_pages: ["id"]`
deletes one.

**Add a dataset from a file.** Put the file under `data/` (use your file tools), then:

```jsonc
// patch_manifest
{ "datasets": { "crypto": { "source": "data/crypto.csv", "description": "holdings" } } }
```

Check the inferred columns with `get_data_schema({ dataset: "crypto" })` before binding islands to it.

**Add a derived dataset (SQL transform).** Transforms shape data with DuckDB SQL. Author the SQL first
and dry-run it, *then* wire it in:

1. Write the file under `models/` with your file tools, e.g. `models/transforms/allocation.sql`:
   ```sql
   SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class
   ```
2. Dry-run it: `validate_sql({ sql: "SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class" })`.
   You get back the result columns, or the **exact** DuckDB error (e.g. `Catalog Error: Table "holding" does
   not exist`). Fix it until it's valid. A transform can read any other dataset by its name.
3. Wire it: `patch_manifest({ datasets: { allocation: { sql: "models/transforms/allocation.sql" } } })`.

**Add a typed write (action).** Targets a writable file dataset (CSV / SQLite), not a `sql` transform:

```jsonc
// patch_manifest
{ "actions": { "log_txn": { "dataset": "transactions", "mode": "insert",
    "description": "Record a transaction",
    "fields": { "amount": { "type": "number", "min": 0 }, "kind": { "type": "string", "enum": ["in","out"] } } } } }
```

Then append rows with `run_action({ name: "log_txn", rows: [{ amount: 50, kind: "in" }] })` — every row
is validated all-or-nothing and the file is snapshotted for rollback.

**Add a typed read (query).** Declarative, parameterized, no raw SQL:

```jsonc
// patch_manifest
{ "queries": { "by_class": { "dataset": "allocation",
    "select": ["class", "value_eur"], "params": { "class": { "type": "string" } },
    "where": [ { "field": "class", "op": "eq", "param": "class" } ] } } }
```

Run it with `run_query({ name: "by_class", params: { class: "BTC" } })`.

**Remove something.** In a record section, set the entry to `null`:
`patch_manifest({ queries: { by_class: null }, actions: { log_txn: null } })`. For pages, use `remove_pages`.

**Connectors.** `list_connectors` shows each connector's status. If `connected` is false it needs a secret
or OAuth — **authorizing is human-only** (the Connect button in the running dashboard). Surface that to the
user; don't try to sync. When connected, `run_sync({ name })` pulls into its datasets (checkpointed).

## Rules that keep the app healthy

- **Validate is the contract.** A binding error names the page, island, and field — fix the manifest or
  the data, never silence it.
- **Bind only to columns that exist.** Use `get_data_schema` / `validate_sql` to confirm columns before
  binding.
- **Sources stay under `data/` / `models/` / `docs/` / `app/`.** Secrets (`.env*`) and `.openislands/` are
  off-limits.
- **Prefer `patch_manifest`; pass objects.** Re-sending a full manifest string is the easiest way to
  introduce a typo.
- **Files are the source of truth.** There is no static export — `serve` reads the files live and pushes
  updates over SSE as they change.

## Running it

```bash
npx openislands serve        # boots the live dashboard at 127.0.0.1:4321
npx openislands validate     # compiles + checks every binding against the data (names what's wrong)
```

`serve` refuses to boot an invalid manifest, so `validate` (or a failed `patch_manifest`) tells you exactly
what to fix.
