import { defineConfig } from "vocs/config";

export default defineConfig({
  title: "OpenIslands",
  description:
    "A local-first compiler and runtime for agent-maintained data apps — typed manifests of reusable islands bound to data you own.",
  // The runtime renders islands dark-only, so the docs match: dark everywhere,
  // no theme toggle. The accent is a tide teal tuned for the dark surface.
  colorScheme: "dark",
  accentColor: "#2dd4bf",
  logoUrl: { light: "/logo-dark.svg", dark: "/logo-light.svg" },
  iconUrl: "/favicon.svg",
  topNav: [{ text: "GitHub", link: "https://github.com/lukaisailovic/openislands" }],
  sidebar: [
    {
      text: "Guide",
      collapsed: false,
      items: [
        { text: "Introduction", link: "/introduction" },
        { text: "Getting Started", link: "/getting-started" },
      ],
    },
    {
      text: "Concepts",
      collapsed: false,
      items: [
        { text: "The Manifest", link: "/concepts/manifest" },
        { text: "Data Contracts", link: "/concepts/data-contracts" },
        { text: "SQL Transforms", link: "/concepts/sql-transforms" },
      ],
    },
    {
      text: "Writing Data",
      collapsed: false,
      items: [
        { text: "Actions", link: "/data/actions" },
        { text: "Connectors", link: "/data/connectors" },
      ],
    },
    {
      text: "Islands",
      collapsed: false,
      items: [
        { text: "Overview", link: "/islands/overview" },
        { text: "Metrics & Gauges", link: "/islands/metrics-and-gauges" },
        { text: "Charts", link: "/islands/charts" },
        { text: "Tables & Feeds", link: "/islands/tables-and-feeds" },
        { text: "Content & Layout", link: "/islands/content-and-layout" },
        { text: "Custom Islands", link: "/islands/custom" },
      ],
    },
    {
      text: "Reference",
      collapsed: false,
      items: [
        { text: "Manifest Reference", link: "/reference/manifest" },
        { text: "Value Formats", link: "/reference/value-formats" },
        { text: "MCP Server", link: "/mcp" },
      ],
    },
  ],
});
