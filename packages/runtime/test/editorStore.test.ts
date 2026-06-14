import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getVersion,
  listVersions,
  moveVersions,
  pruneVersions,
  recordVersion,
} from "../src/server/editorStore.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "oi-editor-store-"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("editorStore", () => {
  it("records, lists, and gets versions newest-first with per-path ids", async () => {
    await recordVersion(dir, "docs/a.md", "v1");
    await recordVersion(dir, "docs/a.md", "v2 — has 'quotes' and\nnewlines", "manual save");
    await recordVersion(dir, "docs/b.md", "other");

    const versions = await listVersions(dir, "docs/a.md");
    expect(versions.map((v) => v.id)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ id: 2, label: "manual save" });
    expect(versions[0]!.byteSize).toBe(Buffer.byteLength("v2 — has 'quotes' and\nnewlines"));
    expect(versions[1]!.label).toBeUndefined();

    expect(await getVersion(dir, "docs/a.md", 2)).toBe("v2 — has 'quotes' and\nnewlines");
    expect(await getVersion(dir, "docs/a.md", 1)).toBe("v1");
    expect(await getVersion(dir, "docs/a.md", 99)).toBeNull();
  });

  it("keeps a path's history isolated from other paths", async () => {
    expect((await listVersions(dir, "docs/b.md")).map((v) => v.id)).toEqual([1]);
  });

  it("prunes a path's oldest versions beyond the keep limit", async () => {
    for (let i = 0; i < 8; i++) await recordVersion(dir, "data/log.csv", `row-${i}`);
    await pruneVersions(dir, "data/log.csv", 3);

    const kept = await listVersions(dir, "data/log.csv");
    expect(kept).toHaveLength(3);
    expect(kept.map((v) => v.id)).toEqual([8, 7, 6]);
    expect(await getVersion(dir, "data/log.csv", 5)).toBeNull();
  });

  it("carries a path's history to its new name on move", async () => {
    await recordVersion(dir, "docs/old.md", "v1");
    await recordVersion(dir, "docs/old.md", "v2");
    await moveVersions(dir, "docs/old.md", "docs/new.md");

    expect(await listVersions(dir, "docs/old.md")).toEqual([]);
    const moved = await listVersions(dir, "docs/new.md");
    expect(moved.map((v) => v.id)).toEqual([2, 1]);
    expect(await getVersion(dir, "docs/new.md", 2)).toBe("v2");
  });

  it("shifts ids past any history already at the destination", async () => {
    await recordVersion(dir, "src/a.md", "a1");
    await recordVersion(dir, "src/b.md", "b1");
    await recordVersion(dir, "src/b.md", "b2");
    await moveVersions(dir, "src/b.md", "src/a.md");

    const merged = await listVersions(dir, "src/a.md");
    expect(merged.map((v) => v.id).toSorted((x, y) => x - y)).toEqual([1, 2, 3]);
    expect(await getVersion(dir, "src/a.md", 1)).toBe("a1");
    expect(await getVersion(dir, "src/a.md", 3)).toBe("b2");
  });
});
