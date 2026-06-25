import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { docs } from "collections/server";

// Docs live at the site root (baseUrl "/"), so a page's URL is "/introduction",
// "/islands/overview", and its raw-markdown sibling is "/introduction.md".
export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/",
  plugins: [lucideIconsPlugin()],
});

export function markdownPathToSlugs(segs: string[]): string[] {
  if (segs.length === 0) return [];

  const out = [...segs];
  out[out.length - 1] = out[out.length - 1].replace(/\.md$/, "");
  if (out.length === 1 && out[0] === "index") out.pop();
  return out;
}

export function slugsToMarkdownPath(slugs: string[]) {
  const segments = slugs.length === 0 ? ["index.md"] : [...slugs];
  if (slugs.length > 0) segments[segments.length - 1] += ".md";

  return {
    segments,
    url: `/${segments.join("/")}`,
  };
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}

const INTERNAL_DOC_LINK = /\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g;

// An agent that opens one page's .md and follows a link should land on the next page's
// .md, not the JS-rendered HTML. Rewrite internal absolute doc links to their .md sibling
// (the same /foo → /foo.md mapping the site already serves), leaving the site root and
// asset files (anything with an extension) and external links untouched.
export function linkToMarkdownSiblings(md: string): string {
  return md.replace(INTERNAL_DOC_LINK, (match, path: string, anchor = "") => {
    if (path === "/" || /\.[a-z0-9]+$/i.test(path)) return match;
    return `](${path}.md${anchor})`;
  });
}
