import type { Metadata } from "next";

export const metadata: Metadata = { title: "Chog of the day", description: "One shared Chog board for everyone today. Holders get one ranked try, fastest clear wins." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
