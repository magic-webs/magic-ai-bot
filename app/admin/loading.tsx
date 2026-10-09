import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";

export default function AdminLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
