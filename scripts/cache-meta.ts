import { createPublicClient, http, parseAbi } from "viem";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CHOG_CONTRACT, CHOG_SUPPLY, MONAD_RPC, type ChogMeta } from "../lib/types";

const abi = parseAbi(["function tokenURI(uint256) view returns (string)"]);
const client = createPublicClient({ transport: http(MONAD_RPC) });
const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/", // canonical image host, but rate-limits hard
  "https://4everland.io/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
  "https://dweb.link/ipfs/",
];
const CACHE = "data/uri-cache.json";
mkdirSync("data", { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cid = (u: string) => u.replace(/^ipfs:\/\//, "");

async function getUris(ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const todo = ids.filter((i) => !out[i]);
  for (let i = 0; i < todo.length; i += 200) {
    const chunk = todo.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
      contracts: chunk.map((id) => ({ address: CHOG_CONTRACT, abi, functionName: "tokenURI", args: [BigInt(id)] })),
    });
    res.forEach((r, k) => { if (r.status === "success") out[chunk[k]] = r.result as string; });
  }
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const cooldown: Record<string, number> = {};
async function fetchJson(uri: string): Promise<any> {
  const path = uri.startsWith("ipfs://") ? cid(uri) : null;
  const urls = path ? [...GATEWAYS.slice(1), GATEWAYS[0]].map((g) => g + path) : [uri];
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const u of urls) {
      const host = new URL(u).host;
      const wait = (cooldown[host] ?? 0) - Date.now();
      if (wait > 0 && urls.length > 1 && attempt % 2 === 0) continue;
      if (wait > 0) await sleep(wait);
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
        if (r.ok) return await r.json();
        if (r.status === 429) cooldown[host] = Date.now() + (Number(r.headers.get("retry-after")) || 5) * 1000;
      } catch {}
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error("failed " + uri);
}

const toHttp = (img: string) => (img.startsWith("ipfs://") ? GATEWAYS[0] + cid(img) : img);

async function main() {
  const ids = Array.from({ length: CHOG_SUPPLY }, (_, i) => i + 1);
  const uris = await getUris(ids);
  const missingUri = ids.filter((i) => !uris[i]);
  if (missingUri.length) console.log("no tokenURI for", missingUri.length, missingUri.slice(0, 10));

  const OUT = "data/chogs.partial.json";
  const done: Record<number, ChogMeta> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const todo = ids.filter((i) => uris[i] && !done[i]);
  let n = 0;
  const worker = async () => {
    while (todo.length) {
      const id = todo.shift()!;
      try {
        const j = await fetchJson(uris[id]);
        done[id] = { id, name: j.name, image: toHttp(j.image), traits: (j.attributes ?? []).map((a: any) => ({ trait_type: a.trait_type, value: String(a.value) })) };
      } catch (e) { console.log("fail", id, String(e)); }
      if (++n % 100 === 0) { writeFileSync(OUT, JSON.stringify(done)); console.log("fetched", n); }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  writeFileSync(OUT, JSON.stringify(done));

  const all = ids.map((i) => done[i]).filter(Boolean);
  console.log("count", all.length, "of", CHOG_SUPPLY);
  const typeSets = new Set(all.map((c) => c.traits.length));
  console.log("trait counts per token:", [...typeSets]);
  const types = new Map<string, Map<string, number>>();
  for (const c of all) for (const t of c.traits) {
    if (!types.has(t.trait_type)) types.set(t.trait_type, new Map());
    const m = types.get(t.trait_type)!; m.set(t.value, (m.get(t.value) ?? 0) + 1);
  }
  const report: Record<string, Record<string, number>> = {};
  for (const [k, m] of types) report[k] = Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
  const allTypes = [...types.keys()];
  const incomplete = all.filter((c) => allTypes.some((t) => !c.traits.find((x) => x.trait_type === t)));
  console.log("trait types:", allTypes.length, "tokens missing a trait type:", incomplete.length);
  writeFileSync("data/trait-report.json", JSON.stringify(report, null, 2));
  if (all.length === CHOG_SUPPLY) writeFileSync("data/chogs.json", JSON.stringify(all));
}
main();
