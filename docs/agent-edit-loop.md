# The agent edit loop

How an agent changes a *live* OpenIslands dashboard safely — the MCP read-many/write-one
path, the data write path (actions), and provider sync (connectors). Read this when working
on `packages/mcp-server`, or when an agent maintains a user's dashboard over MCP. The
user-facing version lives in `apps/docs/src/pages/mcp.mdx`.

## The safe loop (MCP server `@openislands/mcp`)

Read-many / write-one. An agent reads everything, but every change funnels through a single
validated, snapshotted proposal-and-apply pipeline.

**Read first:** `list_islands` (built-in types + required fields), `get_island_schema(type)`,
`get_manifest`, `get_data_schema(dataset)`, `query_data({ dataset } | { sql }, limit)` — pass a
`dataset` name for a whole dataset *or* a read-only `sql` SELECT over the registered dataset
views, not both — `validate_manifest`, and `list_checkpoints` (rollback points, newest last).

**The manifest write path:** `propose_edit(manifest)` takes the **full** manifest, validates it
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

Without MCP, the same loop is: edit `app/manifest.json` → `openislands validate` → `openislands serve`.

## Actions (the data write path)

A manifest-declared, typed `insert` into a `source` dataset (CSV / JSON(L) and SQLite tables;
only a derived `sql` dataset is never writable). Discover with `list_actions` (declared actions
+ their resolved row JSON Schema, derived from the live data merged with the action's `fields`
overrides), then `run_action(name, rows)` — every row is validated first; a bad row rejects the
whole call with an error naming the row index + field and nothing is written (the result reports
the rows `inserted`). The target file is snapshotted to `.openislands/history/` before the insert,
so `rollback` covers data writes too. A SQLite-backed `source` insert is an `INSERT` into the
table; the file and table must already exist. Declare an action in the manifest:

```jsonc
"actions": {
  "log_meal": { "dataset": "meals", "mode": "insert",
    "fields": { "meal_type": { "enum": ["breakfast", "lunch", "dinner", "snack"] } } }
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

**The agent loop** (auth itself stays human-only — OAuth runs in the dashboard browser):

- `list_connectors` → each connector's status: `connected`, `missingSecrets`, `lastSync`,
  `lastError`, effective `schedule`, `loadError`. This is how you discover auth is missing.
- `run_sync({ name })` → pulls from the provider and writes rows; returns rows-per-dataset,
  mode (`insert` / `replace`), and a `checkpoint_id` (so a sync is reversible with `rollback`).
  If a connector isn't connected (OAuth not completed, or secrets missing), tell the user to
  open the dashboard and click **Connect** — do **not** attempt to authorize from the agent.

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
