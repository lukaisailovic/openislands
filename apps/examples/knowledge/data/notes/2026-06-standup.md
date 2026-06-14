# Standup — June 2026

Running notes from daily standup. Newest entries at the top. Decisions that outlive the day get
promoted to the [roadmap](roadmap.md) or a spec.

## 2026-06-12

- **Billing:** invoice snapshot job is flaky when the queue is slow to drain — adding a drain check
  before snapshot. Tracking against the [billing spec](../specs/billing-service.md).
- **Auth:** the CI check for non-nullable migrations (from the
  [May 1 postmortem](../incident-2026-05-01.md)) is merged and live.
- **Gateway:** rate-limit counters moved to a dedicated Redis to stop noisy tenants evicting cache.

## 2026-06-11

- **Notifier:** webhook retries now use exponential backoff with jitter; cut duplicate-delivery
  complaints to near zero.
- Discussed dropping the 15-minute session TTL to 10. Parked — no clear win, more refresh churn.

## 2026-06-10

- Postmortem action items from May 1 are all assigned; one remains open (the on-call drill).
- **Auth:** refresh-token rotation shipped to staging, soaking before promotion.

## Parking lot

- Revisit per-tenant rate-limit defaults — current numbers are guesses from launch.
- Consider a read replica for Billing reporting queries.
