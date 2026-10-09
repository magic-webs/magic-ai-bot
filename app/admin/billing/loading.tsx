import {
  PageHeaderSkeleton,
  StatTilesSkeleton,
  TableSkeleton,
} from "@/components/skeletons";

export default function BillingLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <PageHeaderSkeleton />
      <StatTilesSkeleton count={3} className="lg:grid-cols-3" />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
