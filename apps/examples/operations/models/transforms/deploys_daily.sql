-- Daily deploy rollup: count, outcomes, and the day's success rate.
-- Feeds the deploy-frequency bar and the change-failure trend off one feed.
WITH daily AS (
  SELECT
    CAST(ts AS DATE) AS day,
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS succeeded,
    SUM(CASE WHEN status = 'rolled_back' THEN 1 ELSE 0 END) AS rolled_back
  FROM read_csv_auto('data/deploys.csv')
  GROUP BY CAST(ts AS DATE)
)
SELECT
  day,
  total,
  succeeded,
  rolled_back,
  ROUND(succeeded * 1.0 / total, 2) AS success_rate
FROM daily
ORDER BY day
