"use client";
import { useRef, useState, useTransition } from "react";
import { adAction, deleteAd, saveAd, type AdField, type AdResult } from "@/app/dashboard/promos/actions";
import { PhotoUpload } from "@/components/dashboard/photo-upload";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { PanelHeading } from "@/components/dashboard/tables/ui";
import { NeighbourAd } from "@/components/shop/neighbour-ad";
import { ctl, danger, errorLine, field, hint, labelText, primary, quiet } from "@/components/ui-classes";
import { addDays } from "@/lib/format";
import { AD_LIMITS, SPACE_HEAD, SPACE_IN, count, linkForField, parseAdLink, shortDate, type AdRow, type AdSpace, type FeePeriod } from "@/lib/promos";
import { StatusPill, asPreview } from "./ads-tab";

const REFRESH_AFTER_REFUSAL_MS = 3000;
type Ask = null | "approve" | "delete" | "end";
type Values = {
  advertiser: string;
  line: string;
  place: string;
  link_label: string;
  link: string;
  space: AdSpace;
  starts_on: string;
  ends_on: string;
  fee_kes: string;
  fee_period: FeePeriod;
};
/** What customers see: changing any of these sends an approved ad back to Draft (the ads guard). */
const SEEN: (keyof Values)[] = ["advertiser", "line", "place", "link_label", "link", "space", "starts_on"];

function startValues(ad: AdRow | null, today: string): Values {
  if (!ad) return { advertiser: "", line: "", place: "", link_label: "", link: "", space: "menu", starts_on: today, ends_on: addDays(today, 29), fee_kes: "", fee_period: "month" };
  return {
    advertiser: ad.advertiser,
    line: ad.line,
    place: ad.place,
    link_label: ad.link_label,
    link: linkForField(ad.link_url),
    space: ad.space,
    starts_on: ad.starts_on,
    ends_on: ad.ends_on,
    fee_kes: String(ad.fee_kes),
    fee_period: ad.fee_period,
  };
}

/** New ad / Edit ad (spec 2.11): the fields, a live preview of the customer card, and the footer for its status. */
export function AdSheet({
  open,
  ad,
  ads,
  today,
  askApprove,
  onClose,
  onDone,
}: {
  open: boolean;
  ad: AdRow | null;
  ads: AdRow[];
  today: string;
  /** Opened from the list's Approve: the confirm shows at once, under the preview. */
  askApprove: boolean;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [v, setV] = useState<Values>(() => startValues(ad, today));
  const first = useRef(v);
  const [err, setErr] = useState<{ field: AdField; text: string } | null>(null);
  const [ask, setAsk] = useState<Ask>(askApprove ? "approve" : null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A new ad that saved but then failed to approve is a draft now: later saves update it, not add another.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const reportRefusal = useReportRefusal();

  const status = ad?.status ?? "draft";
  const draft = status === "draft";
  const ended = status === "ended";
  const approved = !draft && !ended;
  const seenChanged = approved && SEEN.some((k) => v[k].trim() !== first.current[k].trim());
  const name = v.advertiser.trim() || "this ad";

  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV((o) => ({ ...o, [k]: value }));
    setErr(null);
    if (ask === "approve") setAsk(null);
  };
  const fail = (r: Extract<AdResult, { ok: false }> | { ok: false; error: string; stale?: boolean; gone?: boolean }) => {
    setErr({ field: "field" in r && r.field ? r.field : "form", text: r.error });
    setAsk(null);
    if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
    if (r.gone) setTimeout(onClose, REFRESH_AFTER_REFUSAL_MS);
  };

  function submit(intent: "save" | "approve") {
    if (pending || uploading || !form.current) return;
    const data = new FormData(form.current);
    data.set("intent", intent);
    start(async () => {
      const r = await saveAd(null, data);
      if (!r.ok) {
        if (r.id && !ad) setSavedId(r.id);
        return fail(r);
      }
      if (intent === "approve") {
        const when = v.starts_on <= today ? "now" : `from ${shortDate(v.starts_on)}`;
        return onDone(`Approved. ${v.advertiser.trim()} shows ${SPACE_IN[v.space]} ${when}.`);
      }
      if (!ad) return onDone(`Saved ${v.advertiser.trim()} as a draft. Approve it when you’re ready.`);
      onDone(seenChanged ? `Saved. ${v.advertiser.trim()} is a draft again until you approve it.` : `Saved ${v.advertiser.trim()}.`);
    });
  }

  function act(kind: "delete" | "end") {
    if (pending || !ad) return;
    start(async () => {
      const r = kind === "delete" ? await deleteAd(ad.id) : await adAction(ad.id, "end");
      if (!r.ok) return fail(r);
      onDone(kind === "delete" ? `Deleted the draft from ${ad.advertiser}.` : `Ended ${ad.advertiser}. Its counts stay in the list.`);
    });
  }

  // Ask before approving: the dates must be right and the link must parse, or the server's line shows.
  function askToApprove() {
    const link = parseAdLink(v.link);
    if (!link.ok) return setErr({ field: "link", text: link.error });
    if (v.ends_on < v.starts_on) return setErr({ field: "dates", text: "The end date is before the start date." });
    setErr(null);
    setAsk("approve");
  }

  const overlap = approvedOverlap(ads, ad?.id ?? null, v);
  const preview = asPreview({
    id: ad?.id ?? "new",
    space: v.space,
    advertiser: v.advertiser.trim() || "Advertiser name",
    line: v.line.trim() || "One line about them.",
    place: v.place.trim(),
    link_label: v.link_label.trim() || "Link label",
    link_url: v.link,
    logo_url: removeLogo ? null : ad?.logo_url ?? null,
  });

  const errFor = (f: AdField) => (err?.field === f ? err.text : null);
  const busy = pending || uploading;

  const footer = ended ? null : ask === "approve" ? (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
        Show {name} {SPACE_IN[v.space]} from {shortDate(v.starts_on)} to {shortDate(v.ends_on)}?
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => submit("approve")} aria-disabled={busy || undefined} className={`${primary} flex-1 aria-disabled:opacity-60`}>
          {pending ? "Approving…" : "Approve"}
        </button>
        <button type="button" onClick={() => setAsk(null)} className={`${quiet} flex-1`}>
          Cancel
        </button>
      </div>
    </div>
  ) : ask === "delete" || ask === "end" ? (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
        {ask === "delete" ? `Delete the draft from ${name}? This can’t be undone.` : `End ${name} now? It stops showing straight away, and can’t be restarted.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => act(ask)} aria-disabled={pending || undefined} className={`${danger} flex-1 aria-disabled:opacity-60`}>
          {pending ? (ask === "delete" ? "Deleting…" : "Ending…") : ask === "delete" ? "Delete draft" : "End now"}
        </button>
        <button type="button" onClick={() => setAsk(null)} className={`${quiet} flex-1`}>
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      {errFor("form") && (
        <p role="alert" className={errorLine}>
          {errFor("form")}
        </p>
      )}
      {seenChanged && <p className={hint}>Changing what customers see makes it a draft again, until you approve it.</p>}
      <div className="flex flex-wrap gap-2">
        {draft ? (
          <>
            <button type="button" onClick={() => submit("save")} aria-disabled={busy || undefined} className={`${quiet} flex-1 aria-disabled:opacity-60`}>
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button type="button" onClick={askToApprove} aria-disabled={busy || undefined} className={`${primary} flex-1 aria-disabled:opacity-60`}>
              Approve and schedule
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => submit("save")} aria-disabled={busy || undefined} className={`${primary} flex-1 aria-disabled:opacity-60`}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setAsk("end")} className={`${quiet} flex-1 text-coral-ink`}>
              End now
            </button>
          </>
        )}
      </div>
      {draft && ad && (
        <button type="button" onClick={() => setAsk("delete")} className={`${ctl} min-h-11 self-start rounded-[var(--r-sm)] px-1 text-[15px] font-semibold text-coral-text`}>
          Delete draft
        </button>
      )}
    </div>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="ad-sheet-title" footer={footer}>
      <PanelHeading
        id="ad-sheet-title"
        title={ad ? ad.advertiser : "New ad"}
        sub={
          ad ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill status={status} />
              <span className="tabular-nums">
                This month: {count(ad.month_views)} {ad.month_views === 1 ? "view" : "views"} · {count(ad.month_taps)} {ad.month_taps === 1 ? "tap" : "taps"}
              </span>
            </span>
          ) : (
            "A draft until you approve it."
          )
        }
        onClose={onClose}
      />
      {ended && <p className="mt-4 rounded-[var(--r-sm)] bg-sand px-4 py-3 text-[15px] text-ink">This ad has ended. Its counts stay here for invoicing.</p>}

      <form
        ref={form}
        noValidate
        onSubmit={(e) => (e.preventDefault(), draft ? askToApprove() : submit("save"))}
        className="mt-5 flex flex-col gap-5 pb-2"
      >
        <fieldset disabled={ended} className="contents">
          <input type="hidden" name="id" value={ad?.id ?? savedId ?? ""} />
          <Text id="ad-advertiser" name="advertiser" label="Advertiser" value={v.advertiser} max={AD_LIMITS.advertiser} error={errFor("advertiser")} onChange={(s) => set("advertiser", s)} capitalize="words" />
          <Text
            id="ad-line"
            name="line"
            label="Line"
            value={v.line}
            max={AD_LIMITS.line}
            error={errFor("line")}
            onChange={(s) => set("line", s)}
            hintText={`${[...v.line].length} of ${AD_LIMITS.line}`}
            capitalize="sentences"
          />
          <Text id="ad-place" name="place" label="Place" optional value={v.place} max={AD_LIMITS.place} error={errFor("place")} onChange={(s) => set("place", s)} hintText="Like “Next door, Argwings Kodhek Rd”" capitalize="sentences" />
          <Text id="ad-link-label" name="link_label" label="Link label" value={v.link_label} max={AD_LIMITS.linkLabel} error={errFor("link_label")} onChange={(s) => set("link_label", s)} hintText="Like “See today’s bread”" capitalize="sentences" />
          <Text
            id="ad-link"
            name="link"
            label="Link"
            value={v.link}
            max={AD_LIMITS.link}
            error={errFor("link")}
            onChange={(s) => set("link", s)}
            hintText="A web address (https://…) or a phone number"
            inputMode="url"
            capitalize="none"
          />

          <div className="flex flex-col gap-2">
            <PhotoUpload
              initialUrl={removeLogo ? null : ad?.logo_url ?? null}
              name="logo"
              label="Logo (optional)"
              chooseLabel="Choose a logo"
              emptyTitle="Add a logo"
              emptyHint=""
              saveWhat="the ad"
              square
              onBusy={setUploading}
            />
            <p className={hint}>No logo: we show the first letter.</p>
            {ad?.logo_url && (
              <label className={`${ctl} flex min-h-11 items-center gap-2 self-start text-[15px] text-ink`}>
                <input type="checkbox" name="remove_logo" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} className="size-5 accent-teal-deep" />
                Remove the logo
              </label>
            )}
            {errFor("logo") && (
              <p role="alert" className={errorLine}>
                {errFor("logo")}
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={`${labelText} mb-2`}>Space</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["menu", "order"] as const).map((s) => (
                <label
                  key={s}
                  className={`${ctl} flex min-h-14 cursor-pointer items-center gap-2 rounded-[var(--r-md)] bg-paper px-3 text-[15px] font-semibold ring-inset ${v.space === s ? "ring-2 ring-teal-deep" : "ring-1 ring-field"}`}
                >
                  <input type="radio" name="space" value={s} checked={v.space === s} onChange={() => set("space", s)} className="size-5 accent-teal-deep" />
                  {SPACE_HEAD[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3">
              <DateField id="ad-starts" name="starts_on" label="Starts" value={v.starts_on} bad={Boolean(errFor("dates"))} onChange={(s) => set("starts_on", s)} />
              <DateField id="ad-ends" name="ends_on" label="Ends" value={v.ends_on} min={v.starts_on} bad={Boolean(errFor("dates"))} onChange={(s) => set("ends_on", s)} />
            </div>
            {errFor("dates") ? (
              <p role="alert" className={errorLine}>
                {errFor("dates")}
              </p>
            ) : overlap ? (
              <p className="text-[14px] text-amber-ink [overflow-wrap:anywhere]">
                {overlap.advertiser} is {SPACE_IN[overlap.space]} until {shortDate(overlap.ends_on)}. Pick dates after that, or {overlap.space === "menu" ? "the order page" : "the menu"}.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ad-fee" className={labelText}>
              Fee (KSh)
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
              <input
                id="ad-fee"
                name="fee_kes"
                value={v.fee_kes}
                onChange={(e) => set("fee_kes", e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="2000"
                aria-invalid={errFor("fee") ? true : undefined}
                aria-describedby="ad-fee-note"
                className={field}
              />
              <select
                name="fee_period"
                aria-label="Fee period"
                value={v.fee_period}
                onChange={(e) => set("fee_period", e.target.value as FeePeriod)}
                className={`${field} pr-2`}
              >
                <option value="week">a week</option>
                <option value="month">a month</option>
              </select>
            </div>
            <p id="ad-fee-note" role={errFor("fee") ? "alert" : undefined} className={errFor("fee") ? errorLine : hint}>
              {errFor("fee") ?? "For your records. Customers never see it."}
            </p>
          </div>
        </fieldset>

        <section aria-label="Preview" className="flex flex-col gap-2 border-t border-sand pt-5">
          <span className={labelText}>What customers see</span>
          <NeighbourAd ad={preview} preview className="bg-paper" />
          <p className={hint}>{v.space === "menu" ? "After Mains, for customers at a table." : "At the end of dine-in and pickup order pages."}</p>
        </section>
      </form>
    </PlannerSheet>
  );
}

/** Another approved ad in the same space whose dates cross these: warned here, refused by the database. */
function approvedOverlap(ads: AdRow[], id: string | null, v: Values) {
  if (!v.starts_on || !v.ends_on) return null;
  return (
    ads.find(
      (a) =>
        a.id !== id &&
        a.space === v.space &&
        (a.status === "scheduled" || a.status === "live" || a.status === "paused") &&
        a.starts_on <= v.ends_on &&
        a.ends_on >= v.starts_on,
    ) ?? null
  );
}

function Text({
  id,
  name,
  label,
  value,
  max,
  error,
  onChange,
  hintText,
  optional,
  inputMode,
  capitalize,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  max: number;
  error: string | null;
  onChange: (s: string) => void;
  hintText?: string;
  optional?: boolean;
  inputMode?: "url" | "text";
  capitalize: "none" | "words" | "sentences";
}) {
  const note = `${id}-note`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelText}>
        {label}
        {optional && <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        autoComplete="off"
        autoCapitalize={capitalize}
        autoCorrect={capitalize === "none" ? "off" : undefined}
        spellCheck={capitalize === "none" ? false : undefined}
        inputMode={inputMode}
        enterKeyHint="next"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hintText ? note : undefined}
        className={field}
      />
      {error ? (
        <p id={note} role="alert" className={errorLine}>
          {error}
        </p>
      ) : hintText ? (
        <p id={note} className={`${hint} tabular-nums`}>
          {hintText}
        </p>
      ) : null}
    </div>
  );
}

function DateField({ id, name, label, value, min, bad, onChange }: { id: string; name: string; label: string; value: string; min?: string; bad: boolean; onChange: (s: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelText}>
        {label}
      </label>
      <input id={id} name={name} type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} aria-invalid={bad || undefined} className={field} />
    </div>
  );
}
