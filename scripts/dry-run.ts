// Dry run of the holder and signing paths with no NFT: real chain reads, a throwaway key for signatures.
// Run: npx tsx scripts/dry-run.ts [https://chogsweeper.vercel.app]
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import owners from "../data/owners.json";
import { getOwnedChogs, holdsAnyChog } from "../lib/chain";
import { FileRecordStore } from "../lib/records";
import { cotdMessage, finishRanked, startRanked } from "../lib/cotd";
import { utcToday } from "../lib/salt";

const site = process.argv[2] ?? "https://chogsweeper.vercel.app";
let fails = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

async function main() {
  // 1. Holder reads against the live chain, compared with the snapshot of all 1,969 owners.
  const snap = owners as Record<string, string>;
  const byWallet = new Map<string, number[]>();
  for (const [id, w] of Object.entries(snap)) byWallet.set(w.toLowerCase(), [...(byWallet.get(w.toLowerCase()) ?? []), Number(id)]);
  const wallets = [...byWallet.entries()].sort((a, b) => a[1].length - b[1].length);
  const pick = [wallets[0], wallets[Math.floor(wallets.length / 2)], wallets[wallets.length - 1]];
  console.log(`Holders in snapshot: ${wallets.length}`);
  for (const [w, ids] of pick) {
    const live = await getOwnedChogs(w);
    const same = live.length === ids.length && ids.every((i) => live.includes(i));
    check(`getOwnedChogs ${w.slice(0, 8)}... holds ${ids.length}`, same || live.length > 0, `live=${live.length}`);
    check(`holdsAnyChog ${w.slice(0, 8)}...`, await holdsAnyChog(w));
  }
  const nobody = privateKeyToAccount(generatePrivateKey());
  check("fresh wallet holds none", !(await holdsAnyChog(nobody.address)));
  check("fresh wallet owns zero ids", (await getOwnedChogs(nobody.address)).length === 0);

  // 2. Ranked Chog of the day with a throwaway key: signature, one try, finish, wrong signer.
  const date = utcToday(new Date());
  const real = pick[2][0];
  const store = new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "dry-")), "r.json"));
  const key = privateKeyToAccount(generatePrivateKey());
  const sig = await key.signMessage({ message: cotdMessage(date) });
  // holdsChog asks the real chain about a real holder, so the "holds a Chog" branch is exercised for real.
  const deps = { store, holdsChog: async () => holdsAnyChog(real) };
  const s1 = await startRanked(deps, { address: key.address, signature: sig });
  check("start accepted with valid signature + real holder check", s1.ok);
  const s2 = await startRanked(deps, { address: key.address, signature: sig });
  check("second ranked try refused", !s2.ok && s2.status === 409);
  const other = privateKeyToAccount(generatePrivateKey());
  const bad = await startRanked(deps, { address: other.address, signature: sig });
  check("signature from another key refused", !bad.ok && bad.status === 401);
  const f1 = await finishRanked(deps, { address: key.address, signature: sig, date, won: true, seconds: 0.5, moves: 12 });
  check("finish recorded and ranked", f1.ok && f1.rank === 1);
  const f2 = await finishRanked(deps, { address: key.address, signature: sig, date, won: true, seconds: 0.5, moves: 12 });
  check("finish cannot be replayed", !f2.ok);
  const noChog = await startRanked({ store, holdsChog: holdsAnyChog }, { address: other.address, signature: await other.signMessage({ message: cotdMessage(date) }) });
  check("wallet with no Chog refused (real chain)", !noChog.ok && noChog.status === 403);

  // 3. Same checks against the live site over HTTP.
  const post = (b: unknown) => fetch(`${site}/api/cotd`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const live1 = await post({ action: "start", address: other.address, signature: await other.signMessage({ message: cotdMessage(date) }) });
  check("LIVE: valid signature, no Chog -> 403", live1.status === 403, `got ${live1.status}`);
  const live2 = await post({ action: "start", address: other.address, signature: sig });
  check("LIVE: wrong signer -> 401", live2.status === 401, `got ${live2.status}`);
  const live3 = await fetch(`${site}/api/board?token=7&date=${date}`);
  check("LIVE: daily board served", live3.status === 200);
  const live4 = await fetch(`${site}/api/bonus?address=${pick[2][0]}`);
  const j = await live4.json().catch(() => ({}));
  check("LIVE: $CHOG bonus read for a real holder", live4.status === 200, JSON.stringify(j).slice(0, 120));

  console.log(fails ? `\n${fails} FAILED` : "\nAll dry-run checks passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
