-- Active batches with remaining grams and remaining macros, depleted by
-- meal_components rows that reference the batch (kind='batch', ref_id=batch_id).
WITH consumed AS (
  SELECT ref_id AS batch_id, sum(grams) AS grams_used
  FROM read_csv_auto('data/meal_components.csv')
  WHERE kind = 'batch'
  GROUP BY ref_id
)
SELECT
  b.batch_id, b.name, b.cooked_date, b.status, b.total_g,
  b.total_g - coalesce(c.grams_used, 0)                                    AS remaining_g,
  round((b.total_g - coalesce(c.grams_used, 0)) / b.total_g, 3)            AS remaining_pct,
  round(b.kcal_total      * (b.total_g - coalesce(c.grams_used, 0)) / b.total_g) AS kcal_left,
  round(b.protein_g_total * (b.total_g - coalesce(c.grams_used, 0)) / b.total_g) AS protein_g_left,
  round(b.carb_g_total    * (b.total_g - coalesce(c.grams_used, 0)) / b.total_g) AS carb_g_left,
  round(b.fat_g_total     * (b.total_g - coalesce(c.grams_used, 0)) / b.total_g) AS fat_g_left
FROM read_csv_auto('data/batches.csv') b
LEFT JOIN consumed c USING (batch_id)
ORDER BY b.cooked_date DESC
