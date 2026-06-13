---
"@openislands/runtime": minor
---

Add a client-safe `@openislands/runtime/islands` entry point exporting `resolveRenderer`, `formatValue`, `registerIsland`, `islandNeedsData`, and the island render types. It pulls in none of the server/Node-only code the package root carries, so island renderers can be reused outside the runtime's own server bundle — e.g. to render live island previews in the docs site.
