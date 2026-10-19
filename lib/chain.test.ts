import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getOwnedChogs, getChogMeta, ownerOf } from "./chain";

const owners: Record<string, string> = JSON.parse(readFileSync("data/owners.json", "utf8"));
const holderCounts = new Map<string, number[]>();
for (const [id, o] of Object.entries(owners)) holderCounts.set(o, [...(holderCounts.get(o) ?? []), Number(id)]);
const [holder, held] = [...holderCounts].filter(([, ids]) => ids.length >= 2 && ids.length <= 10)[0];

describe("chain", () => {
  it("finds every Chog of a real holder", async () => {
    const got = await getOwnedChogs(holder);
    expect(got.sort((a, b) => a - b)).toEqual(held.sort((a, b) => a - b));
  }, 60000);

  it("returns [] for an empty wallet instantly", async () => {
    const t = Date.now();
    expect(await getOwnedChogs("0x000000000000000000000000000000000000dEaD")).toEqual([]);
    expect(Date.now() - t).toBeLessThan(5000);
  }, 20000);

  it("returns [] for a malformed address", async () => {
    expect(await getOwnedChogs("nope")).toEqual([]);
  });

  it("ownerOf matches the snapshot", async () => {
    expect((await ownerOf(1)).toLowerCase()).toBe(owners["1"]);
  }, 20000);

  it("getChogMeta reads cached data", async () => {
    const m = await getChogMeta(1);
    expect(m.id).toBe(1);
    expect(m.image.startsWith("https://")).toBe(true);
    expect(m.traits.length).toBeGreaterThanOrEqual(9);
    await expect(getChogMeta(99999)).rejects.toThrow();
  });
});
