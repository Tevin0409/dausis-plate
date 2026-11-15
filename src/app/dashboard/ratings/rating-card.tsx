"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { StarRow, useAutoGrow } from "@/components/shop/rating-card";
import { COMMENT_MAX, COUNTER_FROM, REPLY_FAILED, dishLine, sentLabel, starsWord, type OwnerRating } from "@/lib/ratings";
import { btnPrimary } from "../settings/ui";
import { replyToRating, setRatingHidden } from "./actions";

type Reply = { text: string; replied_at: string } | null;

const TAP = "press touch-manipulation select-none [-webkit-tap-highlight-color:transparent] disabled:cursor-wait disabled:opacity-60";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
/** The card's quiet 44 px actions. */
const quiet = `${TAP} ${FOCUS} inline-flex min-h-11 items-center justify-center rounded-full bg-paper px-4 text-[15px] font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--color-sand-deep)] hover:bg-cream`;
// Reply is the card's main job: the same quiet pill, in teal, so it reads first. Hide sits apart at the end.
const quietMain = `${TAP} ${FOCUS} inline-flex min-h-11 items-center justify-center rounded-full bg-paper px-4 text-[15px] font-semibold text-teal-deep shadow-[inset_0_0_0_1.5px_var(--color-teal-deep)] hover:bg-cream`;
const small = btnPrimary.replace("min-h-12", "min-h-11").replace("px-5", "px-4");
const UNDO_MS = 6000;

const replyOf = (r: OwnerRating): Reply => (r.reply && r.replied_at ? { text: r.reply, replied_at: r.replied_at } : null);

/** One rating on the owner's screen (spec-2.10 "The list"). The database decides; this card shows its answer. */
export function OwnerRatingCard({ rating }: { rating: OwnerRating }) {
  const id = useId();
  const [isNew] = useState(rating.is_new); // a refresh after an action must not clear this visit's pills
  const [hidden, setHidden] = useState(rating.hidden_at !== null);
  const [reply, setReply] = useState<Reply>(replyOf(rating));
  const [fresh, setFresh] = useState(false); // the reply was just sent: fade it in
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [undo, setUndo] = useState<Reply>(null);
  const [hidePending, startHide] = useTransition();
  const [replyPending, startReply] = useTransition();
  const area = useAutoGrow(draft, 8);
  const replyButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"area" | "reply" | null>(null);

  // A refresh from another tab's change: adopt what the database now says.
  const [seen, setSeen] = useState({ hidden_at: rating.hidden_at, reply: rating.reply, replied_at: rating.replied_at });
  if (seen.hidden_at !== rating.hidden_at || seen.reply !== rating.reply || seen.replied_at !== rating.replied_at) {
    setSeen({ hidden_at: rating.hidden_at, reply: rating.reply, replied_at: rating.replied_at });
    setHidden(rating.hidden_at !== null);
    setReply(replyOf(rating));
  }

  useEffect(() => {
    if (focusNext.current === "area") area.current?.focus();
    if (focusNext.current === "reply") replyButton.current?.focus();
    focusNext.current = null;
  });

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  function toggleHidden() {
    const want = !hidden;
    setError(null);
    startHide(async () => {
      const res = await setRatingHidden(rating.order_id, want).catch(() => null);
      if (!res?.ok) {
        setStatus("");
        setError(res && !res.ok ? res.error : want ? "Couldn’t hide the rating. Try again." : "Couldn’t show the rating. Try again.");
        return;
      }
      setHidden(res.hidden);
      setStatus(res.hidden ? "Rating hidden" : "Rating shown");
    });
  }

  function openBox() {
    setDraft(reply?.text ?? "");
    setError(null);
    setUndo(null);
    setEditing(true);
    focusNext.current = "area";
  }

  function cancel() {
    setEditing(false);
    setError(null);
    focusNext.current = "reply";
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) {
      // An emptied box on an existing reply is a removal; on a new one there is nothing to send.
      if (reply) return remove();
      return cancel();
    }
    setError(null);
    startReply(async () => {
      const res = await replyToRating(rating.order_id, text).catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : REPLY_FAILED);
        return;
      }
      setReply(res.reply);
      setFresh(true);
      setEditing(false);
      setStatus("Reply sent");
      focusNext.current = "reply";
    });
  }

  function remove() {
    const before = reply;
    if (!before) return;
    setError(null);
    startReply(async () => {
      const res = await replyToRating(rating.order_id, "").catch(() => null);
      if (!res?.ok) {
        setError(res && !res.ok ? res.error : REPLY_FAILED);
        return;
      }
      setReply(null);
      setEditing(false);
      setUndo(before);
      setStatus("");
      focusNext.current = "reply";
    });
  }

  function undoRemove() {
    const back = undo;
    if (!back) return;
    setUndo(null);
    startReply(async () => {
      const res = await replyToRating(rating.order_id, back.text).catch(() => null);
      if (!res?.ok) {
        setError(REPLY_FAILED);
        return;
      }
      setReply(res.reply);
      setFresh(true);
      setStatus("Reply put back");
    });
  }

  const count = draft.length;

  return (
    <article aria-labelledby={`${id}-top`} data-hidden={hidden ? "" : undefined} className="relative rounded-[var(--r-lg)] bg-paper p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p id={`${id}-top`} className="rating-dim min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">
          {rating.first_name || "A customer"} · <span className="tabular-nums">{rating.code}</span> ·{" "}
          <span className="font-normal text-ink-soft">{sentLabel(rating.sent_at)}</span>
        </p>
        {isNew && <span className="rounded-full bg-teal-tint px-2.5 py-0.5 text-[12px] font-bold text-teal-deeper">New</span>}
        {hidden && <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold text-ink-soft">Hidden · not in the averages</span>}
      </div>

      <div className="rating-dim mt-2 flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <StarRow stars={rating.stars} size={16} />
          <span className="sr-only">{starsWord(rating.stars)}.</span>
          <span className="min-w-0 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{dishLine(rating.dishes)}</span>
        </p>
        {rating.comment && (
          <blockquote className="whitespace-pre-line text-[15px] leading-relaxed [overflow-wrap:anywhere]">“{rating.comment}”</blockquote>
        )}
        {reply && !editing && (
          <div className={`rounded-xl bg-teal-tint p-3.5 ${fresh ? "fade-in" : ""}`}>
            <p className="text-[13px] font-semibold text-ink-soft">Your reply · {sentLabel(reply.replied_at)}</p>
            <p className="mt-1 whitespace-pre-line text-[15px] [overflow-wrap:anywhere]">{reply.text}</p>
          </div>
        )}
      </div>

      {editing ? (
        <form onSubmit={send} className="mt-3 flex flex-col gap-1.5">
          <label htmlFor={`${id}-reply`} className="text-[14px] font-semibold">
            Your reply
          </label>
          <textarea
            id={`${id}-reply`}
            ref={area}
            rows={3}
            value={draft}
            maxLength={COMMENT_MAX}
            onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX))}
            autoCapitalize="sentences"
            aria-describedby={`${id}-hint${count >= COUNTER_FROM ? ` ${id}-count` : ""}${error ? ` ${id}-error` : ""}`}
            aria-invalid={error ? true : undefined}
            className="w-full resize-none rounded-[var(--r-sm)] border-[1.5px] border-field bg-paper px-3 py-2.5 text-[16px] leading-6 focus:border-teal-deep focus:outline-none focus:ring-3 focus:ring-teal/25 aria-invalid:border-coral-ink"
          />
          {count >= COUNTER_FROM && (
            <p id={`${id}-count`} className={`text-right text-[13px] tabular-nums ${count >= COMMENT_MAX ? "font-semibold text-coral-text" : "text-ink-soft"}`}>
              {count} / {COMMENT_MAX}
            </p>
          )}
          <p id={`${id}-hint`} className="text-[13px] text-ink-soft">
            They’ll see it on their order page if they open it again. Anyone with their order link can read it.
          </p>
          {error && (
            <p id={`${id}-error`} role="alert" className="note-in text-sm font-semibold text-coral-ink">
              {error}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="submit" disabled={replyPending} className={small}>
              {replyPending ? "Sending…" : "Send reply"}
            </button>
            <button type="button" onClick={cancel} disabled={replyPending} className={quiet}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={replyButton} type="button" onClick={openBox} disabled={replyPending} className={quietMain}>
              {reply ? "Edit reply" : "Reply"}
            </button>
            {reply && (
              <button type="button" onClick={remove} disabled={replyPending} className={quiet}>
                Remove reply
              </button>
            )}
            <button type="button" onClick={toggleHidden} disabled={hidePending} className={`${quiet} ml-auto`}>
              {hidden ? "Show again" : "Hide from stars"}
            </button>
          </div>
          {error && (
            <p role="alert" className="note-in mt-2 text-sm font-semibold text-coral-ink">
              {error}
            </p>
          )}
        </>
      )}

      <div aria-live="polite" className="text-[14px]">
        {undo ? (
          <p className="note-in mt-2 flex flex-wrap items-center gap-x-2">
            Reply removed.
            <button type="button" onClick={undoRemove} className={`${TAP} ${FOCUS} inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-teal-deep underline underline-offset-4`}>
              Undo
            </button>
          </p>
        ) : (
          <span className="sr-only">{status}</span>
        )}
      </div>
    </article>
  );
}
