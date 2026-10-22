// Daily Pot server rules. Pure logic with every outside call passed in, so it can be tested
// without a chain, a wallet or a network.
import { recoverMessageAddress, type Hex } from "viem";
import type { Board } from "./types";
import { checkPotRun } from "./pot";
import { pickPotWinners, potPayouts, type PotFinisher } from "./potSettle";
import { rankPotRuns, type PotRun, type PotRunStore } from "./records";
import type { PotChain, PotSettler } from "./potChain";
import {
  POT_FINISH_GRACE_MS,
  POT_SETTLE_WINDOW_MS,
  potDateOf,
  potDayEndMs,
  potDayOf,
  potMessage,
} from "./pot-message";

export type PotDeps = {
  store: PotRunStore;
  chain: Pick<PotChain, "hasEntered">;
  chogOfDay: (date: string) => number;
  boardFor: (date: string) => Promise<Board>; // rebuilds the day's board on the server
  now?: () => number;
  recover?: (message: string, signature: string) => Promise<string>;
};

export type PotError = { ok: false; status: number; error: string };

const recoverDefault = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex });

async function whoSigned(deps: PotDeps, address: unknown, signature: unknown, date: string): Promise<string | PotError> {
  if (typeof address !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return { ok: false, status: 400, error: "Connect your wallet and sign to start." };
  try {
    const who = await (deps.recover ?? recoverDefault)(potMessage(date), signature);
    if (who.toLowerCase() !== address.toLowerCase()) return { ok: false, status: 401, error: "That signature does not match your wallet." };
    return who.toLowerCase();
  } catch {
    return { ok: false, status: 401, error: "Could not read that signature." };
  }
}

// Rule 1: a run only counts if it starts after the wallet's entry is on chain. The server checks
// hasEntered(today, wallet) at the moment of Start, then records startedAt on its own clock.
// One counted run per entry per day (the store's start is atomic).
export async function startPotRun(
  deps: PotDeps,
  input: { address: unknown; signature: unknown; day?: unknown },
): Promise<{ ok: true; run: PotRun } | PotError | { ok: false; status: 409; error: string; run: PotRun }> {
  const now = (deps.now ?? Date.now)();
  const day = potDayOf(now);
  const date = potDateOf(day);
  if (input.day !== undefined && input.day !== day)
    return { ok: false, status: 400, error: "That pot day is over. Reload the page for today's pot." };
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  let entered: boolean;
  try {
    entered = await deps.chain.hasEntered(day, who);
  } catch {
    return { ok: false, status: 503, error: "Could not check the pot contract just now. Nothing was used up. Try again in a moment." };
  }
  if (!entered) return { ok: false, status: 403, error: "This wallet has not entered today's pot yet. Enter first, then start." };
  const out = await deps.store.potStart({ day, date, wallet: who, tokenId: deps.chogOfDay(date), startedAt: now });
  if (!out.ok) return { ok: false, status: 409, error: "You already used today's pot run.", run: out.run };
  return { ok: true, run: out.run };
}

// Rule 2: the browser sends only the move list. The server rebuilds the board, replays the moves
// and times the run on its own clock. Anything that is not a clear uses up the try.
export async function finishPotRun(
  deps: PotDeps,
  input: { address: unknown; signature: unknown; day: unknown; moves: unknown },
): Promise<{ ok: true; run: PotRun; rank: number | null; counted: boolean; reason?: string } | PotError> {
  const now = (deps.now ?? Date.now)();
  const today = potDayOf(now);
  const day = input.day;
  if (typeof day !== "number" || !Number.isInteger(day)) return { ok: false, status: 400, error: "Missing pot day." };
  // A run started just before midnight may finish a little after it.
  const open = day === today || (day === today - 1 && now < potDayEndMs(day) + POT_FINISH_GRACE_MS);
  if (!open) return { ok: false, status: 400, error: "That pot day is closed." };
  const date = potDateOf(day);
  const who = await whoSigned(deps, input.address, input.signature, date);
  if (typeof who !== "string") return who;
  const cur = await deps.store.potRun(day, who);
  if (!cur) return { ok: false, status: 400, error: "Press Start before finishing a pot run." };
  if (cur.finishedAt) return { ok: false, status: 409, error: "Your pot run for this day is already recorded." };

  const board = await deps.boardFor(date);
  const check = checkPotRun(board, input.moves, cur.startedAt, now);
  const elapsed = Math.round(((now - cur.startedAt) / 1000) * 10) / 10;
  const moves = Array.isArray(input.moves) ? input.moves.filter((m) => (m as { action?: unknown })?.action !== "flag").length : 0;
  const result = check.ok
    ? { won: true, seconds: check.seconds, moves: check.moves, at: now }
    : { won: false, seconds: elapsed, moves, at: now, reason: check.error };
  const out = await deps.store.potFinish(day, who, result);
  if (!out.ok) return { ok: false, status: 409, error: out.reason === "not-started" ? "Press Start first." : "Your pot run for this day is already recorded." };
  const ranked = rankPotRuns(await deps.store.potRuns(day));
  const idx = ranked.findIndex((r) => r.wallet === who);
  return { ok: true, run: out.run, rank: idx >= 0 ? idx + 1 : null, counted: check.ok, ...(check.ok ? {} : { reason: check.error }) };
}

// ---------------------------------------------------------------- settling (rule 3)

export type SettleOutcome =
  | { day: number; status: "not-over" | "window-closed" | "already-settled" | "refund-open" | "empty" | "reading" }
  | { day: number; status: "settled"; winners: string[]; tx: string }
  | { day: number; status: "refused"; error: string }
  | { day: number; status: "failed"; error: string };

export type SettleDeps = {
  store: PotRunStore;
  chain: PotChain;
  settler: PotSettler;
  now?: () => number;
  budgetMs?: number; // time allowed for reading entrant lists in one call
  log?: (msg: string) => void; // loud errors go here (console.error by default)
};

// Which days could still be settled now: ended (plus the finish grace), and inside the 7-day window.
export function settleCandidates(now: number): number[] {
  const today = potDayOf(now);
  const out: number[] = [];
  for (let d = today - 8; d < today; d++) {
    const end = potDayEndMs(d);
    if (now < end + POT_FINISH_GRACE_MS) continue;
    if (now >= end + POT_SETTLE_WINDOW_MS) continue; // only refunds now, handled on chain
    out.push(d);
  }
  return out;
}

export async function settleDay(deps: SettleDeps, day: number, deadline: number): Promise<SettleOutcome> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? ((m: string) => console.error(m));
  const end = potDayEndMs(day);
  if (now < end + POT_FINISH_GRACE_MS) return { day, status: "not-over" };
  if (now >= end + POT_SETTLE_WINDOW_MS) return { day, status: "window-closed" };

  const info = await deps.chain.dayInfo(day);
  if (info.settled) return { day, status: "already-settled" };
  if (info.refundOpen) return { day, status: "refund-open" };

  const count = await deps.chain.entrantCount(day);
  if (count === 0) {
    if (info.carriedIn === 0n) return { day, status: "empty" };
    // Nobody entered, but money had rolled in: settle with no winners so it moves on to today's pot.
    try {
      const tx = await deps.settler.settle(day, []);
      return { day, status: "settled", winners: [], tx };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log(`[pot] settle(${day}) with no winners failed: ${error}`);
      return { day, status: "failed", error };
    }
  }

  const budget = Math.max(0, deadline - (deps.now ?? Date.now)());
  const saved = await deps.store.potScanGet(day);
  const { scan, done } = await deps.chain.readEntrants(day, saved, budget);
  await deps.store.potScanSet(day, scan);
  if (!done) return { day, status: "reading" };

  const entrants = scan.wallets;
  if (entrants.length === 0 || entrants.length !== count) {
    const error = `entrantCount(${day}) is ${count} but ${entrants.length} entrants were read from the chain. Not settling.`;
    log(`[pot] LOUD: REFUSING TO SETTLE DAY ${day}. ${error}`);
    // Start the read again from scratch next time, in case a block range was missed.
    await deps.store.potScanSet(day, { ...scan, next: scan.from, wallets: [] });
    return { day, status: "refused", error };
  }

  const finishers: PotFinisher[] = rankPotRuns(await deps.store.potRuns(day)).map((r) => ({
    wallet: r.wallet,
    seconds: r.seconds!,
    finishedAt: r.finishedAt ?? 0,
  }));
  const winners = pickPotWinners(finishers, entrants);
  try {
    const tx = await deps.settler.settle(day, winners);
    return { day, status: "settled", winners, tx };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`[pot] settle(${day}) failed: ${error}`);
    return { day, status: "failed", error };
  }
}

// Settles every day that can be settled now, oldest first. Skips settled days, does nothing for
// days past the 7-day window (refunds are on chain).
export async function settleDue(deps: SettleDeps): Promise<SettleOutcome[]> {
  const now = (deps.now ?? Date.now)();
  const deadline = now + (deps.budgetMs ?? 40_000);
  const out: SettleOutcome[] = [];
  for (const day of settleCandidates(now)) {
    try {
      out.push(await settleDay(deps, day, deadline));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      (deps.log ?? ((m: string) => console.error(m)))(`[pot] could not settle day ${day}: ${error}`);
      out.push({ day, status: "failed", error });
    }
  }
  return out;
}

// ---------------------------------------------------------------- standings for the page

export type PotStanding = { rank: number; wallet: string; seconds: number; payout: string | null };

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

// Fastest clears, with what each of the top 3 would earn from `pot` if the day ended now.
export function standings(runs: PotRun[], pot: bigint, limit = 10): PotStanding[] {
  const ranked = rankPotRuns(runs);
  const pay = potPayouts(pot, Math.min(3, ranked.length));
  return ranked.slice(0, limit).map((r, i) => ({ rank: i + 1, wallet: short(r.wallet), seconds: r.seconds!, payout: i < pay.length ? pay[i].toString() : null }));
}
