import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chogsweeper: your Chog is the board",
  description: "Every Chog Genesis NFT is its own daily minesweeper board. Clear it to reveal your Chog's artwork.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c0916" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
