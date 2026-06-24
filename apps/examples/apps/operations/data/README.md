# Operations data — drop your real exports here

The whole `data/` directory is **gitignored** (see the repo root `.gitignore`) so your
real exports never get committed. The files checked in here are realistic **sample
stand-ins** — fictional figures, one consistent recent story — so the example boots
before you've dropped anything in.

To make this dashboard yours, replace the sample files with exports of the same shape.
The manifest (`manifest.json`) and the SQL transforms (`models/transforms/`) bind to
the columns below — keep the column names and the dashboard keeps working. Run
`openislands validate apps/examples/operations` after any change; a missing column fails
the build and names the island, so you find out immediately, not silently.

## Expected files

### `summary.csv` — weekly engineering rollup, oldest first
The KPIs read the latest row and compare to the previous one (the week-over-week delta);
the trend charts plot the whole series.

| column | type | notes |
|---|---|---|
| `week` | string | `YYYY-Www`, one row per week, sorted ascending |
| `open_issues` | number | open issues at the close of the week |
| `p95_latency_ms` | number | fleet-wide p95 request latency |
| `uptime_pct` | number | fraction (0–1), weekly uptime |
| `error_budget_pct` | number | fraction (0–1) of the error budget still unspent |
| `deploys` | number | deploys shipped that week |
| `change_fail_pct` | number | fraction (0–1) of deploys that failed or rolled back |
| `mttr_min` | number | mean time to recovery, minutes |

### `throughput.csv` — weekly delivery, oldest first
Drives the shipped-vs-committed bars and the carry-over line.

| column | type | notes |
|---|---|---|
| `week` | string | `YYYY-Www`, sorted ascending |
| `shipped` | number | issues completed |
| `committed` | number | issues committed at sprint start |
| `carried_over` | number | issues rolled into the next week |

### `burndown.csv` — current sprint, one row per working day
`day`, `remaining` (work left), `ideal` (the straight-line target), `scope` (constant
total). Weekends are omitted.

| column | type | notes |
|---|---|---|
| `day` | date | `YYYY-MM-DD`, working days only |
| `remaining` | number | story points left |
| `ideal` | number | ideal remaining for a clean burndown |
| `scope` | number | total sprint scope |

### `services.csv` — one row per service
Drives the live service-health table and the fleet KPIs. `models/transforms/services_health.sql`
derives `status_signal` from `status` to tint the status cell — you don't export a signal.

| column | type | notes |
|---|---|---|
| `service` | string | service name |
| `team` | string | owning team |
| `status` | string | `healthy` / `degraded` / `down` |
| `p95_ms` | number | p95 latency, ms |
| `error_rate` | number | fraction (0–1) of requests erroring |
| `rps` | number | requests per second |
| `uptime_pct` | number | fraction (0–1) |
| `owner` | string | on-call owner |

### `slo.csv` — one objective per service
`models/transforms/slo_status.sql` derives `signal` from `current_pct` vs `target_pct` to
tint the Current cell when an objective is breached — you don't export a signal.

| column | type | notes |
|---|---|---|
| `service` | string | service name |
| `objective` | string | short label, e.g. `99.9% availability` |
| `target_pct` | number | fraction (0–1) target |
| `current_pct` | number | fraction (0–1) achieved |
| `budget_remaining_pct` | number | fraction (0–1) of the error budget left; `0.0` when breached |

### `deploys.csv` — one row per deploy, any order
The deploy feed sorts by `ts` descending. `models/transforms/deploys_daily.sql` rolls
these up per day for the frequency and success-rate charts.

| column | type | notes |
|---|---|---|
| `deploy_id` | string | e.g. `DPL-2041` |
| `ts` | datetime | `YYYY-MM-DD HH:MM` |
| `service` | string | service name |
| `version` | string | release tag, e.g. `v2.8.0` |
| `status` | string | `success` / `rolled_back` / `failed` |
| `duration_min` | number | deploy duration, minutes |
| `author` | string | who shipped it |
| `env` | string | `production` / `staging` |

### `incidents.csv` — one row per incident, any order
The incident feed sorts by `ts` descending; rows drill down into `incident_updates.csv`
by `incident_id`.

| column | type | notes |
|---|---|---|
| `incident_id` | string | e.g. `INC-1042` |
| `ts` | datetime | `YYYY-MM-DD HH:MM` |
| `service` | string | service name |
| `title` | string | one-line headline |
| `severity` | string | `Sev-1` / `Sev-2` / `Sev-3` |
| `status` | string | `investigating` / `monitoring` / `resolved` |
| `detected_by` | string | `alert` / `customer` / `oncall` / `canary` |
| `duration_min` | number | time to resolve, minutes |
| `summary` | string | one-phrase cause |

### `incident_updates.csv` — the per-incident timeline
The drilldown target for the incident feed. Each `incident_id` must match a row in
`incidents.csv`; updates sort ascending in time and the status progresses
`investigating` → `monitoring` → `resolved`.

| column | type | notes |
|---|---|---|
| `incident_id` | string | matches `incidents.csv` |
| `ts` | datetime | `YYYY-MM-DD HH:MM` |
| `author` | string | who posted the update |
| `status` | string | `investigating` / `monitoring` / `resolved` |
| `update` | string | one-phrase update |

### `oncall.csv` — one row per team per week
The on-call rotation schedule.

| column | type | notes |
|---|---|---|
| `week` | string | `YYYY-Www` |
| `team` | string | owning team |
| `primary` | string | primary on-call |
| `secondary` | string | secondary on-call |
| `handoff` | string | handoff slot, e.g. `Mon 10:00` |

### `../docs/runbook.md` — the ops runbook (markdown dataset)
Lives under `docs/`, not `data/`, so it is committed (it carries no private figures).
Optional YAML front-matter (`title`, `updated`, …) becomes queryable columns; the body is
exposed as `body`. The runbook source panel and a note card link to this file.

## Deriving extra contracts

`services_health`, `slo_status`, and `deploys_daily` are **computed** by the SQL
transforms in `models/transforms/` — you don't export them. Keep data shaping in SQL
there, never in the manifest. To add a derived contract, add a `.sql` file and a
`{ "sql": "…" }` dataset.
