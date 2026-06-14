---
"@openislands/schema": minor
"@openislands/runtime": minor
---

Redesign the `note.card` and `source.doc` islands. `note.card` gains an optional `tone` (`info` / `success` / `warning` / `danger`) that renders the markdown as a colored callout with a matching icon and left accent; without a tone it stays plain prose. `source.doc` now renders as a proper document card — a type icon, a readable name (the explicit `label`, else the file's basename, else the link's host, never the raw `/api/file` URL), an optional `description` caption, and an Open-in-new-tab action — with image, PDF, markdown, and link layouts.
