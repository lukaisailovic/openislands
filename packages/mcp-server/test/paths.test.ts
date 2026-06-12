import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathConfinementError, confineDatasetSource, confineReadable } from "../src/paths.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "oi-paths-")));

describe("confineReadable", () => {
  it("accepts a path inside the root", () => {
    expect(confineReadable(root, "data/x.csv")).toBe(join(root, "data", "x.csv"));
  });
  it("rejects parent traversal", () => {
    expect(() => confineReadable(root, "../../etc/passwd")).toThrow(PathConfinementError);
  });
  it("rejects absolute paths outside the root", () => {
    expect(() => confineReadable(root, "/etc/passwd")).toThrow(PathConfinementError);
  });
  it("rejects the root itself", () => {
    expect(() => confineReadable(root, ".")).toThrow(PathConfinementError);
  });
  it("rejects .env and dotenv variants", () => {
    expect(() => confineReadable(root, ".env")).toThrow(/protected/);
    expect(() => confineReadable(root, ".env.local")).toThrow(/protected/);
    expect(() => confineReadable(root, "app/../.env.production")).toThrow(/protected/);
  });
  it("rejects .openislands internals", () => {
    expect(() => confineReadable(root, ".openislands/proposals/x.json")).toThrow(/protected/);
  });
});

describe("confineDatasetSource", () => {
  it("accepts sources under data/ and models/", () => {
    expect(confineDatasetSource(root, "data/x.csv")).toBe(join(root, "data", "x.csv"));
    expect(confineDatasetSource(root, "models/t.sql")).toBe(join(root, "models", "t.sql"));
  });
  it("rejects sources outside the data dirs", () => {
    expect(() => confineDatasetSource(root, "secrets/x.csv")).toThrow(PathConfinementError);
  });
  it("rejects traversal and absolute escapes", () => {
    expect(() => confineDatasetSource(root, "../../etc/passwd")).toThrow(PathConfinementError);
    expect(() => confineDatasetSource(root, "/etc/passwd")).toThrow(PathConfinementError);
    expect(() => confineDatasetSource(root, ".env")).toThrow(PathConfinementError);
  });
});
