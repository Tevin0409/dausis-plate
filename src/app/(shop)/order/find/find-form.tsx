"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { ClockIcon, SearchIcon } from "@/components/icons";
import { markArrival } from "@/components/shop/arrive";
import { normaliseCode } from "@/lib/order-code";
import { findOrder, type FindResult } from "./actions";

type Problem = Exclude<FindResult, { ok: true }>["kind"];

const input =
  "min-h-[50px] w-full rounded-[14px] border border-field bg-white px-3.5 text-base font-normal text-ink aria-invalid:border-coral-text";
const label = "flex flex-col gap-1.5 text-sm font-semibold";
const errorLine = "note-in text-sm font-semibold text-coral-text";

export function FindOrderForm({ days, phone }: { days: number | null; phone: string | null }) {
  const router = useRouter();
  const id = useId();
  const [tel, setTel] = useState("");
  const [code, setCode] = useState("");
  const [empty, setEmpty] = useState<{ tel: boolean; code: boolean }>({ tel: false, code: false });
  const [problem, setProblem] = useState<{ kind: Problem; n: number } | null>(null);
  const [pending, start] = useTransition();
  const telRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const t = tel.trim();
    const c = code.trim();
    const next = { tel: !t, code: !c };
    setEmpty(next);
    if (next.tel || next.code) {
      setProblem(null);
      (next.tel ? telRef : codeRef).current?.focus();
      return;
    }
    const sent = normaliseCode(c);
    setCode(sent);
    start(async () => {
      const res = await findOrder(t, sent).catch((): FindResult => ({ ok: false, kind: "network" }));
      if (res.ok) {
        markArrival();
        router.push(`/order/${res.token}`);
        return;
      }
      // n re-keys the line so a repeat miss is announced again.
      setProblem((p) => ({ kind: res.kind, n: (p?.n ?? 0) + 1 }));
    });
  }

  const callUs = phone && (
    // Padding on an inline link grows its tap area to 44 px without moving the text (RQA28-04).
    <a href={`tel:${phone}`} className="py-[13px] font-semibold text-teal-deep underline underline-offset-2">
      call us
    </a>
  );

  return (
    <section aria-labelledby={`${id}-h`} className="mx-5 mt-4 rounded-[var(--r-lg)] bg-paper p-[18px] shadow-[var(--shadow-card)]">
      <h2 id={`${id}-h`} className="font-display text-[21px] leading-tight">
        Lost your order link?
      </h2>
      <p className="mt-1.5 text-sm leading-normal text-ink-soft">
        Use the phone number you ordered with and the code from your order, like <span className="whitespace-nowrap tabular-nums">DP-0142</span>.
        {days !== null && ` Orders from the last ${days} ${days === 1 ? "day" : "days"}.`}
      </p>

      <form onSubmit={submit} noValidate aria-busy={pending} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={label}>
          Phone number
          <input
            ref={telRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
            placeholder="0712 345 678"
            maxLength={40}
            value={tel}
            onChange={(e) => (setTel(e.target.value), setEmpty((v) => ({ ...v, tel: false })))}
            aria-invalid={empty.tel || undefined}
            aria-describedby={empty.tel ? `${id}-tel-err` : undefined}
            className={`${input} tabular-nums`}
          />
          </label>
          {empty.tel && (
            <span id={`${id}-tel-err`} role="alert" className={errorLine}>
              Enter your phone number.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>
          Order code
          <input
            ref={codeRef}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="DP-0142"
            maxLength={20}
            value={code}
            onChange={(e) => (setCode(e.target.value), setEmpty((v) => ({ ...v, code: false })))}
            onBlur={() => code.trim() && setCode(normaliseCode(code))}
            aria-invalid={empty.code || undefined}
            aria-describedby={empty.code ? `${id}-code-err` : undefined}
            className={`${input} uppercase tabular-nums placeholder:normal-case`}
          />
          </label>
          {empty.code && (
            <span id={`${id}-code-err`} role="alert" className={errorLine}>
              Enter your order code.
            </span>
          )}
        </div>

        <button
          type="submit"
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page (RQA28-03).
          aria-disabled={pending || undefined}
          className="press flex min-h-12 w-full select-none items-center justify-center gap-2 rounded-full bg-teal-deep px-5 font-semibold text-white touch-manipulation aria-disabled:opacity-60"
        >
          <SearchIcon size={18} />
          {pending ? "Finding your order…" : "Find my order"}
        </button>
      </form>

      {/* Each line carries its own role and is re-keyed per reply, so it is announced every time. */}
      <div>
        {problem?.kind === "paused" ? (
          <div key={problem.n} role="status" className="note-in mt-4 flex gap-2.5 rounded-[var(--r-md)] bg-amber-tint p-3.5 text-sm leading-normal text-amber-ink">
            <ClockIcon size={18} className="mt-px shrink-0" />
            <p>
              <strong className="font-semibold">Too many tries.</strong> Wait 15 minutes, then try again.
              {phone ? <> Or {callUs} and give your order code.</> : null}
            </p>
          </div>
        ) : problem ? (
          <p key={problem.n} role="alert" className="note-in mt-4 text-sm font-semibold leading-normal text-coral-text">
            {problem.kind === "network" ? (
              "Couldn’t check right now. Try again in a moment."
            ) : (
              <>
                We couldn’t find that order. Check the phone number and code{phone ? <>, or {callUs}</> : null}.
              </>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
