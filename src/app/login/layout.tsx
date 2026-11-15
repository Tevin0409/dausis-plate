import type { Viewport } from "next";

// The sign-in pages are cream to the top, so the status bar is too (spec-2.6 Layouts).
export const viewport: Viewport = { themeColor: "#fbf7f1" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
