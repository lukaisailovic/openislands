import { Text } from "@cloudflare/kumo";

export interface SeriesLegendItem {
  name: string;
  color: string;
}

/**
 * A legible, wrapping legend for multi-series bar and line charts. ECharts'
 * built-in legend renders low-contrast text inside the clipped chart canvas;
 * this lives in normal flow below the chart with Kumo Text contrast and a
 * solid color swatch per series.
 */
export function SeriesLegend({ items }: { items: SeriesLegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.name} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: item.color }}
          />
          <Text variant="secondary" size="sm" DANGEROUS_className="truncate" title={item.name}>
            {item.name}
          </Text>
        </li>
      ))}
    </ul>
  );
}
