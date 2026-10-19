import Link from "next/link";
import { getStore, rankCotd, type ChogRecord } from "@/lib/records";
import { utcToday } from "@/lib/salt";
import { shortWallet } from "@/lib/cotd";
import { CHOG_SUPPLY } from "@/lib/types";
import CotdCard from "@/components/CotdCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hall of Chogs" };

const time = (s: number | null) => (s === null ? "-" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

type Col = { head: string; right?: boolean };

function Board({ title, note, empty, cols, rows }: { title: string; note?: string; empty: string; cols: Col[]; rows: { key: string; cells: React.ReactNode[] }[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {note && <p className="mt-1 text-[13px] text-mute">{note}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-edge bg-panel p-4 text-[14px] text-[#cfc9ea]">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-edge bg-panel">
          <table className="w-full border-collapse text-[14px] tabular-nums">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-mute">
                <th className="px-3 py-2 font-semibold">#</th>
                {cols.map((c) => (
                  <th key={c.head} className={`px-3 py-2 font-semibold ${c.right ? "text-right" : ""}`}>{c.head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-t border-edge">
                  <td className={`px-3 py-2.5 ${i === 0 ? "font-black text-mint" : "text-mute"}`}>{i + 1}</td>
                  {r.cells.map((c, j) => (
                    <td key={j} className={`px-3 py-2.5 ${cols[j]?.right ? "text-right" : ""}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const chogCell = (id: number) => (
  <span className="inline-flex items-center gap-2 font-semibold text-white">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/chogs/${id}.webp`} alt="" width={24} height={24} loading="lazy" className="h-6 w-6 rounded-md object-cover" />
    #{id}
  </span>
);

export default async function HallPage() {
  const store = getStore();
  const today = utcToday();
  const [records, entries] = await Promise.all([store.listRecords(), store.cotdEntries(today)]);
  const won = records.filter((r: ChogRecord) => r.wins > 0);
  const top = rankCotd(entries).slice(0, 10);
  const cleared = [...won].sort((a, b) => b.wins - a.wins || (a.bestSeconds ?? 1e9) - (b.bestSeconds ?? 1e9)).slice(0, 10);
  const streaks = [...won].sort((a, b) => b.longestStreak - a.longestStreak || b.wins - a.wins).slice(0, 10);

  return (
    <main className="page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
        <Link href="/wall" className="btn-ghost">Reveal wall: {won.length} of {CHOG_SUPPLY.toLocaleString()} →</Link>
      </header>
      <h1 className="text-3xl font-black tracking-tight text-white">Hall of Chogs</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[#cfc9ea]">Records belong to the Chog, not the wallet. If a Chog is sold, its history goes to the new owner with it.</p>

      <div className="mt-5"><CotdCard hideActions /></div>

      <Board
        title="Today's top 10, fastest clear"
        note={`Chog of the day, ${today} UTC. One ranked try per wallet, only clears count.`}
        empty="No clears yet today. The first wallet to clear the Chog of the day takes the top spot."
        cols={[{ head: "Wallet" }, { head: "Time", right: true }, { head: "Moves", right: true }]}
        rows={top.map((e) => ({ key: e.wallet, cells: [<span key="w" className="font-mono text-white">{shortWallet(e.wallet)}</span>, time(e.seconds ?? null), String(e.moves ?? "-")] }))}
      />

      <Board
        title="Most boards cleared"
        note="Chogs ranked by daily boards won, ties go to the faster best time."
        empty="Nothing cleared yet. The first Chog to win a board takes the top spot."
        cols={[{ head: "Chog" }, { head: "Cleared", right: true }, { head: "Fastest", right: true }]}
        rows={cleared.map((r) => ({ key: String(r.tokenId), cells: [chogCell(r.tokenId), String(r.wins), time(r.bestSeconds)] }))}
      />

      <Board
        title="Longest streaks"
        empty="No streaks yet. Clear a board on two days in a row to start one."
        cols={[{ head: "Chog" }, { head: "Best", right: true }, { head: "Now", right: true }]}
        rows={streaks.map((r) => ({ key: String(r.tokenId), cells: [chogCell(r.tokenId), `${r.longestStreak} d`, `${r.currentStreak} d`] }))}
      />
    </main>
  );
}
