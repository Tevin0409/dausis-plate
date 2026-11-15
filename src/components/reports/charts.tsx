"use client";
// Hand-built SVG charts for Reports (spec-2.12 "Charts"). One colour per chart, a tooltip on hover, tap and
// arrow keys, selective labels, and a "Show as table" swap on every chart. No chart library.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type Datum = { key: string; label: string; value: number; tip: string; short?: string };
export type Tone = "teal" | "coral" | "amber";
const FILL: Record<Tone, string> = { teal: "var(--color-teal)", coral: "var(--color-coral)", amber: "var(--color-amber)" };

/** The width of an element, kept current. Charts draw at real pixels so bars are exact and never overflow. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A round upper bound for the y axis with 3 to 4 gridlines (steps of 1, 2, 2.5, 5 times a power of ten). */
export function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= raw)!;
  return { max: Math.round(Math.ceil(v / step) * step * 1e6) / 1e6, step };
}
const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n < 10 ? +n.toFixed(2) : Math.round(n * 10) / 10));

/** Tooltip over a chart, clamped inside the card. Fades in with a 2 px rise (.rpt-tip); moves bar to bar without re-entering. */
function Tip({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const half = 100;
  const left = Math.min(Math.max(x, half), Math.max(half, width - half));
  return (
    <div
      role="presentation"
      className="rpt-tip pointer-events-none absolute z-10 w-max max-w-[200px] -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-[13px] leading-snug font-medium text-white tabular-nums shadow-md"
      style={{ left, top: Math.max(y - 6, 0) }}
    >
      {text}
    </div>
  );
}

/**
 * Vertical bars from zero. The whole slot (full height, full width) is the hit area. One Tab stop;
 * arrow keys move between bars, Home and End jump, and the value is announced in a live region.
 */
export function BarChart({ data, tone = "teal", height = 180, title }: { data: Datum[]; tone?: Tone; height?: number; title: string }) {
  const [box, w] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const live = useId();
  const padL = 34;
  const padB = 22;
  const padT = 10;
  const plotW = Math.max(w - padL - 4, 10);
  const plotH = height - padB - padT;
  const n = data.length;
  const slot = n ? plotW / n : plotW;
  const gap = slot > 8 ? 2 : 1;
  const barW = Math.max(slot - gap, 1);
  const top = Math.max(...data.map((d) => d.value), 0);
  const { max, step } = niceMax(top);
  const lines = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
  const hi = top > 0 ? data.findIndex((d) => d.value === top) : -1;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 48))));
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!n) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowLeft" || k === "Home" || k === "End") {
        e.preventDefault();
        setActive((a) => (k === "Home" ? 0 : k === "End" ? n - 1 : Math.min(n - 1, Math.max(0, (a ?? (k === "ArrowRight" ? -1 : n)) + (k === "ArrowRight" ? 1 : -1)))));
      } else if (k === "Escape") setActive(null);
    },
    [n],
  );

  return (
    <div
      ref={box}
      className="relative w-full touch-manipulation select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
      tabIndex={0}
      role="group"
      aria-label={`${title}. Use the arrow keys to move between bars.`}
      aria-describedby={live}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
    >
      <span id={live} role="status" aria-live="polite" className="sr-only">{active !== null ? data[active]?.tip : ""}</span>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden="true" className="block">
          {lines.map((v) => (
            <g key={v}>
              <line x1={padL} x2={w - 4} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-soft)" className="tabular-nums">{compact(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * slot;
            const h = d.value > 0 ? Math.max((d.value / max) * plotH, 2) : 0;
            const label = i % every === 0 || i === n - 1;
            const crowd = i === n - 1 && i % every !== 0 && i - Math.floor(i / every) * every < every * 0.6;
            return (
              <g key={d.key}>
                {h > 0 && <path d={roundTop(x + gap / 2, padT + plotH - h, barW, h, Math.min(4, barW / 2))} fill={FILL[tone]} opacity={active === null || active === i ? 1 : 0.55} />}
                {label && !crowd && (
                  <text x={x + slot / 2} y={height - 5} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">{d.short ?? d.label}</text>
                )}
                {i === hi && d.value > 0 && (
                  <text x={x + slot / 2} y={padT + plotH - h - 4} textAnchor={i > n - 3 ? "end" : "middle"} fontSize={12} fontWeight={700} fill="var(--color-ink)" className="tabular-nums">{compact(d.value)}</text>
                )}
                <rect x={x} y={padT} width={slot} height={plotH} fill="transparent" onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)} onPointerDown={(e) => setActive((a) => (e.pointerType !== "mouse" && a === i ? null : i))} />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && data[active] && w > 0 && (
        <Tip x={padL + active * slot + slot / 2} y={y(data[active]!.value)} width={w} text={data[active]!.tip} />
      )}
    </div>
  );
}

/**
 * A line on a fixed axis (Ratings by week: 1 to 5 stars). One point per slot; a slot with no value is a
 * gap in the line, never a zero. Same hit areas, keys and live region as BarChart.
 */
export function LineChart({ data, tone = "amber", height = 180, title, min = 1, max = 5 }: {
  data: (Omit<Datum, "value"> & { value: number | null })[];
  tone?: Tone;
  height?: number;
  title: string;
  min?: number;
  max?: number;
}) {
  const [box, w] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const live = useId();
  const padL = 34;
  const padR = 10;
  const padB = 22;
  const padT = 14;
  const plotW = Math.max(w - padL - padR, 10);
  const plotH = height - padB - padT;
  const n = data.length;
  const slot = n ? plotW / n : plotW;
  const lines = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const x = (i: number) => padL + i * slot + slot / 2;
  const y = (v: number) => padT + plotH - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * plotH;
  // Runs of weeks with a value; each run is one path, so an empty week breaks the line.
  const runs: number[][] = [];
  data.forEach((d, i) => {
    if (d.value === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  });
  let latest = -1;
  for (let i = n - 1; i >= 0; i--) if (data[i]!.value !== null) { latest = i; break; }

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!n) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowLeft" || k === "Home" || k === "End") {
        e.preventDefault();
        setActive((a) => (k === "Home" ? 0 : k === "End" ? n - 1 : Math.min(n - 1, Math.max(0, (a ?? (k === "ArrowRight" ? -1 : n)) + (k === "ArrowRight" ? 1 : -1)))));
      } else if (k === "Escape") setActive(null);
    },
    [n],
  );

  const at = active !== null ? data[active] : undefined;
  return (
    <div
      ref={box}
      className="relative w-full touch-manipulation select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
      tabIndex={0}
      role="group"
      aria-label={`${title}. Use the arrow keys to move between weeks.`}
      aria-describedby={live}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
    >
      <span id={live} role="status" aria-live="polite" className="sr-only">{at?.tip ?? ""}</span>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden="true" className="block">
          {lines.map((v) => (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-soft)" className="tabular-nums">{v}</text>
            </g>
          ))}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + plotH} stroke="var(--color-sand-deep)" strokeWidth={1} />}
          {runs.filter((r) => r.length > 1).map((r) => (
            <polyline key={r[0]} points={r.map((i) => `${x(i)},${y(data[i]!.value!)}`).join(" ")} fill="none" stroke={FILL[tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {data.map((d, i) => {
            const label = i % every === 0 || i === n - 1;
            const crowd = i === n - 1 && i % every !== 0 && i - Math.floor(i / every) * every < every * 0.6;
            return (
              <g key={d.key}>
                {label && !crowd && <text x={x(i)} y={height - 5} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">{d.short ?? d.label}</text>}
                {d.value !== null && <circle cx={x(i)} cy={y(d.value)} r={active === i ? 5.5 : 4} fill={FILL[tone]} stroke="var(--color-paper)" strokeWidth={2} />}
                {i === latest && d.value !== null && active === null && (
                  <text x={x(i)} y={y(d.value) - 9} textAnchor={i > n - 2 && n > 1 ? "end" : "middle"} fontSize={12} fontWeight={700} fill="var(--color-ink)" className="tabular-nums">{d.value.toFixed(1)}</text>
                )}
                <rect x={padL + i * slot} y={0} width={slot} height={padT + plotH} fill="transparent" onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)} onPointerDown={(e) => setActive((a) => (e.pointerType !== "mouse" && a === i ? null : i))} />
              </g>
            );
          })}
        </svg>
      )}
      {at && w > 0 && <Tip x={x(active!)} y={at.value === null ? padT + plotH / 2 : y(at.value)} width={w} text={at.tip} />}
    </div>
  );
}

/** A rect with only the data end (the top) rounded, anchored on the baseline. */
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Horizontal bars with the value at the end of each; few rows, so every one carries its label. */
export function HBarChart({ data, tone = "teal", title }: { data: (Datum & { end: string })[]; tone?: Tone; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const live = useId();
  const max = Math.max(...data.map((d) => d.value), 1);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.min(data.length - 1, Math.max(0, (a ?? (e.key === "ArrowDown" ? -1 : data.length)) + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Escape") setActive(null);
  };
  return (
    <div
      className="relative flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
      tabIndex={0}
      role="group"
      aria-label={`${title}. Use the arrow keys to move between bars.`}
      aria-describedby={live}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <span id={live} role="status" aria-live="polite" className="sr-only">{active !== null ? data[active]?.tip : ""}</span>
      {data.map((d, i) => (
        <div key={d.key} className="relative grid grid-cols-[minmax(72px,30%)_1fr] items-center gap-x-2.5 min-[480px]:grid-cols-[120px_1fr]" onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)} onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)} onPointerDown={(e) => setActive((a) => (e.pointerType !== "mouse" && a === i ? null : i))}>
          <span className="text-[14px] leading-tight font-medium [overflow-wrap:anywhere]">{d.label}</span>
          <div className="flex min-h-7 items-center gap-2">
            <div className="h-5 min-w-[3px] rounded-r-[4px]" style={{ width: `calc((100% - 120px) * ${d.value / max})`, background: FILL[tone], opacity: active === null || active === i ? 1 : 0.55 }} />
            <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">{d.end}</span>
          </div>
          {active === i && (
            <div role="presentation" className="rpt-tip pointer-events-none absolute right-0 bottom-full z-10 mb-0.5 w-max max-w-[220px] rounded-lg bg-ink px-2.5 py-1.5 text-[13px] leading-snug font-medium text-white tabular-nums shadow-md">{d.tip}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Weekday rows by hour columns on one coral ramp, with its legend. Cells are focusable by arrow keys too. */
export function HeatGrid({ cells, hours, weekdays, title }: { cells: { weekday: number; hour: number; avg: number; tip: string }[]; hours: number[]; weekdays: { n: number; label: string }[]; title: string }) {
  const [active, setActive] = useState<string | null>(null);
  const first = weekdays[0] && hours[0] !== undefined ? `${weekdays[0].n}-${hours[0]}` : "";
  const [roving, setRoving] = useState(first); // one Tab stop; arrow keys move it
  const grid = useRef<HTMLDivElement>(null);
  const live = useId();
  const max = Math.max(...cells.map((c) => c.avg), 0.0001);
  const onKey = (e: React.KeyboardEvent) => {
    const at = (e.target as HTMLElement).dataset.k;
    if (!at) return;
    const [wd, hr] = at.split("-").map(Number) as [number, number];
    const wi = weekdays.findIndex((d) => d.n === wd);
    const hi = hours.indexOf(hr);
    const move: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Home: [0, -hi], End: [0, hours.length - 1 - hi] };
    const m = move[e.key];
    if (!m) return;
    const nw = weekdays[Math.min(Math.max(wi + m[0], 0), weekdays.length - 1)];
    const nh = hours[Math.min(Math.max(hi + m[1], 0), hours.length - 1)];
    if (!nw || nh === undefined) return;
    e.preventDefault();
    grid.current?.querySelector<HTMLButtonElement>(`[data-k="${nw.n}-${nh}"]`)?.focus();
  };
  const by = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const tip = active ? by.get(active)?.tip ?? null : null;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={title}>
      <span id={live} role="status" aria-live="polite" className="sr-only">{tip ?? ""}</span>
      <div className="relative">
        <div ref={grid} onKeyDown={onKey} className="grid gap-[2px]" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((h, i) => (
            <span key={h} className="text-center text-[11px] text-ink-soft tabular-nums">{i % 2 === 0 ? h : ""}</span>
          ))}
          {weekdays.map((d) => (
            <div key={d.n} className="contents">
              <span className="self-center text-[12px] font-medium text-ink-soft">{d.label}</span>
              {hours.map((h) => {
                const c = by.get(`${d.n}-${h}`);
                const k = `${d.n}-${h}`;
                const a = c ? 0.12 + 0.88 * (c.avg / max) : 0;
                return (
                  <button
                    key={h}
                    type="button"
                    data-k={k}
                    tabIndex={k === roving ? 0 : -1}
                    aria-label={c?.tip ?? `${d.label} ${h}:00, no orders`}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setActive(k)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
                    onFocus={() => { setActive(k); setRoving(k); }}
                    onBlur={() => setActive(null)}
                    onClick={(e) => setActive((x) => ((e.nativeEvent as PointerEvent).pointerType && (e.nativeEvent as PointerEvent).pointerType !== "mouse" && x === k ? null : k))}
                    className="h-7 min-w-0 rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-deep"
                    style={{ background: c ? `rgb(229 107 111 / ${a})` : "var(--color-mist)" }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {tip && <div role="presentation" className="rpt-tip pointer-events-none absolute -top-1 right-0 z-10 w-max max-w-[220px] -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-[13px] font-medium text-white shadow-md tabular-nums">{tip}</div>}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-ink-soft">
        <span>Fewer</span>
        <span aria-hidden="true" className="h-2.5 w-24 rounded-full" style={{ background: "linear-gradient(90deg, rgb(229 107 111 / .12), rgb(229 107 111 / 1))" }} />
        <span>More orders</span>
      </div>
    </div>
  );
}

/** An amber meter: "41 of 50". */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex min-w-[110px] flex-col gap-1">
      <div className="h-2 rounded-full bg-sand" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="h-2 rounded-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[13px] tabular-nums">{label}</span>
    </div>
  );
}

export type Col<T> = { key: string; head: string; cell: (r: T) => React.ReactNode; num?: boolean; sort?: (r: T) => number | string; sticky?: boolean; total?: React.ReactNode };

/**
 * A table that scrolls sideways inside its own card, first column sticky, "Swipe for more" until the first scroll.
 * Header taps sort instantly when a column has `sort`.
 */
export function ChartTable<T>({ cols, rows, rowKey, caption, onRow, rowLabel, defaultSort, dim, footer }: {
  cols: Col<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  caption: string;
  onRow?: (r: T) => void;
  rowLabel?: (r: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  dim?: (r: T) => boolean;
  footer?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [sort, setSort] = useState(defaultSort ?? null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const check = () => setWide(el.scrollWidth > el.clientWidth + 2 && el.scrollLeft < 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);
  const col = sort ? cols.find((c) => c.key === sort.key) : null;
  const sorted = col?.sort
    ? [...rows].sort((a, b) => {
        const x = col.sort!(a);
        const y = col.sort!(b);
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort!.dir === "asc" ? r : -r;
      })
    : rows;
  return (
    <div className="relative">
      <div ref={wrap} tabIndex={0} role="region" aria-label="Table, scrolls sideways" className="rpt-table relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-teal-deep" onScroll={() => wide && setWide(false)}>
        <table className="w-full border-collapse text-[14px] tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-[13px] text-ink-soft">
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={`border-b border-line px-3 py-0 font-semibold whitespace-nowrap ${c.num ? "text-right" : ""} ${c.sticky ? "sticky left-0 z-[1] bg-paper pl-0" : ""}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.num ? "desc" : "asc" }))} className="min-h-11 font-semibold focus-visible:outline-2 focus-visible:outline-teal-deep">
                      {c.head}{sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    <span className="inline-block py-3">{c.head}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={rowKey(r, i)} className={`border-b border-line last:border-0 ${dim?.(r) ? "opacity-60" : ""} ${onRow ? "cursor-pointer" : ""}`}>
                {cols.map((c, ci) => (
                  <td key={c.key} className={`px-3 py-2.5 align-top ${c.sticky ? "whitespace-nowrap " : ""}${c.num ? "text-right whitespace-nowrap" : ""} ${c.sticky ? "sticky left-0 z-[1] bg-paper pl-0 font-semibold" : ""}`}>
                    {onRow && ci === 0 ? (
                      <button type="button" onClick={() => onRow(r)} aria-label={rowLabel?.(r)} className="min-h-11 text-left font-semibold text-teal-deep underline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-deep [&:hover]:underline">{c.cell(r)}</button>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="border-t-2 border-line-deep font-bold">
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2.5 ${c.num ? "text-right whitespace-nowrap" : ""} ${c.sticky ? "sticky left-0 bg-paper pl-0" : ""}`}>{c.total}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {wide && <p className="pt-1.5 text-right text-[13px] font-semibold text-ink-soft">Swipe for more →</p>}
    </div>
  );
}

/** A card with a title, a chart and a "Show as table" swap, remembered per chart for the session. */
export function ChartCard({ id, title, note, chart, table, className = "" }: { id: string; title: string; note?: React.ReactNode; chart: React.ReactNode; table: React.ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`rpt-table-${id}`) === "1") setAsTable(true);
    } catch {}
  }, [id]);
  const flip = () =>
    setAsTable((v) => {
      try {
        sessionStorage.setItem(`rpt-table-${id}`, v ? "0" : "1");
      } catch {}
      return !v;
    });
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-paper p-4 min-[600px]:p-5 ${className}`}>
      <h3 className="text-base font-bold">{title}</h3>
      {note && <p className="-mt-1 text-[13px] text-ink-soft">{note}</p>}
      {asTable ? table : chart}
      <button type="button" onClick={flip} className="press -mb-1 min-h-11 self-start rounded-full px-1 text-[14px] font-semibold text-teal-deep focus-visible:outline-2 focus-visible:outline-teal-deep touch-manipulation">
        {asTable ? "Show as chart" : "Show as table"}
      </button>
    </section>
  );
}
