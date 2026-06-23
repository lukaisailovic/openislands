# On-Call Runbook

What to do when you're holding the pager. The current rotation and escalation path live in
PagerDuty; this is the playbook for the first 30 minutes.

## When a page fires

1. **Acknowledge within 5 minutes.** If you can't, it escalates to the secondary automatically.
2. Open the alert's linked dashboard and check the [architecture map](../architecture.md) to find
   which service owns the symptom.
3. Post in `#incidents` with one line: what's alerting and that you're on it.

## Severity

| sev | meaning | response |
|---|---|---|
| SEV1 | customer-facing outage | page secondary + EM immediately, open a postmortem |
| SEV2 | degraded, no full outage | handle solo, write it up if it recurs |
| SEV3 | internal / noisy alert | fix during business hours, tune the alert |

## First response

- **Don't fix blind.** Confirm the blast radius before changing anything.
- Prefer **rollback over forward-fix** during an active SEV1 — see the
  [deploy runbook](deploy.md) for the rollback command.
- If you touch production, say so in `#incidents` as you do it, not after.

## Escalation

- No progress in 15 minutes on a SEV1 → page the engineering manager.
- Suspected data loss or a security issue → page the EM **and** open a SEV1 regardless of impact.

## After

Every SEV1 gets a postmortem within two business days — see
[the 2026-05-01 example](../incident-2026-05-01.md) for the format. Blameless: we fix systems, not
people.
