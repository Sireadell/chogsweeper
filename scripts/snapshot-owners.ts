import { createPublicClient, http, parseAbi } from "viem";
import { writeFileSync, mkdirSync } from "node:fs";
import { CHOG_CONTRACT, CHOG_SUPPLY, MONAD_RPC } from "../lib/types";

const abi = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const client = createPublicClient({ transport: http(MONAD_RPC) });

async function main() {
  const ids = Array.from({ length: CHOG_SUPPLY }, (_, i) => i + 1);
  const res = await client.multicall({
    multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CHOG_CONTRACT, abi, functionName: "ownerOf", args: [BigInt(id)] })),
  });
  const owners: Record<number, string> = {};
  const counts = new Map<string, number>();
  let failed = 0;
  res.forEach((r, i) => {
    if (r.status !== "success") { failed++; return; }
    const o = (r.result as string).toLowerCase();
    owners[ids[i]] = o;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  });
  mkdirSync("data", { recursive: true });
  writeFileSync("data/owners.json", JSON.stringify(owners, null, 1));
  const top = [...counts].sort((a, b) => b[1] - a[1]);
  console.log(`tokens resolved ${Object.keys(owners).length}/${CHOG_SUPPLY}, failed ${failed}`);
  console.log("distinct holders:", counts.size);
  console.log("holding 1:", top.filter((t) => t[1] === 1).length, " 2-5:", top.filter((t) => t[1] >= 2 && t[1] <= 5).length, " 6+:", top.filter((t) => t[1] > 5).length);
  console.log("top 5:", top.slice(0, 5));
}
main();
