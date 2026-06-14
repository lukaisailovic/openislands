import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineConnector } from "../src/index.js";

describe("defineConnector", () => {
  it("returns the definition unchanged", () => {
    const def = defineConnector({
      outputs: { recovery: {} },
      async sync() {},
    });
    expect(def.outputs.recovery).toEqual({});
    expect(typeof def.sync).toBe("function");
  });

  it("carries a typed config schema and oauth config through", () => {
    const config = z.object({ unit: z.enum(["metric", "imperial"]) });
    const def = defineConnector({
      config,
      secrets: ["WHOOP_CLIENT_ID"],
      auth: {
        type: "oauth2",
        data: {
          authorizeUrl: "https://example.com/auth",
          tokenUrl: "https://example.com/token",
          scopes: ["read:recovery"],
          clientIdEnv: "WHOOP_CLIENT_ID",
          clientSecretEnv: "WHOOP_CLIENT_SECRET",
        },
      },
      schedule: "6h",
      outputs: { recovery: { description: "scores" } },
      async sync(ctx) {
        ctx.log(ctx.config.unit);
      },
    });
    const auth = def.auth;
    expect(auth?.type).toBe("oauth2");
    if (auth?.type === "oauth2") expect(auth.data.tokenUrl).toBe("https://example.com/token");
    expect(def.config!.safeParse({ unit: "metric" }).success).toBe(true);
  });

  it("carries bearer auth config through", () => {
    const def = defineConnector({
      auth: { type: "bearer", data: { tokenEnv: "API_TOKEN" } },
      outputs: { readings: {} },
      async sync() {},
    });
    const auth = def.auth;
    expect(auth?.type).toBe("bearer");
    if (auth?.type === "bearer") expect(auth.data.tokenEnv).toBe("API_TOKEN");
  });

  it("infers config, output names, and secret keys onto ctx", () => {
    defineConnector({
      config: z.object({ lookbackDays: z.number().default(30) }),
      secrets: ["API_KEY"],
      outputs: { readings: {}, summaries: {} },
      async sync(ctx) {
        expectTypeOf(ctx.config.lookbackDays).toEqualTypeOf<number>();
        expectTypeOf(ctx.secrets).toEqualTypeOf<Record<"API_KEY", string>>();
        expectTypeOf(ctx.insert).parameter(0).toEqualTypeOf<"readings" | "summaries">();
        expectTypeOf(ctx.replace).parameter(0).toEqualTypeOf<"readings" | "summaries">();
      },
    });
  });
});
