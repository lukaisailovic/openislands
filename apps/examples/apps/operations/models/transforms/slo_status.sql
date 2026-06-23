-- SLO status per service, worst first.
-- signal tints the Current cell (status.signal binding): a breached objective
-- (current below target) renders danger-red, a met one success-green.
SELECT
  service,
  objective,
  target_pct,
  current_pct,
  budget_remaining_pct,
  CASE WHEN current_pct >= target_pct THEN 1 ELSE -1 END AS signal
FROM read_csv_auto('data/slo.csv')
ORDER BY signal ASC, budget_remaining_pct ASC
