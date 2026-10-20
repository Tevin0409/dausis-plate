import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next?.startsWith("/dashboard") ? next : "/dashboard";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-mist px-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-line bg-white p-7">
        <div className="flex items-center gap-2.5">
          <Image src="/brand/dausis-plate-icon.svg" alt="" width={40} height={40} />
          <span className="font-display text-2xl">Dausis Plate</span>
        </div>
        <div>
          <h1 className="font-display text-[28px] leading-tight">Kitchen dashboard</h1>
          <p className="mt-1 text-[15px] text-ink-soft">Staff sign-in.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-sm text-coral-ink">
            That sign-in link didn’t work. Links only work in the browser that asked for them and expire after an hour. Sign in with your password, or request a new link from this browser.
          </p>
        )}
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}
