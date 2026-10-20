import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display, Parisienne } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-dm-serif" });
const parisienne = Parisienne({ subsets: ["latin"], weight: "400", variable: "--font-parisienne" });

export const metadata: Metadata = {
  title: { default: "Dausis Plate · Mama’s Flavour", template: "%s · Dausis Plate" },
  description: "Today’s menu, ordering for dine-in, pickup and delivery.",
  icons: { icon: "/brand/dausis-plate-icon.svg" },
};

export const viewport: Viewport = { themeColor: "#006b66", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable} ${parisienne.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
