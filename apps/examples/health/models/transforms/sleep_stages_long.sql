-- Sleep stage minutes in long form (date, stage, minutes) so category.bar can
-- stack them via x: date, y: minutes, group: stage.
SELECT date, 'deep' AS stage, deep_min AS minutes FROM read_csv_auto('data/wearable_daily.csv') WHERE deep_min IS NOT NULL
UNION ALL SELECT date, 'rem', rem_min FROM read_csv_auto('data/wearable_daily.csv') WHERE rem_min IS NOT NULL
UNION ALL SELECT date, 'light', light_min FROM read_csv_auto('data/wearable_daily.csv') WHERE light_min IS NOT NULL
UNION ALL SELECT date, 'awake', awake_min FROM read_csv_auto('data/wearable_daily.csv') WHERE awake_min IS NOT NULL
