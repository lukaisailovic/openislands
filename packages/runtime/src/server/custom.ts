/**
 * Serve-time loading of a user project's custom island components.
 *
 * A custom island lives at `components/custom/<type>/index.tsx` (the directory
 * name IS the island type). The user project has no node_modules and no build
 * step, so the runtime bundles the component on demand with esbuild and serves
 * it as ESM. React (and its sibling entry points) are not bundled in — they are
 * rewritten to `/__runtime/*.js` shims that re-export the runtime's own React
 * instance from a window global, so the component renders into the same React
 * tree as the built-in islands. Any other bare import is resolved from the
 * runtime package's own node_modules and bundled in.
 *
 * Builds are cached by the component's mtime, so an edit (a watcher event) is
 * picked up on the next request without restarting the server.
 */
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import type { CustomIslandInfo } from "../types.js";

const CUSTOM_DIR = ["components", "custom"];
const ENTRY_FILENAMES = ["index.tsx", "index.jsx", "index.ts", "index.js"];

/** Bare React imports → runtime shim routes. The component shares the host React instance. */
const REACT_SHIMS: Record<string, string> = {
  react: "/__runtime/react.js",
  "react-dom": "/__runtime/react-dom.js",
  "react-dom/client": "/__runtime/react-dom-client.js",
  "react/jsx-runtime": "/__runtime/jsx-runtime.js",
  "react/jsx-dev-runtime": "/__runtime/jsx-runtime.js",
};

/** A custom island type must be a single path segment — no separators, no traversal. */
export function isSafeCustomType(type: string): boolean {
  return type.length > 0 && !type.includes("/") && !type.includes("\\") && !type.includes("..") && !type.includes("\0");
}

function entryFor(projectDir: string, type: string): string | null {
  const dir = join(projectDir, ...CUSTOM_DIR, type);
  for (const name of ENTRY_FILENAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * The node_modules directories on the runtime package's own resolution path, so a
 * custom component's non-React bare imports bundle from the runtime's deps (the
 * user project has none). esbuild's `nodePaths` resolves bare specifiers against
 * these, mirroring NODE_PATH.
 */
function runtimeNodePaths(): string[] {
  const out: string[] = [];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    out.push(join(dir, "node_modules"));
    const parent = parse(dir).dir;
    if (parent === dir) return out;
    dir = parent;
  }
}

const reactShimPlugin: Plugin = {
  name: "openislands-react-externals",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
      const shim = REACT_SHIMS[args.path];
      if (!shim) return null;
      return { path: shim, external: true };
    });
  },
};

interface CachedBuild {
  code: string;
  version: number;
}

const buildCache = new Map<string, CachedBuild>();

export interface CustomComponentResult {
  status: number;
  code?: string;
  error?: string;
}

/** Bundle a custom island's component to ESM, caching by mtime. 404 when none on disk. */
export async function bundleCustomComponent(
  projectDir: string,
  type: string,
): Promise<CustomComponentResult> {
  if (!isSafeCustomType(type)) return { status: 400, error: "invalid custom island type" };
  const entry = entryFor(projectDir, type);
  if (!entry) return { status: 404, error: `no custom island '${type}'` };

  const version = statSync(entry).mtimeMs;
  const cached = buildCache.get(entry);
  if (cached && cached.version === version) return { status: 200, code: cached.code };

  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      jsx: "automatic",
      platform: "browser",
      nodePaths: runtimeNodePaths(),
      plugins: [reactShimPlugin],
    });
    const code = result.outputFiles![0]!.text;
    buildCache.set(entry, { code, version });
    return { status: 200, code };
  } catch (e) {
    return { status: 500, error: (e as Error).message };
  }
}

/** Which React entry a `/__runtime/<file>.js` request maps to, or null if unknown. */
const RUNTIME_GLOBAL_KEYS: Record<string, string> = {
  "react.js": "react",
  "react-dom.js": "reactDom",
  "react-dom-client.js": "reactDomClient",
  "jsx-runtime.js": "jsxRuntime",
};

/**
 * The shim ESM for a `/__runtime/*.js` route: re-export the host React instance
 * from `window.__OPENISLANDS_REACT__` as named exports. The named exports are
 * enumerated server-side from the same module the client runs, so the shim is
 * never stale against a React minor.
 */
export async function runtimeShim(file: string): Promise<CustomComponentResult> {
  const globalKey = RUNTIME_GLOBAL_KEYS[file];
  if (!globalKey) return { status: 404, error: `unknown runtime shim '${file}'` };
  const names = await shimExportNames(globalKey);
  const lines = [
    `const m = window.__OPENISLANDS_REACT__.${globalKey};`,
    "export default m.default ?? m;",
    ...names.filter((n) => n !== "default").map((n) => `export const ${n} = m[${JSON.stringify(n)}];`),
  ];
  return { status: 200, code: lines.join("\n") + "\n" };
}

async function shimExportNames(globalKey: string): Promise<string[]> {
  const specifier =
    globalKey === "react"
      ? "react"
      : globalKey === "reactDom"
        ? "react-dom"
        : globalKey === "reactDomClient"
          ? "react-dom/client"
          : "react/jsx-runtime";
  const mod = (await import(specifier)) as Record<string, unknown>;
  return Object.keys(mod).filter((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
}

/** Scan the project for custom islands with a renderer on disk: type → cache-busting version. */
export async function scanCustomIslands(projectDir: string): Promise<Record<string, CustomIslandInfo>> {
  const root = join(projectDir, ...CUSTOM_DIR);
  if (!existsSync(root)) return {};
  const out: Record<string, CustomIslandInfo> = {};
  for (const dirent of await readdir(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const type = dirent.name;
    if (!isSafeCustomType(type)) continue;
    const entry = entryFor(projectDir, type);
    if (entry) out[type] = { version: statSync(entry).mtimeMs };
  }
  return out;
}

/** Drop all cached builds so the next request re-bundles. */
export function resetCustomBuildCache(): void {
  buildCache.clear();
}
