import {
  Badge,
  Button,
  ClipboardText,
  Collapsible,
  Dialog,
  Table,
  Tabs,
  Text,
  Tooltip,
  cn,
} from "@cloudflare/kumo";
import {
  CalendarBlank,
  CaretRight,
  Database,
  FileCsv,
  FileSql,
  FileText,
  Hash,
  type Icon,
  TextAa,
  ToggleLeft,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Column, ColumnType, Row, Scalar } from "@openislands/compiler";
import { useAppId } from "../client/useAppId.js";
import { formatTimestamp, toNumber } from "../islands/format.js";

const PREVIEW_ROWS = 8;

/** Where an island's data comes from, surfaced through the per-card source dialog. */
export interface SourceInfo {
  name: string;
  path?: string;
  table?: string;
  kind: "file" | "sql";
  description?: string;
  columns?: Column[];
  rows?: Row[];
}

const TYPE_META: Record<ColumnType, { Glyph: Icon; label: string }> = {
  number: { Glyph: Hash, label: "number" },
  string: { Glyph: TextAa, label: "text" },
  date: { Glyph: CalendarBlank, label: "date" },
  boolean: { Glyph: ToggleLeft, label: "boolean" },
};

const FILE_FORMATS: Record<string, { Glyph: Icon; label: string }> = {
  csv: { Glyph: FileCsv, label: "CSV" },
  json: { Glyph: FileText, label: "JSON" },
  parquet: { Glyph: FileText, label: "Parquet" },
  sqlite: { Glyph: Database, label: "SQLite" },
  db: { Glyph: Database, label: "SQLite" },
  md: { Glyph: FileText, label: "Markdown" },
  pdf: { Glyph: FileText, label: "PDF" },
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/** Picks the header glyph + format badge from the source kind and file extension. */
function sourceFormat(source: SourceInfo): { Glyph: Icon; label: string } {
  if (source.kind === "sql") return { Glyph: FileSql, label: "Transform" };
  const ext = extensionOf(source.path ?? source.name);
  return FILE_FORMATS[ext] ?? { Glyph: FileText, label: ext ? ext.toUpperCase() : "File" };
}

/** A plain-language line explaining how this island gets its data. */
function sourceSummary(source: SourceInfo): string {
  if (source.kind === "sql") return "This data is calculated from your files by a transform.";
  if (source.table) return "This data is read from a table inside a database file.";
  return "This data is read directly from a file.";
}

function previewText(value: Scalar, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date") return formatTimestamp(value);
  if (type === "number") {
    const n = toNumber(value);
    if (n !== null) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
  return String(value);
}

/** Lazily fetches and reveals a transform's query — only when the reader opens it. */
function TransformDisclosure({ dataset }: { dataset: string }) {
  const appId = useAppId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ sql?: string; error?: string }>({});
  const loaded = state.sql !== undefined || state.error !== undefined;

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    const url = `/api/source?app=${encodeURIComponent(appId)}&dataset=${encodeURIComponent(dataset)}`;
    fetch(url, { headers: { accept: "application/json" } })
      .then(async (res) => {
        const body = (await res.json()) as { sql?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || body.error) setState({ error: body.error ?? `HTTP ${res.status}` });
        else setState({ sql: body.sql ?? "" });
      })
      .catch((err: Error) => !cancelled && setState({ error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [open, loaded, appId, dataset]);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        render={<Button variant="ghost" size="sm" className="-ml-2 self-start text-kumo-subtle" />}
      >
        <CaretRight size={13} className={cn("transition-transform", open && "rotate-90")} />
        {open ? "Hide how it's calculated" : "Show how it's calculated"}
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-1">
        {state.error ? (
          <Text variant="secondary" size="xs" DANGEROUS_className="text-kumo-danger">
            {state.error}
          </Text>
        ) : state.sql === undefined ? (
          <Text variant="secondary" size="xs">
            loading…
          </Text>
        ) : (
          <pre className="max-h-64 overflow-auto whitespace-pre rounded-md border border-kumo-hairline bg-kumo-recessed p-3 font-mono text-xs leading-relaxed text-kumo-default">
            {state.sql}
          </pre>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function SchemaList({ columns }: { columns: Column[] }) {
  return (
    <div className="flex flex-col">
      {columns.map((column) => {
        const { Glyph, label } = TYPE_META[column.type];
        return (
          <div
            key={column.name}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-kumo-tint"
          >
            <Glyph size={15} className="flex-none text-kumo-subtle" />
            <Text
              as="code"
              size="sm"
              DANGEROUS_className="min-w-0 flex-1 truncate font-mono text-kumo-strong"
            >
              {column.name}
            </Text>
            <Text variant="secondary" size="xs" DANGEROUS_className="flex-none">
              {label}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function PreviewTable({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              {columns.map((column) => (
                <Table.Head
                  key={column.name}
                  className={cn("whitespace-nowrap", column.type === "number" && "text-right")}
                >
                  {column.name}
                </Table.Head>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
              <Table.Row key={i}>
                {columns.map((column) => {
                  const value = row[column.name];
                  const empty = value === null || value === undefined || value === "";
                  return (
                    <Table.Cell
                      key={column.name}
                      className={cn(
                        "max-w-[14rem] truncate",
                        column.type === "number" && "text-right tabular-nums",
                        empty && "text-kumo-subtle",
                      )}
                    >
                      {previewText(value ?? null, column.type)}
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      {rows.length > PREVIEW_ROWS ? (
        <Text variant="secondary" size="xs">
          Showing first {PREVIEW_ROWS} of {rows.length} loaded rows
        </Text>
      ) : null}
    </div>
  );
}

export function SourceButton({ source }: { source: SourceInfo }) {
  const { Glyph: HeaderIcon, label: formatLabel } = sourceFormat(source);
  const columns = source.columns ?? [];
  const rows = source.rows ?? [];
  const hasSchema = columns.length > 0;
  const hasPreview = hasSchema && rows.length > 0;

  const tabs = [
    ...(hasPreview ? [{ value: "preview", label: "Preview" }] : []),
    ...(hasSchema ? [{ value: "schema", label: "Schema" }] : []),
  ];
  const [tab, setTab] = useState("preview");

  return (
    <Dialog.Root>
      <Tooltip
        content={`Source: ${source.name}`}
        render={
          <Dialog.Trigger
            render={
              <Button variant="ghost" size="sm" shape="square" aria-label={`Source: ${source.name}`}>
                <Database size={14} />
              </Button>
            }
          />
        }
      />
      <Dialog size="base" className="t-modal flex max-h-[85vh] w-[min(92vw,34rem)] flex-col p-0">
        <div className="flex items-start gap-3 border-b border-kumo-hairline p-5">
          <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-kumo-recessed text-kumo-subtle">
            <HeaderIcon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Dialog.Title className="text-base font-medium text-kumo-strong">
                {source.name}
              </Dialog.Title>
              <Badge variant="secondary">{formatLabel}</Badge>
            </div>
            {source.description ? (
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                {source.description}
              </Dialog.Description>
            ) : null}
            {hasSchema ? (
              <Text variant="secondary" size="xs" DANGEROUS_className="mt-1 block">
                {columns.length} {columns.length === 1 ? "column" : "columns"}
              </Text>
            ) : null}
          </div>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>

        {source.path ? (
          <div className="flex flex-col gap-2 border-b border-kumo-hairline px-5 py-3">
            <Text variant="secondary" size="xs">
              {sourceSummary(source)}
            </Text>
            <ClipboardText
              text={source.path}
              size="sm"
              tooltip={{ text: "Copy path", copiedText: "Copied" }}
            />
            {source.table ? (
              <Text variant="secondary" size="xs">
                table{" "}
                <Text as="code" size="xs" DANGEROUS_className="font-mono text-kumo-strong">
                  {source.table}
                </Text>
              </Text>
            ) : null}
            {source.kind === "sql" ? <TransformDisclosure dataset={source.name} /> : null}
          </div>
        ) : null}

        {tabs.length > 1 ? (
          <div className="px-5 pt-3">
            <Tabs variant="underline" size="sm" tabs={tabs} value={tab} onValueChange={setTab} />
          </div>
        ) : null}

        {hasSchema ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {tab === "preview" && hasPreview ? (
              <PreviewTable columns={columns} rows={rows} />
            ) : (
              <SchemaList columns={columns} />
            )}
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}
