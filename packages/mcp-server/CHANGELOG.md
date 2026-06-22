# @openislands/mcp

## 0.3.0

### Minor Changes

- **Uniform result contract.** Every tool now returns a JSON object — no more bare arrays. The list
  tools return `{ ok, <name>: [...] }`, `run_sql` returns `{ ok, rowCount, rows }`, and `run_sync`
  carries `ok` on success like the rest. Read-tool failures that were bare `"…failed"` text (unknown
  island type, unreadable dataset, conflicting `run_sql` args, invalid JSON) are now in-band
  `{ ok:false, error }` naming the offending field; `isError` is reserved for unexpected throws.

- **`outputSchema` + `structuredContent`** on the high-value read and proposal tools (the lists,
  `run_sql` / `run_query`, `get_data_schema`, the `validate_*` checks, and the staging tools), so a
  client can consume results without parsing text. The text mirror is preserved.

- **Breaking renames:** `propose_edit` → `replace_manifest`, `query_data` → `run_sql` (pairs with
  `validate_sql`, distinct from the declared `run_query`), `cleanup_history` → `prune_checkpoints`.

- **~96% smaller tool definitions.** `patch_manifest` no longer inlines the entire island catalog
  into its `inputSchema` (it validates server-side through the same dry-check); total
  tool-definition cost drops from ≈109k to ≈5k estimated tokens. Island field shapes remain
  discoverable on demand via `get_island_schema`.

- **Output controls.** `get_overview`, `run_sql`, and `run_query` take a `verbosity`
  (`concise` default / `detailed`); concise `get_overview` omits per-action row schemas and
  per-query params, and the row tools cap output with a truncation note.

- **Annotations + titles.** Every tool now carries a `title`; the stage-only editors
  (`patch_manifest`, `replace_manifest`) are hinted read-only (they write nothing until
  `apply_edit`); `get_island_schema`'s `type` is now an enum of the valid island types.

## 0.2.0

### Patch Changes

- Updated dependencies [1d4d577]
- Updated dependencies [e4f8c85]
- Updated dependencies [52db044]
- Updated dependencies [4dd6657]
- Updated dependencies [00b93e9]
- Updated dependencies [9310d95]
- Updated dependencies [1277310]
- Updated dependencies [067baf3]
- Updated dependencies [3ea7894]
- Updated dependencies [ca837bb]
- Updated dependencies [37f6fe5]
- Updated dependencies [ff27160]
- Updated dependencies [24749df]
  - @openislands/compiler@0.2.0
  - @openislands/schema@0.2.0
  - @openislands/storage@0.2.0
