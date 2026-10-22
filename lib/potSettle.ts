// Daily Pot: who the settler wallet should post as winners once the UTC day is over.
// Pure, no network. The contract checks again on chain that every winner paid in that day.

export type PotFinisher = {
  wallet: string; // 0x address, any case
  seconds: number; // server-timed clear (see checkPotRun in lib/pot.ts)
  finishedAt: number; // ms since epoch, server clock
};

export const POT_MAX_WINNERS = 3;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Same order as rankCotd: fastest first, ties go to whoever finished first. If even the finish
// time is equal, the lower wallet address goes first so the answer never depends on input order.
// Bad rows (not an address, a time that is not a real positive number) are dropped, and a wallet
// can only win once.
//
// `entrants` (the wallets that paid in that day, read from the chain) is REQUIRED and must not be
// empty. A missing or empty list throws, so a failed chain read can never turn into "no winners"
// and quietly roll real money over. A day with zero entrants is settled without calling this.
export function pickPotWinners(finishers: PotFinisher[], entrants: Iterable<string>): `0x${string}`[] {
  if (entrants == null || typeof (entrants as Iterable<string>)[Symbol.iterator] !== "function" || typeof entrants === "string")
    throw new Error("pickPotWinners needs the day's entrant list from the chain.");
  const paid = new Set([...entrants].map((w) => String(w).toLowerCase()));
  if (paid.size === 0) throw new Error("pickPotWinners was given an empty entrant list. Refusing to pick winners.");
  const clean = finishers
    .filter((f) => typeof f.wallet === "string" && ADDRESS.test(f.wallet))
    .filter((f) => Number.isFinite(f.seconds) && f.seconds > 0 && Number.isFinite(f.finishedAt))
    .map((f) => ({ ...f, wallet: f.wallet.toLowerCase() }))
    .filter((f) => paid.has(f.wallet));

  clean.sort(
    (a, b) =>
      a.seconds - b.seconds ||
      a.finishedAt - b.finishedAt ||
      (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0),
  );

  const out: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const f of clean) {
    if (seen.has(f.wallet)) continue;
    seen.add(f.wallet);
    out.push(f.wallet as `0x${string}`);
    if (out.length === POT_MAX_WINNERS) break;
  }
  return out;
}

// What each place earns from a pot of `pot` (smallest token units), exactly as ChogPot.settle
// works it out: 60/25/15 for three winners, 70/30 for two, everything for one. Second and third
// are rounded down and first place takes the rest, so the parts always add up to the pot.
export function potPayouts(pot: bigint, winners: number): bigint[] {
  const n = Math.max(0, Math.min(POT_MAX_WINNERS, Math.floor(winners)));
  if (n === 0) return [];
  const out: bigint[] = new Array(n).fill(0n);
  if (n === 3) {
    out[1] = (pot * 2_500n) / 10_000n;
    out[2] = (pot * 1_500n) / 10_000n;
  } else if (n === 2) {
    out[1] = (pot * 3_000n) / 10_000n;
  }
  out[0] = pot - out.slice(1).reduce((a, b) => a + b, 0n);
  return out;
}

// Share of the pot for each place, as whole percents, for the page.
export function potShares(winners: number): number[] {
  const n = Math.max(0, Math.min(POT_MAX_WINNERS, Math.floor(winners)));
  return n === 3 ? [60, 25, 15] : n === 2 ? [70, 30] : n === 1 ? [100] : [];
}
