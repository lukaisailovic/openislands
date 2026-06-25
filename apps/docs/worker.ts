import { isMarkdownPreferred } from "fumadocs-core/negotiation";

interface Env {
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
}

// Doc pages have no extension (/introduction, /concepts/manifest); their prebuilt markdown
// sibling is /introduction.md. The root has no page markdown, so the llms.txt index stands
// in for it. Paths that already name a file (assets, *.md, *.txt) are served untouched.
function markdownAssetFor(pathname: string): string | null {
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;
  const path = pathname.replace(/\/+$/, "");
  return path === "" ? "/llms.txt" : `${path}.md`;
}

// Claude Code's WebFetch (and other agents) send `Accept: text/markdown`; browsers and
// crawlers never do. When markdown is preferred we answer a page URL with its prebuilt
// markdown instead of the JS-only SPA shell — same URL, no HTML-to-token waste. Everything
// else falls through to the static assets, so the human site (and SEO) is untouched.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const target =
      request.method === "GET" && isMarkdownPreferred(request)
        ? markdownAssetFor(new URL(request.url).pathname)
        : null;
    if (!target) return env.ASSETS.fetch(request);

    const { origin } = new URL(request.url);
    let res = await env.ASSETS.fetch(new URL(target, origin));
    // A wrong guess (no such page .md) falls through to the SPA shell (text/html); hand the
    // agent the llms.txt index instead, so even a bad URL yields readable docs.
    if (res.headers.get("content-type")?.includes("html")) {
      res = await env.ASSETS.fetch(new URL("/llms.txt", origin));
    }
    return new Response(res.body, {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept" },
    });
  },
};
