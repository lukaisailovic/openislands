/**
 * Generates apps/docs/src/pages/reference/manifest.mdx from @openislands/schema.
 *
 * The schema package is the single source of truth: one Zod definition per
 * concept yields runtime validation, TypeScript types, and the JSON Schema this
 * script renders. Regenerate with `pnpm gen:reference` (from apps/docs) whenever
 * the schema changes so the reference can never drift from the code.
 *
 * MDX safety: MDX parses bare `{` as a JS expression and bare `<` as JSX, so
 * every schema shape with braces/angle-brackets goes inside a fenced code block
 * and table cells stay free of unescaped `{ } < >`. Types are rendered as
 * prose (`string`, `array of …`, `"a" | "b"`) or backtick code-spans.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_ISLAND_TYPES,
  ISLAND_MIN_SPAN,
  jsonSchemaFor,
  type IslandType,
} from "@openislands/schema";

// --- JSON Schema → readable type rendering --------------------------------------

interface JsonSchemaNode {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  description?: string;
  default?: unknown;
  additionalProperties?: unknown;
}

/** A JSON literal as it should read inline, e.g. `"link"` or `1`. */
function literal(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * Render a JSON Schema node as a short, MDX-safe type phrase with no braces or
 * angle brackets, suitable for a backtick code-span in a table cell. Unions
 * become `a | b`, arrays become `array of <item>`, and a nested object is
 * summarized as `object` (its own shape is documented where it's defined).
 */
function renderType(node: JsonSchemaNode | undefined): string {
  if (!node) return "any";

  if (node.const !== undefined) return literal(node.const);

  if (node.enum) return node.enum.map(literal).join(" | ");

  const union = node.anyOf ?? node.oneOf ?? node.allOf;
  if (union) {
    const parts = union.map(renderType);
    return [...new Set(parts)].join(" | ");
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type;

  if (type === "array") return `array of ${renderType(node.items)}`;
  if (type === "integer") return "number";
  if (type === "object") return "object";
  if (type) return type;

  return "any";
}

interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
  typeMarkdown?: string;
}

/**
 * Flatten an island's JSON Schema into table rows. The `type` discriminant is
 * dropped (it's always the island's literal type). A property is user-required
 * only when it's in `required` AND has no `default`. Zod lists default-bearing
 * fields as required because they're present after parse, but the author may
 * omit them.
 */
function fieldRows(schema: JsonSchemaNode): FieldRow[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const rows: FieldRow[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    if (name === "type") continue;
    const hasDefault = prop.default !== undefined;
    const isValueFormat = name === "format" || name === "xFormat";
    rows.push({
      name,
      type: renderType(prop),
      required: required.has(name) && !hasDefault,
      description: prop.description?.replace(/\s+/g, " ").trim() ?? "",
      typeMarkdown: isValueFormat ? "[`value format`](/reference/value-formats)" : undefined,
    });
  }
  return rows;
}

// --- MDX assembly ---------------------------------------------------------------

/** Escape a pipe so it can't break a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function fieldTable(rows: FieldRow[]): string {
  const lines = [
    "| Field | Type | Required | Description |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const type = row.typeMarkdown ?? `\`${cell(row.type)}\``;
    const req = row.required ? "yes" : "no";
    lines.push(`| \`${row.name}\` | ${type} | ${req} | ${cell(row.description)} |`);
  }
  return lines.join("\n");
}

/**
 * `table.grid` and `timeline.feed` are Zod `.extend()`s of a base shape that
 * carries the `.describe()` text, and `z.toJSONSchema` drops the description off
 * the extended schema — so their JSON Schema has no top-level description. These
 * fall back to the base shapes' descriptions (copied verbatim from the schema's
 * TableGridBase / TimelineFeedBase). Any island whose schema does carry a
 * description uses that and ignores this map.
 */
const DESCRIPTION_FALLBACKS: Partial<Record<IslandType, string>> = {
  "table.grid":
    "A paginated table of raw rows: use when exact values matter; supports column formats, click-to-open details, and collapsible groups.",
  "timeline.feed":
    "A reverse-chronological feed of events: use for logs and activity; supports detail dialogs and collapsible groups, and a rich row layout (header value, inline stats, meta footer) when highlight/stats/footer are set.",
};

function islandSection(type: IslandType): string {
  const schema = jsonSchemaFor(type) as JsonSchemaNode;
  const rows = fieldRows(schema);
  const minSpan = ISLAND_MIN_SPAN[type];
  const description = (schema.description ?? DESCRIPTION_FALLBACKS[type] ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return [
    `### \`${type}\``,
    "",
    description,
    "",
    `**Minimum span:** ${minSpan}`,
    "",
    fieldTable(rows),
  ].join("\n");
}

/** github-slugger anchor for a `### \`<type>\`` heading: backticks and the dot drop out. */
function islandAnchor(type: IslandType): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildDoc(): string {
  const islandSections = BUILTIN_ISLAND_TYPES.map(islandSection).join("\n\n");
  const islandIndex = `**Built-in islands:** ${BUILTIN_ISLAND_TYPES.map(
    (type) => `[\`${type}\`](#${islandAnchor(type)})`,
  ).join(" · ")}`;

  return `# Manifest Reference

{/* Generated from @openislands/schema by scripts/gen-reference.ts. Do not edit by hand. */}

> Generated from \`@openislands/schema\` by \`scripts/gen-reference.ts\`. Do not edit by hand.
> Run \`pnpm gen:reference\` to refresh it after a schema change.

A manifest is the typed declaration of a data app: the datasets it reads, the pages
and islands that render them, and the optional actions and connectors that write to
them. This page documents every field the schema accepts. The schema is the single
source of truth: the CLI, runtime, and MCP server all validate against it, so an
island bound to a field that doesn't exist fails the build and names the island.

## Top level

A manifest is a JSON object with the following top-level shape:

\`\`\`jsonc
{
  "version": 1,                  // required: the manifest format version, always 1
  "title": "Finance Overview",   // required: the app title
  "icon": "wallet",              // optional: the app's tile icon in the workspace app rail
  "datasets": { /* ... */ },     // required: named data sources (see Datasets)
  "pages": [ /* ... */ ],        // required: the app's pages (see Pages)
  "actions": { /* ... */ },      // optional: typed data writes (see Actions)
  "connectors": { /* ... */ }    // optional: vendored sync integrations (see Connectors)
}
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`version\` | \`1\` | yes | The manifest format version. Always \`1\`. |
| \`title\` | \`string\` | yes | The app title, shown in the chrome. |
| \`icon\` | \`string\` | no | One of the curated icon names, used for the app's tile in the workspace app rail. |
| \`datasets\` | \`object\` | yes | A map of dataset name to a dataset declaration. See [Datasets](#datasets). |
| \`pages\` | \`array of object\` | yes | The app's pages, one sidebar entry each. See [Pages](#pages). |
| \`actions\` | \`object\` | no | A map of action name to an action declaration. See [Actions](#actions). |
| \`connectors\` | \`object\` | no | A map of connector name to a connector declaration. See [Connectors](#connectors). |

## Datasets

\`datasets\` maps each dataset name to a source. A dataset is one of three shapes: a
file source, a SQL transform, or a SQLite table.

\`\`\`jsonc
"datasets": {
  "net_worth": { "source": "data/net_worth.csv" },            // a CSV / JSON / Parquet / SQLite file
  "monthly":   { "sql": "models/transforms/monthly.sql" },    // a DuckDB SQL transform over other datasets
  "tracks":    { "source": "data/library.sqlite", "table": "tracks" } // a table within a SQLite database
}
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`source\` | \`string\` | no | Path to a CSV / JSON / Parquet / SQLite file. One of \`source\` or \`sql\` is required. |
| \`sql\` | \`string\` | no | Path to a DuckDB SQL transform. One of \`source\` or \`sql\` is required. |
| \`table\` | \`string\` | no | The table within a \`.sqlite\` / \`.db\` source. Required for a SQLite source; an error on any other source. |
| \`description\` | \`string\` | no | Free-form note describing the dataset. |

A \`.sqlite\` / \`.db\` source requires \`table\`; supplying \`table\` for any other source is
a validation error. A \`sql\` dataset is derived and read-only; it can never be the
target of an action or a connector.

## Pages

Each entry in \`pages\` is a page: one sidebar entry. A page holds **either** a flat
\`islands\` list **or** tabbed \`groups\`, never both:

\`\`\`jsonc
{
  "id": "overview",       // required: unique page id, used in the URL
  "title": "Overview",    // optional: sidebar label
  "icon": "house",        // optional: one of the curated page icons
  "filters": [ /* ... */ ],  // optional: page-level shared filters (see Page filters)
  "islands": [ /* ... */ ]   // a page has EITHER islands ...
  // "groups": [ { "id": "...", "title": "...", "islands": [ /* ... */ ] } ] // ... OR groups
}
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`id\` | \`string\` | yes | Unique page id, used in the \`/<appId>/<pageId>\` URL. |
| \`title\` | \`string\` | no | Sidebar label for the page. |
| \`icon\` | \`string\` | no | One of the curated page icons (e.g. \`house\`, \`chart-line\`, \`wallet\`). |
| \`filters\` | \`array of object\` | no | Page-level shared date-range filters. |
| \`islands\` | \`array of object\` | no | The page's islands. Exactly one of \`islands\` or \`groups\`. |
| \`groups\` | \`array of object\` | no | Tabbed groups of islands. Exactly one of \`islands\` or \`groups\`. |

A **group** is \`{ id, title?, islands }\`: a string \`id\`, an optional \`title\`, and its own
\`islands\` list. Groups render as tabs under the page header, deep-linked via
\`?group=<id>\`.

### Page filters

A page's optional \`filters\` declare shared controls in the page header. v1 supports a
date range; \`bind\` maps each affected dataset to the date column the range applies to.
Islands whose \`dataset\` appears in \`bind\` re-query when the range changes; the rest
ignore it.

\`\`\`jsonc
"filters": [
  { "id": "period", "type": "daterange", "label": "Period",
    "bind": { "net_worth": "month", "transactions": "ts" } }
]
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`id\` | \`string\` | yes | Unique filter id within the page. |
| \`type\` | \`"daterange"\` | yes | The filter kind. v1 supports \`daterange\`. |
| \`label\` | \`string\` | no | Label shown on the control. |
| \`bind\` | \`object\` | yes | A map of dataset name to the date column the range applies to. Each column is validated against the live data. |

## Actions

An **action** is a manifest-declared, typed write into a \`source\` dataset (a \`sql\`
dataset is never writable). \`mode: "insert"\` appends rows: an append for a flat file
(CSV / JSON(L)), an \`INSERT\` for a SQLite table. The row schema is derived from the
live data; \`fields\` only narrows or annotates it.

\`\`\`jsonc
"actions": {
  "log_meal": {
    "dataset": "meals",
    "mode": "insert",
    "fields": {
      "meal_type": { "enum": ["breakfast", "lunch", "dinner", "snack"] }
    }
  }
}
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`dataset\` | \`string\` | yes | The \`source\` dataset to insert into. Must not be a \`sql\` dataset. |
| \`mode\` | \`"insert"\` | yes | The write mode. v1 supports \`insert\`. |
| \`fields\` | \`object\` | no | Per-column overrides on the derived row schema (see field overrides). |
| \`description\` | \`string\` | no | Free-form note describing the action. |

A **field override** (\`fields.<column>\`) narrows one column of the derived row schema:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`type\` | \`"string" \\| "number" \\| "boolean" \\| "date"\` | no | Constrain the column to one type. |
| \`enum\` | \`array of string\` | no | Constrain the column to a fixed set of string values. |
| \`min\` | \`number\` | no | Minimum for a numeric column. |
| \`max\` | \`number\` | no | Maximum for a numeric column. |
| \`default\` | \`string \\| number \\| boolean\` | no | Value applied when the column is omitted. |
| \`description\` | \`string\` | no | Free-form note describing the column. |

## Connectors

A **connector** is a vendored integration that syncs a provider's data into \`source\`
datasets through the same checkpointed write path actions use. The integration code
lives in the user's project at \`<module>/index.ts\`; the manifest declares an instance:

\`\`\`jsonc
"connectors": {
  "whoop": {
    "module": "connectors/whoop",                  // connector directory, relative to project root
    "datasets": { "recovery": "whoop_recovery" },  // connector output name → manifest dataset name
    "schedule": "6h",                              // optional: sync interval, overrides the connector default
    "config": { "lookbackDays": 30 }               // optional: validated against the connector's own schema
  }
}
\`\`\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`module\` | \`string\` | yes | Connector directory relative to project root, e.g. \`connectors/whoop\`. |
| \`datasets\` | \`object\` | yes | A map of connector output name to the writable \`source\` dataset it syncs into. |
| \`schedule\` | \`string\` | no | Sync interval, overriding the connector default (\`<n>m\`, \`<n>h\`, \`<n>d\`, or ms-style). |
| \`config\` | \`object\` | no | Free-form config, validated against the connector's own schema at load time. |
| \`description\` | \`string\` | no | Free-form note describing the connector instance. |

Each \`datasets\` value must name a writable \`source\` dataset (never a \`sql\` dataset),
and each key must be one of the connector's declared outputs.

## Islands

Each island in a page's \`islands\` (or a group's \`islands\`) is an object discriminated
by its \`type\`. Below is every built-in type with its minimum grid span and the fields
its config accepts. \`id\`, \`title\`, and \`span\` are common optional fields on every
data-bound island; \`span\` is a 1–12 grid column count and must not fall below the
island's minimum span. Bind an island only to fields that exist in its dataset; a
missing field fails validation and names the island.

A \`layout.row\` is a structural wrapper: it holds other islands and forces them onto
their own full-width grid row. It carries no \`span\`, \`title\`, or data binding, and it
cannot nest another \`layout.row\`.

${islandIndex}

${islandSections}

## Custom islands

When no built-in fits, register a renderer in the user's project under
\`components/custom/<type>/\`; the directory name is the island type. An unknown island
\`type\` is accepted as a custom island: with a \`schema.ts\` its manifest config is
validated by the same machinery that guards the built-ins; without one it renders a
placeholder. See the [Custom Islands](/islands/custom) guide for the full shape.
`;
}

// --- Write ----------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../src/pages/reference/manifest.mdx");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buildDoc(), "utf8");
console.log(`Wrote ${outPath}`);
