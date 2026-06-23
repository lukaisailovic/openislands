# @openislands/mcp

[![npm version](https://img.shields.io/npm/v/@openislands/mcp?color=2dd4bf)](https://www.npmjs.com/package/@openislands/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The OpenIslands MCP server: read many, write one, so an agent edits your dashboard safely.

This is how a coding agent maintains an OpenIslands dashboard. It's a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes plenty of read tools but exactly one write path: the agent proposes a manifest change, the server validates it against your island schemas and live data, returns a diff, and writes nothing until the agent applies it. Every apply is snapshotted, so any change rolls back.

`@openislands/mcp` is part of [OpenIslands](https://github.com/lukaisailovic/openislands). You don't import it. You point your agent at it.

## Wire it into your agent

Add it to your `.mcp.json` (Claude Code, Cursor, and friends), pointed at the project directory:

```jsonc
{
  "mcpServers": {
    "openislands": {
      "command": "npx",
      "args": ["-y", "@openislands/mcp", "."]
    }
  }
}
```

The `.` is the project root: the folder holding `app/manifest.json`. `openislands init` writes this file into every scaffolded project for you. Then ask your agent to build or change a page; it reads your data and edits the manifest through the validated loop.

## The edit loop

1. **Read.** `get_overview` returns the manifest, every dataset's live columns, and the declared actions and queries in one call. Ground a specific edit with `list_islands`, `get_island_schema`, `get_data_schema`, and `run_sql`.
2. **Propose.** `patch_manifest` (merge one section) or `replace_manifest` (full rewrite) validate the result and return a `proposal_id` and a diff. Nothing is written yet.
3. **Apply.** `apply_edit` writes the manifest and returns a `checkpoint_id`.
4. **Roll back.** `rollback` restores any checkpoint byte-for-byte.

There's no raw file-write tool, by design. Every change is validated before it lands, and a binding error names the page, island, and field instead of drawing the wrong number.

## Running over HTTP

The stdio server above serves one project per process. For an always-on, remote-reachable setup, `openislands serve --mcp` and the Docker image host the same server over Streamable HTTP on the dashboard's port. Off-loopback it requires a bearer token (`OPENISLANDS_MCP_TOKEN`), since it's a write surface. See [Self-hosting](https://openislands.sh/self-hosting).

## Documentation

- [Agent edit loop](https://github.com/lukaisailovic/openislands/blob/main/docs/agent-edit-loop.md)
- [OpenIslands docs](https://openislands.sh)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
