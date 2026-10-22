import { NextResponse } from "next/server";
import { getPotStore, rankPotRuns } from "@/lib/records";
import { getDailySalt } from "@/lib/salt";
import { chogOfDay, shortWallet } from "@/lib/cotd";
import { potGate } from "@/lib/potFlag";
import { makePotChain, potConfig, readPotPage } from "@/lib/potChain";
import { finishPotRun, standings, startPotRun, type PotDeps } from "@/lib/potServer";
import { POT_ENTRY_CUTOFF_MS, POT_FINISH_GRACE_MS, potDateOf, potDayEndMs, potDayOf } from "@/lib/pot-message";
import type { PotSummary } from "@/lib/potView";
import { MONAD_CHAIN_ID } from "@/lib/types";
import { generateBoard, getChogMeta } from "../_deps";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function boardFor(date: string) {
  const meta = await getChogMeta(chogOfDay(date));
  return generateBoard(meta, date, getDailySalt(date));
}

function deps(): PotDeps | null {
  const { address, rpc } = potConfig();
  if (!address) return null;
  return { store: getPotStore(), chain: makePotChain(address, rpc), chogOfDay, boardFor };
}

// Today's pot (size, entrants, minimum, standings with payouts), yesterday's result,
// and with ?address=0x.. that wallet's own entry, run, winnings and refunds.
export async function GET(req: Request) {
  const off = potGate();
  if (off) return off;
  try {
    const wallet = new URL(req.url).searchParams.get("address")?.toLowerCase() ?? null;
    const now = Date.now();
    const day = potDayOf(now);
    const date = potDateOf(day);
    const yDay = day - 1;
    const store = getPotStore();
    const [runs, yRuns] = await Promise.all([store.potRuns(day), store.potRuns(yDay)]);
    const tokenId = chogOfDay(date);
    const meta = await getChogMeta(tokenId);
    const { address, rpc } = potConfig();

    const out: PotSummary = {
      deployed: !!address,
      contract: address,
      chainId: MONAD_CHAIN_ID,
      day,
      date,
      tokenId,
      meta: { id: meta.id, name: meta.name, image: meta.image },
      endsAt: potDayEndMs(day),
      entryClosesAt: potDayEndMs(day) - POT_ENTRY_CUTOFF_MS,
      settleAfter: potDayEndMs(day) + POT_FINISH_GRACE_MS,
      token: null,
      minEntry: null,
      potSize: null,
      carriedIn: null,
      entrants: null,
      paused: false,
      clears: rankPotRuns(runs).length,
      standings: standings(runs, 0n),
      yesterday: {
        day: yDay,
        date: potDateOf(yDay),
        tokenId: chogOfDay(potDateOf(yDay)),
        settled: null,
        refundOpen: null,
        potSize: null,
        entrants: null,
        winners: [],
        standings: standings(yRuns, 0n),
      },
    };

    const myRun = wallet ? runs.find((r) => r.wallet === wallet) ?? null : null;
    const ranked = rankPotRuns(runs);
    const runView = myRun
      ? {
          started: true,
          finished: !!myRun.finishedAt,
          won: myRun.won,
          seconds: myRun.seconds,
          rank: (() => { const i = ranked.findIndex((r) => r.wallet === wallet); return i >= 0 ? i + 1 : null; })(),
          reason: myRun.reason,
        }
      : null;

    if (address) {
      try {
        const r = await readPotPage(address, rpc, day, wallet);
        const pot = r.today.entries + r.today.carriedIn;
        const yPot = r.yesterday.entries + r.yesterday.carriedIn;
        out.token = { address: r.token, symbol: r.symbol, decimals: r.decimals };
        out.minEntry = r.minEntry.toString();
        out.potSize = pot.toString();
        out.carriedIn = r.today.carriedIn.toString();
        out.entrants = r.today.entrants;
        out.paused = r.paused;
        out.standings = standings(runs, pot);
        out.yesterday = {
          ...out.yesterday,
          settled: r.yesterday.settled,
          refundOpen: r.yesterday.refundOpen,
          potSize: yPot.toString(),
          entrants: r.yesterday.entrants,
          winners: r.yesterdayWinners.map((w, i) => ({ rank: i + 1, wallet: shortWallet(w.wallet), amount: w.amount.toString() })),
          standings: standings(yRuns, yPot),
        };
        if (r.me) {
          out.mine = {
            entered: r.me.entered,
            entry: r.me.entry.toString(),
            claimable: r.me.claimable.toString(),
            allowance: r.me.allowance.toString(),
            balance: r.me.balance.toString(),
            run: runView,
            refunds: r.me.refunds.map((x) => ({ day: x.day, date: potDateOf(x.day), amount: x.amount.toString(), open: x.open })),
          };
        }
      } catch {
        out.chainError = "Could not read the pot contract just now. Amounts may be missing. Reload in a moment.";
      }
    }
    return NextResponse.json(out, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not load the Daily Pot." }, { status: 500 });
  }
}

// { action: "start", address, signature, day } opens the one counted run and returns the board.
// { action: "finish", address, signature, day, moves } replays the moves and records the result.
export async function POST(req: Request) {
  const off = potGate();
  if (off) return off;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const d = deps();
  if (!d) return NextResponse.json({ error: "The Daily Pot is not open yet." }, { status: 503 });
  try {
    if (b.action === "start") {
      const out = await startPotRun(d, { address: b.address, signature: b.signature, day: b.day });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      const meta = await getChogMeta(out.run.tokenId);
      const board = generateBoard(meta, out.run.date, getDailySalt(out.run.date));
      return NextResponse.json({ board, meta, day: out.run.day, startedAt: out.run.startedAt }, { headers: NO_STORE });
    }
    if (b.action === "finish") {
      const out = await finishPotRun(d, { address: b.address, signature: b.signature, day: b.day, moves: b.moves });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
      return NextResponse.json(
        { counted: out.counted, won: out.run.won, seconds: out.run.seconds, rank: out.rank, reason: out.reason ?? null },
        { headers: NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
