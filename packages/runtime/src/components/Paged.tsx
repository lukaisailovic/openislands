import { Button, Text } from "@cloudflare/kumo";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
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
  const [page, setPage] = useState(0);
  const { pages, start, end } = pageWindow(items.length, page, PAGE_SIZE);
  return (
    <div>
      {children(items.slice(start, end), start)}
      <div className="mt-4 flex items-center justify-between">
        <Text variant="secondary" size="xs">
          {start + 1}–{end} of {items.length}
        </Text>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <CaretLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            aria-label="Next page"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <CaretRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
