/**
 * Unit tests for the Code Mode runner (`runCode`) — exercised directly, not through the server, so
 * they stay fast (tiny timeouts) and isolate the sandbox semantics from the `oi` API.
 *
 * What it locks down:
 *  - basic return-value capture + console.log capture (the result contract { ok, result, logs });
 *  - the realm intrinsics a script relies on (Object/JSON/Math/Array/Promise) ARE present;
 *  - the host capabilities a script must NOT reach (process/require) are undefined, and the
 *    canonical `this.constructor.constructor` break-out throws against the null-prototype global;
 *  - the timeout layer (synchronous runaway + async hang) yields ok:false with a "timed out" error;
 *  - the truncation caps (maxResultChars / maxLogChars);
 *  - error surfacing: a thrown error → { ok:false, error } referencing codemode.js, no host paths;
 *  - a syntax error is reported as such, not thrown.
 *
 * Nothing here touches disk, the network, or real timers beyond the small sandbox deadlines.
 */
import { describe, expect, it } from "vitest";
import { runCode } from "../src/codemode.js";

describe("runCode — return + log capture", () => {
  it("captures a returned value and console.log lines", async () => {
    const res = await runCode({
      code: `console.log("hello", 42); return { sum: 1 + 2 };`,
      globals: {},
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ sum: 3 });
    expect(res.logs).toEqual(["hello 42"]);
  });

  it("omits result when the script returns nothing", async () => {
    const res = await runCode({ code: `console.log("noop");`, globals: {} });
    expect(res.ok).toBe(true);
    expect("result" in res).toBe(false);
    expect(res.logs).toEqual(["noop"]);
  });

  it("tags non-log console levels and renders objects as JSON", async () => {
    const res = await runCode({
      code: `console.warn("careful"); console.info({ a: 1 }); return null;`,
      globals: {},
    });
    expect(res.ok).toBe(true);
    expect(res.logs).toEqual(["[warn] careful", `[info] {"a":1}`]);
  });

  it("exposes injected globals to the script", async () => {
    const res = await runCode({
      code: `return greet("world");`,
      globals: { greet: (who: string) => `hi ${who}` },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toBe("hi world");
  });
});

describe("runCode — realm intrinsics", () => {
  it("keeps Object/JSON/Math/Array/Promise available inside the sandbox", async () => {
    const res = await runCode({
      code: `return {
        object: typeof Object,
        json: typeof JSON,
        math: typeof Math,
        array: Array.isArray([1, 2]),
        promise: typeof Promise,
        awaited: await Promise.resolve("ok"),
      };`,
      globals: {},
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ object: "function", json: "object", math: "object", array: true, promise: "function", awaited: "ok" });
  });
});

describe("runCode — sandbox boundary", () => {
  it("hides process and require from the script", async () => {
    const res = await runCode({
      code: `return { process: typeof process, require: typeof require };`,
      globals: {},
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ process: "undefined", require: "undefined" });
  });

  it("blocks the textbook this.constructor.constructor break-out", async () => {
    const res = await runCode({
      code: `return this.constructor.constructor("return process")();`,
      globals: {},
    });
    // The null-prototype global has no `constructor`, so the break-out throws rather than reaching
    // the host realm; either way `process` never resolves.
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/process is not defined|Cannot read properties|undefined/i);
  });
});

describe("runCode — timeout", () => {
  it("interrupts a synchronous infinite loop and reports a timeout", async () => {
    const res = await runCode({ code: `while (true) {}`, globals: {}, timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  it("bounds an async hang that races past the deadline", async () => {
    const res = await runCode({
      code: `await new Promise(() => {}); return "never";`,
      globals: {},
      timeoutMs: 200,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });
});

describe("runCode — output caps", () => {
  it("truncates an over-budget result to a string and flags it", async () => {
    const res = await runCode({
      code: `return Array.from({ length: 500 }, (_, i) => ({ i, blob: "x".repeat(50) }));`,
      globals: {},
      maxResultChars: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.result_truncated).toBe(true);
    expect(typeof res.result).toBe("string");
    expect((res.result as string)).toMatch(/truncated/i);
  });

  it("truncates over-budget console output and flags it", async () => {
    const res = await runCode({
      code: `for (let i = 0; i < 100; i += 1) console.log("line " + i + " " + "y".repeat(50)); return "done";`,
      globals: {},
      maxLogChars: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.logs_truncated).toBe(true);
    expect(res.logs.at(-1)).toMatch(/logs truncated/i);
  });
});

describe("runCode — error surfacing", () => {
  it("returns a thrown error's message without leaking host frames", async () => {
    const res = await runCode({ code: `throw new Error("boom");`, globals: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/boom/);
    // Host internals stay out of the surfaced error — only the message (+ a codemode.js user frame
    // when the realm preserves one) reaches the caller.
    expect(res.error).not.toMatch(/api\.js|server\.js|node_modules|node:internal/);
  });

  it("surfaces an error thrown by an injected global without leaking host frames", async () => {
    const res = await runCode({
      code: `await oops();`,
      globals: { oops: () => { throw new Error("host side"); } },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/host side/);
    expect(res.error).not.toMatch(/node_modules|node:internal/);
  });

  it("reports a syntax error as such rather than throwing", async () => {
    const res = await runCode({ code: `return (;`, globals: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/syntax error/i);
    expect(res.logs).toEqual([]);
  });
});
