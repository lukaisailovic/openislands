# @openislands/connector-kit

[![npm version](https://img.shields.io/npm/v/@openislands/connector-kit?color=2dd4bf)](https://www.npmjs.com/package/@openislands/connector-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-2dd4bf.svg)](https://github.com/lukaisailovic/openislands/blob/main/LICENSE)

> The typed contract for authoring an OpenIslands connector.

A connector pulls data from an outside provider (a wearable, an API, a bank export) into a dataset your dashboard can render. It lives in your project at `connectors/<name>/index.ts` and default-exports `defineConnector({ ... })`. This package is the type contract that `defineConnector` checks against: the config schema, the auth shape, the output names, and the `sync` function's context.

`@openislands/connector-kit` is part of [OpenIslands](https://github.com/lukaisailovic/openislands). Install it as a dev dependency when you're writing a connector; it's editor types only, so the connector files type-check. End users never install it; they drop a connector directory into their project.

## Install

```bash
npm i -D @openislands/connector-kit zod
```

## Authoring a connector

```ts
import { defineConnector } from "@openislands/connector-kit";
import { z } from "zod";

export default defineConnector({
  description: "Example provider sync",
  config: z.object({ lookbackDays: z.number().int().positive().default(30) }),
  schedule: "6h",
  auth: {
    type: "oauth2",
    data: {
      authorizeUrl: "https://provider.example/oauth/authorize",
      tokenUrl: "https://provider.example/oauth/token",
      scopes: ["read:data"],
      clientIdEnv: "PROVIDER_CLIENT_ID",     // read from .env, never inlined
      clientSecretEnv: "PROVIDER_CLIENT_SECRET",
    },
  },
  outputs: {
    recovery: { description: "revised each sync, replaced every run" },
    readings: { description: "immutable, appended by a cursor" },
  },
  async sync(ctx) {
    // ctx.config.lookbackDays is typed `number`;
    // ctx.insert / ctx.replace only accept "recovery" | "readings".
    await ctx.replace("recovery", [{ date: "2026-06-23", score: 71 }]);

    await ctx.insert("readings", [{ id: "r1", value: 42, updated_at: "2026-06-23T10:00:00Z" }]);
    ctx.state.cursor = "2026-06-23T10:00:00Z"; // persisted after a successful sync
  },
});
```

`defineConnector` is an identity function: it returns your definition unchanged. Its only job is inference: it captures your config type, output names, and secret keys so `ctx` is fully typed inside `sync`. Use `ctx.insert` for records that only ever get appended (advance a cursor in `ctx.state`) and `ctx.replace` to overwrite the whole output each run.

## Notes

- Secrets come from `.env` by name (`clientIdEnv`, `tokenEnv`), never inlined. A bearer connector uses `{ type: "bearer", data: { tokenEnv: "API_TOKEN" } }`; a keyless one omits `auth`.
- Authorizing a connector is human-only: sign-in happens in the dashboard. An agent never authorizes one.
- Outputs write to a writable `source` dataset (a file or SQLite table), never a SQL transform. Writes are checkpointed, so a sync rolls back like any other change.

## Documentation

- [Agent edit loop](https://github.com/lukaisailovic/openislands/blob/main/docs/agent-edit-loop.md) (connectors section)
- [OpenIslands docs](https://openislands.sh)
- [GitHub](https://github.com/lukaisailovic/openislands)

## License

MIT © Luka Isailovic
