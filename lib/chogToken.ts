// $CHOG bonus perk. Read only: one balanceOf call, no signing, no spending.
// Holding the token is a bonus, never needed to play.
import { createPublicClient, defineChain, erc20Abi, formatUnits, getAddress, http, isAddress } from "viem";
import { MONAD_CHAIN_ID, MONAD_RPC } from "./types";
import type { Board } from "./types";

export const CHOG_TOKEN = "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777" as const;
export const CHOG_DECIMALS = 18;
export const HOLDER_THRESHOLD = 1000n; // whole CHOG needed for the perk
export const HOLDER_HINTS = 1; // safe-tile hints per board for holders

export type Tier = "none" | "holder";

export type BonusInfo = {
  address: string;
  available: boolean; // false when the balance could not be read
  raw: string; // balance in the token's smallest unit, as text
  balance: string; // whole CHOG, e.g. "1250.5"
  tier: Tier;
  hints: number;
  threshold: number;
};

export type ReadClient = {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof erc20Abi;
    functionName: "balanceOf";
    args: [`0x${string}`];
  }) => Promise<bigint>;
};

const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
});

export function defaultClient(): ReadClient {
  return createPublicClient({ chain: monad, transport: http(MONAD_RPC, { timeout: 8000, retryCount: 1 }) }) as unknown as ReadClient;
}

export function tierFor(raw: bigint): { tier: Tier; hints: number } {
  return raw >= HOLDER_THRESHOLD * 10n ** BigInt(CHOG_DECIMALS)
    ? { tier: "holder", hints: HOLDER_HINTS }
    : { tier: "none", hints: 0 };
}

// Whole-token text with at most 2 decimals, cut not rounded, so a near miss never looks like a pass.
export function formatChog(raw: bigint): string {
  const [whole, frac = ""] = formatUnits(raw, CHOG_DECIMALS).split(".");
  const f = frac.slice(0, 2).replace(/0+$/, "");
  return f ? `${whole}.${f}` : whole;
}

export async function getBonus(address: string, client: ReadClient = defaultClient()): Promise<BonusInfo> {
  if (!isAddress(address, { strict: false })) throw new Error("bad address");
  const addr = getAddress(address.toLowerCase());
  const base = { address: addr, threshold: Number(HOLDER_THRESHOLD) };
  try {
    const raw = await client.readContract({ address: CHOG_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
    return { ...base, available: true, raw: raw.toString(), balance: formatChog(raw), ...tierFor(raw) };
  } catch {
    return { ...base, available: false, raw: "0", balance: "0", tier: "none", hints: 0 };
  }
}

// One guaranteed safe tile: hidden, not flagged, not a mine. Prefers the tile with the most
// opened neighbours so the hint is useful, ties go to the lowest index. Pure and deterministic.
// Only call after the first reveal, because the first click can move mines.
export function pickSafeHint(board: Board, revealed: boolean[], flagged: boolean[]): number | null {
  const { cols, rows, cells } = board;
  let best: number | null = null;
  let bestScore = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].mine || revealed[i] || flagged[i]) continue;
    let score = 0;
    const x = i % cols, y = Math.floor(i / cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && revealed[ny * cols + nx]) score++;
    }
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}
