---
"@openislands/runtime": patch
---

Redesign the per-island source dialog. The Database button now opens a typed header (format badge + icon for CSV / Transform / SQLite / Markdown), a plain-language line explaining where the data comes from, a copyable file or transform path, and **Preview** / **Schema** tabs: Preview shows a live sample of the underlying rows so you can verify the data at a glance, and Schema lists each column with a per-type glyph and a friendly type label. For a transform, a "Show how it's calculated" disclosure reveals the query on demand (served by a new manifest-scoped `/api/source` route). File-only sources (e.g. `source.doc`) still show a clean header and path.
