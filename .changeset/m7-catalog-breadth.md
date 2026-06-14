---
"@openislands/schema": minor
"@openislands/compiler": minor
"@openislands/runtime": minor
---

Add four built-in islands and a categorical page filter. Islands: `category.combo` (dual-axis bars + a secondary-axis line), `rank.list` (ranked Top-N leaderboard with proportional bars), `status.grid` (service/check state tiles, tone from the status value), and `waterfall.bars` (a bridge / P&L walk with `total` anchors). The new `select` page filter narrows every bound island on a categorical column — a single value emits `=`, multiple a parameterized `IN` — with choices drawn from the bound column's live distinct values or an explicit `options` list.
