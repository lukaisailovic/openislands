# Knowledge Base data — your team's docs live here

These are the files the `content.editor` island edits in place. Unlike the other examples, there
is **no dataset and no SQL transform** — the editor reads and writes these files directly, and the
files are the source of truth. Add a `.md` file under `data/` (or one of its subfolders) and it
shows up in the workspace; the `groups` in `manifest.json` decide which virtual folder it lands
in.

The committed files here are realistic **sample content** for a fictional engineering team, so the
example boots with something to read. Replace them with your own docs to make the knowledge base
yours.

## What's here

| path | contents |
|---|---|
| `architecture.md` | platform overview and service map |
| `specs/auth-service.md`, `specs/billing-service.md` | service specs |
| `runbooks/oncall.md`, `runbooks/deploy.md` | operational runbooks |
| `incident-2026-05-01.md` | a postmortem |
| `notes/2026-06-standup.md`, `notes/roadmap.md` | working notes |
| `glossary.csv` | shared terms (`term,definition,category`), shown as a read-only table |

## Grouping

The manifest groups files into **Specs**, **Runbooks**, and **Notes** by glob. Globs are relative
to `data/`, so a file can sit anywhere on disk and still land in the right virtual folder
(`incident-*.md` lives at the top level but groups under **Runbooks**). `glossary.csv` and this
README match no group, so they show under **Ungrouped** — and `glossary.csv` renders as a table
because the island sets `csv: true`.
