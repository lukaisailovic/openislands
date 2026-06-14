# Deploy Runbook

How a change reaches production and how to get it back out. Deploys are continuous — every merge to
`main` builds an image; promotion to production is a manual gate.

## Pipeline

1. Merge to `main` → CI builds and tags an image, runs the full test suite.
2. The image auto-deploys to **staging**.
3. A human promotes staging → **production** from the deploy dashboard.

## Promoting to production

- Promote during business hours unless it's a fix for an active incident.
- Watch the rollout: it's a rolling deploy, 25% at a time, with a 2-minute soak between batches.
- The deploy halts automatically if error rate crosses the SLO threshold mid-rollout.

## Rolling back

```
deployctl rollback <service> --to previous
```

- Rollback is the **default move** during a SEV1 — see the [on-call runbook](oncall.md).
- Rollback is always safe: migrations are backward-compatible by policy (expand-then-contract), so
  the previous image runs against the new schema.

## Database migrations

We use **expand / contract**:

1. **Expand** — add the new column/table; deploy code that writes both old and new.
2. **Backfill** — migrate existing rows in the background.
3. **Contract** — once everything reads the new shape, drop the old column in a later release.

Never combine a schema change and the code that depends on it in the same deploy; that's what makes
rollback unsafe.
