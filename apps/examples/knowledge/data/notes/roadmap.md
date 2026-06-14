# Engineering Roadmap

A rolling, quarter-by-quarter view of where the platform is going. This is intentionally light —
detail lives in the [specs](../specs/auth-service.md), this is just the shape of the plan.

## Now — Q2 2026

- **Harden deploys.** Land the expand/contract CI checks from the
  [May 1 postmortem](../incident-2026-05-01.md). _On track._
- **Refresh-token rotation.** Single-use refresh tokens in Auth. _In staging._
- **Webhook reliability.** Backoff + jitter on Notifier retries. _Shipped._

## Next — Q3 2026

- **Usage dashboards.** Per-tenant metering views on top of the
  [billing service](../specs/billing-service.md).
- **Read replicas.** Offload reporting queries off the primary Postgres for Billing.
- **SSO.** SAML / OIDC login for enterprise tenants in Auth.

## Later — Q4 2026 and beyond

- Multi-region read path for the gateway.
- Self-serve plan changes (today plan moves are manual).
- Tiered rate limits tied to plan, not flat per-tenant defaults.

## Principles

We bias toward **fewer, well-owned services** over many small ones, and we ship behind flags so a
roadmap item can land dark and roll out gradually. Anything here is a direction, not a commitment —
the [standup notes](2026-06-standup.md) are where the week-to-week reality gets recorded.
