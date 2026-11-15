import type { LiveAd } from "@/lib/ads";
import { AdLink, AdSeen } from "./neighbour-ad-client";

/** The advertiser's first letter (a whole grapheme, so an accented or emoji start stays whole). */
function initial(name: string): string {
  const first = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(name.trim())[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toLocaleUpperCase("en-KE");
}

/**
 * "From our neighbours" (DESIGN.md "Ad placement format", spec 2.11): transparent with a sand-deep
 * ring and no shadow, so it reads as lower than a dish. No motion, ever.
 */
export function NeighbourAd({ ad, className = "", preview = false }: { ad: LiveAd; className?: string; preview?: boolean }) {
  const domId = `ad-${ad.id}`;
  return (
    <aside id={preview ? undefined : domId} aria-label={`Advert from ${ad.advertiser}`} className={`rounded-[var(--r-lg)] p-[14px] ring-1 ring-sand-deep ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft">From our neighbours</span>
        <span className="flex-none rounded-[var(--r-sm)] bg-sand px-2 py-0.5 text-[12px] font-semibold text-ink">Ad</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        {ad.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a 48 px logo already sized at upload; next/image adds nothing here
          <img src={ad.logo_url} alt="" width={48} height={48} loading="lazy" className="size-12 flex-none rounded-[var(--r-sm)] bg-sand object-cover" />
        ) : (
          <span aria-hidden="true" className="flex size-12 flex-none items-center justify-center rounded-[var(--r-sm)] bg-sand font-display text-[22px] text-ink">
            {initial(ad.advertiser)}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{ad.advertiser}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-ink-soft [overflow-wrap:anywhere]">{ad.line}</p>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        {ad.place ? <span className="min-w-0 text-[13px] text-ink-soft [overflow-wrap:anywhere]">{ad.place}</span> : <span />}
        {preview ? (
          // The dashboard's preview: the same look, nothing counted and nowhere to go.
          <span className="-mr-2 ml-auto inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-teal-deep underline underline-offset-4 [overflow-wrap:anywhere]">
            {ad.link_label}
          </span>
        ) : (
          <AdLink id={ad.id} kind={ad.link_kind} tel={ad.link_tel} label={ad.link_label} advertiser={ad.advertiser} />
        )}
      </div>
      {!preview && <AdSeen id={ad.id} domId={domId} />}
    </aside>
  );
}
