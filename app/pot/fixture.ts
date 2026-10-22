// Development only: made-up Daily Pot data so every page state can be seen without a wallet or a
// deployed contract. Used only when NODE_ENV is "development" and the URL has ?preview=STATE.
import type { PotSummary } from "@/lib/potView";

export const PREVIEW_STATES = [
  "not-deployed", "connect", "wrong-network", "enter", "approved", "closed", "paused", "low-balance",
  "entered", "playing", "won", "lost", "claim", "refund",
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

const E18 = 10n ** 18n;
const amt = (n: number) => (BigInt(Math.round(n * 100)) * E18 / 100n).toString();

export function previewSummary(state: PreviewState, now = Date.now()): PotSummary {
  const day = Math.floor(now / 86_400_000);
  const endsAt = (day + 1) * 86_400_000;
  const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
  const ydate = new Date((day - 1) * 86_400_000).toISOString().slice(0, 10);
  const base: PotSummary = {
    deployed: state !== "not-deployed",
    contract: state === "not-deployed" ? null : "0x00000000000000000000000000000000000000f0",
    chainId: 143,
    day,
    date,
    tokenId: 7,
    meta: { id: 7, name: "Chog #7", image: "/chogs/7.webp" },
    endsAt: state === "closed" ? now + 6 * 60_000 : endsAt,
    entryClosesAt: state === "closed" ? now - 4 * 60_000 : endsAt - 10 * 60_000,
    settleAfter: endsAt + 15 * 60_000,
    token: { address: "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777", symbol: "CHOG", decimals: 18 },
    minEntry: amt(100),
    potSize: amt(1250),
    carriedIn: amt(250),
    entrants: 10,
    paused: state === "paused",
    clears: 4,
    standings: [
      { rank: 1, wallet: "0x91f2…a3c0", seconds: 38.4, payout: amt(750) },
      { rank: 2, wallet: "0x07bd…11e9", seconds: 44.9, payout: amt(312.5) },
      { rank: 3, wallet: "0xc4a0…9d72", seconds: 51.2, payout: amt(187.5) },
      { rank: 4, wallet: "0x5e33…0b4f", seconds: 63, payout: null },
    ],
    yesterday: {
      day: day - 1,
      date: ydate,
      tokenId: 1468,
      settled: true,
      refundOpen: false,
      potSize: amt(800),
      entrants: 8,
      winners: [
        { rank: 1, wallet: "0x2b8e…77d1", amount: amt(480) },
        { rank: 2, wallet: "0x91f2…a3c0", amount: amt(200) },
        { rank: 3, wallet: "0xe0c5…4a18", amount: amt(120) },
      ],
      standings: [],
    },
  };
  if (state === "not-deployed") {
    return { ...base, token: null, minEntry: null, potSize: null, carriedIn: null, entrants: null, standings: base.standings.map((s) => ({ ...s, payout: null })) };
  }
  const mine: NonNullable<PotSummary["mine"]> = {
    entered: false, entry: "0", claimable: "0", allowance: "0", balance: amt(2400), run: null, refunds: [],
  };
  if (state === "approved") mine.allowance = amt(100);
  if (state === "low-balance") mine.balance = amt(40);
  if (["entered", "playing", "won", "lost", "claim"].includes(state)) { mine.entered = true; mine.entry = amt(100); }
  if (state === "won") mine.run = { started: true, finished: true, won: true, seconds: 44.9, rank: 2 };
  if (state === "lost") mine.run = { started: true, finished: true, won: false, seconds: 12.2, rank: null, reason: "Those moves do not clear the board." };
  if (state === "claim") { mine.claimable = amt(200); mine.run = { started: true, finished: true, won: true, seconds: 51.2, rank: 3 }; }
  if (state === "refund") mine.refunds = [{ day: day - 9, date: new Date((day - 9) * 86_400_000).toISOString().slice(0, 10), amount: amt(100), open: false }];
  return { ...base, mine };
}
