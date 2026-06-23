# openislands

[![npm version](https://img.shields.io/npm/v/openislands?color=2dd4bf)](https://www.npmjs.com/package/openislands)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> Agent-built dashboards over data you own, that don't rot.

`openislands` is the command-line tool for OpenIslands: a local-first runtime for dashboards a coding agent builds and keeps maintaining. Point it at a folder of files (CSV, JSON, Parquet, SQLite, markdown) and it scaffolds a typed dashboard, validates it against your data, and serves it live. Your agent edits a typed manifest, never rendering code, so the dashboard fails loudly when the data and a chart disagree instead of quietly showing the wrong number.

This is the package to install. For the full story, see the [OpenIslands repo](https://github.com/lukaisailovic/openislands).

## Quickstart

```bash
npx openislands init my-dashboard     # scaffold a blank project
cd my-dashboard
npx openislands serve                 # http://127.0.0.1:4321
```

`init` with no flag gives you a blank starter. For a populated example, pass `--template finance`: net worth, allocation, holdings, and transactions over CSVs you own. `health` and `operations` ship too.

Then hand it to an agent. Every scaffolded project includes a `.mcp.json` already wiring the [OpenIslands MCP server](https://www.npmjs.com/package/@openislands/mcp), so an agent that opens the folder builds and maintains the dashboard through a validated edit loop:

```jsonc
// .mcp.json, written for you by init
{
  "mcpServers": {
    "openislands": {
      "command": "npx",
      "args": ["-y", "@openislands/mcp", "."]
    }
  }
}
```

Leave `serve` running and the page live-updates over SSE as each edit lands.

## Commands

| Command | What it does |
|---|---|
| `openislands init [dir]` | Scaffold a project. `--template empty\|finance\|health\|operations` (default `empty`). |
| `openislands serve [dir]` | Run the dashboard locally (TanStack Start SSR, live reload). Flags: `--port`, `--host`, `--mcp`, `--mcp-token`. |
| `openislands validate [dir]` | Validate the manifest and check every island against its data. The exit code reflects pass or fail. |
| `openislands add <island> [dir]` | Add a starter island to the first page, then re-validate before writing. |
| `openislands infer <file> [dir]` | Infer a data file's schema and propose a dataset; `--bind` adds it to the manifest. |

`serve` binds to loopback by default. This is your data. `add`, `infer --bind`, and `serve` all refuse to write or boot something that doesn't validate.

## Self-host

For an always-on dashboard on a home server or NAS, the published Docker image serves the dashboard and the MCP server on one port:

```bash
docker run -d -p 127.0.0.1:4321:4321 \
  -v "$PWD/my-dashboard:/project" \
  ghcr.io/lukaisailovic/openislands:latest
```

See [Self-hosting](https://openislands.sh/self-hosting) for tokens, LAN access, and workspaces.

## Documentation

- [OpenIslands docs](https://openislands.sh)
- [Data app model](https://github.com/lukaisailovic/openislands/blob/main/docs/data-app-model.md)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
