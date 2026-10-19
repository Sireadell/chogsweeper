import { describe, it, expect } from "vitest";
import { getBonus, formatChog, tierFor, pickSafeHint, HOLDER_THRESHOLD, type ReadClient } from "./chogToken";
import type { Board } from "./types";

const E18 = 10n ** 18n;
const fake = (bal: bigint | Error): ReadClient => ({
  readContract: async () => { if (bal instanceof Error) throw bal; return bal; },
});
const ADDR = "0x000000000000000000000000000000000000dEaD";

describe("chogToken", () => {
  it("zero balance means no perk", async () => {
    const r = await getBonus(ADDR, fake(0n));
    expect(r).toMatchObject({ available: true, balance: "0", tier: "none", hints: 0 });
  });
  it("exactly the threshold unlocks one hint", async () => {
    const r = await getBonus(ADDR, fake(HOLDER_THRESHOLD * E18));
    expect(r).toMatchObject({ tier: "holder", hints: 1, balance: "1000" });
  });
  it("one unit below the threshold does not", () => {
    expect(tierFor(HOLDER_THRESHOLD * E18 - 1n).tier).toBe("none");
  });
  it("formats with cut decimals", () => {
    expect(formatChog(1250_500000000000000000n)).toBe("1250.5");
    expect(formatChog(999_999999999999999999n)).toBe("999.99");
  });
  it("a failing read is reported as unavailable, not thrown", async () => {
    const r = await getBonus(ADDR, fake(new Error("rpc down")));
    expect(r).toMatchObject({ available: false, tier: "none", hints: 0 });
  });
  it("rejects a malformed address", async () => {
    await expect(getBonus("nope", fake(0n))).rejects.toThrow();
  });
});

describe("pickSafeHint", () => {
  // 3x3, mines at 0 and 8
  const cells = Array.from({ length: 9 }, (_, i) => ({ mine: i === 0 || i === 8, adj: 1 }));
  const board = { tokenId: 1, date: "2026-10-19", cols: 3, rows: 3, mines: 2, cells, rules: [], shields: 0, commit: "0x" } as Board;
  it("never returns a mine, a flag or an opened tile", () => {
    const revealed = Array(9).fill(false); revealed[4] = true;
    const flagged = Array(9).fill(false); flagged[1] = true;
    const h = pickSafeHint(board, revealed, flagged)!;
    expect(cells[h].mine).toBe(false);
    expect(revealed[h]).toBe(false);
    expect(flagged[h]).toBe(false);
  });
  it("is deterministic and null when nothing is left", () => {
    const none = Array(9).fill(false);
    expect(pickSafeHint(board, none, none)).toBe(pickSafeHint(board, none, none));
    const all = cells.map((c) => !c.mine);
    expect(pickSafeHint(board, all, Array(9).fill(false))).toBeNull();
  });
});
