// Downloads each Chog image (via a non-rate-limited gateway), resizes to 320px webp into public/chogs/<id>.webp
import sharp from "sharp";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import type { ChogMeta } from "../lib/types";

const chogs: ChogMeta[] = JSON.parse(readFileSync("data/chogs.json", "utf8"));
const HOSTS = ["https://ipfs.filebase.io/ipfs/", "https://4everland.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const todo = chogs.filter((c) => !existsSync(`public/chogs/${c.id}.webp`));
let done = 0, bytes = 0, failed: number[] = [];

async function get(c: ChogMeta): Promise<Buffer> {
  const path = c.image.replace(/^https:\/\/[^/]+\/ipfs\//, "");
  for (let a = 0; a < 6; a++) {
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + path, { signal: AbortSignal.timeout(30000) });
        if (r.ok) return Buffer.from(await r.arrayBuffer());
      } catch {}
    }
    await sleep(1500 * (a + 1));
  }
  throw new Error("fail");
}
async function worker() {
  while (todo.length) {
    const c = todo.shift()!;
    try {
      const out = await sharp(await get(c)).resize(320, 320, { fit: "inside" }).webp({ quality: 80 }).toBuffer();
      writeFileSync(`public/chogs/${c.id}.webp`, out);
      bytes += out.length;
    } catch { failed.push(c.id); }
    if (++done % 100 === 0) console.log("art", done, (bytes / 1e6).toFixed(1) + " MB");
  }
}
Promise.all(Array.from({ length: 4 }, worker)).then(() => console.log("art finished", { failed: failed.length, MB: (bytes / 1e6).toFixed(1) }));
