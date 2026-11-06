import { Bone, Loading } from "@/components/states";

/** Static menu skeleton: header, today's cards, then the regular list. No shimmer. */
export default function ShopLoading() {
  return (
    <Loading label="Loading the menu" className="flex flex-col gap-4 pt-4">
      <div className="flex items-center gap-2.5 px-5">
        <Bone className="size-10 rounded-full" />
        <Bone className="h-6 w-36 rounded-lg" />
      </div>
      <Bone className="mx-5 mt-2 h-8 w-4/5 rounded-lg" />
      <div className="flex gap-3 overflow-hidden px-5">
        <Bone className="h-[250px] w-[250px] flex-none rounded-[22px]" />
        <Bone className="h-[250px] w-[250px] flex-none rounded-[22px]" />
      </div>
      <div className="flex flex-col gap-3 px-5 pt-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3.5">
            <Bone className="size-[68px] flex-none rounded-2xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Bone className="h-4 w-3/5 rounded" />
              <Bone className="h-3 w-4/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}
