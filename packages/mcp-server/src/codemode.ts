/**
 * Code Mode runtime — run agent-authored JavaScript against the OpenIslands API in a node:vm
 * context, instead of exposing one MCP tool per operation. The script gets the globals passed in
 * (the server passes `oi`, the per-app/workspace API) plus a captured `console`; it gets NO
 * require / process / Buffer / fetch / timers — every capability comes through `oi`.
 *
 * Security note (read before "hardening" this): node:vm is NOT a security boundary — a determined
 * script can reach the host realm through any leaked host object/constructor. That is acceptable
 * ONLY because of the threat model: the script is written by the user's own agent, runs on the
 * user's machine, and `oi` already grants every (path-confined) file operation the script could
 * want — the same operations the agent could call as discrete tools. The sandbox is a guardrail
 * against the agent's bugs and against ambient-authority footguns, not a defense against hostile
 * code. We give the context a null-prototype global so the canonical `this.constructor.constructor`
 * break-out throws, but a script that *wants* the host can still reach it through any host function
 * it's handed (e.g. an `oi` method's `.constructor`). That residual is out of the threat model.
 * ponytail: node:vm is a guardrail, not a sandbox — move to a worker_thread/real isolate if
 * untrusted code ever runs here.
 */
import vm from "node:vm";

export interface RunCodeResult {
  ok: boolean;
  result?: unknown;
  logs: string[];
  error?: string;
  result_truncated?: boolean;
  logs_truncated?: boolean;
}

export interface RunCodeOptions {
  code: string;
  /** Globals exposed to the script, e.g. `{ oi }`. */
  globals: Record<string, unknown>;
  /** Wall-clock cap for the whole run. Interrupts a synchronous runaway exactly; for async work it
   * is advisory — see {@link runCode}. Default 30s. */
  timeoutMs?: number;
  /** Char cap on the serialized return value before it is truncated. */
  maxResultChars?: number;
  /** Char cap on captured console output. */
  maxLogChars?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULT_CHARS = 60_000; // ~15k tokens
const DEFAULT_MAX_LOG_CHARS = 20_000; // ~5k tokens

/** JSON replacer that survives DuckDB's BigInt counts — `JSON.stringify(1n)` throws, so without this
 * a `SELECT count(*)` result crashes serialization. (Date serializes fine via its own toJSON.) */
function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value !== "bigint") return value;
  return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
}

/** Render a console arg: strings verbatim, everything else as BigInt-safe JSON (falling back to
 * String for circular/unserializable values). */
function render(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, jsonSafe) ?? String(value);
  } catch {
    return String(value);
  }
}

/** A script's return value, made plain + JSON-safe so the MCP layer can re-serialize it (no leaked
 * vm-realm objects, no BigInt crash) and capped so one huge query can't blow the context budget. */
function safeResult(value: unknown, max: number): { result?: unknown; truncated?: boolean } {
  if (value === undefined) return {};
  let json: string | undefined;
  try {
    json = JSON.stringify(value, jsonSafe);
  } catch {
    /* circular / unserializable */
  }
  if (json === undefined) return { result: String(value) };
  if (json.length > max) return { result: json.slice(0, max) + "… (truncated)", truncated: true };
  return { result: JSON.parse(json) };
}

/** Message + the first user frame (line numbers map to the script via lineOffset), with host frames
 * and absolute paths dropped so we don't leak internals. Duck-typed rather than `instanceof Error`:
 * an error thrown inside the vm is a different realm's Error, so `instanceof` would miss it. */
function cleanError(e: unknown): string {
  const err = e as { message?: unknown; stack?: unknown } | null | undefined;
  const message = err && typeof err.message === "string" ? err.message : String(e);
  const stack = err && typeof err.stack === "string" ? err.stack : "";
  const userFrame = stack.split("\n").find((line) => line.includes("codemode.js"));
  return userFrame ? `${message} (at ${userFrame.trim().replace(/^at\s+/, "")})` : message;
}

/**
 * Run `code` as the body of an async function with `globals` + a captured `console` in scope.
 *
 * Timeout has two layers: vm's own `timeout` interrupts a synchronous runaway (e.g. `while(true){}`)
 * exactly, and a `Promise.race` bounds the async run. The race does NOT cancel in-flight work — a
 * DuckDB query or a connector sync already running will finish. Callers must treat the deadline as
 * "stop starting new work" (the API checks an AbortSignal at each method entry) and rely on
 * checkpoints to recover any write that lands after the deadline. (A synchronous infinite loop placed
 * AFTER an `await` blocks the event loop and can outlast both layers — unavoidable without a worker.)
 */
export async function runCode(opts: RunCodeOptions): Promise<RunCodeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResultChars = opts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  const maxLogChars = opts.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;

  const logs: string[] = [];
  let logChars = 0;
  let logsTruncated = false;
  const record = (level: string, args: unknown[]): void => {
    if (logsTruncated) return;
    const line = (level === "log" ? "" : `[${level}] `) + args.map(render).join(" ");
    if (logChars + line.length > maxLogChars) {
      logsTruncated = true;
      logs.push("… (logs truncated)");
      return;
    }
    logChars += line.length + 1;
    logs.push(line);
  };
  const console = {
    log: (...a: unknown[]) => record("log", a),
    info: (...a: unknown[]) => record("info", a),
    warn: (...a: unknown[]) => record("warn", a),
    error: (...a: unknown[]) => record("error", a),
    debug: (...a: unknown[]) => record("debug", a),
  };

  // Null-prototype global: top-level `this.constructor` is undefined, so the textbook
  // `this.constructor.constructor("return process")()` break-out throws. vm still installs the
  // realm intrinsics (Object/Array/JSON/Math/Promise) on the global, so the script keeps those.
  const sandbox = Object.assign(Object.create(null) as Record<string, unknown>, { ...opts.globals, console });
  const context = vm.createContext(sandbox);
  // One-line preamble so error line numbers map to the script (lineOffset undoes it).
  const wrapped = `(async () => {\n${opts.code}\n})()`;

  let script: vm.Script;
  try {
    script = new vm.Script(wrapped, { filename: "codemode.js", lineOffset: -1 });
  } catch (e) {
    return { ok: false, error: `syntax error: ${(e as Error).message}`, logs };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`script timed out after ${timeoutMs}ms (any in-flight write still completes — it is checkpointed)`)), timeoutMs);
  });

  try {
    const promise = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>;
    // On timeout the race settles via `deadline` but `promise` keeps running; swallow a late
    // rejection from it so it doesn't surface as an unhandled rejection after we've returned.
    void promise.catch(() => {});
    const value = await Promise.race([promise, deadline]);
    const { result, truncated } = safeResult(value, maxResultChars);
    return {
      ok: true,
      ...(result === undefined ? {} : { result }),
      logs,
      ...(truncated ? { result_truncated: true } : {}),
      ...(logsTruncated ? { logs_truncated: true } : {}),
    };
  } catch (e) {
    return { ok: false, error: cleanError(e), logs, ...(logsTruncated ? { logs_truncated: true } : {}) };
  } finally {
    clearTimeout(timer);
  }
}
