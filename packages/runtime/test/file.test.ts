import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confineProjectFile, readProjectFile } from "../src/server/file.js";

let root: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "oi-file-")));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "docs", "note.md"), "# Hello\n");
  writeFileSync(join(root, ".env"), "SECRET=1");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("confineProjectFile", () => {
  it("resolves a file inside an allowed dir", () => {
    expect(confineProjectFile(root, "docs/note.md")).toBe(join(root, "docs", "note.md"));
  });

  it("rejects traversal outside the root", () => {
    expect(() => confineProjectFile(root, "../../../etc/passwd")).toThrow(/escapes/);
  });

  it("rejects an absolute path outside the root", () => {
    expect(() => confineProjectFile(root, "/etc/passwd")).toThrow(/escapes/);
  });

  it("rejects dotfiles and secrets", () => {
    expect(() => confineProjectFile(root, ".env")).toThrow(/protected/);
  });

  it("rejects files outside the content dirs", () => {
    expect(() => confineProjectFile(root, "package.json")).toThrow(/must live under/);
  });

  it("rejects an empty path", () => {
    expect(() => confineProjectFile(root, "")).toThrow(/missing/);
  });
});

describe("readProjectFile", () => {
  it("returns file bytes and a markdown content type", () => {
    const result = readProjectFile(root, "docs/note.md");
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/markdown");
    expect(result.body.toString()).toContain("Hello");
  });

  it("turns a confinement failure into the matching HTTP status", () => {
    expect(readProjectFile(root, ".env").status).toBe(403);
    expect(readProjectFile(root, "../escape").status).toBe(403);
  });

  it("returns 404 for a missing but allowed path", () => {
    expect(readProjectFile(root, "data/missing.csv").status).toBe(404);
  });
});
