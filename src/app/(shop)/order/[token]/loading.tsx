import { Bone, Loading } from "@/components/states";

export default function OrderLoading() {
  return (
    <Loading label="Loading your order">
      <div className="flex flex-col gap-3 rounded-b-[28px] bg-teal-deep px-5 pb-[26px] pt-[22px]">
        <div className="size-10 rounded-full bg-white/15" />
        <div className="mt-3 h-8 w-3/5 rounded-lg bg-white/15" />
        <div className="h-4 w-2/5 rounded bg-white/15" />
      </div>
      <div className="mx-5 mt-6 flex flex-col gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3.5">
            <Bone className="size-7 flex-none rounded-full" />
            <Bone className="h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </Loading>
  );
}
