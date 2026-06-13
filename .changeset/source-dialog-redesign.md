---
"@openislands/runtime": patch
---

Redesign the per-island source dialog. The Database button now opens a typed header (format badge + icon for CSV / SQL transform / SQLite / Markdown), a copyable file or transform path, and **Preview** / **Schema** tabs: Preview shows a live sample of the underlying rows so you can verify the data at a glance, and Schema lists each column with a per-type glyph and a friendly type label. File-only sources (e.g. `source.doc`) still show a clean header and path.
