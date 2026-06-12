import { Pagination } from "@cloudflare/kumo";
import { useState } from "react";
import type { ReactNode } from "react";

const PAGE_SIZE = 15;

/** The visible slice and page count for a paged table. Pure, for tests. */
export function pageWindow(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const start = page * size;
  return { pages, start, end: Math.min(start + size, total) };
}

/** Client-side pagination for modal tables: renders a slice and a pager row. */
export function Paged<T>({
  items,
  children,
}: {
  items: T[];
  children: (slice: T[], start: number) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const { start, end } = pageWindow(items.length, page - 1, PAGE_SIZE);
  return (
    <div>
      {children(items.slice(start, end), start)}
      <Pagination
        page={page}
        setPage={setPage}
        perPage={PAGE_SIZE}
        totalCount={items.length}
        className="mt-4"
      >
        <Pagination.Info className="grow" />
        <Pagination.Controls controls="simple" />
      </Pagination>
    </div>
  );
}
