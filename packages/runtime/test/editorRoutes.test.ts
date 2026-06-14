import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createResponse,
  deleteResponse,
  historyResponse,
  moveResponse,
  restoreResponse,
  treeResponse,
  writeResponse,
} from "../src/server/editorRoutes.js";
import { resetWorkspaceCache } from "../src/server/workspace.js";

const APP = "kb";
let root: string;
let projectDir: string;

const savedWorkspace = process.env.OPENISLANDS_WORKSPACE_DIR;
const savedProject = process.env.OPENISLANDS_PROJECT_DIR;

function writeManifest(dir: string): void {
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "manifest.json"), JSON.stringify({ version: 1, title: "KB", datasets: {}, pages: [] }));
}

function get(path: string, query: Record<string, string>): Request {
  const params = new URLSearchParams({ app: APP, ...query });
  return new Request(`http://t/api/editor/${path}?${params}`);
}

function post(path: string, body: unknown): Request {
  return new Request(`http://t/api/editor/${path}?app=${APP}`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  delete process.env.OPENISLANDS_PROJECT_DIR;
  root = mkdtempSync(join(tmpdir(), "oi-editor-routes-"));
  projectDir = join(root, APP);
  writeManifest(projectDir);
  mkdirSync(join(projectDir, "docs"), { recursive: true });
  process.env.OPENISLANDS_WORKSPACE_DIR = root;
  resetWorkspaceCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  process.env.OPENISLANDS_WORKSPACE_DIR = savedWorkspace;
  process.env.OPENISLANDS_PROJECT_DIR = savedProject;
  if (savedWorkspace === undefined) delete process.env.OPENISLANDS_WORKSPACE_DIR;
  if (savedProject === undefined) delete process.env.OPENISLANDS_PROJECT_DIR;
  resetWorkspaceCache();
});

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("writeResponse", () => {
  it("writes a file and reads back the content from disk", async () => {
    const res = await writeResponse(post("write", { path: "docs/note.md", content: "# Hi\n" }));
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ ok: true });
    expect(readFileSync(join(projectDir, "docs", "note.md"), "utf8")).toBe("# Hi\n");
  });

  it("rejects a traversal path with 403", async () => {
    const res = await writeResponse(post("write", { path: "../../etc/passwd", content: "x" }));
    expect(res.status).toBe(403);
  });

  it("rejects a non-text extension with 400", async () => {
    const res = await writeResponse(post("write", { path: "app/evil.js", content: "x" }));
    expect(res.status).toBe(400);
  });

  it("does not record a version when the content is unchanged", async () => {
    await writeResponse(post("write", { path: "docs/n.md", content: "same" }));
    await writeResponse(post("write", { path: "docs/n.md", content: "same" }));

    const versions = (await jsonOf(await historyResponse(get("history", { path: "docs/n.md" })))).versions as unknown[];
    expect(versions).toHaveLength(0);
  });
});

describe("moveResponse", () => {
  it("renames the file into a new folder and carries its history", async () => {
    await writeResponse(post("write", { path: "docs/a.md", content: "one" }));
    await writeResponse(post("write", { path: "docs/a.md", content: "two" }));

    const res = await moveResponse(post("move", { from: "docs/a.md", to: "docs/sub/b.md" }));
    expect(res.status).toBe(200);
    expect(existsSync(join(projectDir, "docs", "a.md"))).toBe(false);
    expect(readFileSync(join(projectDir, "docs", "sub", "b.md"), "utf8")).toBe("two");

    const moved = (await jsonOf(await historyResponse(get("history", { path: "docs/sub/b.md" })))).versions as unknown[];
    expect(moved.length).toBeGreaterThan(0);
    const old = (await jsonOf(await historyResponse(get("history", { path: "docs/a.md" })))).versions as unknown[];
    expect(old).toHaveLength(0);
  });

  it("404s a missing source and 409s an existing destination", async () => {
    const missing = await moveResponse(post("move", { from: "docs/nope.md", to: "docs/x.md" }));
    expect(missing.status).toBe(404);

    await writeResponse(post("write", { path: "docs/here.md", content: "h" }));
    await writeResponse(post("write", { path: "docs/there.md", content: "t" }));
    const conflict = await moveResponse(post("move", { from: "docs/here.md", to: "docs/there.md" }));
    expect(conflict.status).toBe(409);
  });
});

describe("treeResponse", () => {
  it("lists editable text files under a dir, project-relative and sorted", async () => {
    writeFileSync(join(projectDir, "docs", "b.md"), "b");
    writeFileSync(join(projectDir, "docs", "a.txt"), "a");
    writeFileSync(join(projectDir, "docs", "skip.json"), "{}");
    mkdirSync(join(projectDir, "docs", "sub"), { recursive: true });
    writeFileSync(join(projectDir, "docs", "sub", "c.markdown"), "c");

    const res = treeResponse(get("tree", { dir: "docs" }));
    expect(res.status).toBe(200);
    const files = (await jsonOf(res)).files as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(["docs/a.txt", "docs/b.md", "docs/sub/c.markdown"]);
  });

  it("returns an empty list for a missing dir", async () => {
    const res = treeResponse(get("tree", { dir: "data" }));
    expect(await jsonOf(res)).toEqual({ files: [] });
  });
});

describe("historyResponse", () => {
  it("lists versions accumulated by successive writes", async () => {
    await writeResponse(post("write", { path: "docs/note.md", content: "one" }));
    await writeResponse(post("write", { path: "docs/note.md", content: "two" }));

    const res = await historyResponse(get("history", { path: "docs/note.md" }));
    const versions = (await jsonOf(res)).versions as { id: number }[];
    expect(versions.map((v) => v.id)).toEqual([1]);
    expect(readFileSync(join(projectDir, "docs", "note.md"), "utf8")).toBe("two");
  });
});

describe("restoreResponse", () => {
  it("round-trips a prior version back onto disk", async () => {
    await writeResponse(post("write", { path: "docs/note.md", content: "original" }));
    await writeResponse(post("write", { path: "docs/note.md", content: "edited" }));

    const res = await restoreResponse(post("restore", { path: "docs/note.md", id: 1 }));
    expect(res.status).toBe(200);
    expect(readFileSync(join(projectDir, "docs", "note.md"), "utf8")).toBe("original");
  });

  it("404s an unknown version id", async () => {
    await writeResponse(post("write", { path: "docs/note.md", content: "x" }));
    const res = await restoreResponse(post("restore", { path: "docs/note.md", id: 99 }));
    expect(res.status).toBe(404);
  });
});

describe("createResponse", () => {
  it("creates a new file and 409s when it already exists", async () => {
    const first = await createResponse(post("create", { path: "docs/new.md", content: "seed" }));
    expect(first.status).toBe(200);
    expect(readFileSync(join(projectDir, "docs", "new.md"), "utf8")).toBe("seed");

    const again = await createResponse(post("create", { path: "docs/new.md" }));
    expect(again.status).toBe(409);
  });
});

describe("deleteResponse", () => {
  it("snapshots the prior content then removes the file", async () => {
    await writeResponse(post("write", { path: "docs/gone.md", content: "bye" }));
    const res = await deleteResponse(post("delete", { path: "docs/gone.md" }));
    expect(res.status).toBe(200);
    expect(existsSync(join(projectDir, "docs", "gone.md"))).toBe(false);

    const versions = (await jsonOf(await historyResponse(get("history", { path: "docs/gone.md" })))).versions as {
      id: number;
    }[];
    expect(versions.length).toBeGreaterThan(0);
  });
});
