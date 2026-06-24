# Agent guide

This is an **OpenIslands** workspace — one or more data apps under `apps/<id>/`, each a typed
`apps/<id>/manifest.json` of visual *islands* bound to local data files (CSV / JSON / Parquet /
SQLite / markdown). You build and maintain them by editing the manifest through the **OpenIslands MCP
server** (`openislands`, already wired in `.mcp.json` — one endpoint for the whole workspace), never
by writing rendering code.

It runs in **Code Mode**: instead of a tool per operation, you call **one tool — `execute`** — and
pass it a small async JavaScript program that drives the `oi` API (its full TypeScript surface is in
the `execute` tool description). `oi.app(id?)` selects an app (omit `id` when there's only one);
`oi.listApps()` lists them.

**Start here:** read `.agents/skills/openislands/SKILL.md` — the full guide to Code Mode, the manifest
model, the safe edit loop, and CRUD recipes for datasets, islands, pages, actions, and queries.

The short version:

- **Orient in one call.** `const ov = await oi.app().getOverview();` returns the manifest, every
  dataset's live columns, and the declared actions / queries / connectors (plus checkpoint state).
- **Edit through `execute`.** Use `oi.app().patchManifest(...)` to change one section at a time
  (datasets, actions, queries, connectors, pages), or `replaceManifest(...)` for a full rewrite — then
  `applyEdit(proposal_id)`, and `rollback()` if it's wrong. Every edit is validated against the live data
  before it's written, and a binding error names the page, island, and field. Fix it; don't work around it.
- **Data lives in `data/`, transforms in `models/`, docs in `docs/`.** Files are the source of truth and
  nothing leaves the machine.
- **Size islands by their span range.** Each island has a min/recommended/max span; check
  `oi.app().getIslandSchema(type)` before setting `span`. Keep compact islands (KPIs, funnels, gauges,
  pies, radars) narrow and let data-dense ones (tables, charts, feeds) go wide; don't ship a lone KPI —
  group them or use `metric.scorecard`. `validate` and the edit methods surface advisory layout warnings.
- `npx openislands serve` runs the live dashboard at `127.0.0.1:4321`; `npx openislands validate` checks
  every binding.

To install or update this skill in any project: `npx skills add lukaisailovic/openislands --skill openislands`.
