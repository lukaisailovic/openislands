# Finance Overview — dogfood app

A live, agent-maintained finance dashboard built on OpenIslands. This is the real example
the project dogfoods: drop your monthly exports into `data/` and the dashboard updates with
no rebuild. The figures committed here are fictional stand-ins (see `data/README.md`).

## Run it

```bash
node_modules/.bin/tsx packages/cli/src/index.ts validate apps/examples/finance
node_modules/.bin/tsx packages/cli/src/index.ts serve apps/examples/finance
```

## What's on the canvas

- **4 KPI cards** — net worth, after-tax net worth, liquid cash, monthly income, each with
  a month-over-month delta (`compareTo: "prev"`).
- **Net worth vs. target** — a `timeseries.line` with the €500K goal line (`options.goalField`).
- **Allocation treemap** — value by asset class (`breakdown.treemap`, ECharts).
- **Holdings table** — `table.grid` (Perspective) with per-column formats and sign-colored
  gain/loss status cells.
- **Goals bar** — target vs. current per goal (`category.bar`).
- **Transactions feed** — most recent money movements (`timeline.feed`).
- **Strategy notes** — two `note.card`s plus a `source.doc` link to `docs/strategy.md`.

## The contracts

| dataset | source | shape |
|---|---|---|
| `net_worth_monthly` | `data/net_worth_monthly.csv` | monthly series + target |
| `holdings` | `models/transforms/holdings_pnl.sql` | positions + derived gain/loss |
| `allocation` | `models/transforms/allocation.sql` | value + share by class |
| `goals` | `data/goals.csv` | target vs. current |
| `transactions` | `data/transactions.csv` | recent movements |
| `strategy_notes` | `docs/strategy.md` | markdown dataset |

Data shaping (percentages, gain/loss) lives in `models/transforms/`, never in the manifest.
Edit `app/manifest.json` to change the layout; never hand-edit build output.
