import { Bone, Loading } from "@/components/states";

/** Static page skeleton inside the dashboard shell. No shimmer. */
export default function DashboardLoading() {
  return (
    <Loading label="Loading" className="flex max-w-[1040px] flex-col gap-5">
      <Bone className="h-10 w-64 rounded-lg" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-28 rounded-[18px]" />)}
      </div>
      <Bone className="h-64 rounded-[20px]" />
    </Loading>
  );
}
