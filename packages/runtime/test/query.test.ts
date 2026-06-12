import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  negotiateFormat,
  parseMatch,
  parseQueryParams,
  runQuery,
} from "../src/server/query.js";

const queryMock = vi.hoisted(() => vi.fn());
const queryArrowMock = vi.hoisted(() => vi.fn());

vi.mock("@openislands/compiler", () => ({ query: queryMock, queryArrow: queryArrowMock }));

afterEach(() => {
  queryMock.mockReset();
  queryArrowMock.mockReset();
});

const ARROW = "application/vnd.apache.arrow.stream";

describe("parseQueryParams", () => {
  it("reads dataset, limit, and format from search params", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=nw&limit=10&format=json"));
    expect(req).toEqual({ dataset: "nw", limit: 10, format: "json" });
  });

  it("defaults format to json and leaves limit undefined when absent", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=nw"));
    expect(req.format).toBe("json");
    expect(req.limit).toBeUndefined();
  });

  it("reads format=arrow from search params", () => {
    expect(parseQueryParams(new URLSearchParams("dataset=nw&format=arrow")).format).toBe("arrow");
  });

  it("parses a range from filterField + from/to", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=nw&filterField=month&from=2024-03-01&to=2024-06-30"));
    expect(req.range).toEqual({ field: "month", from: "2024-03-01", to: "2024-06-30" });
  });

  it("honors a one-sided range", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=nw&filterField=month&from=2024-03-01"));
    expect(req.range).toEqual({ field: "month", from: "2024-03-01", to: undefined });
  });

  it("ignores a range without a field", () => {
    expect(parseQueryParams(new URLSearchParams("dataset=nw&from=2024-03-01")).range).toBeUndefined();
  });

  it("ignores a range with no valid bound", () => {
    expect(parseQueryParams(new URLSearchParams("dataset=nw&filterField=month")).range).toBeUndefined();
  });

  it("drops a malformed (non YYYY-MM-DD) bound", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=nw&filterField=month&from=nonsense&to=2024-06-30"));
    expect(req.range).toEqual({ field: "month", from: undefined, to: "2024-06-30" });
  });

  it("parses match.<column> params into an equality list", () => {
    const req = parseQueryParams(new URLSearchParams("dataset=meals&match.meal_id=42&match.day=2026-06-11"));
    expect(req.match).toEqual([
      { field: "meal_id", value: "42" },
      { field: "day", value: "2026-06-11" },
    ]);
  });
});

describe("parseMatch", () => {
  it("reads only match.<column> params", () => {
    expect(parseMatch(new URLSearchParams("dataset=meals&match.meal_id=42&limit=10"))).toEqual([
      { field: "meal_id", value: "42" },
    ]);
  });

  it("is undefined when no match params are present", () => {
    expect(parseMatch(new URLSearchParams("dataset=meals"))).toBeUndefined();
  });

  it("ignores a bare 'match.' with an empty column", () => {
    expect(parseMatch(new URLSearchParams("dataset=meals&match.=x"))).toBeUndefined();
  });
});

describe("negotiateFormat", () => {
  it("prefers an explicit format param over the Accept header", () => {
    expect(negotiateFormat(new URLSearchParams("format=json"), ARROW)).toBe("json");
  });

  it("falls back to arrow when the Accept header asks for the arrow stream", () => {
    expect(negotiateFormat(new URLSearchParams(""), ARROW)).toBe("arrow");
  });

  it("defaults to json with no param and no matching Accept header", () => {
    expect(negotiateFormat(new URLSearchParams(""), "text/html")).toBe("json");
  });
});

describe("runQuery", () => {
  it("rejects a missing dataset with 400", async () => {
    const result = await runQuery("/proj", { dataset: "" });
    expect(result.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns {dataset, columns, rows} on success", async () => {
    queryMock.mockResolvedValue({ columns: [{ name: "x", type: "number" }], rows: [{ x: 1 }] });
    const result = await runQuery("/proj", { dataset: "nw" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      dataset: "nw",
      columns: [{ name: "x", type: "number" }],
      rows: [{ x: 1 }],
    });
  });

  it("applies the default row cap when no limit is given", async () => {
    queryMock.mockResolvedValue({ columns: [], rows: [] });
    await runQuery("/proj", { dataset: "nw" });
    expect(queryMock).toHaveBeenCalledWith("/proj", "nw", { limit: DEFAULT_QUERY_LIMIT });
  });

  it("clamps an oversized limit to the max", async () => {
    queryMock.mockResolvedValue({ columns: [], rows: [] });
    await runQuery("/proj", { dataset: "nw", limit: 9_999_999 });
    expect(queryMock).toHaveBeenCalledWith("/proj", "nw", { limit: MAX_QUERY_LIMIT });
  });

  it("falls back to the default cap for a non-positive limit", async () => {
    queryMock.mockResolvedValue({ columns: [], rows: [] });
    await runQuery("/proj", { dataset: "nw", limit: -5 });
    expect(queryMock).toHaveBeenCalledWith("/proj", "nw", { limit: DEFAULT_QUERY_LIMIT });
  });

  it("turns a compiler failure into a 422 error shape", async () => {
    queryMock.mockRejectedValue(new Error("unknown dataset 'missing'"));
    const result = await runQuery("/proj", { dataset: "missing" });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "unknown dataset 'missing'", dataset: "missing" });
  });

  it("returns Arrow bytes from queryArrow when format is arrow", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    queryArrowMock.mockResolvedValue(bytes);
    const result = await runQuery("/proj", { dataset: "holdings", format: "arrow" });
    expect(result.status).toBe(200);
    expect(result.format).toBe("arrow");
    expect(result.arrow).toBe(bytes);
    expect(queryArrowMock).toHaveBeenCalledWith("/proj", "holdings", {
      limit: DEFAULT_QUERY_LIMIT,
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("surfaces an arrow query failure as a 422 without arrow bytes", async () => {
    queryArrowMock.mockRejectedValue(new Error("boom"));
    const result = await runQuery("/proj", { dataset: "holdings", format: "arrow" });
    expect(result.status).toBe(422);
    expect(result.arrow).toBeUndefined();
    expect(result.body).toEqual({ error: "boom", dataset: "holdings" });
  });

  it("passes the active range through to the compiler", async () => {
    queryMock.mockResolvedValue({ columns: [], rows: [] });
    const range = { field: "month", from: "2024-03-01", to: undefined };
    await runQuery("/proj", { dataset: "nw", range });
    expect(queryMock).toHaveBeenCalledWith("/proj", "nw", { limit: DEFAULT_QUERY_LIMIT, range });
  });

  it("passes the range through the arrow path too", async () => {
    queryArrowMock.mockResolvedValue(new Uint8Array());
    const range = { field: "ts", from: "2024-03-01" };
    await runQuery("/proj", { dataset: "holdings", format: "arrow", range });
    expect(queryArrowMock).toHaveBeenCalledWith("/proj", "holdings", { limit: DEFAULT_QUERY_LIMIT, range });
  });

  it("passes a match narrowing through to the compiler", async () => {
    queryMock.mockResolvedValue({ columns: [], rows: [] });
    const match = [{ field: "meal_id", value: "42" }];
    await runQuery("/proj", { dataset: "meals", match });
    expect(queryMock).toHaveBeenCalledWith("/proj", "meals", { limit: DEFAULT_QUERY_LIMIT, match });
  });
});
