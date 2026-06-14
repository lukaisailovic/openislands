# Billing Service

Owns plans, usage metering, and invoicing. Consumes usage events off the queue and turns them into
monthly invoices. Read the [architecture overview](../architecture.md) first for how events get here.

## Responsibilities

- Maintain the plan catalog and each tenant's current plan.
- Aggregate usage events into per-tenant, per-meter counters.
- Generate invoices at the end of each billing period and hand them to the Notifier.

## Metering

Services publish usage events to the `usage` topic; Billing is the only consumer. Each event is
keyed by `(tenant, meter, idempotency_key)` so a duplicate publish is counted once.

| meter | unit | source service |
|---|---|---|
| `api_calls` | request | Gateway |
| `storage_gb_hours` | GB·hour | Auth (key store) + Billing |
| `emails_sent` | message | Notifier |

## Invoicing

1. At period close, snapshot every tenant's counters.
2. Apply the plan's pricing to the snapshot to produce line items.
3. Persist the invoice as **immutable** — corrections are issued as a separate credit note, never
   by editing a sent invoice.

## Notes

- Counters are eventually consistent; the invoice job waits for the queue to drain before
  snapshotting.
- All money is stored in integer minor units (cents). No floats anywhere in the billing path.
