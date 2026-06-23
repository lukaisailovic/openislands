# Operations — dogfood app

A live, agent-maintained engineering-operations review built on OpenIslands. This is the
breadth-prover: the very same islands that render the finance and health examples here track
delivery throughput, service health, SLOs, deploys, and incidents — no rendering code, just a
manifest. The figures committed here are fictional stand-ins (see `data/README.md`).

> The `templates/operations` starter is the *minimal* version of this app. This example is
> where the full surface lives — four pages, twelve datasets (three of them SQL transforms),
> three actions.

## Run it

```bash
node_modules/.bin/tsx packages/cli/src/index.ts validate apps/examples/operations
node_modules/.bin/tsx packages/cli/src/index.ts serve apps/examples/operations
```

## The canvas — four pages

**Overview** — the weekly glance, under a shared date-range filter.
- **4 KPI cards** — shipped this week, open issues, p95 latency, uptime, each with a
  week-over-week delta (`compareTo: "prev"`).
- **Throughput vs commitment** — a `timeseries.line` with the commitment as a goal line
  (`options.goalField`), beside an **error-budget** `gauge.goal`.
- **Sprint burndown** — remaining vs ideal as a line, beside **deploys per day** as a
  `category.bar`.
- **Recent incidents** — a `timeline.feed` with a duration stat and severity/status/detected-by
  footer; click a row to drill into that incident's `incident_updates` (`drilldown`).

**Services** — a tabbed page (`groups`).
- *Health* — a **service-search** `search.box`, the **service health** `table.grid` with a
  derived status cell colored by a signal column, and a **p95 bar** + **RPS treemap**.
- *SLOs* — a **service objectives** `table.grid` with a breach-signalled `Current` cell, plus
  the **error-budget policy** `note.card`.

**Delivery** — DORA-ish delivery metrics, under a shared date-range filter.
- **4 KPI cards** — deploys this week, change-failure rate, MTTR, carried-over.
- **Throughput vs commitment** (`shipped`/`committed` both plotted) beside **deploy success
  rate**, two `timeseries.line`s.
- **Deploys** — the deploy `timeline.feed` with version/status/env/author footer.

**On-call & docs** — the rotation and the references.
- **On-call rotation** `table.grid` by week and team.
- **Runbook highlights** `note.card` beside the full **runbook** as a `source.doc`.
- **Status page / Dashboards / Postmortems** as `source.doc` links.

## The contracts

| dataset | source | shape |
|---|---|---|
| `summary` | `data/summary.csv` | weekly ops KPI rollup |
| `throughput` | `data/throughput.csv` | weekly shipped vs committed + carry-over |
| `burndown` | `data/burndown.csv` | current sprint: remaining vs ideal by day |
| `services` | `data/services.csv` | service health snapshot |
| `services_health` | `models/transforms/services_health.sql` | services + derived status signal, problems first |
| `slo` | `data/slo.csv` | per-service SLOs |
| `slo_status` | `models/transforms/slo_status.sql` | SLOs + breach signal, worst first |
| `deploys` | `data/deploys.csv` | deploy log (written via `log_deploy`) |
| `deploys_daily` | `models/transforms/deploys_daily.sql` | deploys per day + success rate |
| `incidents` | `data/incidents.csv` | incidents (written via `log_incident`) |
| `incident_updates` | `data/incident_updates.csv` | timeline updates per incident (written via `log_incident_update`) |
| `oncall` | `data/oncall.csv` | on-call rotation by week and team |

Every derived contract — the status signals, the daily deploy rollup — is computed in
`models/transforms/`, never in the manifest.

## Actions — typed writes

Three insert actions let an agent record operational events: `log_incident` (open or record an
incident), `log_incident_update` (append a status update sharing the same `incident_id`), and
`log_deploy` (record a deploy). Discover them with `oi.app().listActions()`, write rows with
`oi.app().runAction(...)` (inside the `execute` tool); every row is validated against the resolved
schema before anything is written, and the views update live. Edit `app/manifest.json` to change the
layout; never hand-edit build output.
