import { getStore, type ChogRecord } from "@/lib/records";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hall of Chogs" };

function Table({ title, rows, cols }: { title: string; rows: ChogRecord[]; cols: { head: string; show: (r: ChogRecord) => string }[] }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No results yet. The first Chog to win a board takes the top spot.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7 }}>
                <th style={{ padding: "6px 8px" }}>#</th>
                <th style={{ padding: "6px 8px" }}>Chog</th>
                {cols.map((c) => (
                  <th key={c.head} style={{ padding: "6px 8px" }}>{c.head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.tokenId} style={{ borderTop: "1px solid var(--edge)" }}>
                  <td style={{ padding: "8px" }}>{i + 1}</td>
                  <td style={{ padding: "8px" }}>Chog #{r.tokenId}</td>
                  {cols.map((c) => (
                    <td key={c.head} style={{ padding: "8px" }}>{c.show(r)}</td>
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

const time = (s: number | null) => (s === null ? "-" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

export default async function HallPage() {
  const all = (await getStore().listRecords()).filter((r) => r.wins > 0);
  const streaks = [...all].sort((a, b) => b.longestStreak - a.longestStreak || b.wins - a.wins).slice(0, 25);
  const wins = [...all].sort((a, b) => b.wins - a.wins || (a.bestSeconds ?? 1e9) - (b.bestSeconds ?? 1e9)).slice(0, 25);
  return (
    <main className="page">
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Hall of Chogs</h1>
      <p style={{ opacity: 0.8, marginTop: 8, lineHeight: 1.5 }}>
        Records belong to the Chog, not the wallet. If a Chog is sold, its streak goes to the new owner with it.
      </p>
      <Table
        title="Longest streaks"
        rows={streaks}
        cols={[
          { head: "Best streak", show: (r) => `${r.longestStreak} days` },
          { head: "Streak now", show: (r) => `${r.currentStreak} days` },
          { head: "Wins", show: (r) => String(r.wins) },
        ]}
      />
      <Table
        title="Most wins"
        rows={wins}
        cols={[
          { head: "Wins", show: (r) => String(r.wins) },
          { head: "Played", show: (r) => String(r.plays) },
          { head: "Fastest", show: (r) => time(r.bestSeconds) },
        ]}
      />
    </main>
  );
}
