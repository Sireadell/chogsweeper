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

// Swap this for a hosted store later: implement these three methods, change getStore().
export interface RecordStore {
  getRecord(tokenId: number): Promise<ChogRecord>;
  listRecords(): Promise<ChogRecord[]>;
  submit(result: DayResult): Promise<SubmitOutcome>;
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

type Db = { records: Record<string, ChogRecord>; lastWin: Record<string, string>; days: Record<string, DayResult> };

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
}

let store: RecordStore | undefined;
export function getStore(): RecordStore {
  return (store ??= new FileRecordStore(process.env.CHOG_RECORDS_FILE));
}
export function setStore(s: RecordStore) {
  store = s;
}
