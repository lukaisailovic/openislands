# The agent edit loop

How an agent changes a *live* OpenIslands dashboard safely — the MCP read-many/write-one
path in Code Mode, the data write path (actions), and provider sync (connectors). Read this when
working on `packages/mcp-server`, or when an agent maintains a user's dashboard over MCP. The
user-facing version lives in `apps/docs/content/docs/mcp.mdx`; the canonical agent-facing version is
`skills/openislands/SKILL.md`.

## The safe loop (MCP server `@openislands/mcp`, Code Mode)

Read-many / write-one. An agent reads everything, but every change funnels through a single
validated, snapshotted proposal-and-apply pipeline.

The server runs in **Code Mode**: instead of a tool per operation, the agent calls **one tool —
`execute`** — and passes a small async JavaScript program that drives the `oi` API (loops,
conditionals, chaining; `return` a value and/or `console.log`). It runs in a `node:vm` sandbox (no
`require` / `process` / network, only `oi`) and returns `{ ok, result, logs, checkpoints_created? }`
(or `{ ok:false, error, logs }` on a throw). `oi.listApps()` / `oi.createApp` / `oi.deleteApp` are
workspace-level; `oi.app(id?)` returns the per-app API (omit `id` for the sole app). `execute` is the
*entire* tool surface (plus two read-only resources for the app catalog + per-app manifests) — every
operation, including creating/deleting an app, is an `oi` method reached from inside it. There are no
separate per-operation tools.

**Read first** (all on `oi.app(id?)`): `getOverview()` (the manifest + every dataset's live columns +
the declared actions/queries/connectors + the checkpoint count, in one call — the orientation entry
point that saves a per-dataset `getDataSchema` + `list*` fan-out), `listIslands()` (built-in types +
required fields), `getIslandSchema(type)`, `getManifest()`, `getDataSchema(dataset)`,
`runSql({ dataset } | { sql }, limit)` — pass a `dataset` name for a whole dataset *or* a read-only
`sql` SELECT over the registered dataset views, not both — `listQueries()`/`runQuery()` (declared
parameterized reads, see Queries below), `validateManifest()`, and `listCheckpoints()` (rollback
points, newest last).

**The manifest write path:** `patchManifest(patch)` (preferred — merges one section into the current
manifest) or `replaceManifest(manifest)` (the **full** manifest) validates the result + checks every
binding against the live data, and returns a `diff` — but does **not** write. If the data check fails
it returns `{ ok: false, errors }` (each error names the page, island index, type, and missing field)
with **no** `proposal_id`; fix the binding and stage again. On success it returns a `proposal_id`.
Review the diff, then `applyEdit(proposal_id)` writes the manifest and snapshots the prior version as
a checkpoint — its result includes `checkpoint_id`. (A `proposal_id` persists across `execute` calls,
so you can stage in one call and apply in the next.) A proposal is rejected if unknown or **stale**
(the manifest on disk changed since it was staged); re-stage it. `rollback(checkpoint_id?)` restores a checkpoint byte-for-byte (latest if
omitted) — it restores manifest *and* data checkpoints; the id encodes the target file. There is no
raw file-write tool and no git dependency by design — rollback safety is `.openislands/history/`
snapshots (count + byte capped, oldest pruned first).

Without MCP, the same loop is: edit `manifest.json` → `openislands validate` → `openislands serve`.

## Actions (the data write path)

A manifest-declared typed write into a `source` dataset (CSV / JSON(L) and SQLite tables; a
derived `sql` dataset is never writable). Four modes: `insert` (append), `replace` (overwrite all
rows), `delete` (drop rows matching a predicate), `update` (patch matching rows). Discover with
`oi.app().listActions()` (declared actions + their resolved row JSON Schema), then
`oi.app().runActions([...])`:
- `insert`/`replace`: `{ action, rows: [{ col: val }, ...] }`
- `delete`: `{ action, match: { col: val } }` — equality-only, empty match rejected
- `update`: `{ action, match: { col: val }, set: { col: newVal } }`

Every row is validated first; a bad row (or empty match) rejects the whole call and nothing is
written. The target file is snapshotted to `.openislands/history/` before the write, so `rollback`
covers data writes too. Flat-file (CSV) datasets store no null — pass `""` or omit to use the
field's `default`. Declare an action in the manifest:

```jsonc
"actions": {
  "log_meal": { "dataset": "meals", "mode": "insert",
    "fields": { "meal_type": { "enum": ["breakfast", "lunch", "dinner", "snack"] } } }
}
```

## Queries (the read path)

The read mirror of an action: a manifest-declared, read-only read over **one** dataset (a `source`
dataset or a `sql` transform). It's a **declarative spec, not raw SQL** — `{ dataset, params?,
select?, where?, groupBy?, orderBy?, limit? }` — that the compiler translates to a parameterized,
type-aware `SELECT`. No joins by design; heavy shaping lives in a `sql` transform the `dataset`
points at. Why declarative beats an inline-SQL string: the translator emits casts itself (no
`TRY_CAST`/`ILIKE` footgun), every `field` is validated against live columns at build time (fail
loud, like an island binding), and every param/literal is bound (injection-safe — only verified
identifiers are quoted).

- `params` (`QueryParam`): `type` (string|number|boolean|date, default string), `required` (default
  true; false = optional), `enum`, `min`, `max`, `default`, `description`.
- `where`: array of `{ field, op, param }` or `{ field, op, value }` (exactly one of param/value).
  Ops: `eq, ne, lt, lte, gt, gte, contains` (case-insensitive substring), `sameDay` (timestamp
  field vs a date), `in` (literal `value` array). **An omitted optional param drops its filter** —
  so `get_daily_macros` with no `date` falls through to `order by date desc limit 1`.
- `select`: array of column names or `{ field, fn?, as? }` (`fn` ∈ sum/avg/count/min/max); omit =
  all columns. `groupBy`: array of column names. `orderBy`: array of `{ field, dir? }` (asc|desc).
  `limit`: integer.

### `search` (FTS)

`search: { fields, param, stemmer?, stopwords?, scoreField? }` turns the query into a
relevance-ranked full-text search over text columns — DuckDB FTS / BM25, not the `contains`
filter. `contains` is a whole-phrase substring match, unranked; `search` tokenizes both the columns
and the term, so a multi-word term matches rows sharing **any** token, ranked by BM25. Searching
`"greek yogurt"` returns `Greek Yogurt` above `Olympus Yogurt` (shares the token *yogurt*) and
excludes `Banana`. `fields` are the text columns to index + search across (each a real column,
validated like any binding); `param` names a declared **string** `param` holding the term;
`stemmer` (`porter`|`none`, default `porter`) and `stopwords` (`english`|`none`, default `english`)
control tokenization; optional `scoreField` exposes the BM25 score as a column.

Two constraints: `search` requires a `source` dataset, **not** a `sql` transform (the watcher can't
see upstream-file changes through a transform, so an index on one would silently go stale), and
because FTS can't index a view, declaring `search` materializes the dataset into an indexed sidecar
table at engine build — gated by the manifest, transparent to the query. Composes with the rest:
`where` further filters the matched rows; an omitted `orderBy` defaults to **relevance DESC**, an
explicit `orderBy` wins; `limit` caps as usual.

```jsonc
"queries": {
  "search_ingredients": {
    "dataset": "ingredients",
    "params": { "q": { "type": "string" } },
    "search": { "fields": ["name", "brand"], "param": "q", "scoreField": "score" },
    "limit": 20
  }
}
```

`runQuery("search_ingredients", { q: "greek yogurt" })` ranks `Greek Yogurt` first; with
`scoreField` set, each row carries a `score` column.

Discover with `oi.app().listQueries()` (each query's `name`, `description`, `params` as JSON Schema,
result `columns`), then `oi.app().runQuery(name, params?, { limit? })` — params validated, `limit`
1–500, result row-capped. Success is `{ ok: true, rowCount, columns, rows }`; a bad param is
`{ ok: false, errors }` (all-or-nothing), an unknown name or query error is `{ ok: false, error }`.

Because the spec is plain JSON, an agent **authors** a query through the normal
`oi.app().patchManifest` → `applyEdit` loop (the write path only ever writes the manifest) — it
creates a read tool, not just runs one. `patchManifest`/`replaceManifest`/`validate` check the same
thing as an island binding: the `dataset` exists and every `field` (in
`where`/`select`/`groupBy`/`orderBy`) is a real column (else a named error).

```jsonc
"queries": {
  "get_daily_macros": {
    "dataset": "macros_daily",
    "params": { "date": { "type": "date", "required": false } },
    "where": [{ "field": "date", "op": "eq", "param": "date" }],
    "orderBy": [{ "field": "date", "dir": "desc" }],
    "limit": 1
  }
}
```

## Connectors (provider sync)

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

**The agent loop:**

- `oi.app().listConnectors()` → each connector's status: `connected`, `missingSecrets`, `lastSync`,
  `lastError`, effective `schedule`, `loadError`. This is how you discover whether a connector needs
  human action.
- `oi.app().runSync(name)` → pulls from the provider and writes rows; returns rows-per-dataset,
  mode (`insert` / `replace`), and a `checkpoint_id` (so a sync is reversible with `rollback`).

**Keyless connectors** (`auth: none`) need no human authorization — call `runSync(name)` directly
when `connected` is `true`. For **OAuth2/bearer connectors**, auth runs in the dashboard browser:
if a connector isn't connected (OAuth not completed, or secrets missing), tell the user to open
the dashboard and click **Connect** — do **not** attempt to authorize from the agent.

A connector picks insert vs replace per output by which context method it calls: `ctx.insert`
(immutable records; advance a cursor in `ctx.state`) vs `ctx.replace` (records that get
revised — e.g. Whoop recovery scores — rewrite the whole file each sync). A connector output
may target a SQLite-backed `source` dataset (never a `sql` dataset), same as actions. Tokens +
cursor state persist at `.openislands/connectors/<name>.json` (gitignored). See
`apps/examples/health/connectors/whoop/` for a complete OAuth2 reference connector.

A project's `package.json`/`tsconfig.json` (scaffolded by `init`) exist for **editor types
only** — `npm install` once and connector/custom-island files typecheck against
`@openislands/connector-kit`; the runtime never needs the project's `node_modules` and
always bundles against its own copies.
