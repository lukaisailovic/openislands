# Platform Architecture

A map of the platform for new engineers. Start here, then drill into the per-service specs under
[Specs](specs/auth-service.md).

## Overview

We run a small set of services behind a single API gateway. Traffic enters through the gateway,
which handles TLS termination and routing, then fans out to the services over gRPC. State lives in
Postgres (per service, no shared database) with Redis in front for caching and rate-limit counters.

## Services

| service | owns | datastore |
|---|---|---|
| Gateway | routing, auth handoff, rate limiting | Redis |
| Auth | identity, sessions, API keys | Postgres |
| Billing | plans, usage metering, invoices | Postgres |
| Notifier | email + webhook delivery | Postgres + queue |

## Principles

- **One database per service.** Services never read each other's tables; they talk over the API.
- **Async by default.** Anything a user doesn't block on (email, webhooks, invoicing) goes through
  the queue.
- **Idempotent writes.** Every state-changing endpoint takes an idempotency key so retries are safe.

## Request lifecycle

1. Gateway authenticates the request against Auth and attaches the resolved tenant.
2. The target service validates the tenant scope and does its work.
3. Side effects (usage events, notifications) are published to the queue, not awaited inline.

See the [deploy runbook](runbooks/deploy.md) for how changes reach production.
