// The SPA prerender writes the bootable shell to `_shell.html`, but Cloudflare Workers
// static-asset serving expects `index.html` both for `/` and as the single-page-app
// fallback (`not_found_handling: "single-page-application"`). Materialize the shell as
// index.html so the home route and client-side navigation both resolve on Workers.
import { copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://openislands.sh";

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

// Build sitemap.xml from the pages actually prerendered (every route is `<path>/index.html`,
// the root is `index.html` straight in publicDir) so the sitemap can never drift from the
// shipped routes. Clean URLs are emitted without a trailing slash except the root, matching
// how the site links to its own pages (e.g. `/introduction`).
function findIndexHtmlPaths(dir) {
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...findIndexHtmlPaths(full));
      continue;
    }
    if (entry.name === "index.html") paths.push(full);
  }
  return paths;
}

function toLocation(indexHtmlPath) {
  const route = dirname(relative(publicDir, indexHtmlPath));
  if (route === ".") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}/${route}`;
}

const locations = findIndexHtmlPaths(publicDir).map(toLocation).toSorted();
const urls = locations.map((loc) => `  <url><loc>${loc}</loc></url>`).join("\n");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

const sitemapPath = resolve(publicDir, "sitemap.xml");
writeFileSync(sitemapPath, sitemap);
console.log(`postbuild: wrote ${sitemapPath} with ${locations.length} URLs`);
