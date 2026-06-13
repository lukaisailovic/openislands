---
title: Operations Runbook
updated: 2026-06-12
team: Platform Reliability
---

# Operations Runbook

The on-call engineer owns the incident from the first page until the postmortem
ships. This runbook is the single source of truth for who owns what, how we grade
severity, and the moves that resolve most incidents. Keep it open during an incident.

## Service map

| Service | Team | What it does |
|---|---|---|
| gateway | Platform | Public edge; terminates TLS and routes every request to a backend |
| auth | Identity | Login; issues and validates session tokens and API keys |
| payments | Payments | Charges cards; talks to the upstream processor |
| search | Discovery | Indexes the catalog and serves ranked query results |
| notifications | Growth | Sends push, email, and in-app messages through provider APIs |
| ingest | Data | Accepts event uploads and lands them in the warehouse |

The gateway sits in front of everything, so a gateway incident usually shows up as
errors across several services at once. Check the gateway first when symptoms are broad.

## Severity

- **Sev-1** — customer-facing outage or data loss. Revenue or sign-in is broken for
  many users. Page the on-call immediately, pull in the service owner, and start a
  status-page update inside 15 minutes.
- **Sev-2** — significant degradation. Elevated errors or latency, a feature is partly
  down, a workaround exists. Page the on-call and update internally; status page only
  if customers are likely to notice.
- **Sev-3** — minor or contained issue. Slow path, cosmetic bug, or a single
  non-critical job failing. Handle in business hours; no page required.

When unsure between two grades, pick the higher one. Downgrading later is cheap.

## Incident response flow

1. **Acknowledge** — claim the page so others know it is owned. Open an incident
   channel and pin the alert.
2. **Triage** — confirm scope and blast radius: which services, how many users, since
   when. Set the severity. Check the deploy feed, since most incidents trace to the
   last change.
3. **Mitigate** — stop the bleeding before you chase root cause. Reach for the common
   mitigations below. Restoring service beats a clean explanation.
4. **Communicate** — post an update on a fixed cadence (every 30 minutes for a Sev-1)
   even when there is no change. Silence reads as a bigger outage than it is.
5. **Postmortem** — within 48 hours of resolution, blameless, with a timeline and
   concrete action items that have owners and due dates.

## Common mitigations

- **Roll back the last deploy.** The fastest fix when an incident starts right after a
  release. Confirm the suspect deploy in the feed, roll it back, and watch the error
  rate return to baseline before declaring it mitigated.
- **Scale workers.** For saturation — connection-pool exhaustion, queue backlog, CPU
  pinned — add capacity to absorb load while you find the cause.
- **Fail over.** Shift traffic to a healthy region or replica when a dependency or zone
  is degraded. Verify the target has headroom first.
- **Shed load.** When nothing else holds, drop or rate-limit non-critical traffic to
  protect the core path. Turn off heavy background jobs and degrade gracefully.

After mitigation, keep monitoring until the signal is stable, then move the incident to
resolved and schedule the postmortem.
