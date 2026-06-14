import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppIdContext } from "../src/client/useAppId.js";
import { BreakdownTreemap, buildTreemapData } from "../src/islands/BreakdownTreemap.js";
import { MetricKpi, sparkSeries } from "../src/islands/MetricKpi.js";
import { pageWindow } from "../src/components/Paged.js";
import { NoteCard, stripFrontmatter } from "../src/islands/NoteCard.js";
import { SourceDoc } from "../src/islands/SourceDoc.js";
import { TableGrid, tableColumns } from "../src/islands/TableGrid.js";
import { TimeseriesLine } from "../src/islands/TimeseriesLine.js";
import { computeDelta, formatTimestamp, formatValue } from "../src/islands/format.js";

const series = [
  { month: "2024-01", net_worth_eur: 100, other_eur: 10, target_eur: 120 },
  { month: "2024-02", net_worth_eur: 130, other_eur: 12, target_eur: 120 },
];

describe("value formatting", () => {
  it("renders eur with no fraction digits", () => {
    expect(formatValue(1234, "eur")).toContain("1,234");
    expect(formatValue(1234, "eur")).toContain("€");
  });

  it("renders usd, gbp, and jpy with the right symbol", () => {
    expect(formatValue(1234, "usd")).toContain("$");
    expect(formatValue(1234, "usd")).toContain("1,234");
    expect(formatValue(1234, "gbp")).toContain("£");
    expect(formatValue(1234, "jpy")).toContain("¥");
    expect(formatValue(1234, "jpy")).toContain("1,234");
  });

  it("renders pct as a scaled percentage", () => {
    expect(formatValue(0.125, "pct")).toBe("12.5%");
  });

  it("renders decimal with up to two fraction digits", () => {
    expect(formatValue(1234.5, "decimal")).toBe("1,234.5");
  });

  it("renders compact notation", () => {
    expect(formatValue(1200, "compact")).toBe("1.2K");
    expect(formatValue(3_400_000, "compact")).toBe("3.4M");
  });

  it("renders bytes on a binary scale", () => {
    expect(formatValue(512, "bytes")).toBe("512 B");
    expect(formatValue(1536, "bytes")).toBe("1.5 KB");
  });

  it("renders a duration from seconds as the two largest units", () => {
    expect(formatValue(90, "duration")).toBe("1m 30s");
    expect(formatValue(3900, "duration")).toBe("1h 5m");
  });

  it("renders month from a date string", () => {
    expect(formatValue("2026-06-11", "month")).toBe("Jun 2026");
  });

  it("renders kg and int", () => {
    expect(formatValue(7.25, "kg")).toBe("7.3 kg");
    expect(formatValue(1500.6, "int")).toBe("1,501");
  });

  it("falls back to a plain string for non-numeric values", () => {
    expect(formatValue("n/a", "eur")).toBe("n/a");
  });

  it("renders date, datetime, and time from a YYYY-MM-DD HH:MM:SS string", () => {
    expect(formatValue("2026-06-11 21:30:00", "date")).toBe("Jun 11, 2026");
    expect(formatValue("2026-06-11 21:30:00", "datetime")).toBe("Jun 11, 21:30");
    expect(formatValue("2026-06-11 21:30:00", "time")).toBe("21:30");
  });

  it("renders dates the same from an ISO string and a Date without timezone drift", () => {
    expect(formatValue("2026-06-11", "date")).toBe("Jun 11, 2026");
    expect(formatValue(new Date(Date.UTC(2026, 5, 11, 21, 30)), "datetime")).toBe("Jun 11, 21:30");
  });

  it("falls back to a plain string for an unparseable date", () => {
    expect(formatValue("not-a-date", "date")).toBe("not-a-date");
  });
});

describe("timeline.feed smart timestamp", () => {
  it("renders a date-only value as a date", () => {
    expect(formatTimestamp("2026-06-11")).toBe("Jun 11, 2026");
  });

  it("renders a midnight timestamp as a date", () => {
    expect(formatTimestamp("2026-06-11 00:00:00")).toBe("Jun 11, 2026");
  });

  it("renders a real timestamp as a datetime", () => {
    expect(formatTimestamp("2026-06-11 21:30:00")).toBe("Jun 11, 21:30");
  });

  it("falls back to a plain string for a non-date value", () => {
    expect(formatTimestamp("yesterday")).toBe("yesterday");
  });
});

describe("kpi delta", () => {
  it("is positive and up when the value rose", () => {
    const d = computeDelta(130, 100);
    expect(d).toEqual({ pct: 30, direction: "up" });
  });

  it("is down when the value fell", () => {
    const d = computeDelta(80, 100);
    expect(d?.direction).toBe("down");
    expect(d?.pct).toBeCloseTo(-20);
  });

  it("is null when there is no comparable previous value", () => {
    expect(computeDelta(100, 0)).toBeNull();
    expect(computeDelta(100, null)).toBeNull();
  });
});

describe("metric.kpi renderer", () => {
  it("shows the formatted latest value and a directional delta", () => {
    render(
      <MetricKpi
        config={{
          type: "metric.kpi",
          dataset: "nw",
          value: "net_worth_eur",
          format: "eur",
          compareTo: "prev",
        }}
        data={{ dataset: "nw", columns: [], rows: series }}
      />,
    );
    expect(screen.getByText(/130/)).toBeInTheDocument();
    const delta = screen.getByTestId("kpi-delta");
    expect(delta).toHaveAttribute("data-direction", "up");
    expect(delta.textContent).toContain("30.0%");
  });

  it("omits the delta when compareTo is not 'prev'", () => {
    render(
      <MetricKpi
        config={{ type: "metric.kpi", dataset: "nw", value: "net_worth_eur" }}
        data={{ dataset: "nw", columns: [], rows: series }}
      />,
    );
    expect(screen.queryByTestId("kpi-delta")).toBeNull();
  });

  it("shapes the sparkline series over the detected time field", () => {
    const spark = sparkSeries(series, "net_worth_eur", [], "#4290F0");
    expect(spark).toEqual([
      {
        name: "net_worth_eur",
        color: "#4290F0",
        data: [
          [Date.parse("2024-01-01"), 100],
          [Date.parse("2024-02-01"), 130],
        ],
      },
    ]);
  });

  it("has no sparkline series without a parseable time field", () => {
    expect(sparkSeries([{ a: 1 }, { a: 2 }], "a", [], "#4290F0")).toEqual([]);
  });
});

describe("timeline.feed paging", () => {
  it("windows rows into pages and clamps the last page", () => {
    expect(pageWindow(48, 0, 15)).toEqual({ pages: 4, start: 0, end: 15 });
    expect(pageWindow(48, 3, 15)).toEqual({ pages: 4, start: 45, end: 48 });
    expect(pageWindow(0, 0, 15)).toEqual({ pages: 1, start: 0, end: 0 });
  });
});

describe("timeseries.line renderer", () => {
  it("renders an empty state instead of a chart when there are no rows", () => {
    render(
      <TimeseriesLine
        config={{
          type: "timeseries.line",
          id: "t2",
          dataset: "nw",
          x: "month",
          y: "net_worth_eur",
        }}
        data={{ dataset: "nw", columns: [], rows: [] }}
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });
});

const allocation = [
  { class: "Crypto", value_eur: 120, region: "Digital" },
  { class: "Cash", value_eur: 40, region: "Fiat" },
  { class: "Stocks", value_eur: 0, region: "Equity" },
];

describe("breakdown.treemap data", () => {
  it("maps rows to flat leaves and drops non-positive values", () => {
    const data = buildTreemapData({ label: "class", value: "value_eur" }, allocation);
    expect(data).toEqual([
      { name: "Crypto", value: 120 },
      { name: "Cash", value: 40 },
    ]);
  });

  it("nests leaves under parents and sums parent values when parent is set", () => {
    const data = buildTreemapData({ label: "class", value: "value_eur", parent: "region" }, [
      { class: "BTC", value_eur: 70, region: "Crypto" },
      { class: "ETH", value_eur: 30, region: "Crypto" },
      { class: "EUR", value_eur: 40, region: "Fiat" },
    ]);
    expect(data).toHaveLength(2);
    const crypto = data.find((n) => n.name === "Crypto");
    expect(crypto?.value).toBe(100);
    expect(crypto?.children).toHaveLength(2);
  });

  it("renders a placeholder instead of a chart when there are no rows", () => {
    render(
      <BreakdownTreemap
        config={{ type: "breakdown.treemap", dataset: "a", label: "class", value: "value_eur" }}
        data={{ dataset: "a", columns: [], rows: [] }}
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });
});

describe("note.card markdown", () => {
  it("renders a link, inline code, and nested emphasis", () => {
    render(
      <NoteCard
        config={{
          type: "note.card",
          markdown: "See [docs](https://x.dev) and run `serve` with **bold _and_ italic**.",
        }}
      />,
    );
    const link = screen.getByText("docs");
    expect(link).toHaveAttribute("href", "https://x.dev");
    expect(screen.getByText("serve").tagName).toBe("CODE");
    expect(screen.getByText("and").tagName).toBe("EM");
  });

  it("renders headings and a list", () => {
    render(
      <NoteCard
        config={{ type: "note.card", markdown: "## How to read this\n\n- first\n- second" }}
      />,
    );
    expect(screen.getByText("How to read this").tagName).toBe("H3");
    expect(screen.getByText("first").tagName).toBe("LI");
  });

  it("renders a fenced code block", () => {
    const { container } = render(
      <NoteCard config={{ type: "note.card", markdown: "```\nnpm run build\n```" }} />,
    );
    const pre = container.querySelector("pre code");
    expect(pre?.textContent).toBe("npm run build");
  });

  it("renders plain prose with no callout wrapper when tone is omitted", () => {
    const { container } = render(
      <NoteCard config={{ type: "note.card", markdown: "Just commentary." }} />,
    );
    expect(container.querySelector("[data-tone]")).toBeNull();
    expect(screen.getByText("Just commentary.")).toBeInTheDocument();
  });

  it("wraps the body in a tinted callout when a tone is set", () => {
    const { container } = render(
      <NoteCard
        config={{ type: "note.card", tone: "warning", markdown: "Mind the **gap**." }}
      />,
    );
    const callout = container.querySelector("[data-tone='warning']");
    expect(callout).not.toBeNull();
    expect(callout?.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("gap").tagName).toBe("STRONG");
  });

  it("strips a leading frontmatter block but nothing else", () => {
    expect(stripFrontmatter("---\ntitle: X\nupdated: 2026-06-01\n---\n## Strategy\n\nBody")).toBe(
      "## Strategy\n\nBody",
    );
    expect(stripFrontmatter("## No frontmatter\n\n---\n")).toBe("## No frontmatter\n\n---\n");
  });
});

describe("source.doc renderer", () => {
  it("renders an image kind as an img through the confined app-scoped file route", () => {
    const { container } = render(
      <AppIdContext.Provider value="fin">
        <SourceDoc config={{ type: "source.doc", kind: "image", file: "data/chart.png" }} />
      </AppIdContext.Provider>,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/file?app=fin&path=data%2Fchart.png");
    expect(img?.getAttribute("alt")).toBeTruthy();
  });

  it("renders a link kind as a document card with a hostname label, not the raw url", () => {
    render(
      <SourceDoc config={{ type: "source.doc", kind: "link", href: "https://www.x.dev/path" }} />,
    );
    expect(screen.getByText("x.dev")).toBeInTheDocument();
    expect(screen.queryByText("https://www.x.dev/path")).toBeNull();
    const open = screen.getByRole("link", { name: /open/i });
    expect(open).toHaveAttribute("href", "https://www.x.dev/path");
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("shows a label and description when provided", () => {
    render(
      <SourceDoc
        config={{
          type: "source.doc",
          kind: "link",
          href: "https://x.dev",
          label: "Methodology",
          description: "How the numbers are derived",
        }}
      />,
    );
    expect(screen.getByText("Methodology")).toBeInTheDocument();
    expect(screen.getByText("How the numbers are derived")).toBeInTheDocument();
  });

  it("embeds a pdf with an open-in-new-tab fallback", () => {
    const { container } = render(
      <AppIdContext.Provider value="fin">
        <SourceDoc config={{ type: "source.doc", kind: "pdf", file: "docs/report.pdf" }} />
      </AppIdContext.Provider>,
    );
    expect(container.querySelector("object")?.getAttribute("type")).toBe("application/pdf");
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
  });
});

describe("table.grid columns", () => {
  it("uses the manifest column spec when present", () => {
    expect(tableColumns([{ field: "value_eur", label: "Value" }], [])).toEqual([
      { field: "value_eur", label: "Value" },
    ]);
  });

  it("falls back to every payload column", () => {
    expect(
      tableColumns(undefined, [
        { name: "asset", type: "string" },
        { name: "units", type: "number" },
      ]),
    ).toEqual([{ field: "asset" }, { field: "units" }]);
  });

  it("excludes detail fields from the row columns", () => {
    expect(
      tableColumns(undefined, [{ name: "asset", type: "string" }, { name: "notes", type: "string" }], [
        { field: "notes" },
      ]),
    ).toEqual([{ field: "asset" }]);
    expect(
      tableColumns([{ field: "asset" }, { field: "notes" }], [], [{ field: "notes" }]),
    ).toEqual([{ field: "asset" }]);
  });
});

describe("table.grid renderer", () => {
  const columns = [
    { name: "asset", type: "string" },
    { name: "gain", type: "number" },
  ] as const;
  const rows = [
    { asset: "BTC", gain: 611000 },
    { asset: "Cash", gain: -120 },
  ];

  it("renders labeled headers and formatted, sign-colored cells", () => {
    render(
      <TableGrid
        config={{
          type: "table.grid",
          dataset: "holdings",
          columns: [
            { field: "asset", label: "Asset" },
            { field: "gain", label: "Gain / loss", format: "eur", status: {} },
          ],
        }}
        data={{ dataset: "holdings", columns: [...columns], rows }}
      />,
    );
    expect(screen.getByText("Asset")).toBeInTheDocument();
    expect(screen.getByText("Gain / loss")).toBeInTheDocument();
    expect(screen.getByText("\u20ac611,000")).toHaveClass("text-kumo-success");
    expect(screen.getByText("-\u20ac120")).toHaveClass("text-kumo-danger");
  });

  it("renders the shared empty state when there are no rows", () => {
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings" }}
        data={{ dataset: "holdings", columns: [...columns], rows: [] }}
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("pages the see-all dialog with Kumo pagination controls", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ asset: `A${i}`, gain: i }));
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings" }}
        data={{ dataset: "holdings", columns: [...columns], rows: many }}
      />,
    );
    fireEvent.click(screen.getByText("See all 20"));
    expect(screen.getByText("A14")).toBeInTheDocument();
    expect(screen.queryByText("A15")).toBeNull();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("A19")).toBeInTheDocument();
    expect(screen.queryByText("A14")).toBeNull();
  });

  it("caps card rows and offers a see-all affordance", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ asset: `A${i}`, gain: i }));
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings" }}
        data={{ dataset: "holdings", columns: [...columns], rows: many }}
      />,
    );
    expect(screen.getByText("See all 20")).toBeInTheDocument();
    expect(screen.queryByText("A19")).toBeNull();
  });

  it("renders every row inline with no see-all when expand is false", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ asset: `A${i}`, gain: i }));
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings", expand: false }}
        data={{ dataset: "holdings", columns: [...columns], rows: many }}
      />,
    );
    expect(screen.queryByText("See all 20")).toBeNull();
    expect(screen.queryByText("Expand")).toBeNull();
    expect(screen.getByText("A19")).toBeInTheDocument();
  });

  it("hides detail fields from the row and reveals them in a dialog on click", () => {
    render(
      <TableGrid
        config={{
          type: "table.grid",
          dataset: "panel",
          title: "Blood panel",
          columns: [{ field: "asset", label: "Asset" }],
          details: [{ field: "gain", label: "Gain", format: "eur" }],
        }}
        data={{ dataset: "panel", columns: [...columns], rows }}
      />,
    );
    expect(screen.queryByText("Gain")).toBeNull();
    fireEvent.click(screen.getByText("BTC").closest("tr")!);
    expect(screen.getByText("Gain")).toBeInTheDocument();
    expect(screen.getByText("€611,000")).toBeInTheDocument();
  });

  it("renders no clickable rows without details", () => {
    const { container } = render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings" }}
        data={{ dataset: "holdings", columns: [...columns], rows }}
      />,
    );
    expect(container.querySelector("tr[role='button']")).toBeNull();
  });

  it("offers an Expand affordance even when all rows fit on the card", () => {
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "holdings" }}
        data={{ dataset: "holdings", columns: [...columns], rows }}
      />,
    );
    expect(screen.getByText("Expand")).toBeInTheDocument();
  });
});

describe("table.grid groupBy renderer", () => {
  const columns = [
    { name: "panel_id", type: "string" },
    { name: "panel_name", type: "string" },
    { name: "draw_date", type: "string" },
    { name: "name", type: "string" },
    { name: "value", type: "number" },
  ] as const;
  const rows = [
    { panel_id: "p2", panel_name: "Recent Draw", draw_date: "2026-04-08", name: "HDL", value: 78 },
    { panel_id: "p2", panel_name: "Recent Draw", draw_date: "2026-04-08", name: "LDL", value: 136 },
    { panel_id: "p1", panel_name: "Older Draw", draw_date: "2025-01-02", name: "ApoB", value: 90 },
  ];
  const groupConfig = {
    type: "table.grid",
    dataset: "panels",
    title: "Panels",
    groupBy: { field: "panel_id", titleField: "panel_name", subtitleField: "draw_date" },
    columns: [{ field: "name", label: "Marker" }, { field: "value", label: "Value" }],
  };

  it("renders section headers in first-appearance order with row counts", () => {
    render(<TableGrid config={groupConfig} data={{ dataset: "panels", columns: [...columns], rows }} />);
    const headers = screen.getAllByText(/Draw$/);
    expect(headers.map((h) => h.textContent)).toEqual(["Recent Draw", "Older Draw"]);
    expect(screen.getByText("2026-04-08")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows the first group's rows and hides the rest until toggled", () => {
    render(<TableGrid config={groupConfig} data={{ dataset: "panels", columns: [...columns], rows }} />);
    expect(screen.getByText("HDL")).toBeInTheDocument();
    expect(screen.queryByText("ApoB")).toBeNull();
    fireEvent.click(screen.getByText("Older Draw"));
    expect(screen.getByText("ApoB")).toBeInTheDocument();
  });

  it("opens the details dialog from a grouped row", () => {
    render(
      <TableGrid
        config={{ ...groupConfig, details: [{ field: "value", label: "Value detail", format: "int" }] }}
        data={{ dataset: "panels", columns: [...columns], rows }}
      />,
    );
    expect(screen.queryByText("Value detail")).toBeNull();
    fireEvent.click(screen.getByText("HDL").closest("tr")!);
    expect(screen.getByText("Value detail")).toBeInTheDocument();
  });
});
