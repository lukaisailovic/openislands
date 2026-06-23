import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalAppStateStore,
  LocalContentStore,
  configureStorage,
  getAppStateStore,
  getContentStore,
  getVersionStore,
  hasVersionStore,
  resetStorage,
} from "../src/index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openislands-storage-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetStorage();
});

describe("LocalContentStore", () => {
  it("round-trips text and reports existence + stat", async () => {
    const store = new LocalContentStore(root);
    expect(await store.exists("data/x.csv")).toBe(false);
    expect(await store.readText("data/x.csv")).toBeNull();

    await store.writeText("data/x.csv", "a,b\n1,2\n");
    expect(await store.exists("data/x.csv")).toBe(true);
    expect(await store.readText("data/x.csv")).toBe("a,b\n1,2\n");
    expect(readFileSync(join(root, "data/x.csv"), "utf8")).toBe("a,b\n1,2\n");

    const stat = await store.stat("data/x.csv");
    expect(stat?.size).toBe(8);
  });

  it("lists, moves, and removes", async () => {
    const store = new LocalContentStore(root);
    await store.writeText("docs/a.md", "# A");
    await store.writeText("docs/b.md", "# B");

    const listed = (await store.list("docs")).map((e) => e.name).toSorted();
    expect(listed).toEqual(["a.md", "b.md"]);

    await store.move("docs/a.md", "docs/c.md");
    expect(await store.exists("docs/a.md")).toBe(false);
    expect(await store.readText("docs/c.md")).toBe("# A");

    await store.remove("docs/c.md");
    expect(await store.exists("docs/c.md")).toBe(false);
    await store.remove("docs/missing.md"); // no throw
  });

  it("resolves a source uri to an absolute path", async () => {
    const store = new LocalContentStore(root);
    expect(store.sourceUri("data/x.csv")).toBe(join(root, "data/x.csv"));
    expect(store.sourceUri("/already/abs.csv")).toBe("/already/abs.csv");
  });

  it("configures an engine connection with the file search path", async () => {
    const store = new LocalContentStore(root);
    const calls: string[] = [];
    await store.configureEngine({ run: async (sql: string) => void calls.push(sql) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("file_search_path");
    expect(calls[0]).toContain(root);
  });
});

describe("LocalAppStateStore", () => {
  it("stores blobs under .openislands and lists a prefix with sizes", async () => {
    const store = new LocalAppStateStore(root);
    expect(await store.getText("connectors/x.json")).toBeNull();

    await store.put("connectors/x.json", '{"a":1}\n');
    expect(await store.exists("connectors/x.json")).toBe(true);
    expect(await store.getText("connectors/x.json")).toBe('{"a":1}\n');
    expect(readFileSync(join(root, ".openislands/connectors/x.json"), "utf8")).toBe('{"a":1}\n');

    await store.put("history/ckpt-1!data%2Fx.csv", "snapshot");
    const history = await store.list("history");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: "ckpt-1!data%2Fx.csv", key: "history/ckpt-1!data%2Fx.csv" });
    expect(history[0]?.size).toBe(8);

    await store.delete("connectors/x.json");
    expect(await store.exists("connectors/x.json")).toBe(false);
    expect(await store.list("proposals")).toEqual([]);
  });
});

describe("storage registry", () => {
  it("returns local adapters by default", () => {
    expect(getContentStore(root)).toBeInstanceOf(LocalContentStore);
    expect(getAppStateStore(root)).toBeInstanceOf(LocalAppStateStore);
  });

  it("throws for an unconfigured VersionStore, then resolves once configured", () => {
    expect(hasVersionStore()).toBe(false);
    expect(() => getVersionStore(root)).toThrow(/no VersionStore configured/);

    const fake = {
      record: async () => {},
      list: async () => [],
      get: async () => null,
      move: async () => {},
      prune: async () => {},
    };
    configureStorage({ versions: () => fake });
    expect(hasVersionStore()).toBe(true);
    expect(getVersionStore(root)).toBe(fake);
  });

  it("lets a custom content factory override the default", () => {
    const custom = new LocalContentStore(join(root, "nested"));
    configureStorage({ content: () => custom });
    expect(getContentStore(root)).toBe(custom);
  });
});
