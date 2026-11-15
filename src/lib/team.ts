// Slice 2.6, Team (spec-2.6-owner-screens.md "Team"): the wording, the checks the panel and the
// server share, and the "Last signed in" line. No server-only code here: the panels import it too.

import type { Grant } from "@/lib/permissions";

/**
 * How long an invite link works. The hint under "Send invite" is written from this, so a change to
 * the link's life is a change here, plus the matching Auth setting (email link expiry) at go-live.
 */
export const INVITE_LINK_HOURS = 24;

const hoursText = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : h === 1 ? "1 hour" : `${h} hours`);

export const NAME_MAX = 40;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type TeamRole = "owner" | "staff";

export type Person = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  /** Added with an invite and hasn't chosen a password yet. */
  invited: boolean;
  lastSignIn: string | null;
  grants: Grant[];
  you: boolean;
};

export const TEAM = {
  intro: "Who can sign in to the dashboard, and what each person can do.",
  ownerLine: "Owners can do everything, including prices, sales, the team and settings.",
  inviteHint: `They’ll get an email with a link to choose their password. It works for ${hoursText(INVITE_LINK_HOURS)}.`,
  name: "Enter a name.",
  nameLong: `A name can be up to ${NAME_MAX} characters.`,
  email: "Enter an email like name@example.com.",
  onTeam: "That email is already on the team.",
  inviteFailed: "The invite didn’t send. Check the email and try again.",
  resendFailed: "The invite didn’t send. Try again.",
  invitePending: (name: string) =>
    `${name} hasn’t accepted the invite yet. A link works for ${hoursText(INVITE_LINK_HOURS)}; Send again sends a new one.`,
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  inviteSentAgain: "Invite sent again.",
  hasAccount: (name: string) => `${name} already has an account and can sign in now. If the password is forgotten, use Reset password.`,
  makeOwner: (name: string) => `Make ${name} an owner? Owners can do everything, including prices, sales, the team and settings.`,
  lastOwner: "There has to be at least one owner. Make someone else owner first.",
  everyone: "Everyone on the team can run orders, plan the menu and switch dishes off for the day.",
  ownerAll: "Owner · Can do everything",
  resetIntro: (name: string) =>
    `Set a temporary password for ${name}, and pass it on in person or by phone. ${name} chooses a new one at the next sign-in.`,
  resetOwner: "Owners reset their own password with Forgot password on the sign-in page.",
  resetSelf: "Change your own password in Account.",
  tempShort: "A temporary password needs at least 8 characters.",
  tempShown: (name: string) => `${name}’s temporary password:`,
  tempOnce: "You won’t see this again.",
  cancelAsk: (name: string) => `Cancel ${name}’s invite? The link stops working.`,
  cancelled: (name: string) => `${name}’s invite cancelled.`,
  removeAsk: (name: string) => `Remove ${name} from the team? ${name} is signed out at once and can’t open the dashboard. The name stays in the History.`,
  removed: (name: string) => `${name} removed from the team.`,
  gone: "That person isn’t on the team any more. Refresh the page.",
  ownersOnly: "Only the owner can see the team.",
} as const;

/** spec-2.3 "Team: What they can do": the four switches, in this order. */
export const GRANT_ROWS: { job: Grant; label: string; line: string }[] = [
  { job: "everyday_menu", label: "Everyday menu", line: "Put dishes on the everyday menu or take them off." },
  { job: "dishes_prices", label: "Dishes and prices", line: "Add and edit dishes, and set prices." },
  { job: "tables_delivery", label: "Tables and delivery", line: "Tables, QR codes, delivery zones and fees." },
  { job: "close_early", label: "Close early", line: "Close the kitchen for the rest of today, and reopen." },
];

export function nameProblem(name: string): string | null {
  const v = name.trim();
  if (!v) return TEAM.name;
  if (v.length > NAME_MAX) return TEAM.nameLong;
  return null;
}

export const normEmail = (email: string) => email.trim().toLowerCase();
export const emailProblem = (email: string) => (EMAIL.test(normEmail(email)) && normEmail(email).length <= 254 ? null : TEAM.email);

const TZ = "Africa/Nairobi";
const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** "Last signed in today 11:42", "Last signed in 3 Nov" (with the year when it isn't this one), or the invited line. */
export function signInLine(p: Pick<Person, "invited" | "lastSignIn">, now: Date = new Date()): string {
  if (!p.lastSignIn) return p.invited ? "Invited · hasn’t signed in yet" : "Hasn’t signed in yet";
  const at = new Date(p.lastSignIn);
  if (day(at) === day(now)) {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
    return `Last signed in today ${time}`;
  }
  const sameYear = day(at).slice(0, 4) === day(now).slice(0, 4);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
  return `Last signed in ${date}`;
}

/** Owners first, then by name. */
export const byTeamOrder = (a: Person, b: Person) =>
  a.role === b.role ? a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) : a.role === "owner" ? -1 : 1;
