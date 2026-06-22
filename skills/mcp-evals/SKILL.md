---
name: mcp-evals
description: Measure the @openislands/mcp tool surface — tool-definition token cost and per-task tool-calls/response-tokens/success over canonical agent tasks. Use when changing the MCP tools (descriptions, schemas, result shapes, renames) to check the before/after impact, or to spot a tool definition that has ballooned in size. Local dev only — not shipped, not in CI.
---

# MCP tool-surface evals

A local, dependency-free harness that measures what an agent actually pays to use the
OpenIslands MCP server, so a change to the tool surface can be judged on numbers, not vibes.

It is **not** an LLM-in-the-loop eval. It runs an in-process MCP client through a fixed,
scripted tool sequence per canonical task, so it's deterministic and runs in ~2s with no API
key. It measures the two costs that matter:

1. **Tool-definition tokens** — what every session spends up front to learn the tools (the sum
   of each tool's name, title, description, input/output schema, and annotations). A single
   bloated `inputSchema` shows up here immediately.
2. **Per-task tool-calls + response tokens** — the recurring cost of real work, over: orient
   cold · add a KPI · add a CSV + chart · author + run a query · log a row · fix a binding error ·
   connect + sync.

Tokens are estimated at ~4 chars/token. The estimate is identical on both sides of a comparison,
so the **deltas** are honest even though the absolute numbers are approximate.

## Run it

```bash
node_modules/.bin/tsx packages/mcp-server/evals/run.ts <label>
```

Each run prints a markdown summary and writes `packages/mcp-server/evals/results/<label>.json`
(gitignored). The harness resolves tools by **capability** (e.g. "ad-hoc read" → `run_sql`, else
`query_data`) against the live `listTools()`, and unwraps results shape-agnostically — so the
*same* harness runs against the old and new tool surface without edits.

## Before / after a change

```bash
git switch main
node_modules/.bin/tsx packages/mcp-server/evals/run.ts baseline   # writes results/baseline.json

git switch -                                                      # your branch
node_modules/.bin/tsx packages/mcp-server/evals/run.ts after      # prints "Δ vs baseline"
```

Any label other than `baseline` automatically diffs against `results/baseline.json` and prints
the deltas in tool-definition tokens, total tool-calls, total response tokens, and tasks passing.

## Reading the result

- **A big tool-definition number, or one tool dominating the per-tool list,** usually means a
  schema is being inlined that shouldn't be (e.g. wiring the keystone island schema into a tool's
  `inputSchema` — keep manifest-edit inputs loose and let `dryCheck` validate).
- **Tool-calls** rarely move unless orientation changes (e.g. `get_overview` collapsing a fan-out);
  most surface work is about response tokens and reliability, not call count.
- **A task flipping to ✗** means the scripted path broke — usually a rename the harness's capability
  aliases don't cover yet (add the new name to `ALIASES` in `run.ts`).
