import { getStaff } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const staff = await getStaff();
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <header>
        <h1 className="font-display text-[34px] leading-tight">Your account</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Signed in as {staff?.email}</p>
      </header>
      <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-white p-6">
        <div>
          <h2 className="text-[17px] font-bold">Password</h2>
          <p className="text-sm text-ink-soft">Set a password to sign in instantly, without waiting for an email.</p>
        </div>
        <PasswordForm />
      </section>
    </div>
  );
}
