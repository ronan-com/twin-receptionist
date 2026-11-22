import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./primitives";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right";
  /** Hide the column below this breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  width?: string;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  pageSize = 25,
  dense,
  className,
  selectedKey,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode; icon?: React.ComponentType<{ className?: string }> };
  pageSize?: number;
  dense?: boolean;
  className?: string;
  selectedKey?: string | null;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pages - 1) setPage(0);
  }, [pages, page]);
  useEffect(() => {
    setPage(0);
  }, [rows.length]);

  const slice = useMemo(() => rows.slice(page * pageSize, page * pageSize + pageSize), [rows, page, pageSize]);
  const cellPad = dense ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline bg-[linear-gradient(180deg,#f8fafd,#f3f6fa)]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-left text-[11.5px] font-semibold text-ink-muted",
                    c.align === "right" && "text-right",
                    c.hideBelow && HIDE[c.hideBelow],
                    c.headerClassName,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                  <tr key={i} className="border-b border-hairline last:border-b-0">
                    {columns.map((c) => (
                      <td key={c.key} className={cn(cellPad, c.hideBelow && HIDE[c.hideBelow])}>
                        <Skeleton className="h-4 w-full max-w-[140px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : slice.map((row) => {
                  const k = rowKey(row);
                  const selected = selectedKey != null && selectedKey === k;
                  return (
                    <tr
                      key={k}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-selected={selected || undefined}
                      className={cn(
                        "row-hover border-b border-hairline last:border-b-0",
                        onRowClick && "cursor-pointer outline-none focus-visible:bg-[color-mix(in_srgb,var(--indigo)_7%,#fff)] focus-visible:shadow-[inset_3px_0_0_var(--indigo)]",
                        selected && "bg-[color-mix(in_srgb,var(--indigo)_8%,#fff)] shadow-[inset_3px_0_0_var(--indigo)]",
                        rowClassName?.(row),
                      )}
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(cellPad, "align-middle text-ink", c.align === "right" && "text-right tabular-nums", c.hideBelow && HIDE[c.hideBelow], c.className)}
                        >
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState compact icon={empty?.icon as never} title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} />
      ) : null}
      {!loading && rows.length > pageSize ? (
        <div className="flex items-center justify-between border-t border-hairline px-3 py-2 text-[12px] text-ink-muted">
          <span className="tabular-nums">
            {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] border border-hairline bg-white text-ink hover:bg-canvas-2 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] border border-hairline bg-white text-ink hover:bg-canvas-2 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Toolbar helpers ---------------- */

export function TableToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5", className)}>{children}</div>;
}
