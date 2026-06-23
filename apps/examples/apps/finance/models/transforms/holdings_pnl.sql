-- Holdings with unrealized gain/loss derived from value vs. cost basis.
-- The gain_loss_eur / gain_loss_pct columns drive the table's status (sign) cells.
SELECT
  asset,
  class,
  units,
  value_eur,
  cost_basis_eur,
  value_eur - cost_basis_eur AS gain_loss_eur,
  CASE
    WHEN cost_basis_eur = 0 THEN NULL
    ELSE ROUND((value_eur - cost_basis_eur) / cost_basis_eur * 100, 1)
  END AS gain_loss_pct
FROM read_csv_auto('data/holdings.csv')
ORDER BY value_eur DESC
