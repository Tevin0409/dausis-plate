import Image from "next/image";

/**
 * Sign in, Forgot password, Set your password and Not on the team (spec-2.6 Layouts): a 400 px card
 * centred on cream; below 600 px it is full width with 16 px gutters and a 48 px brand mark.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-cream px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-[calc(24px+env(safe-area-inset-top,0px))]">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-[var(--r-lg)] bg-paper p-6 shadow-[var(--shadow-card)] min-[600px]:p-8">
        <Image src="/brand/dausis-plate-icon.svg" alt="" width={56} height={56} priority className="size-12 min-[600px]:size-14" />
        {children}
      </div>
    </main>
  );
}
