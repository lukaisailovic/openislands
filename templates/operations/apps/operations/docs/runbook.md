# Operations runbook

The on-call reference for keeping the platform healthy. Read it before your rotation
starts, and keep it current — the next person on call is relying on what's written here.

## Service map

| Service | What it does | Owner |
| --- | --- | --- |
| gateway | Edge routing and TLS termination; every request enters here | platform |
| auth | Issues and refreshes tokens, gates every authenticated call | identity |
| payments | Charges, refunds, and processor failover | payments |
| search | Query serving and the reindex pipeline | discovery |
| notifications | Email, push, and webhook delivery | growth |
| ingest | The event pipeline feeding everything downstream | data |

When a service degrades, the owning team is the first escalation point. The gateway is
the one to watch closest — a problem there is visible to every user.

## Severity

- **Sev-1** — customer-facing outage or data loss. Multiple services or the whole product
  is down. All hands; the incident commander runs it until resolved.
- **Sev-2** — significant degradation. One service is unhealthy or a key flow is broken,
  but there's a workaround or partial availability. Owner-led, pager active.
- **Sev-3** — minor or contained. Elevated errors, a slow endpoint, a backed-up job. Handle
  in hours, no bridge needed.

If you're unsure between two levels, pick the higher one. It's cheaper to stand down a
bridge than to under-respond to a real outage.

## Incident response

1. **Ack** the page within 5 minutes. Owning it doesn't mean fixing it alone — it means
   driving it.
2. **Triage** — what's the blast radius? Check the service health table and recent deploys.
   Set the severity.
3. **Mitigate** before you diagnose. Stop the bleeding (roll back, fail over, scale out),
   then find the root cause.
4. **Communicate** — post in #incidents, page the service owner, and for Sev-1 open a
   bridge. Keep a running timeline as you go.
5. **Postmortem** — for any Sev-1 or Sev-2, file a blameless writeup within 48 hours.
   Capture the timeline, the root cause, and the follow-up actions.

## Common mitigations

- **Roll back the last deploy.** Most incidents trace to a recent change. If the timing
  lines up, roll back first and confirm the metric recovers before investigating further.
- **Scale the workers.** For queue backups or backpressure (search reindex, ingest lag),
  add capacity or partitions and let the backlog drain.
- **Fail over.** Payments can switch to the secondary processor; recycle a bad node rather
  than debugging it live during an incident.
- **Shed load.** If the gateway is saturated, enable rate limiting on the noisiest clients
  to protect the rest.

When the metric is back in range and you've confirmed it holds, move the incident to
`monitoring`, then `resolved` once it's stable. Log it on the timeline with `log_incident`.
