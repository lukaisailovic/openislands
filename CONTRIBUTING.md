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
| `packages/mcp-server` | the MCP edit loop (`@openislands/mcp`) |

## Adding an island

The registry is intentionally small and closed — a sharp set beats a sprawling one.
Open an issue before adding a built-in island. If we agree it belongs:

1. Add its Zod config schema in `packages/schema/src/index.ts` and register it in
   `BUILTIN_ISLAND_SCHEMAS` (this gives runtime validation + types + JSON Schema for free).
2. Add its field requirements to `islandRequirements` in `packages/compiler/src/index.ts`
   so the contract check knows what data it needs.
3. Add a renderer in `packages/runtime/src/index.ts`.
4. Use it in a template and add a test.

For one-off needs, prefer a **custom island** in your own project's `components/custom/`
rather than expanding the core.

## Rules of the road

- The manifest stays declarative — no transforms in island configs.
- Every island binding must be checkable against data; keep `validate` honest.
- Local-first is non-negotiable: nothing in the core may require an account or a network.
- Conventional Commits. Add a Changeset (`pnpm changeset`) for any user-facing change.

## Before opening a PR

`pnpm build && pnpm test && pnpm lint` should be green, and `pnpm validate:templates`
and `pnpm e2e` (per-template `init` → `serve` → render + `/api/query`) should pass.
CI runs the same steps.

## Releasing

Releases are automated with Changesets. Land PRs with a changeset on `main`; the
release workflow opens a "Version Packages" PR that bumps versions and updates
changelogs. Merging that PR builds and runs `changeset publish`, publishing the
changed `@openislands/*` packages and the `openislands` CLI to npm (with provenance).
Maintainers only need the `NPM_TOKEN` repo secret configured.
