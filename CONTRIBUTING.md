# Contributing

Thanks for considering a contribution. OpenIslands is MIT and meant to stay simple.

## Setup

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format
```

Node ≥ 20, ESM-only. Toolchain: pnpm + Turborepo + Changesets, tsdown (rolldown/Oxc)
for builds, oxlint + oxfmt for lint/format, Vitest for tests. Tests live in each
package's `test/` (not `src/`, so the bundler doesn't ship them).

## Packages

| package | what it is |
|---|---|
| `packages/schema` | the contract — Zod → types + JSON Schema; everything depends on it |
| `packages/compiler` | the DuckDB query core: files → typed contracts, run live |
| `packages/runtime` | the TanStack Start SSR app + island renderers |
| `packages/cli` | the `openislands` command (init / validate / serve / add) |
| `packages/mcp-server` | the MCP edit loop (`@openislands/mcp`) in Code Mode — one `execute` tool driving the whole `oi` API |

## Adding an island

The registry is intentionally small and closed — a sharp set beats a sprawling one.
Open an issue before adding a built-in island. If we agree it belongs:

1. Add its Zod config schema in `packages/schema/src/index.ts` and register it in
   `BUILTIN_ISLAND_SCHEMAS`, `ISLAND_MIN_SPAN`, and the `BuiltinIsland`/`DrilldownIsland`
   unions (this gives runtime validation + types + JSON Schema for free).
2. Add its field requirements to `islandRequirements` in `packages/compiler/src/index.ts`
   so the contract check knows what data it needs.
3. Add a renderer component under `packages/runtime/src/islands/` and register it in
   `packages/runtime/src/islands/registry.tsx`.
4. Add a starter config to `islandSkeleton` in `packages/cli/src/scaffold.ts` (the `add`
   command scaffolds from it; a test asserts every type has a valid skeleton).
5. Use it in a template and add tests.

For one-off needs, prefer a **custom island** in your own project's `components/custom/`
rather than expanding the core.

## Rules of the road

- The manifest stays declarative — no transforms in island configs.
- Every island binding must be checkable against data; keep `validate` honest.
- Local-first is non-negotiable: nothing in the core may require an account or a network.
- Conventional Commits. Add a Changeset (`pnpm changeset`) for any user-facing change.

## Before opening a PR

`pnpm build && pnpm typecheck && pnpm test && pnpm lint` should be green, and
`pnpm validate:templates` and `pnpm e2e` (per-template `init` → `serve` → render +
`/api/query`) should pass. CI runs the same steps. `typecheck` runs `tsc --noEmit`
per package through Turborepo — the build (Oxc) strips types without checking them,
so this is the only gate that does.

Changing the MCP surface? The server runs in **Code Mode** — one `execute` tool drives the whole
`oi` API in a `node:vm` sandbox; that single tool (plus two read-only resources) is the entire
surface. **A new operation is a method, not a new tool:** add it to the `AppApi` interface and
`createAppApi` in `packages/mcp-server/src/api.ts`, and add its declaration to the `OI_API_DECL` doc
string in `packages/mcp-server/src/server.ts` (the embedded TypeScript the model programs against).
Don't register another tool for it. The deterministic guardrails in
`packages/mcp-server/test/tool-surface.test.ts` lock down the single-tool surface and its token cost,
the `OI_API_DECL` ↔ `AppApi` method-name parity, the canonical agent walkthroughs, and the result
contract — keep them green.

## Releasing

Releases are automated with Changesets. Land PRs with a changeset on `main`; the
release workflow opens a "Version Packages" PR that bumps versions and updates
changelogs. Merging that PR builds and runs `changeset publish`, publishing the
changed `@openislands/*` packages and the `openislands` CLI to npm (with provenance).
Maintainers only need the `NPM_TOKEN` repo secret configured.
