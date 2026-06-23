# Agent guide

This is an **OpenIslands** workspace — one or more data apps under `apps/<id>/`, each a typed
`apps/<id>/app/manifest.json` of visual *islands* bound to local data files (CSV / JSON / Parquet /
SQLite / markdown). You build and maintain them by editing the manifest through the **OpenIslands MCP
server** (`openislands`, already wired in `.mcp.json` — one endpoint for the whole workspace), never
by writing rendering code. Call `list_apps` to see the apps; app-scoped tools take an optional `app`
param (omit it when there's only one app).

**Start here:** read `.agents/skills/openislands/SKILL.md` — the full guide to the manifest model, the
safe edit loop, and CRUD recipes for datasets, islands, pages, actions, and queries.

The short version:

- **Orient in one call.** `get_overview` returns the manifest, every dataset's live columns, and the
  declared actions / queries / connectors (plus checkpoint state) — start there instead of fanning
  out across `get_manifest` and a `get_data_schema` per dataset.
- **Edit through the MCP.** Use `patch_manifest` to change one section at a time (datasets, actions,
  queries, connectors, pages), or `replace_manifest` for a full rewrite — then `apply_edit`, and `rollback`
  if it's wrong. Every edit is validated against the live data before it's written, and a binding error
  names the page, island, and field. Fix it; don't work around it.
- **Data lives in `data/`, transforms in `models/`, docs in `docs/`.** Files are the source of truth and
  nothing leaves the machine.
- **Size islands by their span range.** Each island has a min/recommended/max span; check
  `get_island_schema` before setting `span`. Keep compact islands (KPIs, funnels, gauges, pies, radars)
  narrow and let data-dense ones (tables, charts, feeds) go wide; don't ship a lone KPI — group them or
  use `metric.scorecard`. `validate` and the MCP surface advisory layout warnings.
- `npx openislands serve` runs the live dashboard at `127.0.0.1:4321`; `npx openislands validate` checks
  every binding.

To install or update this skill in any project: `npx skills add lukaisailovic/openislands --skill openislands`.
