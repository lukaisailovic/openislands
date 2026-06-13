import { Autocomplete, Text } from "@cloudflare/kumo";
import { useMemo, useState } from "react";
import { RowDetailsDialog } from "../components/RowDetailsDialog.js";
import type { IslandRenderProps, Row } from "../types.js";

function matchRows(rows: Row[], fields: string[], query: string, limit: number): Row[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows.slice(0, limit);
  const matched: Row[] = [];
  for (const row of rows) {
    if (!fields.some((field) => String(row[field] ?? "").toLowerCase().includes(needle))) continue;
    matched.push(row);
    if (matched.length >= limit) break;
  }
  return matched;
}

export function SearchBox({ config, data }: IslandRenderProps) {
  const rows = data?.rows ?? [];
  const fields = (config.fields ?? []) as string[];
  const titleField = config.titleField as string;
  const detail = config.detail as string | undefined;
  const limit = (config.limit as number | undefined) ?? 10;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  const matches = useMemo(() => matchRows(rows, fields, query, limit), [rows, fields, query, limit]);
  const dialogFields = useMemo(() => (data?.columns ?? []).map((c) => ({ field: c.name })), [data?.columns]);

  return (
    <div className="flex flex-col justify-center">
      <Autocomplete
        items={matches}
        value={query}
        onValueChange={(value, details) => {
          setQuery(String(value ?? ""));
          if (details.reason === "input-change") setOpen(true);
        }}
        open={open}
        onOpenChange={setOpen}
        mode="none"
        itemToStringValue={(row) => String((row as Row)[titleField] ?? "")}
      >
        <Autocomplete.InputGroup placeholder={(config.placeholder as string | undefined) ?? "Search…"} />
        <Autocomplete.Content>
          <Autocomplete.Empty>
            <Text size="sm" color="secondary" DANGEROUS_className="px-2 py-1.5">
              No matches
            </Text>
          </Autocomplete.Empty>
          <Autocomplete.List>
            {(item: unknown, index: number) => {
              const row = item as Row;
              return (
                <Autocomplete.Item key={index} value={item} onClick={() => setSelectedRow(row)}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{String(row[titleField] ?? "")}</span>
                    {detail ? (
                      <Text size="xs" color="secondary" DANGEROUS_className="truncate">
                        {String(row[detail] ?? "")}
                      </Text>
                    ) : null}
                  </div>
                </Autocomplete.Item>
              );
            }}
          </Autocomplete.List>
        </Autocomplete.Content>
      </Autocomplete>
      <RowDetailsDialog
        row={selectedRow}
        fields={dialogFields}
        title={(config.title as string | undefined) ?? "Details"}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}
