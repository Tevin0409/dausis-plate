"use client";
import { useState } from "react";
import { Segments } from "@/components/ui-parts";
import type { AdRow, CodeRow, ComboRow } from "@/lib/promos";
import { AdsTab } from "./ads-tab";
import { CodesCard } from "./codes-card";
import { CombosCard, type ComboDish } from "./combos-card";
import { PicksCard, type PickDish } from "./picks-card";

type Tab = "ads" | "promos";

/** The two tabs (instant). The URL keeps the tab (`?tab=promos`) without a round trip. */
export function PromosView({
  initialTab,
  ads,
  dishes,
  combos,
  codes,
  today,
}: {
  initialTab: Tab;
  ads: AdRow[];
  dishes: (PickDish & ComboDish)[];
  combos: ComboRow[];
  codes: CodeRow[];
  today: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  function pick(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "promos") url.searchParams.set("tab", "promos");
    else url.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <>
      <div className="w-full min-[600px]:max-w-[360px]">
        <Segments<Tab>
          label="Show"
          value={tab}
          options={[
            ["ads", "Neighbour ads"],
            ["promos", "Your promos"],
          ]}
          onChange={pick}
        />
      </div>
      {tab === "ads" ? (
        <AdsTab ads={ads} today={today} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <PicksCard dishes={dishes} />
          <CombosCard combos={combos} dishes={dishes} />
          <div className="xl:col-span-2">
            <CodesCard codes={codes} today={today} />
          </div>
        </div>
      )}
    </>
  );
}
