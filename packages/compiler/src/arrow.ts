import { Bool, Float64, Table, Utf8, tableToIPC, vectorFromArray, type Vector } from "apache-arrow";
import type { Column, QueryResult, Row } from "./index.js";

function numberColumn(rows: Row[], field: string): (number | null)[] {
  return rows.map((row) => {
    const v = row[field];
    if (typeof v === "number") return v;
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  });
}

function boolColumn(rows: Row[], field: string): (boolean | null)[] {
  return rows.map((row) => {
    const v = row[field];
    if (typeof v === "boolean") return v;
    return v === null || v === undefined ? null : Boolean(v);
  });
}

function stringColumn(rows: Row[], field: string): (string | null)[] {
  return rows.map((row) => {
    const v = row[field];
    return v === null || v === undefined ? null : String(v);
  });
}

function vectorFor(column: Column, rows: Row[]): Vector {
  if (column.type === "number") return vectorFromArray(numberColumn(rows, column.name), new Float64());
  if (column.type === "boolean") return vectorFromArray(boolColumn(rows, column.name), new Bool());
  return vectorFromArray(stringColumn(rows, column.name), new Utf8());
}

/**
 * Encodes a JSON query result as an Arrow IPC stream. Dates and unmapped types are
 * carried as Utf8 so the wire format is lossless for display; Perspective parses the
 * stream zero-copy on the client.
 */
export function queryResultToArrowIPC(result: QueryResult): Uint8Array {
  const vectors: Record<string, Vector> = {};
  for (const column of result.columns) vectors[column.name] = vectorFor(column, result.rows);
  return tableToIPC(new Table(vectors), "stream");
}
