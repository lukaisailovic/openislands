import { Badge, ChartPalette, Text, cn } from "@cloudflare/kumo";
import type { FooterItemSpec, HighlightSpec, StatSpec } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import { Paged } from "../components/Paged.js";
import { SeeAllDialog } from "../components/SeeAllDialog.js";
import { GroupedRowsView, groupRows, type GroupBySpec } from "../components/GroupedRows.js";
import {
  type DrilldownSpec,
  ROW_INTERACTIVE_CLASS,
  rowActivationProps,
  type RowField,
  useRowDetails,
} from "../components/RowDetailsDialog.js";
import type { IslandRenderProps } from "../types.js";
import { usePrefersDark } from "./chart.js";
import { formatTimestamp, formatValue } from "./format.js";

const FEED_CAP = 12;
const FEED_GROUP_CAP = 6;
const FEED_DIALOG_WIDTH = "w-[min(92vw,48rem)]";

interface FeedSpec {
  ts: string;
  titleField: string;
  detail?: string;
  details: RowField[];
  highlight?: HighlightSpec;
  stats: StatSpec[];
  footer: FooterItemSpec[];
  drilldown?: DrilldownSpec;
  expand: boolean;
}

function readSpec(config: IslandRenderProps["config"]): FeedSpec {
  return {
    ts: config.ts as string,
    titleField: config.titleField as string,
    detail: config.detail as string | undefined,
    details: (config.details as RowField[] | undefined) ?? [],
    highlight: config.highlight as HighlightSpec | undefined,
    stats: (config.stats as StatSpec[] | undefined) ?? [],
    footer: (config.footer as FooterItemSpec[] | undefined) ?? [],
    drilldown: config.drilldown as DrilldownSpec | undefined,
    expand: config.expand !== false,
  };
}

function isRich(spec: FeedSpec): boolean {
  return Boolean(spec.highlight) || spec.stats.length > 0 || spec.footer.length > 0;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function RichHeader({ row, spec }: { row: Row; spec: FeedSpec }) {
  const value = spec.highlight ? row[spec.highlight.field] : undefined;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Text size="sm" as="span" className="font-medium text-kumo-strong">
        {String(row[spec.titleField] ?? "")}
      </Text>
      {spec.highlight && isPresent(value) ? (
        <span className="whitespace-nowrap">
          <Text size="sm" as="span" className="font-semibold tabular-nums">
            {formatValue(value ?? null, spec.highlight.format)}
          </Text>
          {spec.highlight.unit ? (
            <Text variant="secondary" size="xs" as="span" className="ml-1 uppercase">
              {spec.highlight.unit}
            </Text>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function RichStats({ row, stats, dark }: { row: Row; stats: StatSpec[]; dark: boolean }) {
  const visible = stats.filter((s) => isPresent(row[s.field]));
  if (visible.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {visible.map((stat, i) => (
        <span key={stat.field} className="whitespace-nowrap">
          {i > 0 ? (
            <Text variant="secondary" size="xs" as="span" className="mr-2">
              ·
            </Text>
          ) : null}
          {stat.label ? (
            <Text
              size="xs"
              as="span"
              className="font-medium"
              style={{ color: stat.color ?? ChartPalette.categorical(i, dark) }}
            >
              {stat.label}{" "}
            </Text>
          ) : null}
          <Text size="xs" as="span" className="tabular-nums">
            {formatValue(row[stat.field] ?? null, stat.format)}
          </Text>
          {stat.unit ? (
            <Text variant="secondary" size="xs" as="span" className="ml-0.5">
              {stat.unit}
            </Text>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function RichFooter({ row, spec }: { row: Row; spec: FeedSpec }) {
  const items = spec.footer.filter((item) => isPresent(row[item.field]));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <Text variant="secondary" size="xs" as="span">
        {formatTimestamp(row[spec.ts] ?? null)}
      </Text>
      {items.map((item) => (
        <span key={item.field} className="flex items-center gap-1.5">
          <Text variant="secondary" size="xs" as="span">
            ·
          </Text>
          {item.pill ? (
            <Badge variant="secondary">{formatValue(row[item.field] ?? null, item.format)}</Badge>
          ) : (
            <Text variant="secondary" size="xs" as="span">
              {item.label ? `${item.label} ` : ""}
              {formatValue(row[item.field] ?? null, item.format)}
              {item.unit ? ` ${item.unit}` : ""}
            </Text>
          )}
        </span>
      ))}
    </div>
  );
}

function FeedRow({
  row,
  spec,
  rich,
  dark,
  onClick,
}: {
  row: Row;
  spec: FeedSpec;
  rich: boolean;
  dark: boolean;
  onClick?: (row: Row) => void;
}) {
  if (rich) {
    return (
      <li
        className={cn(
          "border-b border-kumo-hairline py-2 last:border-b-0",
          onClick && ROW_INTERACTIVE_CLASS,
        )}
        {...(onClick ? rowActivationProps(() => onClick(row)) : {})}
      >
        <RichHeader row={row} spec={spec} />
        <RichStats row={row} stats={spec.stats} dark={dark} />
        <RichFooter row={row} spec={spec} />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "flex items-baseline gap-2.5 border-b border-kumo-hairline py-1.5 last:border-b-0",
        onClick && ROW_INTERACTIVE_CLASS,
      )}
      {...(onClick ? rowActivationProps(() => onClick(row)) : {})}
    >
      <Text variant="secondary" size="xs" as="span" className="whitespace-nowrap">
        {formatTimestamp(row[spec.ts] ?? null)}
      </Text>
      <Text size="sm" as="span">
        {String(row[spec.titleField] ?? "")}
      </Text>
      {spec.detail ? (
        <Text variant="secondary" size="sm" as="span">
          {String(row[spec.detail] ?? "")}
        </Text>
      ) : null}
    </li>
  );
}

function feedDialogFields(spec: FeedSpec, rich: boolean): RowField[] {
  if (rich) return spec.details;
  const primary: RowField[] = [{ field: spec.ts, smartTimestamp: true }, { field: spec.titleField }];
  if (spec.detail) primary.push({ field: spec.detail });
  return [...primary, ...spec.details];
}

function FeedList({
  rows,
  spec,
  rich,
  dark,
  onRowClick,
  start = 0,
}: {
  rows: Row[];
  spec: FeedSpec;
  rich: boolean;
  dark: boolean;
  onRowClick?: (row: Row) => void;
  start?: number;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((row, i) => (
        <FeedRow key={start + i} row={row} spec={spec} rich={rich} dark={dark} onClick={onRowClick} />
      ))}
    </ul>
  );
}

export function TimelineFeed({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rich = isRich(spec);
  const dark = usePrefersDark();
  const rows = data?.rows ?? [];
  const groupBy = config.groupBy as GroupBySpec | undefined;
  const { onRowClick, dialog } = useRowDetails(
    spec.details,
    feedDialogFields(spec, rich),
    (config.title as string | undefined) ?? "Details",
    spec.drilldown,
  );

  if (rows.length === 0) return <NoData />;

  if (groupBy) {
    return (
      <div className="flex h-full flex-col">
        <GroupedRowsView
          groups={groupRows(rows, groupBy)}
          groupCap={FEED_GROUP_CAP}
          title={(config.title as string | undefined) ?? "All entries"}
          expand={spec.expand}
          dialogWidth={FEED_DIALOG_WIDTH}
        >
          {(group) => (
            <FeedList rows={group.rows} spec={spec} rich={rich} dark={dark} onRowClick={onRowClick} />
          )}
        </GroupedRowsView>
        {dialog}
      </div>
    );
  }

  const all = rows.toReversed();
  const visible = spec.expand ? all.slice(0, FEED_CAP) : all;

  return (
    <div className="flex h-full flex-col">
      <FeedList rows={visible} spec={spec} rich={rich} dark={dark} onRowClick={onRowClick} />
      {spec.expand && all.length > FEED_CAP ? (
        <SeeAllDialog
          label={`See all ${all.length}`}
          title={(config.title as string | undefined) ?? "All entries"}
          width={FEED_DIALOG_WIDTH}
        >
          <Paged items={all}>
            {(slice, start) => (
              <FeedList
                rows={slice}
                spec={spec}
                rich={rich}
                dark={dark}
                onRowClick={onRowClick}
                start={start}
              />
            )}
          </Paged>
        </SeeAllDialog>
      ) : null}
      {dialog}
    </div>
  );
}
