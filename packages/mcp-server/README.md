# @openislands/mcp

[![npm version](https://img.shields.io/npm/v/@openislands/mcp?color=2dd4bf)](https://www.npmjs.com/package/@openislands/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The OpenIslands MCP server, in Code Mode: one `execute` tool, an `oi` API the agent drives with JavaScript, read many and write one — so an agent edits your dashboard safely.

This is how a coding agent maintains an OpenIslands dashboard. It's a [Model Context Protocol](https://modelcontextprotocol.io) server that runs in **Code Mode**: instead of a tool per operation, the agent calls **one tool — `execute`** — and passes a small async JavaScript program that drives the `oi` API, composing many steps in a single call. That single tool is the entire surface; one tool means a tiny, stable context cost no matter how rich the API grows, and the agent can loop, branch, and chain reads and edits without a round-trip per step.

The whole API is read-many, write-one: the agent reads everything (manifest, island schemas, live data) but every manifest change funnels through one validated path — `oi.app().patchManifest` / `replaceManifest` returns a diff and writes nothing, then `applyEdit` commits it. The server validates against your island schemas and live data before anything lands, and snapshots every apply, so any change rolls back. There are no separate per-operation tools — even creating or deleting an app is an `oi` method (`oi.createApp` / `oi.deleteApp`) you call from inside `execute`.

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

The `.` is the project root: the workspace holding your apps under `apps/<id>/` (or a single app's folder). `openislands init` writes this file into every scaffolded project for you. Then ask your agent to build or change a page; it reads your data and edits the manifest through the validated loop.

## The edit loop

You drive it all through `execute`. Inside the script, `const app = oi.app()` is the sole app (`oi.app("id")` picks one in a multi-app workspace):

```js
const app = oi.app();
const ov = await app.getOverview();               // 1. read: manifest + every dataset's live columns + actions/queries/connectors
const page = ov.pages[0];
page.islands.push({ type: "metric.kpi", title: "Net worth", dataset: "net_worth",
                    value: "net_worth_eur", format: "eur", span: 4 });
const s = await app.patchManifest({ pages: [page] }); // 2. stage: validates vs the live data, returns a proposal_id + diff, writes nothing
if (!s.ok) return s.errors;                        //    each error names the page/island/field
return await app.applyEdit(s.proposal_id);         // 3. apply: writes it, returns a checkpoint_id (rollback if wrong)
```

1. **Read.** `app.getOverview()` returns the manifest, every dataset's live columns, and the declared actions/queries/connectors in one call. Ground a specific edit with `app.listIslands()`, `app.getIslandSchema(type)`, `app.getDataSchema(dataset)`, and `app.runSql(...)`.
2. **Stage.** `app.patchManifest(...)` (merge one section) or `app.replaceManifest(...)` (full rewrite) validate the result and return a `proposal_id` and a diff. Nothing is written yet.
3. **Apply.** `app.applyEdit(proposal_id)` writes the manifest and returns a `checkpoint_id`. (A `proposal_id` persists across `execute` calls, so you can stage in one call and apply in the next.)
4. **Roll back.** `app.rollback(checkpoint_id?)` restores any checkpoint byte-for-byte.

There's no raw file-write tool, by design. Every change is validated before it lands, and a binding error names the page, island, and field instead of drawing the wrong number.

## Running over HTTP

The stdio server above serves one project per process. For an always-on, remote-reachable setup, `openislands serve --mcp` and the Docker image host the same server over Streamable HTTP on the dashboard's port. Off-loopback it requires a bearer token (`OPENISLANDS_MCP_TOKEN`), since it's a write surface. See [Self-hosting](https://openislands.sh/self-hosting).

## Documentation

- [Agent edit loop](https://github.com/lukaisailovic/openislands/blob/main/docs/agent-edit-loop.md)
- [OpenIslands docs](https://openislands.sh)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
