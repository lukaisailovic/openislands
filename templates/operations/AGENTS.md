# Agent guide

This is an **OpenIslands** data app — a typed `app/manifest.json` of visual *islands* bound to local
data files (CSV / JSON / Parquet / SQLite / markdown). You build and maintain it by editing the
manifest through the **OpenIslands MCP server** (`openislands`, already wired in `.mcp.json`), never by
writing rendering code.

**Start here:** read `.agents/skills/openislands/SKILL.md` — the full guide to the manifest model, the
safe edit loop, and CRUD recipes for datasets, islands, pages, actions, and queries.

The short version:

- **Edit through the MCP.** Use `patch_manifest` to change one section at a time (datasets, actions,
  queries, connectors, pages), or `propose_edit` for a full rewrite — then `apply_edit`, and `rollback`
  if it's wrong. Every edit is validated against the live data before it's written, and a binding error
  names the page, island, and field. Fix it; don't work around it.
- **Data lives in `data/`, transforms in `models/`, docs in `docs/`.** Files are the source of truth and
  nothing leaves the machine.
- `npx openislands serve` runs the live dashboard at `127.0.0.1:4321`; `npx openislands validate` checks
  every binding.

To install or update this skill in any project: `npx skills add lukaisailovic/openislands --skill openislands`.
