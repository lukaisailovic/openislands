/**
 * Shared request handlers behind the `/api/editor/*` routes — the write side of
 * the `content.editor` island. Reads are served by the existing `/api/file`
 * route; everything that mutates a text file lives here so the route files stay
 * thin wiring. Every handler is app-scoped via `?app=` and confines its target
 * path through `confineProjectFile`, so untrusted paths can never escape the
 * project's content dirs. Writes/creates/deletes are limited to an editable
 * text-file allowlist, snapshot the prior content into the per-app version
 * store before mutating, and broadcast a `files-changed` event so other open
 * clients re-read.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileExtension, isEditableTextFile, markSelfWrite } from "./editorSync.js";
import { FileAccessError, confineProjectFile } from "./file.js";
import { getVersion, listVersions, moveVersions, recordVersion } from "./editorStore.js";
import { broadcasterFor } from "./watcher.js";
import { type AppResolution, appDirFromParams } from "./workspace.js";

interface EditorFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function resolveApp(request: Request): AppResolution {
  return appDirFromParams(new URL(request.url).searchParams);
}

/**
 * Project-relative posix path for an absolute file under the project dir.
 * `confineProjectFile` resolves paths against the project root's realpath, so
 * the relative base must too — otherwise a symlinked root (e.g. macOS `/var` →
 * `/private/var`) yields a spurious `../` prefix.
 */
function relPosix(projectDir: string, abs: string): string {
  return relative(realpathSync(projectDir), abs).split(sep).join("/");
}

function publishFilesChanged(appId: string, projectDir: string, ...rels: string[]): void {
  for (const rel of rels) markSelfWrite(projectDir, rel);
  broadcasterFor(appId).publish({ type: "files-changed", paths: rels });
}

/** Collect every editable text file under `dir` (absolute, confined), skipping dotfiles and `.openislands`. */
function walkEditable(projectDir: string, dir: string): EditorFile[] {
  const out: EditorFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkEditable(projectDir, abs));
      continue;
    }
    if (!entry.isFile() || !isEditableTextFile(entry.name)) continue;
    const stat = statSync(abs);
    out.push({
      path: relPosix(projectDir, abs),
      name: entry.name,
      ext: fileExtension(entry.name),
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  }
  return out;
}

export function treeResponse(request: Request): Response {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const dir = new URL(request.url).searchParams.get("dir") ?? "";
  try {
    const abs = confineProjectFile(app.dir, dir);
    if (!existsSync(abs)) return json({ files: [] });
    const files = walkEditable(app.dir, abs).toSorted((a, b) => a.path.localeCompare(b.path));
    return json({ files });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

interface WriteBody {
  path?: string;
  content?: string;
}

export async function writeResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const body = (await request.json()) as WriteBody;
  try {
    const abs = confineProjectFile(app.dir, body.path ?? "");
    if (!isEditableTextFile(abs)) return new Response("only text files are editable", { status: 400 });
    const content = body.content ?? "";
    const rel = relPosix(app.dir, abs);
    if (existsSync(abs)) {
      const current = readFileSync(abs, "utf8");
      if (current === content) return json({ ok: true });
      await recordVersion(app.dir, rel, current);
    }
    writeFileSync(abs, content);
    publishFilesChanged(app.appId, app.dir, rel);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

export async function historyResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  try {
    const abs = confineProjectFile(app.dir, path);
    return json({ versions: await listVersions(app.dir, relPosix(app.dir, abs)) });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

interface RestoreBody {
  path?: string;
  id?: number;
}

export async function restoreResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const body = (await request.json()) as RestoreBody;
  if (typeof body.id !== "number") return new Response("missing 'id'", { status: 400 });
  try {
    const abs = confineProjectFile(app.dir, body.path ?? "");
    const rel = relPosix(app.dir, abs);
    const content = await getVersion(app.dir, rel, body.id);
    if (content == null) return new Response("version not found", { status: 404 });
    if (existsSync(abs)) await recordVersion(app.dir, rel, readFileSync(abs, "utf8"));
    writeFileSync(abs, content);
    publishFilesChanged(app.appId, app.dir, rel);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

export async function createResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const body = (await request.json()) as WriteBody;
  try {
    const abs = confineProjectFile(app.dir, body.path ?? "");
    if (!isEditableTextFile(abs)) return new Response("only text files are editable", { status: 400 });
    if (existsSync(abs)) return new Response("file already exists", { status: 409 });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body.content ?? "");
    const rel = relPosix(app.dir, abs);
    publishFilesChanged(app.appId, app.dir, rel);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

interface MoveBody {
  from?: string;
  to?: string;
}

/**
 * Rename a file on disk and carry its version history with it: the store rows
 * are re-keyed old→new, and a `files-changed` event names BOTH paths so open
 * clients drop the old entry and pick up the new one. 404 if the source is
 * gone, 409 if the destination is taken.
 */
export async function moveResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const body = (await request.json()) as MoveBody;
  try {
    const fromAbs = confineProjectFile(app.dir, body.from ?? "");
    const toAbs = confineProjectFile(app.dir, body.to ?? "");
    if (!isEditableTextFile(toAbs)) return new Response("only text files are editable", { status: 400 });
    if (!existsSync(fromAbs)) return new Response("source not found", { status: 404 });
    if (existsSync(toAbs)) return new Response("destination already exists", { status: 409 });
    const relFrom = relPosix(app.dir, fromAbs);
    const relTo = relPosix(app.dir, toAbs);
    mkdirSync(dirname(toAbs), { recursive: true });
    renameSync(fromAbs, toAbs);
    await moveVersions(app.dir, relFrom, relTo);
    publishFilesChanged(app.appId, app.dir, relFrom, relTo);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}

interface DeleteBody {
  path?: string;
}

export async function deleteResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const body = (await request.json()) as DeleteBody;
  try {
    const abs = confineProjectFile(app.dir, body.path ?? "");
    const rel = relPosix(app.dir, abs);
    if (existsSync(abs)) {
      await recordVersion(app.dir, rel, readFileSync(abs, "utf8"));
      rmSync(abs);
    }
    publishFilesChanged(app.appId, app.dir, rel);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof FileAccessError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
