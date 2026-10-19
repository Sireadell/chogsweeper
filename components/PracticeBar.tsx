"use client";
import type { PracticeStats } from "@/lib/practice";

export default function PracticeBar({ stats, upNext }: { stats: PracticeStats; upNext: number }) {
  return (
    <section aria-label="Practice chain score" className="mx-auto mb-4 w-full max-w-[560px] rounded-2xl border border-edge bg-panel p-3">
      <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
        <Cell label="Chain" value={String(stats.streak)} hot={stats.streak > 0} />
        <Cell label="Best chain" value={String(stats.best)} />
        <Cell label="Tiles cleared" value={stats.tiles.toLocaleString("en-US")} />
      </div>
      <p className="mt-2 text-center text-[12px] text-mute">
        Clear a board and Chog #{upNext} is next. A boom ends the chain. Scores stay in this browser.
      </p>
    </section>
  );
}

function Cell({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="rounded-xl border border-edge px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className={`text-xl font-black leading-tight ${hot ? "text-mint" : "text-white"}`}>{value}</div>
    </div>
  );
}
