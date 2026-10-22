import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { potEnabled } from "@/lib/potFlag";
import PotClient from "./PotClient";

export const metadata: Metadata = {
  title: "Daily Pot",
  description: "An optional race on today's Chog of the day board. Pay a CHOG entry, play one counted run, and the three fastest clears split the pot.",
};

// The page does not exist unless POT_ENABLED is exactly "true" (checked on every request).
export default async function PotPage() {
  await connection();
  if (!potEnabled()) notFound();
  return <PotClient dev={process.env.NODE_ENV === "development"} />;
}
