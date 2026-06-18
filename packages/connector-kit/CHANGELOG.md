# @openislands/connector-kit

## 0.2.0

### Minor Changes

- 1d4d577: Connectors now support static bearer-token auth (`auth: { type: "bearer", data: { tokenEnv } }`) alongside OAuth2: a long-lived API token / JWT read from `.env` and handed to `sync` as `ctx.tokens.accessToken`, with no interactive Connect. Auth handling in the compiler is reworked into a per-scheme abstraction (keyless / oauth2 / bearer).
