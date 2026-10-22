// Daily Pot: everything the server reads from (or sends to) the ChogPot contract on Monad.
// Server only. The settler key is read from POT_SETTLER_KEY at the moment of sending and is
// never logged, returned or stored.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chogPotAbi } from "./potAbi";
import { MONAD_CHAIN_ID } from "./types";
import type { PotScan } from "./records";

export const POT_DEFAULT_RPC = "https://rpc.monad.xyz";
const ENTERED = parseAbiItem("event Entered(uint256 indexed day, address indexed player, uint256 amount)");

export type PotDayInfo = { entries: bigint; carriedIn: bigint; entrants: number; settled: boolean; refundOpen: boolean };

export type PotChain = {
  hasEntered(day: number, wallet: string): Promise<boolean>;
  entrantCount(day: number): Promise<number>;
  dayInfo(day: number): Promise<PotDayInfo>;
  // Wallets that paid in on `day`, read from the Entered events. Resumable: pass the saved progress
  // and a time budget; `done` is false when it ran out of time and should be called again.
  readEntrants(day: number, saved: PotScan | null, budgetMs: number): Promise<{ scan: PotScan; done: boolean }>;
};

export type PotSettler = {
  // Checks the call first (simulation), then sends it and waits for it to land. Returns the transaction hash.
  settle(day: number, winners: `0x${string}`[]): Promise<Hex>;
};

export function potConfig(env: Record<string, string | undefined> = process.env) {
  const raw = env.NEXT_PUBLIC_POT_ADDRESS?.trim();
  const address = raw && isAddress(raw) ? (getAddress(raw) as `0x${string}`) : null;
  return { address, rpc: env.POT_RPC_URL?.trim() || POT_DEFAULT_RPC };
}

function monad(rpc: string) {
  return defineChain({
    id: MONAD_CHAIN_ID,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

export function publicPotClient(rpc: string) {
  return createPublicClient({ chain: monad(rpc), transport: http(rpc, { timeout: 10_000, retryCount: 2 }) });
}

// Many public RPCs cap how many blocks one log query may cover (Monad's public RPC: 100).
// Read the cap from the error text when there is one.
export function rangeLimitFrom(err: unknown): number | null {
  const text = err instanceof Error ? `${err.message} ${(err as { details?: string }).details ?? ""}` : String(err);
  const m = text.match(/limited to (?:a )?(\d+)/i) ?? text.match(/max(?:imum)? (?:block )?range(?: of| is)? (\d+)/i);
  return m ? Number(m[1]) : null;
}

// First block whose timestamp is at or after `ts` (seconds). Binary search, about 30 reads.
async function firstBlockAtOrAfter(getTs: (n: bigint) => Promise<bigint>, latest: bigint, ts: bigint): Promise<bigint> {
  let lo = 0n;
  let hi = latest + 1n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if ((await getTs(mid)) >= ts) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

export function makePotChain(address: `0x${string}`, rpc: string): PotChain {
  const client = publicPotClient(rpc);
  const read = <T>(functionName: string, args: unknown[]) =>
    client.readContract({ address, abi: chogPotAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  return {
    hasEntered: (day, wallet) => read<boolean>("hasEntered", [BigInt(day), getAddress(wallet)]),
    entrantCount: async (day) => Number(await read<bigint>("entrantCount", [BigInt(day)])),
    dayInfo: async (day) => {
      const [entries, carriedIn, entrants, settled, refundOpen] = await read<[bigint, bigint, bigint, boolean, boolean]>("dayInfo", [BigInt(day)]);
      return { entries, carriedIn, entrants: Number(entrants), settled, refundOpen };
    },
    readEntrants: async (day, saved, budgetMs) => {
      const t0 = Date.now();
      let scan = saved;
      if (!scan) {
        // Entries for `day` can only land in blocks stamped inside that UTC day.
        const latest = await client.getBlockNumber();
        const getTs = async (n: bigint) => (await client.getBlock({ blockNumber: n })).timestamp;
        const from = await firstBlockAtOrAfter(getTs, latest, BigInt(day) * 86_400n);
        const after = await firstBlockAtOrAfter(getTs, latest, BigInt(day + 1) * 86_400n);
        scan = { from: Number(from), to: Number(after) - 1, next: Number(from), wallets: [] };
      }
      const found = new Set(scan.wallets);
      let step = 10_000;
      let next = BigInt(scan.next);
      const to = BigInt(scan.to);
      const PARALLEL = 8;
      while (next <= to && Date.now() - t0 < budgetMs) {
        const ranges: [bigint, bigint][] = [];
        let a = next;
        for (let i = 0; i < PARALLEL && a <= to; i++) {
          const b = a + BigInt(step - 1) > to ? to : a + BigInt(step - 1);
          ranges.push([a, b]);
          a = b + 1n;
        }
        try {
          const batches = await Promise.all(
            ranges.map(([fromBlock, toBlock]) =>
              client.getLogs({ address, event: ENTERED, args: { day: BigInt(day) }, fromBlock, toBlock, strict: true }),
            ),
          );
          for (const logs of batches) for (const l of logs) if (l.args.player) found.add(l.args.player.toLowerCase());
          next = ranges[ranges.length - 1][1] + 1n;
        } catch (e) {
          const cap = rangeLimitFrom(e);
          if (cap && cap < step) step = cap;
          else if (step > 1) step = Math.max(1, Math.floor(step / 2));
          else throw e;
        }
      }
      const out: PotScan = { from: scan.from, to: scan.to, next: Number(next), wallets: [...found].sort() };
      return { scan: out, done: next > to };
    },
  };
}

// Builds the settler only when it is needed. The key never leaves this function.
export function makePotSettler(address: `0x${string}`, rpc: string, env: Record<string, string | undefined> = process.env): PotSettler | null {
  const raw = env.POT_SETTLER_KEY?.trim();
  if (!raw) return null;
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  } catch {
    // Never pass the library's error on: some include the value they were given.
    throw new Error("POT_SETTLER_KEY is not a valid private key.");
  }
  const chain = monad(rpc);
  const pub = publicPotClient(rpc);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  return {
    async settle(day, winners) {
      const { request } = await pub.simulateContract({ account, address, abi: chogPotAbi, functionName: "settle", args: [BigInt(day), winners] });
      const hash = await wallet.writeContract(request);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 45_000 });
      if (receipt.status !== "success") throw new Error(`settle(${day}) failed on chain: ${hash}`);
      return hash;
    },
  };
}

// Reads for the page. All plain view calls, nothing is signed.
export type PotPageReads = {
  token: `0x${string}`;
  decimals: number;
  symbol: string;
  minEntry: bigint;
  paused: boolean;
  today: PotDayInfo;
  yesterday: PotDayInfo;
  yesterdayWinners: { wallet: string; amount: bigint }[];
  me?: {
    entered: boolean;
    entry: bigint;
    claimable: bigint;
    allowance: bigint;
    balance: bigint;
    refunds: { day: number; amount: bigint; open: boolean }[];
  };
};

let tokenCache: { pot: string; token: `0x${string}`; decimals: number; symbol: string } | null = null;

export async function readPotPage(address: `0x${string}`, rpc: string, today: number, wallet?: string | null): Promise<PotPageReads> {
  const client = publicPotClient(rpc);
  const read = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi: chogPotAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const info = async (day: number): Promise<PotDayInfo> => {
    const [entries, carriedIn, entrants, settled, refundOpen] = await read<[bigint, bigint, bigint, boolean, boolean]>("dayInfo", [BigInt(day)]);
    return { entries, carriedIn, entrants: Number(entrants), settled, refundOpen };
  };

  if (!tokenCache || tokenCache.pot !== address) {
    const token = await read<`0x${string}`>("token");
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    ]);
    tokenCache = { pot: address, token, decimals: Number(decimals), symbol };
  }
  const { token, decimals, symbol } = tokenCache;

  const [minEntry, paused, t, y, yw] = await Promise.all([
    read<bigint>("minEntryFor", [BigInt(today)]),
    read<boolean>("paused"),
    info(today),
    info(today - 1),
    read<[string[], bigint[]]>("winnersOf", [BigInt(today - 1)]),
  ]);
  const out: PotPageReads = {
    token, decimals, symbol, minEntry, paused, today: t, yesterday: y,
    yesterdayWinners: yw[0].map((w, i) => ({ wallet: w.toLowerCase(), amount: yw[1][i] })),
  };

  if (wallet && isAddress(wallet)) {
    const me = getAddress(wallet);
    // Days whose 7-day settle window has closed recently: an unsettled one can be refunded.
    const refundDays = Array.from({ length: 7 }, (_, i) => today - 8 - i);
    const [entry, claimable, allowance, balance, ...past] = await Promise.all([
      read<bigint>("entryOf", [BigInt(today), me]),
      read<bigint>("claimable", [me]),
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, address] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
      ...refundDays.map(async (d) => {
        const amount = await read<bigint>("entryOf", [BigInt(d), me]);
        if (amount === 0n) return null;
        const [i, taken] = await Promise.all([info(d), read<boolean>("refundTaken", [BigInt(d), me])]);
        if (i.settled || taken) return null;
        return { day: d, amount, open: i.refundOpen };
      }),
    ]);
    out.me = {
      entered: (entry as bigint) > 0n,
      entry: entry as bigint,
      claimable: claimable as bigint,
      allowance: allowance as bigint,
      balance: balance as bigint,
      refunds: (past as ({ day: number; amount: bigint; open: boolean } | null)[]).filter((x): x is { day: number; amount: bigint; open: boolean } => x !== null),
    };
  }
  return out;
}
