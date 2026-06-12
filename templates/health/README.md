# Health template

A minimal personal-health starter — macros, weight, a meal log, and bloodwork — built from
files you own. It's a compact two-page example that touches each built-in feature once;
swap `data/` for your own export and rebuild. Designed to render data exported from a local
health database like [`health-mcp`](https://github.com/lukaisailovic/health-mcp), which
keeps the typed database and MCP tools while OpenIslands renders the views.

```bash
openislands validate .
openislands serve .
```

Two pages:

- **Today** — macro rings (protein / carbs / fat filling toward a goal), calories and
  weight KPIs with a day-over-day delta, the meal log (`timeline.feed` — click a meal for
  its hidden detail), and your protocol as a `note.card`.
- **Trends** — a weight line, calories vs the upper goal band, and one blood-panel table
  (`table.grid`) grouped by draw (`groupBy`) with reference ranges tucked into per-row
  details.

## The data

Everything under `data/` is one consistent story:

- `macros_daily.csv` — daily totals vs goals: kcal with a goal band, plus protein, carbs,
  and fat goals.
- `meals.csv` — the meal log: typed, timed, per-meal macros and a note. The `log_meal`
  action appends rows here.
- `weight.csv` — daily weight.
- `biomarkers.csv` — blood-panel markers, one row per marker per draw, with reference
  *and* optimal ranges. Grouped by panel in the Trends table.

The macro rings are the built-in `gauge.rings` island — concentric rings reading the latest
row, each filling toward its goal column.

The single **action** — `log_meal`, a typed, append-only write — lets an agent log a meal.
An agent discovers it with `list_actions` and writes rows with `run_action`; the views
update live.

Swap `data/` for your own export and rebuild. Nothing leaves your machine.

> Looking for the full surface — four pages, more datasets, derived SQL transforms, and six
> actions? See the rich `apps/examples/health` dogfood app in the OpenIslands repo.
