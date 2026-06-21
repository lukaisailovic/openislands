# My dashboard

A blank **OpenIslands** dashboard. OpenIslands turns local data files into a typed, durable dashboard
that an AI agent builds and keeps healthy as the data changes — no cloud, no account, no rendering code.

## Start

1. Drop a data file into `data/` (CSV, JSON, Parquet, or SQLite).
2. Point your coding agent at this folder. It's already wired: `.mcp.json` connects the OpenIslands MCP
   server, and `AGENTS.md` + `.agents/skills/openislands/` teach it how to build here. Ask it to build a
   dashboard from your file.
3. Prefer to do it by hand? Run `npx openislands serve` to watch it live and edit `app/manifest.json`.

`npx openislands validate` checks every island binding against your data and names anything that's wrong.

See `AGENTS.md` for the agent guide, or the docs at https://openislands.sh.
