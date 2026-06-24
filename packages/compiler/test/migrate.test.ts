import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateApp } from "../src/migrate.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An app dir with a manifest at `app/manifest.json` (the pre-flatten layout) and any extra files. */
function nestedApp(manifest: string, extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-migrate-"));
  dirs.push(dir);
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "manifest.json"), manifest);
  for (const [rel, content] of Object.entries(extra)) writeFileSync(join(dir, "app", rel), content);
  return dir;
}

const MANIFEST = JSON.stringify({ version: 1, title: "T", datasets: {}, pages: [] });

describe("migrateApp — flatten app/manifest.json", () => {
  it("moves app/manifest.json to manifest.json and removes the empty app/ dir", () => {
    const dir = nestedApp(MANIFEST);
    migrateApp(dir);
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(MANIFEST);
    expect(existsSync(join(dir, "app"))).toBe(false);
  });

  it("is idempotent — running again is a no-op and never throws", () => {
    const dir = nestedApp(MANIFEST);
    migrateApp(dir);
    expect(() => migrateApp(dir)).not.toThrow();
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(MANIFEST);
  });

  it("leaves an already-flat app untouched and creates no app/ dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-migrate-"));
    dirs.push(dir);
    writeFileSync(join(dir, "manifest.json"), MANIFEST);
    migrateApp(dir);
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(MANIFEST);
    expect(existsSync(join(dir, "app"))).toBe(false);
  });

  it("never clobbers an existing flat manifest when both exist", () => {
    const flat = JSON.stringify({ version: 1, title: "FLAT", datasets: {}, pages: [] });
    const dir = nestedApp(MANIFEST);
    writeFileSync(join(dir, "manifest.json"), flat);
    migrateApp(dir);
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(flat);
  });

  it("moves the manifest but keeps app/ when it holds other files", () => {
    const dir = nestedApp(MANIFEST, { "notes.txt": "keep me" });
    migrateApp(dir);
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(MANIFEST);
    expect(readFileSync(join(dir, "app", "notes.txt"), "utf8")).toBe("keep me");
  });

  it("is a no-op when there is no manifest at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-migrate-"));
    dirs.push(dir);
    expect(() => migrateApp(dir)).not.toThrow();
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
  });
});
