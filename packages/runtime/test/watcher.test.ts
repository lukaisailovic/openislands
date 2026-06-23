import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@openislands/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateDatasets,
  islandErrorKey,
  queryKeyMatchesDatasets,
} from "../src/client/useLiveUpdates.js";
import type { RuntimeEvent } from "../src/types.js";
import { isEditableTextFile, markSelfWrite, takeSelfWrite } from "../src/server/editorSync.js";
import {
  affectedDatasets,
  eventsForChange,
  filesChangedEvent,
  mergeEvents,
  RuntimeEventBroadcaster,
  startWatcher,
  type WatchHandle,
} from "../src/server/watcher.js";

const FINANCE = join(import.meta.dirname, "..", "..", "..", "templates", "finance", "apps", "finance");

function manifest(datasets: Manifest["datasets"]): Manifest {
  return { version: 1, title: "T", datasets, pages: [] };
}

describe("affectedDatasets", () => {
  it("maps a data file change to the datasets sourced from it", () => {
    const m = manifest({
      nw: { source: "data/net_worth.csv" },
      tx: { source: "data/transactions.csv" },
    });
    expect(affectedDatasets(m, "data/net_worth.csv")).toEqual(["nw"]);
  });

  it("maps a sql transform file change to its dataset", () => {
    const m = manifest({ joined: { sql: "models/joined.sql" }, raw: { source: "data/a.csv" } });
    expect(affectedDatasets(m, "models/joined.sql")).toEqual(["joined"]);
  });

  it("treats a manifest change as touching every dataset", () => {
    const m = manifest({ a: { source: "data/a.csv" }, b: { source: "data/b.csv" } });
    expect(affectedDatasets(m, "app/manifest.json").toSorted()).toEqual(["a", "b"]);
  });

  it("matches a glob source by directory and extension", () => {
    const m = manifest({ logs: { source: "data/logs/*.csv" } });
    expect(affectedDatasets(m, "data/logs/2026-06.csv")).toEqual(["logs"]);
    expect(affectedDatasets(m, "data/other.csv")).toEqual([]);
  });

  it("returns nothing for a file no dataset reads", () => {
    const m = manifest({ a: { source: "data/a.csv" } });
    expect(affectedDatasets(m, "data/unused.csv")).toEqual([]);
  });
});

describe("mergeEvents", () => {
  it("collapses datasets-changed events into one deduped set", () => {
    const merged = mergeEvents([
      { type: "datasets-changed", datasets: ["a", "b"] },
      { type: "datasets-changed", datasets: ["b", "c"] },
    ]);
    expect(merged).toHaveLength(1);
    expect((merged[0] as { datasets: string[] }).datasets.toSorted()).toEqual(["a", "b", "c"]);
  });

  it("a validation event wins over datasets-changed", () => {
    const merged = mergeEvents([
      { type: "datasets-changed", datasets: ["a"] },
      { type: "validation", islandErrors: [] },
    ]);
    expect(merged).toEqual([{ type: "validation", islandErrors: [] }]);
  });
});

describe("isEditableTextFile", () => {
  it("accepts the editable text extensions", () => {
    for (const name of ["a.md", "a.markdown", "a.txt", "a.csv"]) {
      expect(isEditableTextFile(name)).toBe(true);
    }
  });

  it("rejects non-text extensions", () => {
    for (const name of ["a.json", "a.js", "a.png"]) {
      expect(isEditableTextFile(name)).toBe(false);
    }
  });
});

describe("self-write suppression", () => {
  it("consumes a mark once and ignores unmarked paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-selfwrite-"));
    markSelfWrite(dir, "data/note.md");
    expect(takeSelfWrite(dir, "data/note.md")).toBe(true);
    expect(takeSelfWrite(dir, "data/note.md")).toBe(false);
    expect(takeSelfWrite(dir, "data/other.md")).toBe(false);
  });
});

describe("filesChangedEvent", () => {
  it("keeps only editable paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-fc-"));
    expect(filesChangedEvent(dir, ["data/a.md", "data/b.json", "data/c.csv"])).toEqual({
      type: "files-changed",
      paths: ["data/a.md", "data/c.csv"],
    });
  });

  it("returns null when no path is editable", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-fc-"));
    expect(filesChangedEvent(dir, ["data/a.json", "data/b.png"])).toBeNull();
  });

  it("excludes a self-written path while keeping an external sibling", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-fc-"));
    markSelfWrite(dir, "data/self.md");
    expect(filesChangedEvent(dir, ["data/self.md", "data/external.md"])).toEqual({
      type: "files-changed",
      paths: ["data/external.md"],
    });
  });
});

describe("client invalidation key logic", () => {
  it("matches an island-data key whose app and dataset changed", () => {
    const set = new Set(["nw"]);
    expect(queryKeyMatchesDatasets(["island-data", "fin", "nw", "hash"], set, "fin")).toBe(true);
    expect(queryKeyMatchesDatasets(["island-data", "fin", "tx", "hash"], set, "fin")).toBe(false);
    expect(queryKeyMatchesDatasets(["island-data", "other-app", "nw", "hash"], set, "fin")).toBe(false);
    expect(queryKeyMatchesDatasets(["other", "fin", "nw"], set, "fin")).toBe(false);
  });

  it("invalidates only matching queries via predicate", () => {
    const client = { invalidateQueries: vi.fn() } as unknown as Parameters<
      typeof invalidateDatasets
    >[0];
    invalidateDatasets(client, ["nw"], "fin");
    const predicate = (client.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .predicate;
    expect(predicate({ queryKey: ["island-data", "fin", "nw", "h"] })).toBe(true);
    expect(predicate({ queryKey: ["island-data", "fin", "tx", "h"] })).toBe(false);
    expect(predicate({ queryKey: ["island-data", "health", "nw", "h"] })).toBe(false);
  });

  it("skips invalidation when nothing changed", () => {
    const client = { invalidateQueries: vi.fn() } as unknown as Parameters<
      typeof invalidateDatasets
    >[0];
    invalidateDatasets(client, [], "fin");
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it("keys island errors by page and index", () => {
    expect(islandErrorKey("overview", 2)).toBe("overview#2");
  });
});

function financeCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-watch-"));
  cpSync(FINANCE, dir, { recursive: true });
  return dir;
}

describe("eventsForChange", () => {
  it("emits datasets-changed for a valid edit", async () => {
    const dir = financeCopy();
    const events = await eventsForChange(dir, "data/net_worth_monthly.csv");
    expect(events).toEqual([{ type: "datasets-changed", datasets: ["net_worth_monthly"] }]);
  });

  it("emits a validation event naming the broken island when a bound field disappears", async () => {
    const dir = financeCopy();
    const csv = join(dir, "data", "net_worth_monthly.csv");
    writeFileSync(csv, readFileSync(csv, "utf8").replace("net_worth_eur", "renamed"));
    const events = await eventsForChange(dir, "data/net_worth_monthly.csv");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("validation");
    const errors = (events[0] as { islandErrors: { field?: string; type: string }[] }).islandErrors;
    expect(errors.some((e) => e.field === "net_worth_eur")).toBe(true);
  });
});

describe("startWatcher integration", () => {
  let handle: WatchHandle | undefined;
  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
  });

  it("publishes a datasets-changed event when a watched CSV is edited", async () => {
    const dir = financeCopy();
    const received: unknown[] = [];
    const broadcaster = new RuntimeEventBroadcaster();
    const unsub = broadcaster.subscribe((e) => received.push(e));
    handle = await startWatcher(dir, { broadcaster, debounceMs: 20 });

    const csv = join(dir, "data", "net_worth_monthly.csv");
    const event = new Promise<void>((resolve) => {
      const stop = broadcaster.subscribe(() => {
        stop();
        resolve();
      });
    });
    const header = readFileSync(csv, "utf8").split("\n", 1)[0]!;
    const newRow = [
      "2099-01",
      ...header
        .split(",")
        .slice(1)
        .map(() => "9999999"),
    ].join(",");
    writeFileSync(csv, readFileSync(csv, "utf8") + newRow + "\n");
    await Promise.race([
      event,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no event in 10s")), 10000)),
    ]);

    unsub();
    expect(received).toContainEqual({ type: "datasets-changed", datasets: ["net_worth_monthly"] });
  });

  it("emits files-changed when an external content file under data/ is added", async () => {
    const dir = financeCopy();
    const received: RuntimeEvent[] = [];
    const broadcaster = new RuntimeEventBroadcaster();
    broadcaster.subscribe((e) => received.push(e));
    handle = await startWatcher(dir, { broadcaster, debounceMs: 20 });

    const filesChanged = new Promise<void>((resolve) => {
      const stop = broadcaster.subscribe((e) => {
        if (e.type !== "files-changed") return;
        stop();
        resolve();
      });
    });
    writeFileSync(join(dir, "data", "note.md"), "# external note\n");
    await Promise.race([
      filesChanged,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no files-changed in 10s")), 10000)),
    ]);

    expect(received).toContainEqual({ type: "files-changed", paths: ["data/note.md"] });
  });

  it("suppresses the files-changed echo for a self-written path", async () => {
    const dir = financeCopy();
    const received: RuntimeEvent[] = [];
    const broadcaster = new RuntimeEventBroadcaster();
    broadcaster.subscribe((e) => received.push(e));
    handle = await startWatcher(dir, { broadcaster, debounceMs: 20 });

    markSelfWrite(dir, "data/note.md");
    writeFileSync(join(dir, "data", "note.md"), "# self write\n");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      received.some((e) => e.type === "files-changed" && e.paths.includes("data/note.md")),
    ).toBe(false);
  });
});
