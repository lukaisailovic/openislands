import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";

// Docs are served at the site root (/introduction, /mcp, /islands/overview, …) to
// preserve the URLs the Vocs site shipped. crawlLinks discovers every page from the
// home + sidebar (and each page's hidden markdown link), but we seed the full set so
// the static prerender can never silently drop a page; the three unlinked handler
// routes (search index + llms files) are seeded explicitly.
const docPaths = [
  "/introduction",
  "/getting-started",
  "/mcp",
  "/agents",
  "/cli",
  "/concepts/manifest",
  "/concepts/data-contracts",
  "/concepts/sql-transforms",
  "/data/queries",
  "/data/actions",
  "/data/connectors",
  "/islands/overview",
  "/islands/metrics-and-gauges",
  "/islands/charts",
  "/islands/tables-and-feeds",
  "/islands/content-and-layout",
  "/islands/custom",
  "/reference/manifest",
  "/reference/value-formats",
];

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    mdx(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          enabled: true,
          crawlLinks: true,
        },
      },
      pages: [
        { path: "/" },
        ...docPaths.map((path) => ({ path })),
        { path: "/api/search" },
        { path: "/llms.txt" },
        { path: "/llms-full.txt" },
      ],
    }),
    react(),
    // See https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro
    nitro(),
  ],
  // Ship source maps for first-party chunks so Lighthouse `valid-source-maps` passes.
  build: {
    sourcemap: true,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
});
