import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ChogRecord = {
  tokenId: number;
  plays: number;
  wins: number;
  bestSeconds: number | null;
  currentStreak: number;
  longestStreak: number;
  lastDate: string | null;
};

export type DayResult = { tokenId: number; date: string; won: boolean; seconds: number; moves: number };

export type SubmitOutcome =
  | { ok: true; record: ChogRecord }
  | { ok: false; reason: "already-played"; record: ChogRecord };

// Chog of the day: one ranked try per wallet per UTC day. startedAt is the server clock when the
// wallet pressed Start, the other fields are filled in once when the try ends.
export type CotdEntry = {
  date: string;
  wallet: string; // lowercase 0x address
  tokenId: number; // the featured Chog that day
  startedAt: number; // ms since epoch
  finishedAt?: number;
  won?: boolean;
  seconds?: number;
  moves?: number;
};

export type CotdStart = { ok: true; entry: CotdEntry } | { ok: false; entry: CotdEntry };
export type CotdFinish =
  | { ok: true; entry: CotdEntry }
  | { ok: false; reason: "not-started" | "already-finished"; entry?: CotdEntry };
export type CotdResult = { won: boolean; seconds: number; moves: number; at: number };

// Wins only, fastest first. Ties go to whoever finished first.
export function rankCotd(entries: CotdEntry[]): CotdEntry[] {
  return entries
    .filter((e) => e.won === true && typeof e.seconds === "number")
    .sort((a, b) => a.seconds! - b.seconds! || (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
}

// Two stores implement this: FileRecordStore (local dev) and UpstashRecordStore (hosted).
// getStore() picks Upstash when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
export interface RecordStore {
  getRecord(tokenId: number): Promise<ChogRecord>;
  listRecords(): Promise<ChogRecord[]>;
  submit(result: DayResult): Promise<SubmitOutcome>;
  cotdStart(entry: CotdEntry): Promise<CotdStart>;
  cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish>;
  cotdEntries(date: string): Promise<CotdEntry[]>;
  cotdEntry(date: string, wallet: string): Promise<CotdEntry | null>;
}

function finishEntry(cur: CotdEntry, r: CotdResult): CotdEntry {
  return { ...cur, finishedAt: r.at, won: r.won, seconds: r.seconds, moves: r.moves };
}

export function emptyRecord(tokenId: number): ChogRecord {
  return { tokenId, plays: 0, wins: 0, bestSeconds: null, currentStreak: 0, longestStreak: 0, lastDate: null };
}

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// Pure streak maths. A win on the day after the last win continues the streak,
// a win after a gap starts again at 1, a loss ends it.
export function applyResult(rec: ChogRecord, r: DayResult, lastWinDate: string | null): { rec: ChogRecord; lastWinDate: string | null } {
  const next: ChogRecord = { ...rec, plays: rec.plays + 1, lastDate: r.date };
  let win = lastWinDate;
  if (r.won) {
    next.wins = rec.wins + 1;
    next.bestSeconds = rec.bestSeconds === null ? r.seconds : Math.min(rec.bestSeconds, r.seconds);
    next.currentStreak = lastWinDate && dayBefore(r.date) === lastWinDate ? rec.currentStreak + 1 : 1;
    next.longestStreak = Math.max(rec.longestStreak, next.currentStreak);
    win = r.date;
  } else {
    next.currentStreak = 0;
  }
  return { rec: next, lastWinDate: win };
}

type Db = {
  records: Record<string, ChogRecord>;
  lastWin: Record<string, string>;
  days: Record<string, DayResult>;
  cotd?: Record<string, Record<string, CotdEntry>>;
};

export class FileRecordStore implements RecordStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file = path.join(process.cwd(), "data", "records.json")) {}

  private async load(): Promise<Db> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Db;
    } catch {
      return { records: {}, lastWin: {}, days: {} };
    }
  }

  private async save(db: Db) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(db));
    await rename(tmp, this.file);
  }

  // Writes run one at a time so two quick requests cannot overwrite each other.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getRecord(tokenId: number) {
    return (await this.load()).records[tokenId] ?? emptyRecord(tokenId);
  }

  async listRecords() {
    return Object.values((await this.load()).records);
  }

  submit(result: DayResult): Promise<SubmitOutcome> {
    return this.serial(async () => {
      const db = await this.load();
      const key = `${result.tokenId}:${result.date}`;
      const cur = db.records[result.tokenId] ?? emptyRecord(result.tokenId);
      if (db.days[key]) return { ok: false as const, reason: "already-played" as const, record: cur };
      const { rec, lastWinDate } = applyResult(cur, result, db.lastWin[result.tokenId] ?? null);
      db.records[result.tokenId] = rec;
      if (lastWinDate) db.lastWin[result.tokenId] = lastWinDate;
      db.days[key] = result;
      await this.save(db);
      return { ok: true as const, record: rec };
    });
  }

  cotdStart(entry: CotdEntry): Promise<CotdStart> {
    return this.serial(async () => {
      const db = await this.load();
      const day = ((db.cotd ??= {})[entry.date] ??= {});
      if (day[entry.wallet]) return { ok: false as const, entry: day[entry.wallet] };
      day[entry.wallet] = entry;
      await this.save(db);
      return { ok: true as const, entry };
    });
  }

  cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish> {
    return this.serial(async () => {
      const db = await this.load();
      const cur = db.cotd?.[date]?.[wallet];
      if (!cur) return { ok: false as const, reason: "not-started" as const };
      if (cur.finishedAt) return { ok: false as const, reason: "already-finished" as const, entry: cur };
      const entry = finishEntry(cur, r);
      db.cotd![date][wallet] = entry;
      await this.save(db);
      return { ok: true as const, entry };
    });
  }

  async cotdEntries(date: string) {
    return Object.values((await this.load()).cotd?.[date] ?? {});
  }

  async cotdEntry(date: string, wallet: string) {
    return (await this.load()).cotd?.[date]?.[wallet] ?? null;
  }
}

// Hosted store on Upstash Redis over its REST API (plain fetch, no extra package).
// Keys: chog:ids (set of token ids), chog:rec:ID, chog:lastwin:ID, chog:day:ID:DATE (the
// one-result-per-day lock) and cotd:DATE (hash of wallet to entry).
type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class UpstashRecordStore implements RecordStore {
  private url: string;
  constructor(url: string, private token: string, private doFetch: Fetch = fetch as unknown as Fetch) {
    this.url = url.replace(/\/+$/, "");
  }

  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await this.doFetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error ?? res.status}`);
    return body.result as T;
  }

  private parse<T>(raw: unknown): T | null {
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  }

  async getRecord(tokenId: number) {
    return this.parse<ChogRecord>(await this.cmd("GET", `chog:rec:${tokenId}`)) ?? emptyRecord(tokenId);
  }

  async listRecords() {
    const ids = await this.cmd<string[]>("SMEMBERS", "chog:ids");
    if (!ids.length) return [];
    const rows = await this.cmd<(string | null)[]>("MGET", ...ids.map((id) => `chog:rec:${id}`));
    return rows.map((r) => this.parse<ChogRecord>(r)).filter((r): r is ChogRecord => r !== null);
  }

  async submit(result: DayResult): Promise<SubmitOutcome> {
    const id = result.tokenId;
    const cur = await this.getRecord(id);
    // SET NX is the one-result-per-day lock, so two quick requests cannot both count.
    const first = await this.cmd("SET", `chog:day:${id}:${result.date}`, JSON.stringify(result), "NX");
    if (first !== "OK") return { ok: false, reason: "already-played", record: cur };
    const lastWin = await this.cmd<string | null>("GET", `chog:lastwin:${id}`);
    const { rec, lastWinDate } = applyResult(cur, result, lastWin);
    await this.cmd("SET", `chog:rec:${id}`, JSON.stringify(rec));
    if (lastWinDate) await this.cmd("SET", `chog:lastwin:${id}`, lastWinDate);
    await this.cmd("SADD", "chog:ids", id);
    return { ok: true, record: rec };
  }

  async cotdStart(entry: CotdEntry): Promise<CotdStart> {
    const made = await this.cmd<number>("HSETNX", `cotd:${entry.date}`, entry.wallet, JSON.stringify(entry));
    if (made === 1) return { ok: true, entry };
    return { ok: false, entry: (await this.cotdEntry(entry.date, entry.wallet)) ?? entry };
  }

  async cotdFinish(date: string, wallet: string, r: CotdResult): Promise<CotdFinish> {
    const cur = await this.cotdEntry(date, wallet);
    if (!cur) return { ok: false, reason: "not-started" };
    if (cur.finishedAt) return { ok: false, reason: "already-finished", entry: cur };
    const entry = finishEntry(cur, r);
    await this.cmd("HSET", `cotd:${date}`, wallet, JSON.stringify(entry));
    return { ok: true, entry };
  }

  async cotdEntries(date: string) {
    const flat = await this.cmd<string[]>("HGETALL", `cotd:${date}`);
    const out: CotdEntry[] = [];
    for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]) as CotdEntry);
    return out;
  }

  async cotdEntry(date: string, wallet: string) {
    return this.parse<CotdEntry>(await this.cmd("HGET", `cotd:${date}`, wallet));
  }
}

let store: RecordStore | undefined;
export function getStore(): RecordStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return (store = url && token ? new UpstashRecordStore(url, token) : new FileRecordStore(process.env.CHOG_RECORDS_FILE));
}
export function setStore(s: RecordStore) {
  store = s;
}
