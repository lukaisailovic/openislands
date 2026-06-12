import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleCustomComponent,
  isSafeCustomType,
  resetCustomBuildCache,
  runtimeShim,
  scanCustomIslands,
} from "../src/server/custom.js";

function projectWithComponent(type: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-runtime-custom-"));
  const cdir = join(dir, "components", "custom", type);
  mkdirSync(cdir, { recursive: true });
  writeFileSync(join(cdir, "index.tsx"), source);
  return dir;
}

const TINY = `export default function Tiny({ config }: { config: { type: string } }) {
  return <div data-testid="tiny">{config.type}</div>;
}
`;

describe("isSafeCustomType (path confinement)", () => {
  it("accepts a plain island type", () => {
    expect(isSafeCustomType("gauge.ring")).toBe(true);
  });
  it("rejects separators and traversal", () => {
    expect(isSafeCustomType("../secret")).toBe(false);
    expect(isSafeCustomType("a/b")).toBe(false);
    expect(isSafeCustomType("a\\b")).toBe(false);
    expect(isSafeCustomType("")).toBe(false);
  });
});

describe("bundleCustomComponent", () => {
  it("bundles a tsx component to ESM and rewrites react to the runtime shim", async () => {
    resetCustomBuildCache();
    const dir = projectWithComponent("gauge.ring", TINY);
    const result = await bundleCustomComponent(dir, "gauge.ring");
    expect(result.status).toBe(200);
    expect(result.code).toContain("/__runtime/jsx-runtime.js");
    expect(result.code).not.toContain('from "react"');
    expect(result.code).toContain("as default");
  });

  it("404s for a type with no component on disk", async () => {
    const dir = projectWithComponent("gauge.ring", TINY);
    const result = await bundleCustomComponent(dir, "other.thing");
    expect(result.status).toBe(404);
  });

  it("400s for an unsafe type", async () => {
    const dir = projectWithComponent("gauge.ring", TINY);
    const result = await bundleCustomComponent(dir, "../escape");
    expect(result.status).toBe(400);
  });
});

describe("runtimeShim", () => {
  it("re-exports named React members from the window global", async () => {
    const result = await runtimeShim("react.js");
    expect(result.status).toBe(200);
    expect(result.code).toContain("window.__OPENISLANDS_REACT__.react");
    expect(result.code).toContain("export const useState");
    expect(result.code).toContain("export default");
  });

  it("404s for an unknown shim", async () => {
    expect((await runtimeShim("lodash.js")).status).toBe(404);
  });
});

describe("scanCustomIslands", () => {
  it("lists custom island types with a version", async () => {
    const dir = projectWithComponent("gauge.ring", TINY);
    const map = await scanCustomIslands(dir);
    expect(Object.keys(map)).toEqual(["gauge.ring"]);
    expect(typeof map["gauge.ring"]!.version).toBe("number");
  });

  it("returns an empty map when there is no components dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-empty-"));
    expect(await scanCustomIslands(dir)).toEqual({});
  });
});
