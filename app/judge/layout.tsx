import type { Metadata } from "next";

export const metadata: Metadata = { title: "Judge mode", description: "Play any of the 1,969 Chogs right now. No wallet. Each Chog's traits change the rules of its board." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
