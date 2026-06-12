import { query, queryArrow } from "@openislands/compiler";
import type { QueryPayload } from "../types.js";

export const DEFAULT_QUERY_LIMIT = 1_000;
export const MAX_QUERY_LIMIT = 50_000;

export const ARROW_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

export interface QueryRequest {
  dataset: string;
  limit?: number;
  format?: ResponseFormat;
  range?: { field: string; from?: string; to?: string };
  match?: { field: string; value: string }[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Negotiable wire format: JSON by default, Arrow IPC for API consumers that want bytes. */
export type ResponseFormat = "json" | "arrow";

export interface QueryHandlerResult {
  status: number;
  format: ResponseFormat;
  body: QueryPayload | { error: string; dataset?: string };
  /** Arrow IPC stream bytes when format is "arrow" and the query succeeded. */
  arrow?: Uint8Array;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_QUERY_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_QUERY_LIMIT;
  return Math.min(Math.floor(limit), MAX_QUERY_LIMIT);
}

/**
 * Read-only, row-capped dataset read. Returns a structured result instead of an
 * HTTP Response so the same logic is exercised by unit tests and by the route.
 */
export async function runQuery(
  projectDir: string,
  request: QueryRequest,
): Promise<QueryHandlerResult> {
  const format = request.format ?? "json";
  if (!request.dataset) return { status: 400, format, body: { error: "missing 'dataset'" } };

  const limit = clampLimit(request.limit);
  const opts = { limit, range: request.range, match: request.match };
  try {
    if (format === "arrow") {
      const arrow = await queryArrow(projectDir, request.dataset, opts);
      return {
        status: 200,
        format,
        body: { dataset: request.dataset, columns: [], rows: [] },
        arrow,
      };
    }
    const result = await query(projectDir, request.dataset, opts);
    return {
      status: 200,
      format,
      body: { dataset: request.dataset, columns: result.columns, rows: result.rows },
    };
  } catch (err) {
    return {
      status: 422,
      format,
      body: { error: err instanceof Error ? err.message : String(err), dataset: request.dataset },
    };
  }
}

/** Resolves the wire format from an explicit `?format=` param or the Accept header. */
export function negotiateFormat(params: URLSearchParams, accept?: string | null): ResponseFormat {
  const explicit = params.get("format");
  if (explicit === "arrow" || explicit === "json") return explicit;
  if (accept?.includes(ARROW_CONTENT_TYPE)) return "arrow";
  return "json";
}

/** Parse a query request from URL search params and the request's Accept header (GET/POST routes). */
export function parseQueryParams(params: URLSearchParams, accept?: string | null): QueryRequest {
  const dataset = params.get("dataset") ?? "";
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  const format = negotiateFormat(params, accept);
  return { dataset, limit, format, range: parseRange(params), match: parseMatch(params) };
}

/** Reads every `match.<column>=<value>` param into an equality narrowing list. */
export function parseMatch(params: URLSearchParams): QueryRequest["match"] {
  const match: NonNullable<QueryRequest["match"]> = [];
  for (const [key, value] of params) {
    if (!key.startsWith("match.")) continue;
    const field = key.slice("match.".length);
    if (field) match.push({ field, value });
  }
  return match.length > 0 ? match : undefined;
}

/** A range is honored only with a field and at least one valid YYYY-MM-DD bound. */
function parseRange(params: URLSearchParams): QueryRequest["range"] {
  const field = params.get("filterField");
  if (!field) return undefined;
  const from = isoOrUndefined(params.get("from"));
  const to = isoOrUndefined(params.get("to"));
  if (from === undefined && to === undefined) return undefined;
  return { field, from, to };
}

function isoOrUndefined(value: string | null): string | undefined {
  return value && ISO_DATE.test(value) ? value : undefined;
}
