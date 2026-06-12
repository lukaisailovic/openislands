-- Latest macros row; fallback for islands that need exactly today's totals
-- instead of reading the last row of macros_daily themselves.
SELECT * FROM read_csv_auto('data/macros_daily.csv') ORDER BY date DESC LIMIT 1
