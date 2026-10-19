import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getBonus } from "@/lib/chogToken";

export const dynamic = "force-dynamic";

// Read only: the $CHOG balance of a wallet and the bonus tier it unlocks.
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address, { strict: false }))
    return NextResponse.json({ error: "Use a wallet address like 0x1234...abcd." }, { status: 400 });
  const info = await getBonus(address);
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
