-- Latest value per marker across all panels, with a range verdict.
-- Biomarkers are historical (one row per marker per draw); this view keeps the
-- newest draw of each marker so the table reads like "current bloodwork".
-- status_signal drives the status cell's tone (status.signal binding):
-- +1 optimal renders success-green, -1 out of range danger-red, 0 in range/unknown neutral.
-- Handles open-ended ranges (NULL bounds) and non-numeric values (value NULL,
-- value_text keeps the reported text, status falls back to 'unknown').
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY name ORDER BY draw_date DESC) AS rn
  FROM read_csv_auto('data/biomarkers.csv')
)
SELECT
  name, category, value, value_text, unit,
  ref_low, ref_high, optimal_low, optimal_high,
  panel_id, panel_name, draw_date,
  CASE
    WHEN value IS NULL THEN 'unknown'
    WHEN (ref_low IS NOT NULL AND value < ref_low)
      OR (ref_high IS NOT NULL AND value > ref_high) THEN 'out of range'
    WHEN optimal_low IS NOT NULL AND optimal_high IS NOT NULL
      AND value BETWEEN optimal_low AND optimal_high THEN 'optimal'
    WHEN optimal_low IS NOT NULL AND optimal_high IS NULL
      AND value >= optimal_low THEN 'optimal'
    ELSE 'in range'
  END AS status,
  CASE
    WHEN value IS NULL THEN 0
    WHEN (ref_low IS NOT NULL AND value < ref_low)
      OR (ref_high IS NOT NULL AND value > ref_high) THEN -1
    WHEN optimal_low IS NOT NULL AND value >= optimal_low
      AND (optimal_high IS NULL OR value <= optimal_high) THEN 1
    ELSE 0
  END AS status_signal
FROM ranked
WHERE rn = 1
ORDER BY status_signal ASC, category, name
