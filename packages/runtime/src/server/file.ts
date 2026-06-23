import { getContentStore, isHiddenPath, resolveWithinRoot } from "@openislands/storage";

/**
 * Confined, read-only project-file access for the `source.doc` island. Untrusted
 * `?path=` input must stay under the project root, clear the dotfile/secret
 * denylist, and live in a content directory — never reach config or escape the root.
 */
const ALLOWED_DIRS = ["data", "docs", "app"];

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export class FileAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileAccessError";
  }
}

/**
 * Resolve `candidate` under the project root or throw a FileAccessError with an HTTP status.
 * Containment is checked against the candidate's realpath, so a symlink under a content dir
 * can't point the resolved path (and thus the fs write/read that follows it) outside the root.
 */
export function confineProjectFile(projectRoot: string, candidate: string): string {
  if (!candidate) throw new FileAccessError("missing 'path'", 400);
  const confined = resolveWithinRoot(projectRoot, candidate);
  if (!confined) throw new FileAccessError("path escapes the project root", 403);
  if (isHiddenPath(confined.rel)) throw new FileAccessError("path targets a protected file", 403);
  const top = confined.rel.split(/[\\/]/)[0];
  if (!top || !ALLOWED_DIRS.includes(top)) {
    throw new FileAccessError(`path must live under ${ALLOWED_DIRS.join("/, ")}/`, 403);
  }
  return confined.abs;
}

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface FileResult {
  status: number;
  body: Uint8Array | string;
  contentType: string;
}

export async function readProjectFile(projectRoot: string, candidate: string): Promise<FileResult> {
  try {
    const abs = confineProjectFile(projectRoot, candidate);
    const bytes = await getContentStore(projectRoot).readBytes(abs);
    if (bytes === null) return { status: 404, body: "not found", contentType: "text/plain; charset=utf-8" };
    return { status: 200, body: bytes, contentType: contentType(abs) };
  } catch (err) {
    if (err instanceof FileAccessError) {
      return { status: err.status, body: err.message, contentType: "text/plain; charset=utf-8" };
    }
    return { status: 404, body: "not found", contentType: "text/plain; charset=utf-8" };
  }
}
