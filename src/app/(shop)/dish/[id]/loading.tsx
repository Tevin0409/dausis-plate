import { Bone, Loading } from "@/components/states";

export default function DishLoading() {
  return (
    <Loading label="Loading the dish">
      <Bone className="h-[290px] w-full" />
      <div className="flex flex-col gap-3 px-5 pt-[22px]">
        <Bone className="h-8 w-3/4 rounded-lg" />
        <Bone className="h-4 w-full rounded" />
        <Bone className="h-4 w-2/3 rounded" />
        <Bone className="mt-4 h-14 w-full rounded-[18px]" />
      </div>
    </Loading>
  );
}
