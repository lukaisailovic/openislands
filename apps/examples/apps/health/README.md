# Health — dogfood app

A live, agent-maintained personal-health dashboard built on OpenIslands. This is the rich
example the project dogfoods: it renders a [`health-mcp`](https://github.com/lukaisailovic/health-mcp)
export (Whoop + Oura + labs) — drop a fresh export into `data/` and every chart updates with
no rebuild. The figures committed here are fictional stand-ins (see `data/README.md`).

> The `templates/health` starter is the *minimal* two-page version of this app. This example
> is where the full surface lives — four pages, fourteen datasets, six actions.

## Run it

```bash
node_modules/.bin/tsx packages/cli/src/index.ts validate apps/examples/health
node_modules/.bin/tsx packages/cli/src/index.ts serve apps/examples/health
```

## The canvas — four pages

**Today** — the morning glance.
- **Macro rings** (`gauge.rings`) — protein / carbs / fat / fiber filling toward goals as
  `atLeast`, sat fat as an `atMost` budget that turns red over the limit.
- **4 KPI cards** — calories, weight, resting HR, HRV, each with a day-over-day delta.
- **Meals timeline** (`timeline.feed`, click a row for hidden micro-detail) and the
  **protocol** as a `table.grid`.

**Nutrition** — a tabbed page (`groups`) under a shared date-range filter.
- *Log* — the full meal-component feed, grouped by meal (`groupBy`).
- *Trends* — calories / protein vs goal, carbs & fat, fiber & sugar, hydration lines.
- *Batches* — cooked-batch depletion (`batches_status` transform).

**Labs** — the bloodwork, tabbed.
- *Latest* — latest value per marker (`biomarkers_status`) with a derived
  **optimal / in range / out of range** status colored by a signed signal column, plus
  the **Lab notes** `note.card`.
- *Panels* — every draw's markers grouped by panel (`groupBy`), and the draw history feed.
- *History* — biomarker history over draws (`biomarkers`, series split by marker; the chart
  auto-shows a searchable series picker since there are many markers) and a `source.doc` link
  to the full report PDF.

**Training & recovery** — sleep / recovery / HRV / RHR KPIs, weight and HRV lines, weekly
training minutes and sleep stages as stacked bars, and the workout feed — under a shared
date-range filter.

## The contracts

| dataset | source | shape |
|---|---|---|
| `macros_daily` | `data/macros_daily.csv` | daily macros + goal band |
| `meals` | `data/meals.csv` | one row per meal (written via `log_meal`) |
| `meal_components` | `data/meal_components.csv` | components per meal (written via `log_meal_components`) |
| `weight` | `data/weight.csv` | weigh-ins, with source |
| `wearable_daily` | `data/wearable_daily.csv` | sleep / recovery / HRV / RHR / sleep stages |
| `biomarkers` | `data/biomarkers.csv` | marker history, one row per marker per draw |
| `biomarkers_status` | `models/transforms/biomarkers_status.sql` | latest value per marker + range verdict |
| `panels` | `data/panels.csv` | blood draws (written via `log_panel`) |
| `workouts` | `data/workouts.csv` | activities (written via `log_workout`) |
| `training_weekly` | `models/transforms/training_weekly.sql` | weekly training minutes by sport |
| `sleep_stages` | `models/transforms/sleep_stages_long.sql` | sleep stages in long form |
| `batches_status` | `models/transforms/batches_status.sql` | cooked batches, depleted by intake |
| `protocol` | `data/protocol.csv` | supplements / targets / habits |

The range verdict (`optimal` / `in range` / `out of range`) and every other derived
contract is computed in `models/transforms/`, never in the manifest.

## Actions — typed writes

Six insert actions let an agent log new rows: `log_meal` (+ `log_meal_components`),
`log_weight`, `log_workout`, and `log_panel` (+ `log_biomarkers`). Discover them with
`oi.app().listActions()`, write rows with `oi.app().runAction(...)` (inside the `execute` tool);
every row is validated against the resolved schema before anything is written, and the views update
live. Edit `app/manifest.json` to change the layout; never hand-edit build output.
