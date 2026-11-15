"use client";
// Slice 2.10: "How was your food?" on a completed order's page (spec-2.10 "Customer: the order page").
// The server decides whether rating is still open (rate_until) and whether it was sent (rating);
// this card only collects the stars and the comment and words the database's answer.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { rateOrder } from "@/app/(shop)/rating-actions";
import { COMMENT_MAX, COULDNT_SEND, COUNTER_FROM, shortDate, STAR_LABELS, starsWord, type CustomerRating } from "@/lib/ratings";

export function StarShape({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        d="M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9z"
        className={filled ? "fill-amber stroke-amber" : "fill-white stroke-field"}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Five small static stars, e.g. on the thanks card and the owner's cards. */
export function StarRow({ stars, size = 16 }: { stars: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <StarShape key={n} size={size} filled={n <= stars} />
      ))}
    </span>
  );
}

/** The dishes under the heading: as many names as fit about two lines, then "and N more". */
function dishesLine(names: string[]) {
  if (names.length < 2) return null;
  const cut = (s: string) => (s.length > 40 ? `${s.slice(0, 39).trimEnd()}…` : s);
  const shown: string[] = [];
  let length = 0;
  for (const name of names) {
    const n = cut(name);
    if (shown.length > 0 && length + n.length + 3 > 70) break;
    shown.push(n);
    length += n.length + 3;
  }
  const more = names.length - shown.length;
  return shown.join(" · ") + (more > 0 ? ` and ${more} more` : "");
}

/** Grows a textarea with its text between its rows and `maxRows`. */
export function useAutoGrow(value: string, maxRows: number) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * maxRows + padY + border;
    el.style.height = "auto"; // back to its rows, so it can shrink
    const want = el.scrollHeight + border;
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
  }, [value, maxRows]);
  return ref;
}

export function Thanks({ stars, commentSent, reply, animate, headingRef }: {
  stars: number;
  commentSent: boolean;
  reply: { text: string; replied_at: string } | null;
  animate?: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <section aria-labelledby="rate-thanks" className={`flex flex-col gap-1.5 ${animate ? "rate-in" : ""}`}>
      <h2 id="rate-thanks" ref={headingRef} tabIndex={-1} className="font-display text-[22px] leading-tight outline-none">Asante for telling us.</h2>
      <p className="text-[14px] text-ink-soft">{commentSent ? "Mama reads every comment." : "Your stars are on the dishes now."}</p>
      <p className="mt-1 flex items-center gap-2 text-[14px]">
        <StarRow stars={stars} />
        <span>You gave {starsWord(stars)}</span>
      </p>
      {reply && (
        <div className="mt-2.5 rounded-xl bg-teal-tint p-4">
          <p className="text-[14px] font-semibold">Mama replied · {shortDate(reply.replied_at)}</p>
          <p className="mt-1 whitespace-pre-line text-[15px] [overflow-wrap:anywhere]">{reply.text}</p>
        </div>
      )}
    </section>
  );
}

const card = "mx-5 mt-5 rounded-[18px] border border-sand bg-white p-4";

export function RatingCard({ token, dishes, rating, open }: {
  token: string;
  dishes: string[];
  rating: CustomerRating;
  /** Still inside the 7 days (the server's clock, from rate_until). */
  open: boolean;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [sent, setSent] = useState<{ stars: number; commentSent: boolean } | null>(null);
  const [phase, setPhase] = useState<"form" | "swap" | "thanks">("form");
  const [pending, start] = useTransition();
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const thanksRef = useRef<HTMLHeadingElement>(null);
  const area = useAutoGrow(comment, 8);

  useEffect(() => {
    if (phase !== "swap") return;
    thanksRef.current?.focus({ preventScroll: true });
    // Swap once the form's fade-out (--dur-exit) has finished; the value comes from the token.
    const exit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-exit")) || 220;
    const t = setTimeout(() => setPhase("thanks"), exit + 20);
    return () => clearTimeout(t);
  }, [phase]);

  // Sent earlier (or in another tab), and this tab didn't just send it.
  if (rating && !sent) {
    return (
      <div className={card}>
        <Thanks stars={rating.stars} commentSent={rating.comment_sent} reply={rating.reply} />
      </div>
    );
  }
  if (!sent && (gone || !open)) {
    return <p className="mx-5 mt-5 text-[14px] text-ink-soft" role={gone ? "status" : undefined}>{gone ?? "Rating closed 7 days after your order."}</p>;
  }

  const pick = (n: number) => {
    setStars((s) => (s === n ? 0 : n));
    setLine(null);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, n + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, n - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 5;
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setStars(0);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setStars(next);
    setLine(null);
    starRefs.current[next - 1]?.focus();
  };
  const send = () => {
    if (!stars || pending) return;
    setLine(null);
    start(async () => {
      let r: Awaited<ReturnType<typeof rateOrder>>;
      try {
        r = await rateOrder(token, stars, comment);
      } catch {
        // Offline, or the request never reached the server: keep the stars and the comment (RQA210-01).
        setLine(COULDNT_SEND);
        return;
      }
      if (r.ok) {
        setSent({ stars: r.stars, commentSent: r.commentSent });
        setPhase("swap");
        router.refresh();
      } else if (r.rated) {
        // Another tab sent it: the refreshed page brings the thanks card with the saved stars.
        router.refresh();
      } else if (r.gone) {
        // No refresh: an undone order isn't "completed" any more, so a refreshed page would drop
        // this card before the line is read (RQA210-02). The next load shows the real status.
        setGone(r.line);
      } else {
        setLine(r.line);
      }
    });
  };

  const focusable = stars || 1;
  const dishText = dishesLine(dishes);
  const form = (
    <section aria-labelledby="rate-heading" data-leaving={phase !== "form" ? "" : undefined} inert={phase !== "form"} className="rate-out flex flex-col">
      <h2 id="rate-heading" className="font-display text-[22px] leading-tight">How was your food?</h2>
      <p className="mt-1.5 text-[14px] text-ink-soft">Your stars count on every dish you ordered. Only Mama reads your comment.</p>
      {dishText && <p className="mt-1 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{dishText}</p>}

      <div role="radiogroup" aria-label="Your rating" className="-ml-2 mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => {
              starRefs.current[n - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={starsWord(n)}
            tabIndex={n === focusable ? 0 : -1}
            onClick={() => pick(n)}
            onKeyDown={(e) => onKey(e, n)}
            className="star-btn flex size-[52px] items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-deep"
          >
            <StarShape size={36} filled={n <= stars} />
          </button>
        ))}
      </div>
      {/* Reserved height, so picking a star doesn't move the comment field. */}
      <p className="min-h-5 text-[14px] text-ink-soft" aria-hidden="true">{stars ? STAR_LABELS[stars - 1] : ""}</p>

      <label htmlFor="rate-comment" className="mt-3 text-[15px] font-semibold">
        Anything to tell Mama? <span className="font-normal text-ink-soft">Only Mama sees this.</span>
      </label>
      <textarea
        id="rate-comment"
        ref={area}
        rows={4}
        value={comment}
        maxLength={COMMENT_MAX}
        onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
        placeholder="What did you love? What could be better?"
        autoCapitalize="sentences"
        aria-describedby={comment.length >= COUNTER_FROM ? "rate-count" : undefined}
        className="mt-1.5 w-full resize-none rounded-[var(--r-sm)] border border-field bg-white px-3 py-2.5 text-[16px] leading-6 placeholder:text-ink-soft/80 focus:outline-2 focus:outline-offset-1 focus:outline-teal-deep"
      />
      {comment.length >= COUNTER_FROM && (
        <p id="rate-count" className="mt-1 self-end text-[13px] tabular-nums text-ink-soft">{comment.length} / {COMMENT_MAX}</p>
      )}

      <button
        type="button"
        onClick={send}
        disabled={!stars || pending}
        aria-describedby={!stars ? "rate-first" : line ? "rate-line" : undefined}
        className="press mt-4 min-h-12 w-full rounded-full bg-teal-deep px-5 font-semibold text-white disabled:bg-sand-deep disabled:text-ink-soft"
      >
        {pending ? "Sending…" : "Send to Mama"}
      </button>
      {!stars && <p id="rate-first" className="mt-2 text-[14px] text-ink-soft">Tap the stars first.</p>}
      {line && <p id="rate-line" role="alert" key={line} className="note-in mt-2 text-[14px] text-coral-text">{line}</p>}
    </section>
  );

  if (!sent) return <div className={card}>{form}</div>;
  return (
    // Crossfade in one grid cell: the form fades out while the thanks card fades in over it.
    <div className={`${card} grid [&>*]:[grid-area:1/1]`}>
      {phase === "swap" && form}
      <Thanks key="thanks" animate stars={sent.stars} commentSent={sent.commentSent} reply={rating?.reply ?? null} headingRef={thanksRef} />
    </div>
  );
}

export function GoogleReviewCard({ url }: { url: string }) {
  return (
    <section aria-labelledby="google-review" className={`${card} flex flex-col gap-3`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-sand-deep bg-cream font-display text-[20px] text-ink">G</span>
        <div className="min-w-0">
          <h2 id="google-review" className="text-[16px] font-bold">Also review us on Google</h2>
          <p className="text-[14px] text-ink-soft">It helps other people find Mama’s kitchen.</p>
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="press flex min-h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-teal-deep bg-white px-5 font-semibold text-teal-deep"
      >
        Review on Google
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
        <span className="sr-only">(opens Google)</span>
      </a>
    </section>
  );
}
