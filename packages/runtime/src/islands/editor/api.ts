import type { EditorFile, FileVersion } from "./types.js";

function q(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

async function jsonOk<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = await response.text().catch(() => "");
  throw new Error(body || `HTTP ${response.status}`);
}

export async function editorTree(appId: string, dir: string): Promise<EditorFile[]> {
  const response = await fetch(`/api/editor/tree?${q({ app: appId, dir })}`);
  const { files } = await jsonOk<{ files: EditorFile[] }>(response);
  return files;
}

export async function readFile(appId: string, path: string): Promise<string> {
  const response = await fetch(`/api/file?${q({ app: appId, path })}`);
  if (response.ok) return response.text();
  throw new Error(`HTTP ${response.status}`);
}

async function post(appId: string, action: string, body: unknown): Promise<void> {
  const response = await fetch(`/api/editor/${action}?${q({ app: appId })}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await jsonOk<{ ok: true }>(response);
}

export function writeFile(appId: string, path: string, content: string): Promise<void> {
  return post(appId, "write", { path, content });
}

export async function history(appId: string, path: string): Promise<FileVersion[]> {
  const response = await fetch(`/api/editor/history?${q({ app: appId, path })}`);
  const { versions } = await jsonOk<{ versions: FileVersion[] }>(response);
  return versions;
}

export function restore(appId: string, path: string, id: number): Promise<void> {
  return post(appId, "restore", { path, id });
}

export function createFile(appId: string, path: string, content = ""): Promise<void> {
  return post(appId, "create", { path, content });
}

export function deleteFile(appId: string, path: string): Promise<void> {
  return post(appId, "delete", { path });
}

export function moveFile(appId: string, from: string, to: string): Promise<void> {
  return post(appId, "move", { from, to });
}
