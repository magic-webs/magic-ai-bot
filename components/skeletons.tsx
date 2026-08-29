import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";

/**
 * Loading placeholders shaped like the content they stand in for.
 *
 * A centred spinner tells you something is happening but not what is coming,
 * and the page jumps when it arrives. These hold the same space the real
 * layout will take, so the content lands where the placeholder was.
 *
 * Widths vary per row on purpose: a column of identical bars reads as a
 * rendering artefact, and real titles are not all the same length.
 */

const WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-4/5", "w-3/5"];

/** Cards in a grid — agents, knowledge sources, channels, workspaces. */
export function CardGridSkeleton({
  count = 6,
  className = "sm:grid-cols-2 xl:grid-cols-3",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-3 ${className}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 shrink-0 rounded-md" />
            <Skeleton className={`h-4 ${WIDTHS[i % WIDTHS.length]}`} />
          </div>
          <div className="flex gap-1">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-1 h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A bordered table — the catalogue, orders, webhook deliveries. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="rounded-md border border-border" aria-hidden>
      <Table>
        <TableBody>
          {Array.from({ length: rows }, (_, r) => (
            <TableRow key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <TableCell key={c}>
                  {/* The first column carries a title and a subtitle in every
                      one of these tables; the rest are single values. */}
                  {c === 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <Skeleton
                        className={`h-3.5 ${WIDTHS[r % WIDTHS.length]}`}
                      />
                      <Skeleton className="h-2.5 w-full max-w-md" />
                    </div>
                  ) : (
                    <Skeleton className="h-3.5 w-16" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Stacked rows — conversations, and any plain list. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border p-3"
        >
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3.5 ${WIDTHS[i % WIDTHS.length]}`} />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** The KPI row plus the charts under it. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
          >
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4 lg:col-span-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-56 w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}
