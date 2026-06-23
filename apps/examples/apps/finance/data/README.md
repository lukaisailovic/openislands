# Finance data — drop your real exports here

The whole `data/` directory is **gitignored** (see the repo root `.gitignore`) so your
real numbers never get committed. The files checked in here are realistic **sample
stand-ins** — fictional figures — so the example boots before you've dropped anything in.

To make this dashboard yours, replace the sample files with exports of the same shape.
The manifest (`app/manifest.json`) and the SQL transforms (`models/transforms/`) bind to
the columns below — keep the column names and the dashboard keeps working. Run
`openislands validate apps/examples/finance` after any change; a missing column fails the
build and names the island, so you find out immediately, not silently.

## Expected files

### `net_worth_monthly.csv` — one row per month, oldest first
The KPIs read the latest row and compare to the previous one (the month-over-month delta),
and the net-worth chart plots the whole series against the house/net-worth target.

| column | type | notes |
|---|---|---|
| `month` | date | `YYYY-MM`, one row per month, sorted ascending |
| `net_worth_eur` | number | total net worth |
| `after_tax_eur` | number | net worth net of expected crypto capital-gains tax |
| `cash_eur` | number | liquid cash / runway |
| `monthly_income_eur` | number | take-home income that month |
| `target_eur` | number | the goal line drawn on the chart |

### `holdings.csv` — one row per position
`models/transforms/holdings_pnl.sql` derives `gain_loss_eur` / `gain_loss_pct` from these,
and `models/transforms/allocation.sql` rolls them up by `class` for the treemap. Set
`cost_basis_eur` to `0` for zero-basis lots (the % gain shows blank, not infinity).

| column | type | notes |
|---|---|---|
| `asset` | string | ticker or label, e.g. `BTC`, `Rental Studio` |
| `class` | string | asset class, e.g. `Crypto`, `Equities`, `Real Estate`, `Cash` |
| `units` | number | quantity held |
| `value_eur` | number | current market value |
| `cost_basis_eur` | number | what you paid; `0` for zero-basis lots |

### `goals.csv` — one row per savings goal
| column | type | notes |
|---|---|---|
| `goal` | string | goal name |
| `target_eur` | number | amount you're aiming for |
| `current_eur` | number | amount saved so far (plotted in the goals bar chart) |
| `due` | date | `YYYY-MM` target date |

### `transactions.csv` — recent money movements, any order
The timeline feed sorts by `ts` descending and shows the most recent.

| column | type | notes |
|---|---|---|
| `ts` | date | `YYYY-MM-DD` |
| `account` | string | source account, e.g. `IBKR`, `Bank`, `Kraken` |
| `description` | string | shown as the feed headline |
| `amount_eur` | number | signed; negative = money out |
| `category` | string | shown as the feed detail tag |

### `../docs/strategy.md` — strategy notes (markdown dataset)
Lives under `docs/`, not `data/`, so it is committed (it carries no private figures).
Optional YAML front-matter (`title`, `updated`, `posture`, …) becomes queryable columns;
the body is exposed as `body`. The Strategy source panel links to this file.

## Deriving extra contracts

`allocation` and the holdings P&L are **computed** from `holdings.csv` by the SQL transforms
in `models/transforms/` — you don't export them. Keep data shaping in SQL there, never in
the manifest. To add a derived contract, add a `.sql` file and a `{ "sql": "…" }` dataset.
