"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { customRangeError, periodQuery, TABS, type Period, type Tab } from "@/lib/reports/period";

const href = (p: Pick<Period, "range" | "from" | "to" | "tab">, extra?: Record<string, string>) => {
  const q = periodQuery(p, extra);
  return q ? `/dashboard/reports?${q}` : "/dashboard/reports";
};

const SEG =
  "press flex min-h-11 flex-auto items-center justify-center whitespace-nowrap px-2 text-[14px] font-semibold touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-deep";

/** Today · This week · This month · Pick dates. Today is the default. The change is instant: no sliding indicator. */
export function PeriodControl({ period, today, firstOrderDay }: { period: Period; today: string; firstOrderDay: string | null }) {
  const router = useRouter();
  const [picking, setPicking] = useState(period.range === "custom");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [error, setError] = useState<string | null>(null);
  const items: { key: "today" | "week" | "month"; label: string; short?: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This week" },
    { key: "month", label: "This month", short: "Month" },
  ];
  const cls = (on: boolean) => `${SEG} ${on ? "bg-teal-deep text-white" : "bg-paper text-ink"}`;
  const show = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = customRangeError(from, to, today, firstOrderDay);
    setError(bad);
    if (!bad) router.replace(href({ range: "custom", from, to, tab: period.tab }), { scroll: false });
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div role="group" aria-label="Period" className="flex overflow-hidden rounded-full ring-[1.5px] ring-sand-deep ring-inset max-[599px]:w-full min-[600px]:w-[440px]">
        {items.map((i) => (
          <Link
            key={i.key}
            href={href({ range: i.key, from: period.from, to: period.to, tab: period.tab })}
            replace
            scroll={false}
            aria-current={!picking && period.range === i.key ? "true" : undefined}
            onClick={() => setPicking(false)}
            className={cls(!picking && period.range === i.key)}
          >
            {i.short ? (<><span className="max-[359px]:hidden">{i.label}</span><span className="min-[360px]:hidden">{i.short}</span></>) : i.label}
          </Link>
        ))}
        <button type="button" aria-pressed={picking} onClick={() => setPicking(true)} className={cls(picking)}>
          Pick dates
        </button>
      </div>
      {picking && (
        <form onSubmit={show} className="flex flex-col gap-2" noValidate>
          <div className="grid grid-cols-2 gap-2.5 min-[600px]:max-w-[440px]">
            {([["From", from, setFrom], ["To", to, setTo]] as const).map(([label, v, set]) => (
              <label key={label} className="flex flex-col gap-1 text-[13px] font-semibold text-ink-soft">
                {label}
                <input
                  type="date"
                  value={v}
                  min={firstOrderDay ?? undefined}
                  max={today}
                  onChange={(e) => set(e.target.value)}
                  className="min-h-11 w-full min-w-0 rounded-[10px] border border-line-deep bg-paper px-3 text-base font-medium text-ink"
                />
              </label>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px] font-semibold text-coral-ink">{error}</p>}
          <button type="submit" className="press min-h-11 rounded-full bg-teal-deep px-6 text-[15px] font-bold text-white touch-manipulation min-[600px]:self-start max-[599px]:w-full">
            Show
          </button>
        </form>
      )}
    </div>
  );
}

async function download(section: string, period: Period) {
  const q = new URLSearchParams({ section });
  if (period.range === "custom") {
    q.set("from", period.from);
    q.set("to", period.to);
  } else if (period.range !== "today") q.set("range", period.range);
  const res = await fetch(`/dashboard/reports/export?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `dausis-plate-${section}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const TAB_LABEL: Record<Tab, string> = { sales: "Sales & money", dishes: "Dishes", times: "Busy times", delivery: "Delivery & tables", ratings: "Ratings", promos: "Promos & ads" };

/** The tab strip: scrolls sideways in its own row, the open tab scrolls into view, an edge fade while there is more. */
export function TabStrip({ period }: { period: Period }) {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [period.tab]);
  return (
    <nav aria-label="Report sections" className="relative">
      <div ref={strip} className="rpt-strip -mx-4 flex gap-1.5 overflow-x-auto px-4 min-[600px]:mx-0 min-[600px]:px-0">
        {TABS.map((t) => {
          const on = period.tab === t;
          return (
            <Link
              key={t}
              href={href({ ...period, tab: t })}
              replace
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`press flex min-h-11 shrink-0 snap-start items-center rounded-full px-4 text-[15px] font-semibold whitespace-nowrap touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-deep ${on ? "bg-teal-deep text-white" : "bg-paper text-ink ring-[1.5px] ring-sand-deep ring-inset"}`}
            >
              {TAB_LABEL[t]}
            </Link>
          );
        })}
      </div>
      {more && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-cream to-transparent min-[600px]:hidden" />}
    </nav>
  );
}

/** Export CSV: "Preparing…" while the file is made, then the button again. Shown as an icon on phones. */
export function ExportButton({ section, period, className = "" }: { section: string; period: Period; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const go = async () => {
    setState("busy");
    try {
      await download(section, period);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className={`flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={go}
        disabled={state === "busy"}
        aria-label={state === "busy" ? "Preparing the file" : "Export CSV"}
        className="press inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-ink ring-[1.5px] ring-sand-deep ring-inset touch-manipulation select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep disabled:opacity-60 min-[600px]:px-4"
      >
        <DownloadIcon size={18} />
        <span className="max-[599px]:sr-only">{state === "busy" ? "Preparing…" : "Export CSV"}</span>
      </button>
      {state === "failed" && <span role="alert" className="text-[13px] font-semibold text-coral-ink">Couldn’t make the file. Try again</span>}
    </span>
  );
}

/** "Orders (CSV)" and "Credit notes (CSV)" style links that download one file. */
export function DownloadLink({ section, period, children }: { section: string; period: Period; children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const run = async () => {
    setState("busy");
    try {
      await download(section, period);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="flex flex-col items-start">
      <button type="button" onClick={run} disabled={state === "busy"} className="press min-h-11 rounded-full px-1 text-[14px] font-semibold text-teal-deep touch-manipulation focus-visible:outline-2 focus-visible:outline-teal-deep disabled:opacity-60">
        {state === "busy" ? "Preparing…" : children}
      </button>
      {state === "failed" && <span role="alert" className="text-[13px] font-semibold text-coral-ink">Couldn’t make the file. Try again</span>}
    </span>
  );
}
