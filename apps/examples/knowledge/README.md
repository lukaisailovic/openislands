# Knowledge Base — dogfood app

A live, agent-maintained knowledge base for an engineering team, built on OpenIslands. This
example showcases the **`content.editor`** island: a full-page, Obsidian-style workspace that
edits the markdown and CSV files in `data/` directly — no dataset, no SQL, no rebuild. Save a
file and the editor reflects it; the files on disk are the source of truth.

## Run it

```bash
node_modules/.bin/tsx packages/cli/src/index.ts validate apps/examples/knowledge
node_modules/.bin/tsx packages/cli/src/index.ts serve apps/examples/knowledge
```

## What's on the canvas

A single full-page **`content.editor`** bound to the whole `data/` directory (`dir: "data"`,
recursed). It is **data-free** — it binds no dataset and runs no transform; it reads and writes
the files in place.

- **Markdown editing** — every `.md` file under `data/` opens in a rich editor.
- **CSV table view** — `csv: true` also surfaces `.csv` files, shown as a read-only table
  (`glossary.csv`).
- **Virtual folders** — `groups` collect scattered files into tidy buckets regardless of where
  they live on disk:

  | group | icon | matches |
  |---|---|---|
  | **Specs** | `files` | `specs/**`, `architecture.md` |
  | **Runbooks** | `list-bullets` | `runbooks/**`, `incident-*.md` |
  | **Notes** | `folder` | `notes/**`, `roadmap.md` |

  Files matching no group (`glossary.csv`, `data/README.md`) fall into the **Ungrouped** bucket.

## The content

`content.editor` binds files, not contracts — `datasets` is empty. The files under `data/` are
the app:

| path | what it is |
|---|---|
| `data/architecture.md` | system overview — the map of the whole platform |
| `data/specs/auth-service.md` | spec for the authentication service |
| `data/specs/billing-service.md` | spec for the billing / metering service |
| `data/runbooks/oncall.md` | on-call runbook — paging, escalation, first response |
| `data/runbooks/deploy.md` | deploy runbook — release flow and rollback |
| `data/incident-2026-05-01.md` | postmortem for the 2026-05-01 outage |
| `data/notes/2026-06-standup.md` | running standup notes for June 2026 |
| `data/notes/roadmap.md` | the rolling engineering roadmap |
| `data/glossary.csv` | shared terminology (CSV table) |

Edit the files to change the knowledge base; edit `app/manifest.json` to change the layout or the
folder grouping. Never hand-edit build output.
