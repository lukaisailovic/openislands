---
"@openislands/schema": minor
"@openislands/compiler": minor
"@openislands/runtime": minor
---

Add the `form.entry` island: a data-entry form bound to a manifest `action`. It renders one typed input per field — types, enums, ranges, and defaults all come from the action's resolved row schema — with a submit button that inserts a row through the same validated, history-snapshotted path as the agent's `run_action`, then the bound dataset's islands refresh live. The human-facing mirror of an action: point it at an action by name and reuse its typing, no separate form schema. A new `/api/action` runtime endpoint resolves the form and performs the insert; the compiler exports `actionFields` for the resolved field descriptors.
