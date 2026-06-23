-- Service health snapshot, worst first.
-- status_signal drives the table's status cell tone (status.signal binding):
-- +1 healthy renders success-green, -1 down danger-red, 0 degraded/unknown neutral.
SELECT
  service,
  team,
  status,
  p95_ms,
  error_rate,
  rps,
  uptime_pct,
  owner,
  CASE status
    WHEN 'healthy' THEN 1
    WHEN 'down' THEN -1
    ELSE 0
  END AS status_signal
FROM read_csv_auto('data/services.csv')
ORDER BY status_signal ASC, p95_ms DESC
