# Finance template

A net-worth / portfolio dashboard built from exported files — the flagship demo.
Recreates a hand-kept finance overview (net worth, allocation, holdings, strategy,
transactions, source docs) as typed islands over CSVs you own.

```bash
openislands validate .   # check the manifest + every island's data binding
openislands serve .      # run it as a live local app over your files
```

## What you maintain

- `data/net_worth_monthly.csv` — one row per month: `net_worth_eur`, `after_tax_eur`,
  `cash_eur`, `monthly_income_eur`, `target_eur`. The KPIs read the latest row and show the
  month-over-month delta; the chart plots the series against `target_eur`.
- `data/holdings.csv` — one row per position: `asset`, `class`, `units`, `value_eur`,
  `cost_basis_eur`. Everything else is derived.
- `data/transactions.csv` — `ts`, `account`, `description`, `amount_eur`, `category`.
- `docs/strategy.md` — your strategy notes (also exposed as the `strategy_notes` dataset).

## What's derived (SQL transforms, not the manifest)

Data shaping lives in `models/transforms/`, never in island configs:

- `allocation.sql` rolls holdings up by `class` and computes each class's share.
- `holdings_pnl.sql` adds `gain_loss_eur` / `gain_loss_pct`, which feed the table's
  sign-colored status cells (green gains, red losses).

To add a derived contract, drop a `.sql` file in `models/transforms/` and add a
`{ "sql": "models/transforms/x.sql" }` dataset to the manifest.

Replace the files in `data/` and `docs/` with your own — same column names, and the
dashboard queries them live. The sample numbers here are illustrative. Nothing leaves your
machine; let your agent maintain `app/manifest.json`.
