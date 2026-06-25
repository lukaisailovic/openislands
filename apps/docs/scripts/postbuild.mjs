// The SPA prerender writes the bootable shell to `_shell.html`, but Cloudflare Workers
// static-asset serving expects `index.html` both for `/` and as the single-page-app
// fallback (`not_found_handling: "single-page-application"`). Materialize the shell as
// index.html so the home route and client-side navigation both resolve on Workers.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

// index.html is served for `/` AND every unmatched path (Workers SPA fallback), and it's
// the one surface with no prerendered content — fetch `/` or guess a wrong URL and you get
// only the empty shell. The shell carries <noscript>/<link rel=alternate> pointers, but
// HTML→markdown extractors (e.g. agents' WebFetch) drop both, so inject a *visible* pointer
// as real body text. The inline script removes it before React hydrates (classic inline
// scripts run during parse, ahead of the deferred module bundle), so JS users never see it
// and hydration still matches; no-JS clients and markdown extractors keep it.
const AGENT_POINTER = `<div id="oi-agents" style="padding:1rem;font-family:system-ui;font-size:14px">OpenIslands docs for AI agents — plain text: <a href="/llms.txt">/llms.txt</a> (index), <a href="/llms-full.txt">/llms-full.txt</a> (every page in one file). Append <code>.md</code> to any page URL for its markdown (e.g. <a href="/introduction.md">/introduction.md</a>). Agent onboarding: <a href="/start.md">/start.md</a>.</div><script>document.getElementById("oi-agents")?.remove()</script>`;

const shellHtml = readFileSync(shell, "utf8");
const withPointer = shellHtml.replace(/(<body[^>]*>)/, `$1${AGENT_POINTER}`);
if (withPointer === shellHtml) {
  console.error("postbuild: no <body> tag in the shell — could not inject the agent pointer");
  process.exit(1);
}
writeFileSync(index, withPointer);
console.log(`postbuild: wrote ${index} from _shell.html with the agent docs pointer`);

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
