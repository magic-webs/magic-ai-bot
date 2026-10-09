import {
  PageHeaderSkeleton,
  StatTilesSkeleton,
  TableSkeleton,
} from "@/components/skeletons";

export default function SubscriptionsLoading() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <PageHeaderSkeleton />
      <StatTilesSkeleton
        count={6}
        className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6"
      />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
