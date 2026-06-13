# Operations template

A project / service operations review built from exported files — the breadth-prover.
It shows the same islands and compiler that render finance and health rendering an ops
review (throughput, error budget, sprint burndown, service health, incidents, a runbook)
with no domain-specific hacks.

```bash
openislands validate .   # check the manifest + every island's data binding
openislands serve .      # run it as a live local app over your files
```

## What's on the canvas

Two pages:

- **Overview** — throughput / open-issues / p95 / uptime KPIs, a throughput-vs-commitment
  line, an error-budget gauge against its floor, and the sprint burndown vs. ideal.
- **Services** — a service-health table whose status cell is tone-colored from a derived
  signal, p95 by service, the recent-incidents feed, and the runbook docs.

## Contracts

| dataset | source | shape |
| --- | --- | --- |
| `summary` | `data/summary.csv` | weekly rollup: `open_issues`, `p95_latency_ms`, `uptime_pct`, `error_budget_pct`, `deploys_week` |
| `throughput` | `data/throughput.csv` | weekly `shipped` vs `committed` |
| `burndown` | `data/burndown.csv` | one sprint: `remaining` vs `ideal` by `day` |
| `services` | `data/services.csv` | per service: `status`, `p95_ms`, `error_rate`, `uptime_pct`, `owner` |
| `services_health` | `models/transforms/services_health.sql` | `services` + a derived status signal, worst-first |
| `incidents` | `data/incidents.csv` | `ts`, `service`, `title`, `severity`, `status`, `summary` |

`services_health` is derived in SQL (never in the manifest): `services_health.sql` adds a
`status_signal` that drives the table's tone-colored status cell and orders problems to the
top. The `log_incident` action lets an agent add a row to `incidents` — typed, validated,
and reversible — without hand-editing the file.

Replace the files in `data/` and `docs/` with your own — same column names, and the
dashboard queries them live. The sample numbers here are illustrative. Edit
`app/manifest.json`; never hand-edit build output.
