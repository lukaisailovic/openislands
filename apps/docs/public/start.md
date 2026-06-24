# Build a dashboard with OpenIslands

You're a coding agent. A user just pasted a prompt asking you to help them build their first
OpenIslands dashboard. This doc is your briefing. Read it, then drive the steps below.

## What OpenIslands is

A local-first runtime for dashboards that **you** maintain. Every project is a **workspace**: each
dashboard (an "app") lives under `apps/<id>/`, and its manifest is `apps/<id>/manifest.json`. A
manifest is a typed declaration of reusable visual **islands** (KPI cards, charts, tables, gauges,
feeds) bound to **typed data contracts** built from the user's local files — CSV, JSON, Parquet,
SQLite, or markdown. The files never leave their machine; `serve` queries them live on every
request.

You edit the manifest, never rendering code. The point: the dashboard **fails loudly** when a
binding and the data disagree, instead of silently rendering a wrong number. That validation is
the safety net — it's what lets you keep the app healthy for months.

Every change goes through the **OpenIslands MCP server** (`@openislands/mcp`), which runs in **Code
Mode**: instead of a tool per operation, you call **one tool — `execute`** — and pass it a small
async JavaScript program that drives the `oi` API. It's a safety boundary: read freely, write through
one validated pipeline. Nothing is written until you apply a validated proposal, and every write is
snapshotted for rollback.

## Get the project running

One command scaffolds a complete, working project workspace, with its first app under `apps/<id>/`:

```bash
npx openislands init my-dashboard
```

With no flag this scaffolds the `empty` template: a blank starter (one welcome `note.card`, empty
`data/`) you build up from the user's files. If they'd rather start from a populated example, pass
`--template`: `finance` (the flagship — net worth, allocation, holdings, transactions over CSVs),
`health`, or `operations`. The first app's id defaults to the template name (or `main` for
`empty`); `--app <id>` overrides it. Either way, `init` also drops a local `.mcp.json` (already
wiring `@openislands/mcp` at the project root), an `AGENTS.md`, and this skill under
`.agents/skills/openislands/` — so you're connected over MCP automatically; no manual setup.

Then serve it so the user can watch every edit land live:

```bash
npx openislands serve        # http://127.0.0.1:4321, live-updates over SSE as files change
```

To add another dashboard to the workspace later: `npx openislands add-app <id> --template <t>`
scaffolds `apps/<id>/`.

If the project isn't scaffolded from a template, the only hard requirement is at least one
`apps/<id>/manifest.json` and a `.mcp.json` that points `@openislands/mcp` at the project root.

## Code Mode: one tool, driven with JavaScript

`execute` is the entire tool surface. You write a small async JavaScript program that calls
the `oi` API, compose as many steps as you like in a single call (loops, conditionals, chaining), and
`return` a value and/or `console.log` what you want back. It runs in a sandbox — no `require`, no
`process`, no network, only `oi`. (`execute`'s tool description carries the full `oi` TypeScript API
— read it once.) It returns `{ ok, result, logs, checkpoints_created? }` (or `{ ok:false, error,
logs }` if the script throws).

`oi.listApps()`, `oi.createApp({ id, title? })`, and `oi.deleteApp({ id })` are workspace-level.
`oi.app(id?)` returns the **app-scoped API** — omit `id` in a single-app project (it resolves to the
sole app); when there are several, call `oi.listApps()` first, then pass `oi.app("<id>")`. The
examples below assume `const app = oi.app();`.

Every operation — reads, SQL, the manifest edit pipeline, actions, queries, connectors, even creating
or deleting an app — is a method on `oi`, reached from inside `execute`. There are no separate
per-operation tools.

## The safe edit loop

1. **Read** — start with `app.getOverview()` (the manifest + every dataset's live columns + the
   declared actions/queries/connectors + checkpoint count, in **one call**). Then ground a specific
   edit with `app.listIslands()`, `app.getIslandSchema(type)`, `app.getDataSchema(dataset)`, and
   `app.runSql({ dataset | sql, limit })`. Don't guess island fields or column names.
2. **Edit** — `app.patchManifest({ ... })` merges one section into the current manifest (preferred),
   or `app.replaceManifest(manifest)` for a full rewrite. Both return a `proposal_id` + a diff and
   write **nothing** yet. Pass JSON **objects**, not strings.
3. **It already validated** — the edit methods dry-run the result against the live data. If `ok` is
   `false`, read `errors` (each names the page, island, and field) and fix the edit. Do **not** work
   around a binding error.
4. **Apply** — `app.applyEdit(proposal_id)` writes the manifest and returns a `checkpoint_id`.
5. **Undo if needed** — `app.rollback(checkpoint_id)` (or latest) restores byte-for-byte, including
   any data writes.

Usually it's one script:

```js
const app = oi.app();
const ov = await app.getOverview();                 // 1. read
const page = ov.pages[0];
page.islands.push({ type: "metric.kpi", title: "Net worth", dataset: "net_worth_monthly",
                    value: "net_worth_eur", format: "eur", span: 4 });
const s = await app.patchManifest({ pages: [page] });   // 2. stage (already validated vs the data)
if (!s.ok) return s.errors;                         //    each error names the page/island/field
return await app.applyEdit(s.proposal_id);          // 3. apply → checkpoint_id (rollback if wrong)
```

Prefer `patchManifest` — you never re-send (or re-typo) the whole document.

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
  `label`, …). A page uses either a flat `islands` array or tabbed `groups`, not both — a group is
  `{ id, title?, islands }` and renders as a tab. Groups are page structure, not an island, so they
  won't show up in `listIslands()`.
- **actions** — a typed `insert` into a writable file dataset; append rows with `app.runAction`.
- **queries** — a typed, parameterized read; run it with `app.runQuery`. No raw SQL — heavy shaping
  lives in a `sql` transform the query reads from.

## Layout & sizing

Each island has a **min / recommended / max** span on the 12-column grid — check
`app.getIslandSchema(type)` (its `layout` + `notes`) before you set `span`. Keep **compact**
islands narrow (KPIs, funnels, gauges, pies, radars cap well below full width — a `span` over the
max is a named error) and let **data-dense** islands (tables, charts, feeds, calendars) run the
full 12. Omit `span` for the recommended width. Don't ship a lone KPI — group 2+ in a row or use
`metric.scorecard`. `validate` and the edit methods also return advisory layout `warnings` for these
smells; they never block the apply.

## CRUD recipes

Each recipe is the body of an `execute` script (assume `const app = oi.app();` at the top).
`patchManifest` takes record sections as `name → spec` (and `name → null` to delete); `pages` are
full Page objects upserted by `id`, and `remove_pages: ["id"]` deletes a page.

**Add a dataset from a file.** Put the file under `data/` (use your file tools), then bind it and
confirm its inferred columns in one script:

```js
const s = await app.patchManifest({ datasets: { crypto: { source: "data/crypto.csv", description: "holdings" } } });
if (!s.ok) return s.errors;
await app.applyEdit(s.proposal_id);
return await app.getDataSchema("crypto");           // confirm columns before binding islands to it
```

**Add a SQL transform.** Author and dry-run the SQL *before* wiring it in:

1. Write the file under `models/`, e.g. `models/transforms/allocation.sql`:
   ```sql
   SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class
   ```
2. Dry-run it inside a script:
   `return await app.validateSql("SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class")`.
   You get back the result columns, or the exact DuckDB error (e.g. `Catalog Error: Table "holding"
   does not exist`). Fix until valid. A transform can read any other dataset by its name.
3. Wire it: `app.patchManifest({ datasets: { allocation: { sql: "models/transforms/allocation.sql" } } })`.

**Add an island to a page.** Read the current page, append the island, send just that page:

```js
const ov = await app.getOverview();
const page = ov.pages.find((p) => p.id === "overview");
page.islands.push({ type: "rank.list", title: "Top assets", dataset: "allocation",
                    label: "class", value: "value_eur", span: 6 });
const s = await app.patchManifest({ pages: [page] });
return s.ok ? await app.applyEdit(s.proposal_id) : s.errors;
```

**Add a typed write (action).** Targets a writable file dataset (CSV / SQLite), not a `sql` transform:

```js
await app.patchManifest({ actions: { log_txn: { dataset: "transactions", mode: "insert",
  fields: { amount: { type: "number", min: 0 }, kind: { type: "string", enum: ["in", "out"] } } } } });
// ...applyEdit, then append rows:
return await app.runAction("log_txn", [{ amount: 50, kind: "in" }]);
```

Every row is validated all-or-nothing and the file is snapshotted for rollback.

**Add a typed read (query).** Declarative, parameterized, no raw SQL:

```js
await app.patchManifest({ queries: { by_class: { dataset: "allocation",
  select: ["class", "value_eur"], params: { class: { type: "string" } },
  where: [{ field: "class", op: "eq", param: "class" }] } } });
// ...applyEdit, then run it:
return await app.runQuery("by_class", { class: "BTC" });
```

**Remove something.** In a record section, set the entry to `null`:
`app.patchManifest({ queries: { by_class: null }, actions: { log_txn: null } })`. For pages, use
`remove_pages: ["overview"]`.

**Connectors.** `app.listConnectors()` shows each connector's status. If it isn't `connected` it needs
a secret or OAuth — **authorizing is human-only** (the Connect button in the running dashboard). Tell
the user; don't try to sync. When connected, `app.runSync(name)` pulls into its datasets
(checkpointed).

## The `oi` API

`oi.listApps()`, `oi.createApp({ id, title? })`, `oi.deleteApp({ id })` are workspace-level.
`oi.app(id?)` returns the app-scoped API — omit `id` in a single-app project. On the app:

- **apps** — `oi.listApps()`, `oi.createApp({ id, title? })`, `oi.deleteApp({ id })` (soft-archive)
- **read** — `app.getOverview({ verbosity? })` (start here), `app.listIslands()`,
  `app.getIslandSchema(type)`, `app.getManifest()`, `app.getDataSchema(dataset)`,
  `app.runSql({ dataset | sql, limit })`, `app.validateManifest(manifest?)`, `app.validateSql(sql)`,
  `app.listCheckpoints()`
- **write** — `app.patchManifest({ ... })`, `app.replaceManifest(manifest)`,
  `app.applyEdit(proposal_id)`, `app.rollback(checkpoint_id?)`, `app.pruneCheckpoints(keep?)`
- **data** — `app.listActions()`, `app.runAction(name, rows)`
- **queries** — `app.listQueries()`, `app.runQuery(name, params?, { limit? })`
- **connectors** — `app.listConnectors()`, `app.runSync(name)`

`replaceManifest` and `validateManifest` accept a manifest **object** (preferred) or a JSON string. A
proposed manifest is validated against itself, so brand-new datasets, transforms, and markdown
sources bind correctly even from an empty manifest.

## Rules that keep the app healthy

- **Validate is the contract.** A binding error names the page, island, and field — fix the manifest
  or the data, never silence it.
- **Bind only to columns that exist.** Confirm with `app.getDataSchema` / `app.validateSql` before binding.
- **Sources stay under `data/`, `models/`, `docs/`, or `app/`.** Secrets (`.env*`) and `.openislands/`
  are off-limits.
- **The manifest stays declarative.** No transforms inside island configs; data shaping lives in the
  SQL/data layer.
- **Prefer `patchManifest`; pass objects.** Re-sending a full manifest string is the easiest way to
  introduce a typo.
- **Files are the source of truth.** No static export — `serve` reads them live and pushes SSE updates
  as they change.

## Going further

- Full docs: https://openislands.sh
- Install this skill into any project: `npx skills add lukaisailovic/openislands --skill openislands`
