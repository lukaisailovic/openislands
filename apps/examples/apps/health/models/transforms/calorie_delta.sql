-- Daily calorie surplus/deficit: intake minus the midpoint of the goal band.
-- The signed delta is computed here so the manifest stays declarative.
SELECT
  date,
  kcal - (kcal_goal_low + kcal_goal_high) / 2 AS delta
FROM read_csv_auto('data/macros_daily.csv')
ORDER BY date
