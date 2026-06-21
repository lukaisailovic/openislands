# Build a dashboard with OpenIslands

You're a coding agent. A user just pasted a prompt asking you to help them build their first
OpenIslands dashboard. This doc is your briefing. Read it, then drive the steps below.

## What OpenIslands is

A local-first runtime for dashboards that **you** maintain. A dashboard is a typed **manifest**
(`app/manifest.json`) of reusable visual **islands** (KPI cards, charts, tables, gauges, feeds)
bound to **typed data contracts** built from the user's local files — CSV, JSON, Parquet, SQLite,
or markdown. The files never leave their machine; `serve` queries them live on every request.

You edit the manifest, never rendering code. The point: the dashboard **fails loudly** when a
binding and the data disagree, instead of silently rendering a wrong number. That validation is
the safety net — it's what lets you keep the app healthy for months.

Every change goes through the **OpenIslands MCP server** (`@openislands/mcp`). It's a safety
boundary: read freely, write through one validated pipeline. Nothing is written until you apply a
validated proposal, and every write is snapshotted for rollback.

## Get the project running

One command scaffolds a complete, working project:

```bash
npx openislands init my-dashboard
```

With no flag this scaffolds the `empty` template: a blank starter (one welcome `note.card`, empty
`data/`) you build up from the user's files. If they'd rather start from a populated example, pass
`--template`: `finance` (the flagship — net worth, allocation, holdings, transactions over CSVs),
`health`, or `operations`. Either way, `init` also drops a local `.mcp.json` (already wiring
`@openislands/mcp`), an `AGENTS.md`, and this skill under `.agents/skills/openislands/` — so you're
connected over MCP automatically; no manual setup.

Then serve it so the user can watch every edit land live:

```bash
npx openislands serve        # http://127.0.0.1:4321, live-updates over SSE as files change
```

If the project isn't scaffolded from a template, the only hard requirement is an `app/manifest.json`
and a `.mcp.json` that points `@openislands/mcp` at the project root.

## The safe edit loop

1. **Read** — `get_manifest`, `list_islands`, `get_island_schema({ type })`,
   `get_data_schema({ dataset })`, `query_data({ dataset | sql, limit })`. Ground every edit in the
   live contract; don't guess island fields or column names.
2. **Edit** — `patch_manifest({ ... })` merges one section into the current manifest (preferred), or
   `propose_edit({ manifest })` for a full rewrite. Both return a `proposal_id` + a diff and write
   **nothing** yet. Pass JSON **objects**, not strings.
3. **It already validated** — the edit tools dry-run the result against the live data. If `ok` is
   `false`, read `errors` (each names the page, island, and field) and fix the edit. Do **not** work
   around a binding error.
4. **Apply** — `apply_edit({ proposal_id })` writes the manifest and returns a `checkpoint_id`.
5. **Undo if needed** — `rollback({ checkpoint_id })` (or latest) restores byte-for-byte, including
   any data writes.

Prefer `patch_manifest` — you never re-send (or re-typo) the whole document.

## The manifest model

```jsonc
{
  "version": 1,
  "title": "My dashboard",
  "datasets": { "<name>": { "source": "data/x.csv" } },        // or { "sql": "models/x.sql" }
  "pages":    [ { "id": "overview", "islands": [ /* islands */ ] } ],
  "actions":  { "<name>": { "dataset": "<name>", "mode": "insert" } },          // optional typed writes
  "queries":  { "<name>": { "dataset": "<name>", "select": [], "where": [] } }, // optional typed reads
  "connectors": { "<name>": { "module": "connectors/x", "datasets": {} } }      // optional external pulls
}
```

- **datasets** — a named map. Exactly one of `source` (a `.csv` / `.json` / `.parquet` / `.sqlite` /
  `.md` file) **or** `sql` (a path to a DuckDB transform). SQLite sources need a `table`.
- **pages → islands** — each island has a `type`, an optional `span` (1–12 grid columns), and
  type-specific fields. Data islands name a `dataset` and the columns they bind (`value`, `x`, `y`,
  `label`, …). A page uses either a flat `islands` array or tabbed `groups`, not both.
- **actions** — a typed `insert` into a writable file dataset; append rows with `run_action`.
- **queries** — a typed, parameterized read; run it with `run_query`. No raw SQL — heavy shaping
  lives in a `sql` transform the query reads from.

## Layout & sizing

Each island has a **min / recommended / max** span on the 12-column grid — check
`get_island_schema({ type })` (its `layout` + `notes`) before you set `span`. Keep **compact**
islands narrow (KPIs, funnels, gauges, pies, radars cap well below full width — a `span` over the
max is a named error) and let **data-dense** islands (tables, charts, feeds, calendars) run the
full 12. Omit `span` for the recommended width. Don't ship a lone KPI — group 2+ in a row or use
`metric.scorecard`. `validate` and the edit tools also return advisory layout `warnings` for these
smells; they never block the apply.

## CRUD recipes

`patch_manifest` takes record sections as `name → spec` (and `name → null` to delete); `pages` are
full Page objects upserted by `id`, and `remove_pages: ["id"]` deletes a page.

**Add a dataset from a file.** Put the file under `data/` (use your file tools), then:

```jsonc
// patch_manifest
{ "datasets": { "crypto": { "source": "data/crypto.csv", "description": "holdings" } } }
```

Check the inferred columns with `get_data_schema({ dataset: "crypto" })` before binding islands.

**Add a SQL transform.** Author and dry-run the SQL *before* wiring it in:

1. Write the file under `models/`, e.g. `models/transforms/allocation.sql`:
   ```sql
   SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class
   ```
2. Dry-run it: `validate_sql({ sql: "SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class" })`.
   You get back the result columns, or the exact DuckDB error (e.g. `Catalog Error: Table "holding"
   does not exist`). Fix until valid. A transform can read any other dataset by its name.
3. Wire it: `patch_manifest({ datasets: { allocation: { sql: "models/transforms/allocation.sql" } } })`.

**Add an island to a page.** Read the current page, append the island, send just that page:

```jsonc
// patch_manifest
{ "pages": [ { "id": "overview", "title": "Overview", "islands": [
    /* ...existing islands... */,
    { "type": "rank.list", "title": "Top assets", "dataset": "allocation",
      "label": "class", "value": "value_eur", "span": 6 }
] } ] }
```

**Add a typed write (action).** Targets a writable file dataset (CSV / SQLite), not a `sql` transform:

```jsonc
// patch_manifest
{ "actions": { "log_txn": { "dataset": "transactions", "mode": "insert",
    "fields": { "amount": { "type": "number", "min": 0 },
                "kind": { "type": "string", "enum": ["in", "out"] } } } } }
```

Then `run_action({ name: "log_txn", rows: [{ amount: 50, kind: "in" }] })` — every row validated
all-or-nothing, the file snapshotted for rollback.

**Add a typed read (query).** Declarative, parameterized, no raw SQL:

```jsonc
// patch_manifest
{ "queries": { "by_class": { "dataset": "allocation",
    "select": ["class", "value_eur"], "params": { "class": { "type": "string" } },
    "where": [ { "field": "class", "op": "eq", "param": "class" } ] } } }
```

Run it with `run_query({ name: "by_class", params: { class: "BTC" } })`.

**Remove something.** In a record section, set the entry to `null`:
`patch_manifest({ queries: { by_class: null }, actions: { log_txn: null } })`. For pages, use
`remove_pages: ["overview"]`.

**Connectors.** `list_connectors` shows each connector's status. If it isn't `connected` it needs a
secret or OAuth — **authorizing is human-only** (the Connect button in the running dashboard). Tell
the user; don't try to sync. When connected, `run_sync({ name })` pulls into its datasets
(checkpointed).

## The full tool set

- **read** — `list_islands`, `get_island_schema(type)`, `get_manifest`, `get_data_schema(dataset)`,
  `query_data({ dataset | sql, limit })`, `validate_manifest({ manifest? })`, `validate_sql({ sql })`,
  `list_checkpoints`
- **write** — `patch_manifest({ ... })`, `propose_edit({ manifest })`, `apply_edit({ proposal_id })`,
  `rollback({ checkpoint_id? })`
- **data** — `list_actions`, `run_action({ name, rows })`
- **queries** — `list_queries`, `run_query({ name, params?, limit? })`
- **connectors** — `list_connectors`, `run_sync({ name })`

`propose_edit` and `validate_manifest` accept a manifest **object** (preferred) or a JSON string. A
proposed manifest is validated against itself, so brand-new datasets, transforms, and markdown
sources bind correctly even from an empty manifest.

## Rules that keep the app healthy

- **Validate is the contract.** A binding error names the page, island, and field — fix the manifest
  or the data, never silence it.
- **Bind only to columns that exist.** Confirm with `get_data_schema` / `validate_sql` before binding.
- **Sources stay under `data/`, `models/`, `docs/`, or `app/`.** Secrets (`.env*`) and `.openislands/`
  are off-limits.
- **The manifest stays declarative.** No transforms inside island configs; data shaping lives in the
  SQL/data layer.
- **Prefer `patch_manifest`; pass objects.** Re-sending a full manifest string is the easiest way to
  introduce a typo.
- **Files are the source of truth.** No static export — `serve` reads them live and pushes SSE updates
  as they change.

## Going further

- Full docs: https://openislands.sh
- Install this skill into any project: `npx skills add lukaisailovic/openislands --skill openislands`
