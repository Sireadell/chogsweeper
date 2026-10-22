import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBoard } from "./engine";
import { newGame, reveal, type Move } from "./game";
import { FileRecordStore, UpstashRecordStore, type PotRun, type PotRunStore, type PotScan } from "./records";
import { finishPotRun, settleCandidates, settleDay, settleDue, standings, startPotRun, type PotDeps, type SettleDeps } from "./potServer";
import { potDateOf, potDayOf, potDayEndMs, potMessage, POT_FINISH_GRACE_MS } from "./pot-message";
import { rangeLimitFrom, type PotChain, type PotDayInfo } from "./potChain";
import type { Board, ChogMeta } from "./types";

const meta: ChogMeta = { id: 5, name: "Chog #5", image: "x", traits: [{ trait_type: "Tier", value: "Common" }] };
const W = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const T0 = Date.parse("2026-10-20T12:00:00Z");
const DAY = potDayOf(T0);
const DATE = potDateOf(DAY);
const fileStore = () => new FileRecordStore(path.join(mkdtempSync(path.join(tmpdir(), "pot-")), "r.json"));

function winningMoves(board: Board): Move[] {
  const moves: Move[] = [{ action: "reveal", idx: Math.floor((board.cols * board.rows) / 2) }];
  let s = reveal(newGame(board), moves[0].idx);
  for (let i = 0; i < s.board.cells.length && s.status === "playing"; i++) {
    if (!s.board.cells[i].mine && !s.revealed[i]) {
      moves.push({ action: "reveal", idx: i });
      s = reveal(s, i);
    }
  }
  expect(s.status).toBe("won");
  return moves;
}

// A move list that steps on a mine after the first safe reveal.
function losingMoves(board: Board): Move[] {
  const first = Math.floor((board.cols * board.rows) / 2);
  const s = reveal(newGame(board), first);
  const mine = s.board.cells.findIndex((c, i) => c.mine && !s.revealed[i] && i !== s.board.freeFlag);
  return [{ action: "reveal", idx: first }, { action: "reveal", idx: mine }, { action: "reveal", idx: mine }];
}

describe("pot message and days", () => {
  it("uses the contract's day number and a dated sentence", () => {
    expect(DAY).toBe(Math.floor(T0 / 1000 / 86_400));
    expect(DATE).toBe("2026-10-20");
    expect(potDayEndMs(DAY)).toBe(Date.parse("2026-10-21T00:00:00Z"));
    expect(potMessage(DATE)).toContain("2026-10-20");
    expect(potMessage(DATE)).toContain("Daily Pot");
  });
});

describe("starting a pot run (rule 1)", () => {
  const board = generateBoard(meta, DATE, "pot-test-salt");
  const mk = (over: Partial<PotDeps> = {}, entered = true) => {
    let t = T0;
    const calls: [number, string][] = [];
    const deps: PotDeps = {
      store: fileStore(),
      chain: { hasEntered: async (d, w) => { calls.push([d, w]); return entered; } },
      chogOfDay: () => 5,
      boardFor: async () => board,
      now: () => t,
      recover: async () => W(1),
      ...over,
    };
    return { deps, calls, advance: (s: number) => { t += s * 1000; } };
  };
  const who = { address: W(1), signature: "0xsig" };

  it("refuses a wallet that has not entered on chain, and records nothing", async () => {
    const m = mk({}, false);
    expect(await startPotRun(m.deps, who)).toMatchObject({ ok: false, status: 403 });
    expect(m.calls).toEqual([[DAY, W(1)]]);
    expect(await m.deps.store.potRun(DAY, W(1))).toBeNull();
  });

  it("refuses when the chain cannot be read, without using up the run", async () => {
    const m = mk({ chain: { hasEntered: async () => { throw new Error("rpc down"); } } });
    expect(await startPotRun(m.deps, who)).toMatchObject({ ok: false, status: 503 });
    expect(await m.deps.store.potRun(DAY, W(1))).toBeNull();
  });

  it("checks the signature for today's pot message", async () => {
    let signed = "";
    const m = mk({ recover: async (msg) => { signed = msg; return W(2); } });
    expect(await startPotRun(m.deps, who)).toMatchObject({ ok: false, status: 401 });
    expect(signed).toBe(potMessage(DATE));
    expect(await startPotRun(mk().deps, { address: "nope", signature: "x" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a day that is not today", async () => {
    expect(await startPotRun(mk().deps, { ...who, day: DAY - 1 })).toMatchObject({ ok: false, status: 400 });
  });

  it("records startedAt on the server clock and allows one run per day", async () => {
    const m = mk();
    const s = await startPotRun(m.deps, { ...who, day: DAY });
    expect(s).toMatchObject({ ok: true, run: { day: DAY, date: DATE, wallet: W(1), tokenId: 5, startedAt: T0 } });
    expect(await startPotRun(m.deps, who)).toMatchObject({ ok: false, status: 409 });
  });

  it("two Start presses at once open only one run", async () => {
    const m = mk();
    const [a, b] = await Promise.all([startPotRun(m.deps, who), startPotRun(m.deps, who)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("finishing a pot run (rule 2)", () => {
  const board = generateBoard(meta, DATE, "pot-test-salt");
  const moves = winningMoves(board);
  const mk = (walletN = 1) => {
    let t = T0;
    const store = fileStore();
    const deps: PotDeps = {
      store,
      chain: { hasEntered: async () => true },
      chogOfDay: () => 5,
      boardFor: async () => board,
      now: () => t,
      recover: async () => W(walletN),
    };
    return { deps, store, advance: (s: number) => { t += s * 1000; } };
  };
  const who = { address: W(1), signature: "0xsig" };

  it("replays the moves and takes the time from the server clock, ignoring any browser time", async () => {
    const m = mk();
    await startPotRun(m.deps, who);
    m.advance(41.3);
    const f = await finishPotRun(m.deps, { ...who, day: DAY, moves, seconds: 1 } as Parameters<typeof finishPotRun>[1]);
    expect(f).toMatchObject({ ok: true, counted: true, rank: 1, run: { won: true, seconds: 41.3 } });
  });

  it("a run that does not clear the board uses up the try", async () => {
    const m = mk();
    await startPotRun(m.deps, who);
    m.advance(20);
    const f = await finishPotRun(m.deps, { ...who, day: DAY, moves: losingMoves(board) });
    expect(f).toMatchObject({ ok: true, counted: false, rank: null, run: { won: false } });
    m.advance(5);
    expect(await finishPotRun(m.deps, { ...who, day: DAY, moves })).toMatchObject({ ok: false, status: 409 });
    expect(await startPotRun(m.deps, who)).toMatchObject({ ok: false, status: 409 });
  });

  it("junk or too-fast runs do not count and use up the try", async () => {
    const m = mk();
    await startPotRun(m.deps, who);
    m.advance(1);
    expect(await finishPotRun(m.deps, { ...who, day: DAY, moves })).toMatchObject({ ok: true, counted: false });
    const m2 = mk();
    await startPotRun(m2.deps, who);
    m2.advance(30);
    expect(await finishPotRun(m2.deps, { ...who, day: DAY, moves: "lol" })).toMatchObject({ ok: true, counted: false });
  });

  it("refuses an unstarted finish, a closed day and a bad day value", async () => {
    const m = mk();
    expect(await finishPotRun(m.deps, { ...who, day: DAY, moves })).toMatchObject({ ok: false, status: 400 });
    expect(await finishPotRun(m.deps, { ...who, day: DAY - 2, moves })).toMatchObject({ ok: false, status: 400 });
    expect(await finishPotRun(m.deps, { ...who, day: "today", moves })).toMatchObject({ ok: false, status: 400 });
  });

  it("a run started before midnight may finish inside the grace, not after it", async () => {
    const late = mk();
    const start = potDayEndMs(DAY) - 60_000;
    late.deps.now = () => start;
    await startPotRun(late.deps, who);
    late.deps.now = () => start + 60_000 + POT_FINISH_GRACE_MS - 1000;
    expect(await finishPotRun(late.deps, { ...who, day: DAY, moves })).toMatchObject({ ok: true, counted: true });

    const tooLate = mk();
    tooLate.deps.now = () => start;
    await startPotRun(tooLate.deps, who);
    tooLate.deps.now = () => potDayEndMs(DAY) + POT_FINISH_GRACE_MS + 1;
    expect(await finishPotRun(tooLate.deps, { ...who, day: DAY, moves })).toMatchObject({ ok: false, status: 400 });
  });
});

// ---------------------------------------------------------------- settling (rule 3)

type FakeChainOpts = { info?: Partial<PotDayInfo>; count?: number; wallets?: string[]; chunks?: number };
function fakeChain(o: FakeChainOpts = {}) {
  const calls = { readEntrants: 0 };
  const chain: PotChain = {
    hasEntered: async () => true,
    entrantCount: async () => o.count ?? (o.wallets?.length ?? 0),
    dayInfo: async () => ({ entries: 100n, carriedIn: 0n, entrants: o.count ?? 0, settled: false, refundOpen: false, ...o.info }),
    readEntrants: async (_day, saved: PotScan | null) => {
      calls.readEntrants++;
      const all = (o.wallets ?? []).map((w) => w.toLowerCase());
      const chunks = o.chunks ?? 1;
      const step = saved ? saved.next + 1 : 1;
      const got = all.slice(0, Math.ceil((all.length * step) / chunks));
      return { scan: { from: 0, to: chunks - 1, next: step, wallets: got }, done: step >= chunks };
    },
  };
  return { chain, calls };
}
function fakeSettler() {
  const sent: [number, string[]][] = [];
  return { sent, settler: { settle: async (day: number, winners: `0x${string}`[]) => { sent.push([day, winners]); return "0xhash" as `0x${string}`; } } };
}
async function storeWithWins(day: number, wins: [string, number, number][]): Promise<PotRunStore> {
  const s = fileStore();
  for (const [w, seconds, at] of wins) {
    await s.potStart({ day, date: potDateOf(day), wallet: w, tokenId: 1, startedAt: 0 });
    await s.potFinish(day, w, { won: seconds > 0, seconds: Math.abs(seconds), moves: 3, at });
  }
  return s;
}

describe("settling a finished day (rule 3)", () => {
  const Y = DAY - 1; // yesterday, relative to T0 (noon), well past the grace
  const now = () => T0;
  const quiet = () => { const logs: string[] = []; return { logs, log: (m: string) => logs.push(m) }; };

  it("pays the 3 fastest entrants, fastest first", async () => {
    const store = await storeWithWins(Y, [[W(1), 40, 1], [W(2), 20, 2], [W(3), 30, 3], [W(4), 10, 4], [W(5), -5, 5]]);
    const { chain } = fakeChain({ count: 5, wallets: [W(1), W(2), W(3), W(4), W(5)] });
    const s = fakeSettler();
    const out = await settleDay({ store, chain, settler: s.settler, now }, Y, T0 + 10_000);
    expect(out).toMatchObject({ status: "settled", winners: [W(4), W(2), W(3)] });
    expect(s.sent).toEqual([[Y, [W(4), W(2), W(3)]]]);
  });

  it("refuses loudly when entrantCount > 0 but the list read is empty", async () => {
    const store = await storeWithWins(Y, [[W(1), 10, 1]]);
    const { chain } = fakeChain({ count: 3, wallets: [] });
    const s = fakeSettler();
    const q = quiet();
    const out = await settleDay({ store, chain, settler: s.settler, now, log: q.log }, Y, T0 + 10_000);
    expect(out).toMatchObject({ status: "refused" });
    expect(s.sent).toEqual([]);
    expect(q.logs.join(" ")).toMatch(/REFUSING TO SETTLE/);
  });

  it("refuses when the count does not match the list", async () => {
    const store = await storeWithWins(Y, [[W(1), 10, 1]]);
    const { chain } = fakeChain({ count: 3, wallets: [W(1), W(2)] });
    const s = fakeSettler();
    const q = quiet();
    expect(await settleDay({ store, chain, settler: s.settler, now, log: q.log }, Y, T0 + 10_000)).toMatchObject({ status: "refused" });
    expect(s.sent).toEqual([]);
  });

  it("never pays a fast finisher who is not on the chain's entrant list", async () => {
    const store = await storeWithWins(Y, [[W(9), 1, 1], [W(2), 20, 2]]);
    const { chain } = fakeChain({ count: 2, wallets: [W(1), W(2)] });
    const s = fakeSettler();
    expect(await settleDay({ store, chain, settler: s.settler, now }, Y, T0 + 10_000)).toMatchObject({ status: "settled", winners: [W(2)] });
  });

  it("entrants but no clears settles with no winners (the pot rolls over)", async () => {
    const store = await storeWithWins(Y, [[W(1), -9, 1]]);
    const { chain } = fakeChain({ count: 1, wallets: [W(1)] });
    const s = fakeSettler();
    expect(await settleDay({ store, chain, settler: s.settler, now }, Y, T0 + 10_000)).toMatchObject({ status: "settled", winners: [] });
    expect(s.sent).toEqual([[Y, []]]);
  });

  it("skips settled, refund-open and empty days, and rolls on money in a day nobody entered", async () => {
    const store = fileStore();
    const s = fakeSettler();
    expect(await settleDay({ store, chain: fakeChain({ info: { settled: true } }).chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "already-settled" });
    expect(await settleDay({ store, chain: fakeChain({ info: { refundOpen: true } }).chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "refund-open" });
    expect(await settleDay({ store, chain: fakeChain({ count: 0, info: { entries: 0n } }).chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "empty" });
    expect(s.sent).toEqual([]);
    expect(await settleDay({ store, chain: fakeChain({ count: 0, info: { entries: 0n, carriedIn: 50n } }).chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "settled", winners: [] });
    expect(s.sent).toEqual([[Y, []]]);
  });

  it("does nothing before the day ends plus the grace, or after the 7-day window", async () => {
    const store = fileStore();
    const s = fakeSettler();
    const { chain } = fakeChain({ count: 1, wallets: [W(1)] });
    expect(await settleDay({ store, chain, settler: s.settler, now }, DAY, T0)).toMatchObject({ status: "not-over" });
    const justAfter = () => potDayEndMs(Y) + 60_000;
    expect(await settleDay({ store, chain, settler: s.settler, now: justAfter }, Y, T0)).toMatchObject({ status: "not-over" });
    expect(await settleDay({ store, chain, settler: s.settler, now }, DAY - 8, T0)).toMatchObject({ status: "window-closed" });
    expect(s.sent).toEqual([]);
  });

  it("resumes a slow entrant read on the next call", async () => {
    const store = await storeWithWins(Y, [[W(1), 10, 1]]);
    const f = fakeChain({ count: 2, wallets: [W(1), W(2)], chunks: 2 });
    const s = fakeSettler();
    expect(await settleDay({ store, chain: f.chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "reading" });
    expect(s.sent).toEqual([]);
    expect(await settleDay({ store, chain: f.chain, settler: s.settler, now }, Y, T0)).toMatchObject({ status: "settled", winners: [W(1)] });
  });

  it("settleDue looks at the last 7 finished days, oldest first, and reports a failed send", async () => {
    expect(settleCandidates(T0)).toEqual([DAY - 7, DAY - 6, DAY - 5, DAY - 4, DAY - 3, DAY - 2, DAY - 1]);
    expect(settleCandidates(potDayEndMs(DAY - 1) + 1000)).not.toContain(DAY - 1);
    const store = await storeWithWins(Y, [[W(1), 10, 1]]);
    const { chain } = fakeChain({ count: 1, wallets: [W(1)] });
    const failing = { settle: async () => { throw new Error("reverted"); } };
    const q = quiet();
    const out = await settleDue({ store, chain, settler: failing, now, log: q.log } as SettleDeps);
    expect(out.find((o) => o.day === Y)).toMatchObject({ status: "failed" });
    expect(q.logs.length).toBeGreaterThan(0);
  });
});

describe("standings with payouts", () => {
  it("shows what the top 3 would earn and nothing for 4th", () => {
    const runs: PotRun[] = [1, 2, 3, 4].map((n) => ({ day: 1, date: "d", wallet: W(n), tokenId: 1, startedAt: 0, finishedAt: n, won: true, seconds: n * 10 }));
    const s = standings(runs, 1000n);
    expect(s.map((x) => x.payout)).toEqual(["600", "250", "150", null]);
    expect(standings(runs.slice(0, 2), 1000n).map((x) => x.payout)).toEqual(["700", "300"]);
  });
});

describe("reading the RPC's block range limit", () => {
  it("finds the number in Monad's error text", () => {
    expect(rangeLimitFrom(new Error("eth_getLogs is limited to a 100 range"))).toBe(100);
    expect(rangeLimitFrom(new Error("something else"))).toBeNull();
  });
});

// ---------------------------------------------------------------- the pot namespace in both stores (rule 4)

function fakeUpstashPot() {
  const kv = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const run = (c: (string | number)[]): unknown => {
    const [op, key, ...a] = c.map(String);
    switch (op) {
      case "GET": return kv.get(key) ?? null;
      case "SET":
        if (a[1] === "NX" && kv.has(key)) return null;
        kv.set(key, a[0]);
        return "OK";
      case "HSETNX": {
        const h = hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
        if (h.has(a[0])) return 0;
        h.set(a[0], a[1]);
        return 1;
      }
      case "HSET": (hashes.get(key) ?? hashes.set(key, new Map()).get(key)!).set(a[0], a[1]); return 1;
      case "HGET": return hashes.get(key)?.get(a[0]) ?? null;
      case "HGETALL": return [...(hashes.get(key) ?? [])].flat();
      default: throw new Error(`fake: ${op}`);
    }
  };
  const keys = () => [...kv.keys(), ...hashes.keys()];
  const fetchImpl = async (_url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
    ({ ok: true, status: 200, json: async () => ({ result: run(JSON.parse(init.body)) }) });
  return { fetchImpl, keys };
}

const potStores: [string, () => FileRecordStore | UpstashRecordStore][] = [
  ["file", fileStore],
  ["upstash (fake fetch)", () => new UpstashRecordStore("https://x.upstash.io", "tok", fakeUpstashPot().fetchImpl)],
];

describe.each(potStores)("%s store, pot namespace", (_n, make) => {
  const run = (wallet: string, startedAt = 1000): PotRun => ({ day: 20381, date: "2025-10-20", wallet, tokenId: 5, startedAt });

  it("one run per wallet per day, one finish per run", async () => {
    const s = make();
    expect((await s.potStart(run("0xaa"))).ok).toBe(true);
    expect(await s.potStart(run("0xaa", 9999))).toMatchObject({ ok: false, run: { startedAt: 1000 } });
    expect(await s.potFinish(20381, "0xbb", { won: true, seconds: 1, moves: 1, at: 5 })).toMatchObject({ ok: false, reason: "not-started" });
    expect((await s.potFinish(20381, "0xaa", { won: true, seconds: 33.3, moves: 12, at: 5000 })).ok).toBe(true);
    expect(await s.potFinish(20381, "0xaa", { won: true, seconds: 1, moves: 1, at: 6000 })).toMatchObject({ ok: false, reason: "already-finished" });
    expect(await s.potRun(20381, "0xaa")).toMatchObject({ won: true, seconds: 33.3, startedAt: 1000, finishedAt: 5000 });
    expect(await s.potRuns(20382)).toEqual([]);
    expect((await s.potRuns(20381)).length).toBe(1);
  });

  it("keeps a lost run's reason and the entrant-read progress", async () => {
    const s = make();
    await s.potStart(run("0xcc"));
    await s.potFinish(20381, "0xcc", { won: false, seconds: 4, moves: 2, at: 9, reason: "Those moves do not clear the board." });
    expect(await s.potRun(20381, "0xcc")).toMatchObject({ won: false, reason: "Those moves do not clear the board." });
    expect(await s.potScanGet(20381)).toBeNull();
    await s.potScanSet(20381, { from: 1, to: 9, next: 5, wallets: ["0xcc"] });
    expect(await s.potScanGet(20381)).toEqual({ from: 1, to: 9, next: 5, wallets: ["0xcc"] });
  });

  it("does not touch the Chog of the day board or Chog records", async () => {
    const s = make();
    await s.potStart(run("0xdd"));
    await s.potFinish(20381, "0xdd", { won: true, seconds: 9, moves: 3, at: 2 });
    expect(await s.cotdEntries("2025-10-20")).toEqual([]);
    expect(await s.cotdEntry("2025-10-20", "0xdd")).toBeNull();
    expect((await s.getRecord(5)).plays).toBe(0);
  });

  it("parallel finishes record only one result", async () => {
    const s = make();
    await s.potStart(run("0xee"));
    const [a, b] = await Promise.all([
      s.potFinish(20381, "0xee", { won: true, seconds: 9, moves: 3, at: 2 }),
      s.potFinish(20381, "0xee", { won: false, seconds: 1, moves: 1, at: 3 }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("upstash pot keys", () => {
  it("live under pot: only", async () => {
    const f = fakeUpstashPot();
    const s = new UpstashRecordStore("https://x.upstash.io", "tok", f.fetchImpl);
    await s.potStart({ day: 3, date: "d", wallet: "0xaa", tokenId: 1, startedAt: 1 });
    await s.potFinish(3, "0xaa", { won: true, seconds: 5, moves: 1, at: 2 });
    await s.potScanSet(3, { from: 0, to: 0, next: 1, wallets: [] });
    expect(f.keys().every((k) => k.startsWith("pot:"))).toBe(true);
  });
});
