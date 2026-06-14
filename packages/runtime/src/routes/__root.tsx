import * as react from "react";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { LinkProvider, TooltipProvider } from "@cloudflare/kumo";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { RouterLink } from "../components/RouterLink.js";
import appCss from "../styles.css?url";

declare global {
  interface Window {
    __OPENISLANDS_REACT__?: {
      react: typeof react;
      reactDom: typeof reactDom;
      reactDomClient: typeof reactDomClient;
      jsxRuntime: typeof jsxRuntime;
    };
  }
}

// Custom island bundles import their React from `/__runtime/*` shims that re-export
// this host instance, so they render into the same React tree as the built-ins.
if (typeof window !== "undefined") {
  window.__OPENISLANDS_REACT__ = { react, reactDom, reactDomClient, jsxRuntime };
}

// Kumo gates its dark styles (skeletons, tooltips, datepicker, code blocks) on
// [data-mode="dark"], so mirror the OS color scheme onto <html> before first paint.
const colorModeScript = `(function(){var m=matchMedia("(prefers-color-scheme: dark)");var apply=function(){document.documentElement.dataset.mode=m.matches?"dark":"light"};apply();m.addEventListener("change",apply)})()`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OpenIslands" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=optional",
      },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ children: colorModeScript }],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-kumo-canvas text-kumo-default">
        <LinkProvider component={RouterLink}>
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
        </LinkProvider>
        <Scripts />
      </body>
    </html>
  );
}
