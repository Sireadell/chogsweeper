import { NextResponse } from "next/server";
import { getPotStore } from "@/lib/records";
import { potGate } from "@/lib/potFlag";
import { makePotChain, makePotSettler, potConfig } from "@/lib/potChain";
import { settleDue } from "@/lib/potServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the Vercel timer after each UTC day ends. Posts the winners of every finished,
// unsettled day still inside the 7-day settle window, from the settler wallet (POT_SETTLER_KEY).
// Protected by CRON_SECRET exactly like /api/cron/post-commit.
export async function GET(req: Request) {
  const off = potGate();
  if (off) return off;
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const { address, rpc } = potConfig();
  if (!address) return NextResponse.json({ error: "NEXT_PUBLIC_POT_ADDRESS is not set." }, { status: 500 });
  try {
    const settler = makePotSettler(address, rpc);
    if (!settler) return NextResponse.json({ error: "No settler wallet is set up on the server." }, { status: 500 });
    const results = await settleDue({ store: getPotStore(), chain: makePotChain(address, rpc), settler, budgetMs: 40_000 });
    const bad = results.some((r) => r.status === "refused" || r.status === "failed");
    return NextResponse.json({ ok: !bad, results }, { status: bad ? 500 : 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed.";
    console.error(`[pot] settle run failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
