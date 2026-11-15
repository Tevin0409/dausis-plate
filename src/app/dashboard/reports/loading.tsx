import { Bone, Loading } from "@/components/states";

/** Skeleton in the shape of the title, tiles and the open section's cards: sand blocks, no shimmer. */
export default function ReportsLoading() {
  return (
    <Loading label="Loading the reports" className="flex max-w-[1120px] flex-col gap-4">
      <Bone className="h-10 w-48 rounded-lg" />
      <Bone className="h-11 w-full rounded-full min-[600px]:w-[440px]" />
      <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-6 min-[1024px]:grid-cols-5">
        <Bone className="col-span-2 h-[104px] rounded-[18px] min-[1024px]:col-span-1" />
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-[104px] rounded-[18px] min-[600px]:col-span-2 min-[1024px]:col-span-1" />)}
      </div>
      <Bone className="h-11 w-full rounded-full" />
      <Bone className="h-64 rounded-[18px]" />
      <Bone className="h-48 rounded-[18px]" />
    </Loading>
  );
}
