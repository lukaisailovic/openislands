// The SPA prerender writes the bootable shell to `_shell.html`, but Cloudflare Workers
// static-asset serving expects `index.html` both for `/` and as the single-page-app
// fallback (`not_found_handling: "single-page-application"`). Materialize the shell as
// index.html so the home route and client-side navigation both resolve on Workers.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "../.output/public");
const shell = resolve(publicDir, "_shell.html");
const index = resolve(publicDir, "index.html");

if (!existsSync(shell)) {
  console.error(`postbuild: ${shell} not found — did the build run?`);
  process.exit(1);
}

copyFileSync(shell, index);
console.log(`postbuild: wrote ${index} from _shell.html`);
