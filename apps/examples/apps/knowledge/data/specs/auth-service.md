# Auth Service

Owns identity, sessions, and API keys for the whole platform. Every other service trusts the tenant
context the gateway resolves through Auth — see the [architecture overview](../architecture.md).

## Responsibilities

- Issue and validate session tokens (short-lived JWTs, 15-minute TTL).
- Mint and revoke long-lived API keys, scoped per tenant.
- Resolve a bearer token to a `{ tenant, scopes }` context for the gateway.

## Token model

| token | lifetime | refreshable | used by |
|---|---|---|---|
| Session JWT | 15 min | yes, via refresh token | browser clients |
| Refresh token | 30 days | rotated on use | browser clients |
| API key | until revoked | no | server-to-server |

Refresh tokens are **single-use** — each refresh rotates the token and invalidates the old one. A
reused refresh token revokes the whole session family, which catches token theft.

## Endpoints

- `POST /sessions` — exchange credentials for a session + refresh token.
- `POST /sessions/refresh` — rotate a refresh token.
- `POST /keys` / `DELETE /keys/:id` — manage API keys.
- `GET /resolve` — internal-only; gateway calls this on every request (cached in Redis for 10s).

## Notes

- Passwords are hashed with Argon2id; we never log credentials or tokens.
- Rate limits live in the gateway, not here, so a credential-stuffing attempt is shed before it
  reaches the database.
