"use client";
import Image from "next/image";
import { ClockIcon, TableIcon } from "@/components/icons";
import { bandStatus, menuNotice } from "@/lib/kitchen";
import { useCart } from "../cart-provider";
import { useKitchen } from "../kitchen-provider";

/** "Kilimani, Lavington, Westlands and CBD". */
const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Splits "Closed now. Opens …" into its first sentence and the rest. */
const firstSentence = (text: string) => {
  const i = text.indexOf(". ");
  return i < 0 ? { lead: text, rest: "" } : { lead: text.slice(0, i + 1), rest: text.slice(i + 2) };
};

/**
 * The band (spec-2.8 "The band"; DESIGN.md menu order): teal deep, 28 px bottom corners, not sticky.
 * Closed means the table is gone: no chip, no "Karibu, Table 4", no table line.
 */
export function MenuBand({ dayName, address, zones }: { dayName: string; address: string | null; zones: string[] }) {
  const { status, open, now } = useKitchen();
  const { table: savedTable } = useCart();
  const table = open ? savedTable : null;
  const s = bandStatus(status);
  const notice = menuNotice(status, now());
  const where = table
    ? "We bring it to your table. Pay at the table or by M-Pesa."
    : [address ? `Pickup on ${address}` : "Pickup", zones.length > 0 ? `or delivery to ${list(zones)}` : null].filter(Boolean).join(", ") + ".";

  return (
    <header className="rounded-b-[28px] bg-teal-deep text-white">
      <div className="mx-auto max-w-[1264px] px-5 pb-[22px] pt-[calc(14px+env(safe-area-inset-top,0px))] lg:px-8 lg:pb-[26px] lg:pt-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/dausis-plate-icon.svg" alt="" width={44} height={44} priority className="size-10 lg:size-11" />
            <div className="flex flex-col leading-none">
              <span className="font-display text-[22px]">Dausis Plate</span>
              <span className="mt-0.5 font-script text-[17px] text-blush">Mama’s Flavour</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-on-teal-soft">
            <p>
              <strong className="font-semibold text-white">{s.lead}</strong>
              {s.rest && <> · {s.rest}</>}
            </p>
            {table && (
              <span className="flex h-9 items-center gap-1.5 rounded-full bg-white/[.14] px-3 font-semibold text-white ring-1 ring-white/[.28]">
                <TableIcon size={16} />
                {table.label}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:mt-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="font-script text-[30px] leading-none text-blush">{table ? `Karibu, ${table.label}` : "Karibu"}</p>
            <h1 className="mt-1 font-display text-[32px] leading-tight lg:text-[40px]">{dayName}’s menu</h1>
            <p className="mt-1 text-sm text-on-teal-soft">{where}</p>
          </div>
          <div role="status" className="lg:max-w-[420px]">
            {notice?.tone === "closed" && (
              <div className="flex gap-3 rounded-[var(--r-md)] bg-teal-deeper p-4">
                <ClockIcon size={20} className="mt-1 flex-none text-blush" />
                <p className="text-sm leading-snug text-on-teal-soft">
                  <span className="block font-display text-[22px] leading-tight text-white">{firstSentence(notice.text).lead}</span>
                  {firstSentence(notice.text).rest}
                </p>
              </div>
            )}
            {notice?.tone === "quiet" && <p className="text-sm font-semibold text-white">{notice.text}</p>}
          </div>
        </div>
      </div>
    </header>
  );
}
