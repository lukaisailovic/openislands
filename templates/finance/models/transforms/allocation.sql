-- Value by asset class, with each class's share of the total.
-- Derived from holdings.csv so you maintain one file, not two.
-- Percentages are computed here so the manifest stays declarative.
WITH by_class AS (
  SELECT class, SUM(value_eur) AS value_eur
  FROM read_csv_auto('data/holdings.csv')
  GROUP BY class
)
SELECT
  class,
  value_eur,
  ROUND(value_eur / SUM(value_eur) OVER () * 100, 1) AS pct
FROM by_class
ORDER BY value_eur DESC
