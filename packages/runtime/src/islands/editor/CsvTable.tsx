import { Button, Input, Table, Text } from "@cloudflare/kumo";
import { Plus, TrashSimple } from "@phosphor-icons/react";
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { parseCsv, type ParsedCsv, serializeCsv } from "./csv.js";
import type { EditorHandle } from "./types.js";

/** Pad/truncate every row to the header length so the grid stays rectangular. */
function normalize(parsed: ParsedCsv): ParsedCsv {
  const width = parsed.header.length;
  return {
    header: parsed.header,
    rows: parsed.rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? "")),
  };
}

export function CsvTable({
  content,
  readOnly,
  onSave,
  onDirtyChange,
  handleRef,
}: {
  path: string;
  content: string;
  readOnly: boolean;
  onSave: () => void;
  onDirtyChange: (dirty: boolean) => void;
  handleRef: RefObject<EditorHandle | null>;
}) {
  const [grid, setGrid] = useState(() => normalize(parseCsv(content)));
  const baselineRef = useRef(serializeCsv(grid));

  useImperativeHandle(handleRef, () => ({ serialize: () => serializeCsv(grid) }), [grid]);

  useEffect(() => {
    const current = serializeCsv(grid);
    if (content === current) return;
    const next = normalize(parseCsv(content));
    setGrid(next);
    baselineRef.current = serializeCsv(next);
    onDirtyChange(false);
  }, [content]);

  const apply = (next: ParsedCsv) => {
    setGrid(next);
    onDirtyChange(serializeCsv(next) !== baselineRef.current);
  };

  const editCell = (r: number, c: number, value: string) => {
    const rows = grid.rows.map((row) => row.slice());
    rows[r]![c] = value;
    apply({ header: grid.header, rows });
  };

  const deleteRow = (r: number) => {
    apply({ header: grid.header, rows: grid.rows.filter((_, i) => i !== r) });
  };

  const addRow = () => {
    apply({ header: grid.header, rows: [...grid.rows, grid.header.map(() => "")] });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (readOnly) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    onSave();
  };

  const { header, rows } = grid;

  if (header.length === 0) {
    return (
      <Text variant="secondary" size="sm" DANGEROUS_className="block p-8">
        This CSV has no columns yet.
      </Text>
    );
  }

  if (readOnly) {
    return (
      <div className="min-w-0 overflow-auto p-4">
        <Table>
          <Table.Header>
            <Table.Row>
              {header.map((cell, i) => (
                <Table.Head key={i} className="whitespace-nowrap">
                  {cell}
                </Table.Head>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row, r) => (
              <Table.Row key={r}>
                {header.map((_, c) => (
                  <Table.Cell key={c} className="max-w-[18rem] truncate">
                    {row[c] ?? ""}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-auto p-4" onKeyDown={onKeyDown}>
      <Table>
        <Table.Header>
          <Table.Row>
            {header.map((cell, i) => (
              <Table.Head key={i} className="whitespace-nowrap">
                {cell}
              </Table.Head>
            ))}
            <Table.Head className="w-px" aria-label="Row actions" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row, r) => (
            <Table.Row key={r}>
              {header.map((label, c) => (
                <Table.Cell key={c} className="p-0">
                  <Input
                    size="sm"
                    aria-label={`${label || `column ${c + 1}`}, row ${r + 1}`}
                    value={row[c] ?? ""}
                    onChange={(event) => editCell(r, c, event.target.value)}
                    className="h-auto w-full rounded-none bg-transparent px-3 py-1.5 ring-0 focus:ring-0"
                  />
                </Table.Cell>
              ))}
              <Table.Cell className="w-px">
                <Button
                  variant="ghost"
                  size="sm"
                  shape="square"
                  icon={TrashSimple}
                  aria-label={`Delete row ${r + 1}`}
                  onClick={() => deleteRow(r)}
                />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <Button variant="secondary" size="sm" icon={Plus} className="mt-3" onClick={addRow}>
        Add row
      </Button>
    </div>
  );
}
