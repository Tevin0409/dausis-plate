"use client";
import { useState, useTransition } from "react";
import { adAction } from "@/app/dashboard/promos/actions";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { NeighbourAd } from "@/components/shop/neighbour-ad";
import { ctl, primary } from "@/components/ui-classes";
import { PageNote } from "@/components/ui-parts";
import type { LiveAd } from "@/lib/ads";
import {
  AD_ACTION_LABEL,
  SPACE_HEAD,
  SPACE_SHORT,
  STATUS_LABEL,
  STATUS_TONE,
  count,
  dateRange,
  priceLabel,
  rowAction,
  shortDate,
  type AdRow,
  type AdSpace,
  type AdStatus,
} from "@/lib/promos";
import { AdSheet } from "./ad-sheet";

const PAGE = 20;
const SPACES: AdSpace[] = ["menu", "order"];

/** The customer card's data from a row, for the previews. */
export function asPreview(a: Pick<AdRow, "id" | "space" | "advertiser" | "line" | "place" | "link_label" | "link_url" | "logo_url">): LiveAd {
  const tel = a.link_url.startsWith("tel:");
  return {
    id: a.id,
    space: a.space,
    advertiser: a.advertiser,
    line: a.line,
    place: a.place,
    link_label: a.link_label,
    link_kind: tel ? "tel" : "web",
    link_tel: tel ? a.link_url.slice(4) : null,
    logo_url: a.logo_url,
  };
}

export function StatusPill({ status }: { status: AdStatus }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

type Open = { id: string | null; confirm: boolean; seq: number };

/** The Neighbour ads tab: the two space cards, New ad, and every ad (spec 2.11). */
export function AdsTab({ ads, today }: { ads: AdRow[]; today: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [visible, setVisible] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  const show = (id: string | null, confirm = false) => {
    setOpen((o) => ({ id, confirm, seq: (o?.seq ?? 0) + 1 }));
    setVisible(true);
  };
  const ad = open?.id ? ads.find((a) => a.id === open.id) ?? null : null;

  return (
    <section aria-label="Neighbour ads" className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 min-[768px]:grid-cols-2">
        {SPACES.map((s) => (
          <SpaceCard key={s} space={s} ads={ads} />
        ))}
      </div>

      <button type="button" onClick={() => show(null)} className={`${primary} w-full min-[600px]:w-auto min-[600px]:self-start`}>
        New ad
      </button>
      {note && <PageNote text={note.text} tone={note.tone} />}

      {ads.length === 0 ? (
        <p className="rounded-[18px] bg-paper p-5 text-[15px] text-ink-soft ring-1 ring-sand">
          No ads yet. Neighbours pay you an agreed price to show a small card to your dine-in and pickup customers.
        </p>
      ) : (
        <AdList ads={ads.slice(0, shown)} onOpen={show} onNote={setNote} />
      )}
      {ads.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${ctl} min-h-11 self-center rounded-[var(--r-sm)] px-3 text-[15px] font-semibold text-teal-deep`}>
          Show {Math.min(PAGE, ads.length - shown)} more
        </button>
      )}

      {open && (open.id === null || ad) && (
        <AdSheet
          key={open.seq}
          open={visible}
          ad={ad}
          ads={ads}
          today={today}
          askApprove={open.confirm}
          onClose={() => setVisible(false)}
          onDone={(text) => (setNote({ text, tone: "info" }), setVisible(false))}
        />
      )}
    </section>
  );
}

function SpaceCard({ space, ads }: { space: AdSpace; ads: AdRow[] }) {
  const here = ads.filter((a) => a.space === space);
  const live = here.find((a) => a.status === "live");
  const next = here.filter((a) => a.status === "scheduled").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return (
    <article aria-labelledby={`space-${space}`} className="flex flex-col gap-3 rounded-[18px] bg-paper p-4 ring-1 ring-sand min-[600px]:p-5">
      <h2 id={`space-${space}`} className="text-[17px] font-semibold text-ink">
        {SPACE_HEAD[space]}
      </h2>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft">Now</span>
        {live ? (
          <>
            <NeighbourAd ad={asPreview(live)} preview className="bg-cream" />
            <p className="text-[14px] text-ink-soft">
              Live until {shortDate(live.ends_on)} · {live.price_kes ? `${priceLabel(live.price_kes)} for the run` : priceLabel(live.price_kes)}
            </p>
          </>
        ) : (
          <p className="text-[15px] text-ink-soft">Empty. No ad is showing here.</p>
        )}
      </div>
      {next.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-sand pt-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft">Next</span>
          <ul className="flex flex-col gap-1">
            {next.map((a) => (
              <li key={a.id} className="text-[14px] text-ink [overflow-wrap:anywhere]">
                {a.advertiser} · {dateRange(a.starts_on, a.ends_on)} · Scheduled
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

type ListProps = { ads: AdRow[]; onOpen: (id: string, confirm?: boolean) => void; onNote: (n: { text: string; tone: "info" | "error" }) => void };

/** Newest first. A table from 600 px, cards below; tapping a row opens the ad. */
function AdList({ ads, onOpen, onNote }: ListProps) {
  return (
    <div className="overflow-hidden rounded-[18px] bg-paper ring-1 ring-sand">
      <table className="hidden w-full border-collapse text-left text-[14px] min-[600px]:table">
        <thead>
          <tr className="border-b border-sand text-[13px] text-ink-soft">
            <th scope="col" className="px-4 py-3 font-semibold">Advertiser</th>
            <th scope="col" className="px-3 py-3 font-semibold">Space</th>
            <th scope="col" className="px-3 py-3 font-semibold">Dates</th>
            <th scope="col" className="px-3 py-3 font-semibold">Price</th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">Views</th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">Taps</th>
            <th scope="col" className="px-4 py-3"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {ads.map((a) => (
            <tr key={a.id} onClick={() => onOpen(a.id)} className="cursor-pointer border-t border-sand first:border-t-0 hover:bg-cream">
              <td className="px-4 py-2">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={(e) => (e.stopPropagation(), onOpen(a.id))}
                    className={`${ctl} min-h-11 min-w-0 rounded-[var(--r-sm)] text-left text-[15px] font-semibold text-ink [overflow-wrap:anywhere]`}
                  >
                    {a.advertiser}
                  </button>
                  <StatusPill status={a.status} />
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{SPACE_SHORT[a.space]}</td>
              <td className="px-3 py-2 whitespace-nowrap">{dateRange(a.starts_on, a.ends_on)}</td>
              <td className={`px-3 py-2 whitespace-nowrap tabular-nums ${a.price_kes === null ? "text-ink-soft" : ""}`}>{priceLabel(a.price_kes)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{count(a.views)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{count(a.taps)}</td>
              <td className="px-4 py-2 text-right">
                <RowAction ad={a} onOpen={onOpen} onNote={onNote} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col min-[600px]:hidden">
        {ads.map((a) => (
          <li key={a.id} className="flex items-start gap-3 border-t border-sand px-4 py-3 first:border-t-0">
            <button type="button" onClick={() => onOpen(a.id)} className={`${ctl} flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--r-sm)] text-left`}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{a.advertiser}</span>
                <StatusPill status={a.status} />
              </span>
              <span className="text-[13px] text-ink-soft">
                {SPACE_SHORT[a.space]} · {dateRange(a.starts_on, a.ends_on)} · <span className="whitespace-nowrap">{priceLabel(a.price_kes)}</span>
              </span>
              <span className="text-[13px] text-ink-soft tabular-nums">
                {count(a.views)} {a.views === 1 ? "view" : "views"} · {count(a.taps)} {a.taps === 1 ? "tap" : "taps"}
              </span>
            </button>
            <RowAction ad={a} onOpen={onOpen} onNote={onNote} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Approve opens the ad on its confirm (the preview first); Pause and Resume act at once. */
function RowAction({ ad, onOpen, onNote }: { ad: AdRow } & Omit<ListProps, "ads">) {
  const action = rowAction(ad.status);
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();
  if (!action) return null;
  const run = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === "approve") return onOpen(ad.id, true);
    if (pending) return;
    start(async () => {
      const r = await adAction(ad.id, action);
      if (r.ok) return onNote({ text: action === "pause" ? `Paused ${ad.advertiser}. It isn’t showing now.` : `${ad.advertiser} is showing again.`, tone: "info" });
      onNote({ text: r.error, tone: "error" });
      if (r.stale) reportRefusal(r.error);
    });
  };
  return (
    <button
      type="button"
      onClick={run}
      aria-disabled={pending || undefined}
      aria-label={`${AD_ACTION_LABEL[action]} ${ad.advertiser}`}
      className={`${ctl} inline-flex min-h-11 shrink-0 items-center rounded-[var(--r-sm)] bg-paper px-4 text-[14px] font-semibold text-teal-deep ring-1 ring-sand-deep ring-inset aria-disabled:opacity-60`}
    >
      {pending ? `${action === "pause" ? "Pausing" : "Resuming"}…` : AD_ACTION_LABEL[action]}
    </button>
  );
}
