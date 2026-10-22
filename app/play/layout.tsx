import type { Metadata } from "next";

export const metadata: Metadata = { title: "Play my Chogs", description: "Connect the wallet that holds your Chog Genesis NFTs. Each Chog gets one ranked board a day." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
