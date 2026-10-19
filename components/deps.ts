// Browser-side access to the engine and the Chog data. The metadata file stays on the
// server (app/api/chog), so lib/chain is never pulled into the client bundle.
import type { ChogMeta } from "@/lib/types";
export { generateBoard, saltCommit } from "@/lib/engine";

export async function getChogMeta(id: number): Promise<ChogMeta> {
  const r = await fetch(`/api/chog?id=${id}`);
  if (!r.ok) throw new Error("no chog");
  return r.json();
}

export async function getOwnedChogMetas(address: string): Promise<ChogMeta[]> {
  const r = await fetch(`/api/chog?owner=${address}`, { cache: "no-store" });
  if (!r.ok) throw new Error("no chogs");
  return r.json();
}
