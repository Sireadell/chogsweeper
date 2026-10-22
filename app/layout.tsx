import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://chogsweeper.vercel.app";
const TITLE = "Chogsweeper: your Chog is the board";
const DESCRIPTION =
  "Every Chog Genesis NFT is its own daily minesweeper board. Its traits change the rules, and clearing the board reveals the Chog's art. Try any of the 1,969 Chogs with no wallet.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: { default: TITLE, template: "%s | Chogsweeper" },
  description: DESCRIPTION,
  applicationName: "Chogsweeper",
  openGraph: { type: "website", siteName: "Chogsweeper", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0814" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
