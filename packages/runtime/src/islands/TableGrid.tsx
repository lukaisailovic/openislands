import { Table, cn } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Column, Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import { Paged } from "../components/Paged.js";
import { SeeAllDialog } from "../components/SeeAllDialog.js";
import { GroupedRowsView, groupRows, type GroupBySpec } from "../components/GroupedRows.js";
import {
  type DrilldownSpec,
  ROW_INTERACTIVE_TABLE_CLASS,
  rowActivationProps,
  type RowField,
  useRowDetails,
} from "../components/RowDetailsDialog.js";
import type { IslandRenderProps } from "../types.js";
import { formatValue, toNumber } from "./format.js";

const CARD_CAP = 8;
const CARD_GROUP_CAP = 6;

interface StatusSpec {
  low?: string;
  high?: string;
  signal?: string;
}

interface ColumnSpec {
  field: string;
  label?: string;
  format?: ValueFormat;
  status?: StatusSpec;
}

/**
 * The columns to render: the manifest spec when present, else every column
 * in the payload — minus any `details` fields (shown only in the expanded row
 * view) and any `groupBy` fields (carried by the section header). Pure, so
 * tests assert without a DOM.
 */
export function tableColumns(
  spec: ColumnSpec[] | undefined,
  columns: Column[],
  details?: RowField[],
  groupBy?: GroupBySpec,
): ColumnSpec[] {
  const hidden = new Set((details ?? []).map((d) => d.field));
  if (groupBy) {
    for (const f of [groupBy.field, groupBy.titleField, groupBy.subtitleField]) {
      if (f) hidden.add(f);
    }
  }
  const cols = spec && spec.length > 0 ? spec : columns.map((c) => ({ field: c.name }));
  return cols.filter((c) => !hidden.has(c.field));
}

function isNumeric(col: ColumnSpec, columns: Column[]): boolean {
  if (col.format) return true;
  return columns.find((c) => c.name === col.field)?.type === "number";
}

function cellClass(col: ColumnSpec, columns: Column[], row: Row): string | undefined {
  const numeric = isNumeric(col, columns);
  if (!numeric && !col.status?.signal) return undefined;
  const n = toNumber(col.status?.signal ? row[col.status.signal] : row[col.field]);
  return cn(
    numeric && "text-right tabular-nums",
    col.status && n !== null && n > 0 && "text-kumo-success",
    col.status && n !== null && n < 0 && "text-kumo-danger",
  );
}

function cellText(col: ColumnSpec, value: unknown): string {
  if (col.format) return formatValue(value ?? null, col.format);
  return String(value ?? "");
}

function DataTable({
  cols,
  columns,
  rows,
  onRowClick,
}: {
  cols: ColumnSpec[];
  columns: Column[];
  rows: Row[];
  onRowClick?: (row: Row) => void;
}) {
  return (
    <Table>
      <Table.Header>
        <Table.Row>
          {cols.map((col) => (
            <Table.Head
              key={col.field}
              className={isNumeric(col, columns) ? "text-right" : undefined}
            >
              {col.label ?? col.field}
            </Table.Head>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row, i) => (
          <Table.Row
            key={i}
            className={onRowClick ? ROW_INTERACTIVE_TABLE_CLASS : undefined}
            {...(onRowClick ? rowActivationProps(() => onRowClick(row)) : {})}
          >
            {cols.map((col) => (
              <Table.Cell key={col.field} className={cellClass(col, columns, row)}>
                {cellText(col, row[col.field])}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

export function TableGrid({ config, data }: IslandRenderProps) {
  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];
  const details = (config.details as RowField[] | undefined) ?? [];
  const groupBy = config.groupBy as GroupBySpec | undefined;
  const cols = tableColumns(config.columns as ColumnSpec[] | undefined, columns, details, groupBy);
  const drilldown = config.drilldown as DrilldownSpec | undefined;
  const expand = config.expand !== false;
  const { onRowClick, dialog } = useRowDetails(
    details,
    [...cols, ...details],
    (config.title as string | undefined) ?? "Details",
    drilldown,
  );

  if (rows.length === 0) return <NoData />;

  if (groupBy) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <GroupedRowsView
          groups={groupRows(rows, groupBy)}
          groupCap={CARD_GROUP_CAP}
          title={(config.title as string | undefined) ?? "Table"}
          expand={expand}
          wrapSections={(sections) => <div className="min-w-0 overflow-x-auto">{sections}</div>}
        >
          {(group) => (
            <DataTable cols={cols} columns={columns} rows={group.rows} onRowClick={onRowClick} />
          )}
        </GroupedRowsView>
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="min-w-0 overflow-x-auto">
        <DataTable
          cols={cols}
          columns={columns}
          rows={expand ? rows.slice(0, CARD_CAP) : rows}
          onRowClick={onRowClick}
        />
      </div>
      {expand ? (
        <SeeAllDialog
          label={rows.length > CARD_CAP ? `See all ${rows.length}` : "Expand"}
          title={(config.title as string | undefined) ?? "Table"}
        >
          <Paged items={rows}>
            {(slice) => (
              <DataTable cols={cols} columns={columns} rows={slice} onRowClick={onRowClick} />
            )}
          </Paged>
        </SeeAllDialog>
      ) : null}
      {dialog}
    </div>
  );
}
