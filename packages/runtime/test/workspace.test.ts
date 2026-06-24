import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appDir,
  appDirFromParams,
  listApps,
  resetWorkspaceCache,
  workspaceRoot,
} from "../src/server/workspace.js";
import { broadcasterFor } from "../src/server/watcher.js";

function writeApp(root: string, name: string, content: Record<string, unknown>): void {
  mkdirSync(join(root, "apps", name), { recursive: true });
  writeFileSync(join(root, "apps", name, "manifest.json"), JSON.stringify(content));
}

function manifest(title: string, icon?: string): Record<string, unknown> {
  return { version: 1, title, icon, datasets: {}, pages: [] };
}

const savedProjectDir = process.env.OPENISLANDS_PROJECT_DIR;

beforeEach(() => {
  delete process.env.OPENISLANDS_PROJECT_DIR;
  resetWorkspaceCache();
});

afterEach(() => {
  process.env.OPENISLANDS_PROJECT_DIR = savedProjectDir;
  if (savedProjectDir === undefined) delete process.env.OPENISLANDS_PROJECT_DIR;
  resetWorkspaceCache();
});

describe("workspaceRoot", () => {
  it("returns the project root from the env var", () => {
    process.env.OPENISLANDS_PROJECT_DIR = "/p";
    expect(workspaceRoot()).toBe("/p");
  });

  it("throws when it is not set", () => {
    expect(() => workspaceRoot()).toThrow(/openislands serve/);
  });
});

describe("listApps", () => {
  it("scans apps/ subdirs with a manifest.json, alphabetically", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    writeApp(root, "finance", manifest("Finance Overview", "wallet"));
    writeApp(root, "health", manifest("Health"));
    mkdirSync(join(root, "apps", "not-an-app"), { recursive: true });
    process.env.OPENISLANDS_PROJECT_DIR = root;

    const apps = listApps();
    expect(apps.map((a) => a.id)).toEqual(["finance", "health"]);
    expect(apps[0]).toMatchObject({ title: "Finance Overview", icon: "wallet", errors: [] });
    expect(apps[1]!.icon).toBeUndefined();
  });

  it("auto-migrates a legacy app/manifest.json layout so the scan still finds it", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    mkdirSync(join(root, "apps", "legacy", "app"), { recursive: true });
    writeFileSync(join(root, "apps", "legacy", "app", "manifest.json"), JSON.stringify(manifest("Legacy")));
    process.env.OPENISLANDS_PROJECT_DIR = root;

    expect(listApps().map((a) => a.id)).toEqual(["legacy"]);
  });

  it("applies openislands.json order and hidden", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    writeApp(root, "a", manifest("A"));
    writeApp(root, "b", manifest("B"));
    writeApp(root, "c", manifest("C"));
    writeFileSync(join(root, "openislands.json"), JSON.stringify({ order: ["c", "a"], hidden: ["b"] }));
    process.env.OPENISLANDS_PROJECT_DIR = root;

    expect(listApps().map((a) => a.id)).toEqual(["c", "a"]);
  });

  it("surfaces manifest errors on the app instead of dropping it", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    writeApp(root, "broken", { version: 2, title: "Broken" });
    process.env.OPENISLANDS_PROJECT_DIR = root;

    const apps = listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]!.errors.length).toBeGreaterThan(0);
  });
});

describe("appDir + appDirFromParams", () => {
  it("resolves a known app and throws on an unknown one", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    writeApp(root, "fin", manifest("F"));
    process.env.OPENISLANDS_PROJECT_DIR = root;

    expect(appDir("fin")).toBe(join(root, "apps", "fin"));
    expect(() => appDir("nope")).toThrow(/unknown app/);
  });

  it("maps a missing param to 400 and an unknown app to 404", () => {
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    writeApp(root, "fin", manifest("F"));
    process.env.OPENISLANDS_PROJECT_DIR = root;

    expect(appDirFromParams(new URLSearchParams(""))).toMatchObject({ ok: false, status: 400 });
    expect(appDirFromParams(new URLSearchParams("app=nope"))).toMatchObject({ ok: false, status: 404 });
    expect(appDirFromParams(new URLSearchParams("app=fin"))).toMatchObject({
      ok: true,
      dir: join(root, "apps", "fin"),
      appId: "fin",
    });
  });
});

describe("query isolation across apps", () => {
  it("queries the same dataset name from two apps without cache bleed", async () => {
    const { runQuery } = await import("../src/server/query.js");
    const root = mkdtempSync(join(tmpdir(), "oi-ws-"));
    for (const [name, value] of [
      ["fin", "100"],
      ["health", "200"],
    ] as const) {
      writeApp(root, name, {
        version: 1,
        title: name,
        datasets: { metrics: { source: "data/metrics.csv" } },
        pages: [],
      });
      mkdirSync(join(root, "apps", name, "data"), { recursive: true });
      writeFileSync(join(root, "apps", name, "data", "metrics.csv"), `value\n${value}\n`);
    }
    process.env.OPENISLANDS_PROJECT_DIR = root;

    const fin = await runQuery(appDir("fin"), { dataset: "metrics" });
    const health = await runQuery(appDir("health"), { dataset: "metrics" });
    expect(fin.status).toBe(200);
    expect(health.status).toBe(200);
    expect((fin.body as { rows: unknown[] }).rows).toEqual([{ value: 100 }]);
    expect((health.body as { rows: unknown[] }).rows).toEqual([{ value: 200 }]);
  });
});

describe("per-app broadcasters", () => {
  it("keeps app event streams isolated", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = broadcasterFor("app-a").subscribe((e) => a.push(e));
    const unsubB = broadcasterFor("app-b").subscribe((e) => b.push(e));

    broadcasterFor("app-a").publish({ type: "components-changed" });
    expect(a).toEqual([{ type: "components-changed" }]);
    expect(b).toEqual([]);

    unsubA();
    unsubB();
  });
});
