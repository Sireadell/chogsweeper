import { describe, expect, it } from "vitest";
import { pickPotWinners, potPayouts, potShares, type PotFinisher } from "./potSettle";
import { potEnabled, potGate } from "./potFlag";
import { rankCotd, type CotdEntry } from "./records";
import { chogPotAbi } from "./potAbi";

const W = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
// Every wallet in the list paid in (the entrant list is required).
const all = (f: { wallet: string }[]) => f.map((x) => x.wallet);

describe("pickPotWinners", () => {
  it("returns the 3 fastest, fastest first", () => {
    const f: PotFinisher[] = [
      { wallet: W(1), seconds: 40, finishedAt: 1 },
      { wallet: W(2), seconds: 20, finishedAt: 2 },
      { wallet: W(3), seconds: 30, finishedAt: 3 },
      { wallet: W(4), seconds: 10, finishedAt: 4 },
    ];
    expect(pickPotWinners(f, all(f))).toEqual([W(4), W(2), W(3)]);
  });

  it("ties go to whoever finished first", () => {
    const f: PotFinisher[] = [
      { wallet: W(1), seconds: 12.3, finishedAt: 500 },
      { wallet: W(2), seconds: 12.3, finishedAt: 100 },
    ];
    expect(pickPotWinners(f, all(f))).toEqual([W(2), W(1)]);
  });

  it("a full tie is settled by wallet so input order never matters", () => {
    const a = { wallet: W(9), seconds: 5, finishedAt: 7 };
    const b = { wallet: W(3), seconds: 5, finishedAt: 7 };
    expect(pickPotWinners([a, b], [W(3), W(9)])).toEqual([W(3), W(9)]);
    expect(pickPotWinners([b, a], [W(9), W(3)])).toEqual([W(3), W(9)]);
  });

  it("matches rankCotd order on the same day", () => {
    const entries: CotdEntry[] = [
      { date: "d", wallet: W(1), tokenId: 1, startedAt: 0, finishedAt: 30, won: true, seconds: 9 },
      { date: "d", wallet: W(2), tokenId: 1, startedAt: 0, finishedAt: 10, won: true, seconds: 9 },
      { date: "d", wallet: W(3), tokenId: 1, startedAt: 0, finishedAt: 20, won: true, seconds: 4 },
      { date: "d", wallet: W(4), tokenId: 1, startedAt: 0, finishedAt: 5, won: true, seconds: 11 },
    ];
    const fromCotd = rankCotd(entries).slice(0, 3).map((e) => e.wallet);
    const fromPot = pickPotWinners(entries.map((e) => ({ wallet: e.wallet, seconds: e.seconds!, finishedAt: e.finishedAt! })), all(entries));
    expect(fromPot).toEqual(fromCotd);
  });

  it("lowercases wallets and lets a wallet win only once", () => {
    const upper = `0x${"AB".repeat(20)}`;
    const f: PotFinisher[] = [
      { wallet: upper, seconds: 5, finishedAt: 1 },
      { wallet: upper.toLowerCase(), seconds: 6, finishedAt: 2 },
      { wallet: W(2), seconds: 7, finishedAt: 3 },
    ];
    expect(pickPotWinners(f, [upper, W(2)])).toEqual([upper.toLowerCase(), W(2)]);
  });

  it("drops bad rows", () => {
    const f = [
      { wallet: "not-an-address", seconds: 1, finishedAt: 1 },
      { wallet: W(1), seconds: Number.NaN, finishedAt: 1 },
      { wallet: W(2), seconds: 0, finishedAt: 1 },
      { wallet: W(3), seconds: -4, finishedAt: 1 },
      { wallet: W(4), seconds: Infinity, finishedAt: 1 },
      { wallet: W(5), seconds: 8, finishedAt: Number.NaN },
      { wallet: W(6), seconds: 8, finishedAt: 1 },
    ] as PotFinisher[];
    expect(pickPotWinners(f, [W(1), W(2), W(3), W(4), W(5), W(6)])).toEqual([W(6)]);
  });

  it("only counts wallets that paid in when the entrant list is given", () => {
    const f: PotFinisher[] = [
      { wallet: W(1), seconds: 1, finishedAt: 1 },
      { wallet: W(2), seconds: 2, finishedAt: 2 },
      { wallet: W(3), seconds: 3, finishedAt: 3 },
    ];
    expect(pickPotWinners(f, [W(3).toUpperCase().replace("0X", "0x"), W(2)])).toEqual([W(2), W(3)]);
  });

  it("returns 1 or 2 when that is all there is, and none when entrants paid but nobody cleared", () => {
    expect(pickPotWinners([{ wallet: W(1), seconds: 3, finishedAt: 1 }], [W(1), W(2)])).toEqual([W(1)]);
    expect(pickPotWinners([], [W(1), W(2)])).toEqual([]);
  });

  it("refuses a missing or empty entrant list, so a failed chain read never means no winners", () => {
    const f: PotFinisher[] = [{ wallet: W(1), seconds: 3, finishedAt: 1 }];
    expect(() => pickPotWinners(f, [])).toThrow(/empty/);
    expect(() => pickPotWinners([], [])).toThrow(/empty/);
    expect(() => pickPotWinners(f, new Set<string>())).toThrow(/empty/);
    expect(() => pickPotWinners(f, undefined as unknown as string[])).toThrow(/entrant list/);
    expect(() => pickPotWinners(f, null as unknown as string[])).toThrow(/entrant list/);
    expect(() => pickPotWinners(f, W(1) as unknown as string[])).toThrow(/entrant list/);
  });

  it("drops a fast finisher who is not on the chain's entrant list", () => {
    const f: PotFinisher[] = [
      { wallet: W(7), seconds: 1, finishedAt: 1 },
      { wallet: W(8), seconds: 9, finishedAt: 2 },
    ];
    expect(pickPotWinners(f, [W(8)])).toEqual([W(8)]);
  });
});

describe("potPayouts", () => {
  it("splits 60/25/15, 70/30 or 100 like the contract", () => {
    expect(potPayouts(1000n, 3)).toEqual([600n, 250n, 150n]);
    expect(potPayouts(1000n, 2)).toEqual([700n, 300n]);
    expect(potPayouts(1000n, 1)).toEqual([1000n]);
    expect(potPayouts(1000n, 0)).toEqual([]);
    expect(potPayouts(1000n, 9)).toEqual([600n, 250n, 150n]);
  });
  it("gives rounding dust to first place so the parts add up to the pot", () => {
    const pot = 10n ** 18n * 7n + 3n;
    for (const n of [1, 2, 3]) {
      const p = potPayouts(pot, n);
      expect(p.reduce((a, b) => a + b, 0n)).toBe(pot);
    }
    expect(potPayouts(7n, 3)).toEqual([5n, 1n, 1n]);
  });
  it("shares match the payouts", () => {
    expect(potShares(3)).toEqual([60, 25, 15]);
    expect(potShares(2)).toEqual([70, 30]);
    expect(potShares(1)).toEqual([100]);
    expect(potShares(0)).toEqual([]);
  });
});

describe("pot feature flag", () => {
  it("is on only for exactly \"true\"", () => {
    expect(potEnabled({ POT_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "TRUE", "True", "1", "yes", " true", "true "]) {
      expect(potEnabled({ POT_ENABLED: v })).toBe(false);
    }
    expect(potEnabled({})).toBe(false);
  });

  it("the gate answers 404 when off and steps aside when on", () => {
    expect(potGate({})?.status).toBe(404);
    expect(potGate({ POT_ENABLED: "true" })).toBeNull();
  });
});

describe("pot ABI for the website", () => {
  it("has the functions the website and settler need", () => {
    const names = chogPotAbi.filter((x) => x.type === "function").map((x) => (x as { name: string }).name);
    for (const n of ["enter", "claim", "claimRefund", "refund", "settle", "potSize", "entrantCount", "hasEntered", "claimable", "isSettled", "minEntry", "currentDay"]) {
      expect(names).toContain(n);
    }
    expect(names.some((n) => /withdraw|sweep|rescue/i.test(n))).toBe(false);
  });
});
