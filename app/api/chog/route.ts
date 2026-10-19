import { NextResponse } from "next/server";
import { CHOG_SUPPLY, type ChogMeta } from "@/lib/types";
import { getChogMeta, getOwnedChogs } from "@/lib/chain";

export const dynamic = "force-dynamic";

// Keeps the big metadata file on the server. ?id=N gives one Chog, ?owner=0x.. gives the Chogs a wallet holds.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const owner = q.get("owner");
    if (owner) {
      const ids = await getOwnedChogs(owner);
      const metas: ChogMeta[] = await Promise.all(ids.map((id) => getChogMeta(id)));
      return NextResponse.json(metas, { headers: { "Cache-Control": "no-store" } });
    }
    const id = Number(q.get("id"));
    if (!Number.isInteger(id) || id < 1 || id > CHOG_SUPPLY)
      return NextResponse.json({ error: `Pick a Chog number from 1 to ${CHOG_SUPPLY}.` }, { status: 400 });
    return NextResponse.json(await getChogMeta(id), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Could not load that Chog." }, { status: 500 });
  }
}
