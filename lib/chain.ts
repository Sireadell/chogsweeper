import { createPublicClient, http, parseAbi, getAddress, isAddress } from "viem";
import { CHOG_CONTRACT, CHOG_SUPPLY, MONAD_RPC, type ChogMeta } from "./types";
import chogsData from "../data/chogs.json";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const abi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
]);

const client = createPublicClient({ transport: http(MONAD_RPC) });

export async function ownerOf(id: number): Promise<string> {
  return client.readContract({ address: CHOG_CONTRACT, abi, functionName: "ownerOf", args: [BigInt(id)] });
}

// Token ids of the Chogs the wallet holds. Zero balance returns at once; otherwise one multicall over all ids.
export async function getOwnedChogs(address: string): Promise<number[]> {
  if (!isAddress(address)) return [];
  const me = getAddress(address);
  const bal = await client.readContract({ address: CHOG_CONTRACT, abi, functionName: "balanceOf", args: [me] });
  if (bal === 0n) return [];
  const ids = Array.from({ length: CHOG_SUPPLY }, (_, i) => i + 1);
  const res = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: true,
    batchSize: 16_384,
    contracts: ids.map((id) => ({ address: CHOG_CONTRACT, abi, functionName: "ownerOf", args: [BigInt(id)] })),
  });
  const owned: number[] = [];
  res.forEach((r, i) => {
    if (r.status === "success" && getAddress(r.result as string) === me) owned.push(ids[i]);
  });
  return owned;
}

const byId = new Map<number, ChogMeta>((chogsData as ChogMeta[]).map((c) => [c.id, c]));

export async function getChogMeta(id: number): Promise<ChogMeta> {
  const m = byId.get(id);
  if (!m) throw new Error(`Unknown Chog id ${id}`);
  return m;
}
