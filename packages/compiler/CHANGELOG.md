# @openislands/compiler

## 0.2.0

### Minor Changes

- 1d4d577: Connectors now support static bearer-token auth (`auth: { type: "bearer", data: { tokenEnv } }`) alongside OAuth2: a long-lived API token / JWT read from `.env` and handed to `sync` as `ctx.tokens.accessToken`, with no interactive Connect. Auth handling in the compiler is reworked into a per-scheme abstraction (keyless / oauth2 / bearer).
- 52db044: Add the `activity.calendar` island: a GitHub-contributions-style calendar heatmap of a daily value over the months the data spans. Any parseable date works and same-day rows sum.
- 4dd6657: Add the `category.pie` island: a pie or donut chart of one series' share across a handful of categories. Slices sum by `label`, sort largest-first, and show their percentage; `donut: true` cuts an inner hole.
- 00b93e9: Add the `compare.radar` island: a radar (spider) chart comparing rows across several metrics at once. Each metric is an axis and each row a polygon; a shared `max` puts every axis on one scale.
- 9310d95: Add the `correlation.scatter` island: a scatter or bubble plot of two numeric fields. Split points into colored series with `series`, scale them into bubbles with `size`, and label points for the tooltip; `xFormat`/`format` style the axes.
- 1277310: Add the `distribution.heatmap` island: a matrix heatmap of one value across two categorical dimensions (`x` × `y`), shaded on a continuous color scale with a legend.
- 067baf3: Add the `form.entry` island: a data-entry form bound to a manifest `action`. It renders one typed input per field — types, enums, ranges, and defaults all come from the action's resolved row schema — with a submit button that inserts a row through the same validated, history-snapshotted path as the agent's `run_action`, then the bound dataset's islands refresh live. The human-facing mirror of an action: point it at an action by name and reuse its typing, no separate form schema. A new `/api/action` runtime endpoint resolves the form and performs the insert; the compiler exports `actionFields` for the resolved field descriptors.
- 3ea7894: Add the `funnel.steps` island: a conversion/drop-off funnel of sequential stages, each sized by its share. Stages follow the declared row order by default; `sort` can reorder them.
- ca837bb: Add the `map.choropleth` island: a geographic choropleth shading world-country regions by a value on a continuous scale. The world map ships as vendored GeoJSON so it renders fully offline (local-first — no tiles, no network); region names join on the GeoJSON country name.
- 37f6fe5: Add the `metric.scorecard` island: a compact card of several KPIs read off the last row, each with an optional delta versus the previous row. A tidy alternative to a row of separate `metric.kpi` tiles.
- ff27160: Add four built-in islands and a categorical page filter. Islands: `category.combo` (dual-axis bars + a secondary-axis line), `rank.list` (ranked Top-N leaderboard with proportional bars), `status.grid` (service/check state tiles, tone from the status value), and `waterfall.bars` (a bridge / P&L walk with `total` anchors). The new `select` page filter narrows every bound island on a categorical column — a single value emits `=`, multiple a parameterized `IN` — with choices drawn from the bound column's live distinct values or an explicit `options` list.

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
  - @openislands/connector-kit@0.2.0
  - @openislands/schema@0.2.0
  - @openislands/storage@0.2.0
