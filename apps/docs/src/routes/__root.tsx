import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import * as React from "react";
import appCss from "@/styles/app.css?url";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import SearchDialog from "@/components/search";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OpenIslands" },
      {
        name: "description",
        content:
          "A local-first compiler and runtime for agent-maintained data apps — typed manifests of reusable islands bound to data you own.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      // Agent/LLM discovery: every page advertises the plain-text docs. Pairs with the
      // <noscript> below so a JS-less fetch of ANY url (incl. wrong guesses → the SPA
      // shell) finds /llms.txt instead of an empty "OpenIslands" page.
      {
        rel: "alternate",
        type: "text/markdown",
        href: "/llms.txt",
        title: "OpenIslands docs as plain text (for LLMs)",
      },
    ],
  }),
  component: RootComponent,
});

// The live-island renderers pick light/dark from `matchMedia("(prefers-color-scheme:
// dark)")` (the OS setting), not our `.dark` class — so on a light-mode OS they'd render
// white. The docs are dark-only, so we shim matchMedia to always report dark for the
// color-scheme query (leaving every other query, e.g. reduced-motion, untouched). Runs at
// parse time, before any island effect reads it.
const forceDarkColorScheme = `(function(){
  if (typeof window === "undefined" || !window.matchMedia) return;
  var orig = window.matchMedia.bind(window);
  window.matchMedia = function(q){
    if (typeof q === "string" && q.indexOf("prefers-color-scheme") !== -1) {
      var matches = q.indexOf("dark") !== -1;
      return { matches: matches, media: q, onchange: null,
        addEventListener: function(){}, removeEventListener: function(){},
        addListener: function(){}, removeListener: function(){},
        dispatchEvent: function(){ return false; } };
    }
    return orig(q);
  };
})();`;

function RootComponent() {
  // The runtime renders islands dark-only, so the docs match: dark everywhere, no
  // theme toggle. `enabled: false` locks the scheme and hides the switcher.
  // Three dark switches, all forced statically so islands paint dark on first frame:
  // `class="dark"` drives Fumadocs UI + the runtime's `dark:` utilities, `data-mode="dark"`
  // drives Kumo's component tokens (the IslandCard surface), and the matchMedia shim above
  // drives the ECharts `isDarkMode`.
  return (
    <html lang="en" suppressHydrationWarning className="dark" data-mode="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: forceDarkColorScheme }} />
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        {/* Rendered into the static shell that serves every unmatched path. A JS-less
            client (WebFetch, crawlers, agents) sees this pointer home instead of a blank
            page; real JS clients never paint it. */}
        <noscript>
          <p>
            These docs render with JavaScript. Reading as an LLM or agent? Plain-text docs:
          </p>
          <ul>
            <li>
              <a href="/llms-full.txt">/llms-full.txt</a> — every page, one file
            </li>
            <li>
              <a href="/llms.txt">/llms.txt</a> — page index
            </li>
            <li>
              Any page as Markdown: append <code>.md</code> (e.g.{" "}
              <a href="/introduction.md">/introduction.md</a>)
            </li>
            <li>
              <a href="/start.md">/start.md</a> — agent onboarding
            </li>
          </ul>
        </noscript>
        <RootProvider theme={{ defaultTheme: "dark", enabled: false }} search={{ SearchDialog }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
