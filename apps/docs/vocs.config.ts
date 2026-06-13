import { defineConfig } from "vocs/config";

export default defineConfig({
  title: "OpenIslands",
  description:
    "A local-first compiler and runtime for agent-maintained data apps — typed manifests of reusable islands bound to data you own.",
  topNav: [{ text: "GitHub", link: "https://github.com/lukaisailovic/openislands" }],
  sidebar: [
    {
      text: "Guide",
      collapsed: false,
      items: [
        { text: "Introduction", link: "/" },
        { text: "Getting Started", link: "/getting-started" },
      ],
    },
    {
      text: "Concepts",
      collapsed: false,
      items: [
        { text: "The Manifest", link: "/concepts/manifest" },
        { text: "Data Contracts", link: "/concepts/data-contracts" },
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
        { text: "MCP Server", link: "/mcp" },
      ],
    },
  ],
});
