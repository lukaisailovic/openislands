import { Table, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useAppId } from "../../client/useAppId.js";
import { readFile } from "./api.js";
import { parseCsv, type ParsedCsv } from "./csv.js";

export function CsvTable({ path }: { path: string }) {
  const appId = useAppId();
  const [state, setState] = useState<{ data?: ParsedCsv; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    setState({});
    readFile(appId, path)
      .then((text) => !cancelled && setState({ data: parseCsv(text) }))
      .catch((error: Error) => !cancelled && setState({ error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [appId, path]);

  if (state.error) {
    return (
      <Text variant="secondary" size="sm" DANGEROUS_className="block p-8 text-kumo-danger">
        Couldn't load this file: {state.error}
      </Text>
    );
  }
  if (!state.data) {
    return (
      <Text variant="secondary" size="sm" DANGEROUS_className="block p-8">
        Loading…
      </Text>
    );
  }

  const { header, rows } = state.data;
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
