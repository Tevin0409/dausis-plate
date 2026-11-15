"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancelInvite, removeMember, resendInvite, resetPassword, setMemberGrant, setMemberName, setMemberRole, type TeamResult } from "@/app/dashboard/team/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { Switch } from "@/components/dashboard/switch";
import { PageNote, PanelHeading, Segments, danger, errorLine, field, hint, labelText, linkBtn, primary, quiet } from "@/components/dashboard/tables/ui";
import type { Grant } from "@/lib/permissions";
import { GRANT_ROWS, NAME_MAX, TEAM, nameProblem, signInLine, type Person, type TeamRole } from "@/lib/team";
import { isTempPassword, makeTempPassword } from "@/lib/temp-password";

const REFRESH_AFTER_REFUSAL_MS = 3000;
type Fail = Extract<TeamResult, { ok: false }>;

const sectionHeading = "text-[17px] font-semibold text-ink";
const section = "flex flex-col gap-3 border-t border-sand pt-5";
const coralText = "press min-h-11 self-start rounded-[var(--r-sm)] px-1 text-[15px] font-semibold text-coral-text touch-manipulation select-none hover:underline disabled:opacity-60";

/** One person's panel (spec-2.6 "Person panel"). Each part saves on its own. */
export function PersonPanel({
  open,
  person,
  soleOwner,
  onClose,
  onDone,
}: {
  open: boolean;
  person: Person;
  soleOwner: boolean;
  onClose: () => void;
  /** Closes the panel with a note in the list (Remove, Cancel invite). */
  onDone: (note: string) => void;
}) {
  const reportRefusal = useReportRefusal();
  // A refusal for a job the owner no longer holds, or a person who's gone: the line shows, then the page refreshes.
  const after = (r: Fail) => {
    if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
    if (r.gone) setTimeout(onClose, REFRESH_AFTER_REFUSAL_MS);
  };

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="person-panel-title">
      <PanelHeading
        id="person-panel-title"
        title={person.you ? `${person.name} (you)` : person.name}
        sub={
          <span className="flex flex-col gap-0.5">
            <span className="[overflow-wrap:anywhere]">{person.email}</span>
            <span>{signInLine(person)}</span>
          </span>
        }
        onClose={onClose}
      />
      <div className="mt-5 flex flex-col gap-6 pb-2">
        <NameField person={person} after={after} />
        <RoleField person={person} soleOwner={soleOwner} after={after} />
        <Jobs person={person} after={after} />
        {person.invited ? <Invite person={person} after={after} onDone={onDone} /> : <Password person={person} after={after} />}
        {!person.you && !person.invited && <Remove person={person} after={after} onDone={onDone} />}
      </div>
    </PlannerSheet>
  );
}

type PartProps = { person: Person; after: (r: Fail) => void };
type El = React.RefObject<HTMLElement | null>;

/** Focus follows a part opening (to its question or field) and closing (back to its button), not the first render. */
function useFocusOn(key: string, targets: Record<string, El>) {
  // Compare with the last key rather than skipping the first run: Strict Mode runs a mount effect
  // twice, and a "first run" flag would then move focus (and scroll the panel) on open.
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    targets[key]?.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; runs when the part changes
  }, [key]);
}

function NameField({ person, after }: PartProps) {
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const p = nameProblem(name);
    if (p) return setError(p);
    if (name.trim() === person.name) return setSaved(true);
    startTransition(async () => {
      const r = await setMemberName(person.id, name);
      if (r.ok) return setSaved(true);
      setError(r.error);
      after(r);
    });
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-1.5">
      <label htmlFor="person-name" className={labelText}>
        Name
      </label>
      <div className="flex gap-2">
        <input
          id="person-name"
          value={name}
          onChange={(e) => (setName(e.target.value), setError(null), setSaved(false))}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "person-name-err" : "person-name-hint"}
          className={field}
        />
        <button type="submit" disabled={pending} className={`${quiet} shrink-0 px-4`}>
          {pending ? "Saving…" : "Save name"}
        </button>
      </div>
      {error ? (
        <p id="person-name-err" role="alert" className={errorLine}>
          {error}
        </p>
      ) : (
        <p id="person-name-hint" className={hint} aria-live="polite">
          {saved ? "Name saved." : "Shown on the board, in the History and in the menu bar."}
        </p>
      )}
    </form>
  );
}

function RoleField({ person, soleOwner, after }: PartProps & { soleOwner: boolean }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const question = useRef<HTMLParagraphElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useFocusOn(asking ? "ask" : "idle", { ask: question, idle: label });

  function save(next: TeamRole) {
    setError(null);
    startTransition(async () => {
      const r = await setMemberRole(person.id, next);
      setAsking(false);
      if (r.ok) return;
      setError(r.error);
      after(r);
    });
  }

  function pick(next: TeamRole) {
    if (next === person.role || pending) return setAsking(false);
    if (next === "owner") return setAsking(true);
    // The last owner can't become staff: the line is already above, so nothing is sent.
    if (soleOwner) return setError(TEAM.lastOwner);
    save(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <span ref={label} tabIndex={-1} className={`${labelText} outline-none`}>
        Role
      </span>
      {soleOwner && <p className="text-[14px] text-ink-soft">{TEAM.lastOwner}</p>}
      <Segments
        label="Role"
        value={person.role}
        options={[
          ["staff", "Staff"],
          ["owner", "Owner"],
        ]}
        onChange={pick}
      />
      {asking && (
        <div role="group" aria-labelledby="make-owner-q" className="note-in flex flex-col gap-3 rounded-[var(--r-md)] bg-paper p-4 ring-1 ring-sand">
          <p id="make-owner-q" ref={question} tabIndex={-1} className="text-[15px] leading-snug [overflow-wrap:anywhere] focus:outline-none">
            {TEAM.makeOwner(person.name)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAsking(false)} disabled={pending} className={quiet}>
              Keep as staff
            </button>
            <button type="button" onClick={() => save("owner")} disabled={pending} className={primary}>
              {pending ? "Saving…" : "Make owner"}
            </button>
          </div>
        </div>
      )}
      {error && error !== (soleOwner ? TEAM.lastOwner : null) && (
        <p role="alert" className={errorLine}>
          {error}
        </p>
      )}
    </div>
  );
}

function Jobs({ person, after }: PartProps) {
  if (person.role === "owner") {
    return (
      <div className={section}>
        <h3 className={sectionHeading}>What they can do</h3>
        <p className="text-[15px] text-ink">{TEAM.ownerAll}</p>
      </div>
    );
  }
  return (
    <div className={section}>
      <h3 className={sectionHeading}>What they can do</h3>
      <p className={hint}>{TEAM.everyone}</p>
      <ul className="flex flex-col">
        {GRANT_ROWS.map((g) => (
          <li key={g.job} className="border-t border-sand first:border-t-0">
            <GrantRow person={person} job={g.job} label={g.label} line={g.line} after={after} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GrantRow({ person, job, label, line, after }: PartProps & { job: Grant; label: string; line: string }) {
  const held = person.grants.includes(job);
  const [on, setOn] = useState(held);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (!busy.current) setOn(held);
  }, [held]);

  function toggle(v: boolean) {
    if (busy.current) return;
    busy.current = true;
    setOn(v);
    setError(null);
    startTransition(async () => {
      const r = await setMemberGrant(person.id, job, v);
      busy.current = false;
      if (r.ok) return;
      setOn(!v);
      setError(r.error);
      after(r);
    });
  }

  return (
    <>
      <Switch checked={on} onChange={toggle} className="min-h-14 w-full justify-between gap-3 py-2 text-left">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold text-ink">{label}</span>
          <span className={hint}>{line}</span>
        </span>
      </Switch>
      {error && (
        <p role="alert" className={`${errorLine} pb-2`}>
          {error}
        </p>
      )}
    </>
  );
}

function Password({ person, after }: PartProps) {
  if (person.you) {
    return (
      <div className={section}>
        <h3 className={sectionHeading}>Password</h3>
        <p className="text-[15px] text-ink">
          {TEAM.resetSelf}{" "}
          <Link href="/dashboard/account" className={linkBtn}>
            Go to Account
          </Link>
        </p>
      </div>
    );
  }
  if (person.role === "owner") {
    return (
      <div className={section}>
        <h3 className={sectionHeading}>Password</h3>
        <p className="text-[15px] text-ink">{TEAM.resetOwner}</p>
      </div>
    );
  }
  return <Reset person={person} after={after} />;
}

function Reset({ person, after }: PartProps) {
  const [stage, setStage] = useState<"closed" | "typing" | "shown">("closed");
  const [temp, setTemp] = useState("");
  const [error, setError] = useState<{ field: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  useFocusOn(stage, { closed: opener, typing: input, shown: done });

  function set(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!isTempPassword(temp)) {
      setError({ field: true, message: TEAM.tempShort });
      return input.current?.focus();
    }
    startTransition(async () => {
      const r = await resetPassword(person.id, temp);
      if (r.ok) {
        setStage("shown");
        return;
      }
      setError({ field: r.field === "password", message: r.error });
      after(r);
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(temp);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function finish() {
    setTemp("");
    setCopied(false);
    setStage("closed");
  }

  return (
    <div className={section}>
      <h3 className={sectionHeading}>Password</h3>
      {stage === "closed" && (
        <button ref={opener} type="button" onClick={() => setStage("typing")} className={`${quiet} self-start`}>
          Reset password
        </button>
      )}
      {stage === "typing" && (
        <form onSubmit={set} noValidate className="note-in flex flex-col gap-3">
          <p className="text-[15px] leading-snug text-ink [overflow-wrap:anywhere]">{TEAM.resetIntro(person.name)}</p>
          <label htmlFor="temp-password" className={labelText}>
            Temporary password
          </label>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              ref={input}
              id="temp-password"
              type="text"
              value={temp}
              onChange={(e) => (setTemp(e.target.value), setError(null))}
              maxLength={200}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-invalid={error?.field ? true : undefined}
              aria-describedby={error ? "temp-password-err" : "temp-password-hint"}
              className={`${field} font-mono`}
            />
            <button type="button" onClick={() => (setTemp(makeTempPassword()), setError(null))} className={`${quiet} shrink-0 px-4`}>
              Make one for me
            </button>
          </div>
          {error ? (
            <p id="temp-password-err" role="alert" className={errorLine}>
              {error.message}
            </p>
          ) : (
            <p id="temp-password-hint" className={hint}>
              At least 8 characters.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={finish} disabled={pending} className={quiet}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primary}>
              {pending ? "Setting…" : "Set password"}
            </button>
          </div>
        </form>
      )}
      {stage === "shown" && (
        <div className="note-in flex flex-col gap-3 rounded-[var(--r-md)] bg-teal-tint p-4">
          <p className="text-[15px] text-teal-deeper [overflow-wrap:anywhere]">
            {TEAM.tempShown(person.name)} <strong className="font-mono text-[17px] font-bold select-all">{temp}</strong>
          </p>
          <p className="text-[14px] text-teal-deeper">{TEAM.tempOnce}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} className={quiet}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button ref={done} type="button" onClick={finish} className={primary}>
              Done
            </button>
            <span aria-live="polite" className="sr-only">
              {copied ? "Copied" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Invite({ person, after, onDone }: PartProps & { onDone: (note: string) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"send" | "cancel" | null>(null);
  const [, startTransition] = useTransition();
  const question = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useFocusOn(asking ? "ask" : "idle", { ask: question, idle: opener });

  function send() {
    if (busy) return;
    setBusy("send");
    setNote(null);
    setError(null);
    startTransition(async () => {
      const r = await resendInvite(person.id);
      setBusy(null);
      if (r.ok) return setNote(r.note ?? TEAM.inviteSentAgain);
      setError(r.error);
      after(r);
    });
  }

  function cancel() {
    if (busy) return;
    setBusy("cancel");
    setError(null);
    startTransition(async () => {
      const r = await cancelInvite(person.id, person.name);
      setBusy(null);
      if (r.ok) return onDone(r.note ?? TEAM.cancelled(person.name));
      setError(r.error);
      after(r);
    });
  }

  return (
    <div className={section}>
      <h3 className={sectionHeading}>Invite</h3>
      <p className="text-[15px] text-ink [overflow-wrap:anywhere]">{TEAM.invitePending(person.name)}</p>
      <button type="button" onClick={send} disabled={busy !== null} className={`${quiet} self-start`}>
        {busy === "send" ? "Sending…" : "Send again"}
      </button>
      <div aria-live="polite">{note && <PageNote text={note} />}</div>
      {asking ? (
        <div role="group" aria-labelledby="cancel-invite-q" className="note-in flex flex-col gap-3 rounded-[var(--r-md)] bg-blush p-4">
          <p id="cancel-invite-q" ref={question} tabIndex={-1} className="text-[15px] text-coral-ink [overflow-wrap:anywhere] focus:outline-none">
            {TEAM.cancelAsk(person.name)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAsking(false)} disabled={busy !== null} className={quiet}>
              Keep the invite
            </button>
            <button type="button" onClick={cancel} disabled={busy !== null} className={danger}>
              {busy === "cancel" ? "Cancelling…" : "Cancel invite"}
            </button>
          </div>
        </div>
      ) : (
        <button ref={opener} type="button" onClick={() => setAsking(true)} className={coralText}>
          Cancel invite
        </button>
      )}
      {error && (
        <p role="alert" className={errorLine}>
          {error}
        </p>
      )}
    </div>
  );
}

function Remove({ person, after, onDone }: PartProps & { onDone: (note: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const question = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useFocusOn(asking ? "ask" : "idle", { ask: question, idle: opener });

  function remove() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const r = await removeMember(person.id, person.name);
      if (r.ok) return onDone(r.note ?? TEAM.removed(person.name));
      setError(r.error);
      after(r);
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-sand pt-5">
      {asking ? (
        <div role="group" aria-labelledby="remove-q" className="note-in flex flex-col gap-3 rounded-[var(--r-md)] bg-blush p-4">
          <p id="remove-q" ref={question} tabIndex={-1} className="text-[15px] text-coral-ink [overflow-wrap:anywhere] focus:outline-none">
            {TEAM.removeAsk(person.name)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAsking(false)} disabled={pending} className={quiet}>
              Keep on the team
            </button>
            <button type="button" onClick={remove} disabled={pending} className={danger}>
              {pending ? "Removing…" : "Remove from team"}
            </button>
          </div>
        </div>
      ) : (
        <button ref={opener} type="button" onClick={() => setAsking(true)} className={coralText}>
          Remove from team
        </button>
      )}
      {error && (
        <p role="alert" className={errorLine}>
          {error}
        </p>
      )}
    </div>
  );
}
