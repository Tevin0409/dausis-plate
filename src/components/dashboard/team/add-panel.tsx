"use client";
import { useState, useTransition } from "react";
import { inviteMember } from "@/app/dashboard/team/actions";
import { PlannerSheet } from "@/components/dashboard/planner/sheet";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { PanelHeading, Segments, errorLine, field, hint, labelText, primary } from "@/components/dashboard/tables/ui";
import { NAME_MAX, TEAM, emailProblem, nameProblem, type TeamRole } from "@/lib/team";

type Field = "name" | "email" | "form";
const REFRESH_AFTER_REFUSAL_MS = 3000;

/** Add someone: name, email and role; the invite goes when the button is pressed (spec-2.6). */
export function AddPanel({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (note: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("staff");
  const [problem, setProblem] = useState<{ field: Field; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const reportRefusal = useReportRefusal();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const local: { field: Field; message: string } | null = nameProblem(name)
      ? { field: "name", message: nameProblem(name)! }
      : emailProblem(email)
        ? { field: "email", message: TEAM.email }
        : null;
    if (local) {
      setProblem(local);
      document.getElementById(`add-${local.field}`)?.focus();
      return;
    }
    startTransition(async () => {
      const r = await inviteMember({ name, email, role });
      if (r.ok) return onDone(r.note ?? TEAM.inviteSent(email.trim()));
      const f: Field = r.field === "name" || r.field === "email" ? r.field : "form";
      setProblem({ field: f, message: r.error });
      if (f !== "form") document.getElementById(`add-${f}`)?.focus();
      if (r.stale) setTimeout(() => reportRefusal(r.error), REFRESH_AFTER_REFUSAL_MS);
    });
  }

  const err = (f: Field) => (problem?.field === f ? problem.message : null);
  const line = (f: Field) =>
    err(f) && (
      <p id={`add-${f}-err`} role="alert" className={errorLine}>
        {err(f)}
      </p>
    );
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => (set(e.target.value), setProblem(null));

  const footer = (
    <div className="flex flex-col gap-2">
      {line("form")}
      <button type="submit" form="add-form" disabled={pending} aria-describedby="add-hint" className={`${primary} w-full`}>
        {pending ? "Sending…" : role === "owner" ? "Invite as owner" : "Send invite"}
      </button>
      <p id="add-hint" className={hint}>
        {TEAM.inviteHint}
      </p>
    </div>
  );

  return (
    <PlannerSheet open={open} onClose={onClose} labelledBy="add-panel-title" footer={footer}>
      <PanelHeading id="add-panel-title" title="Add someone" onClose={onClose} />
      <form id="add-form" onSubmit={submit} noValidate className="mt-5 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-name" className={labelText}>
            Name
          </label>
          <input
            id="add-name"
            value={name}
            onChange={edit(setName)}
            maxLength={NAME_MAX}
            placeholder="e.g. Otieno"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={err("name") ? "add-name-err" : undefined}
            className={field}
          />
          {line("name")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-email" className={labelText}>
            Email
          </label>
          <input
            id="add-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={edit(setEmail)}
            maxLength={254}
            placeholder="name@example.com"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-invalid={err("email") ? true : undefined}
            aria-describedby={err("email") ? "add-email-err" : undefined}
            className={field}
          />
          {line("email")}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={labelText} aria-hidden="true">
            Role
          </span>
          <Segments
            label="Role"
            value={role}
            options={[
              ["staff", "Staff"],
              ["owner", "Owner"],
            ]}
            onChange={(v) => (setRole(v), setProblem(null))}
          />
          {role === "owner" && <p className="text-[14px] text-ink">{TEAM.ownerLine}</p>}
        </div>
      </form>
    </PlannerSheet>
  );
}
