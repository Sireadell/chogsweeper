"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, ChogMeta } from "@/lib/types";
import { CHOG_SUPPLY } from "@/lib/types";
import { generateBoard, getChogMeta } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import GameScreen from "@/components/GameScreen";
import PracticeBar from "@/components/PracticeBar";
import {
  applyResult, EMPTY_STATS, newPracticeSalt, nextChogId, parseChogId, randomChogId, readStats, tilesForBoard, writeStats,
  type PracticeStats,
} from "@/lib/practice";

type Round = { meta: ChogMeta; salt: string };

export default function PracticePage() {
  const [round, setRound] = useState<Round | null>(null);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [upNext, setUpNext] = useState(1);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const won = useRef(false);
  const statsRef = useRef<PracticeStats>(EMPTY_STATS);
  const date = todayUTC();

  const load = useCallback(async (id: number) => {
    setErr("");
    try {
      const meta = await getChogMeta(id);
      won.current = false;
      setRound({ meta, salt: newPracticeSalt() });
      setInput(String(id));
      setUpNext(nextChogId(id));
    } catch {
      setErr("Could not load that Chog. Try another number.");
    }
  }, []);

  // Start at once: ?id=420 picks a Chog, otherwise a random one. Saved scores come back from this browser.
  useEffect(() => {
    const s = readStats();
    statsRef.current = s;
    setStats(s);
    const id = parseChogId(new URLSearchParams(window.location.search).get("id") ?? "");
    load(id ?? randomChogId());
  }, [load]);

  function finish(board: Board, r: { won: boolean }) {
    won.current = r.won;
    const next = applyResult(statsRef.current, r.won, r.won ? tilesForBoard(board.cols, board.rows, board.mines) : 0);
    statsRef.current = next;
    setStats(next);
    writeStats(next);
  }

  function again() {
    if (!round) return;
    // Won: chain on to the next Chog. Lost: same Chog, fresh board.
    load(won.current ? upNext : round.meta.id);
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = parseChogId(input);
    if (n === null) { setErr(`Type a number from 1 to ${CHOG_SUPPLY}.`); return; }
    load(n);
  }

  // Memoised: a new board object would reset the game in progress.
  const board = useMemo(() => (round ? generateBoard(round.meta, date, round.salt) : null), [round, date]);

  return (
    <main className="page">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
        <span className="rounded-md border border-chog px-2 py-1 text-[12px] font-bold uppercase tracking-wider text-chog">Practice · not ranked</span>
      </header>

      <form onSubmit={go} className="mx-auto mb-4 flex w-full max-w-[560px] flex-wrap items-end gap-2">
        <label className="min-w-[120px] flex-1">
          <span className="mb-1 block text-[12px] text-mute">Any Chog, 1 to {CHOG_SUPPLY}</span>
          <input
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="h-11 w-full rounded-xl border border-edge bg-panel px-3 text-base text-white outline-none focus:border-chog"
            placeholder="e.g. 420"
          />
        </label>
        <button type="submit" className="btn-main h-11 !py-0">Play</button>
        <button type="button" className="btn-ghost h-11" onClick={() => load(randomChogId())}>🎲 Random</button>
        <button type="button" className="btn-ghost h-11" onClick={() => load(upNext)}>Next Chog →</button>
      </form>
      {err && <p className="mx-auto mb-3 max-w-[560px] text-[14px] text-boom" role="alert">{err}</p>}

      <PracticeBar stats={stats} upNext={upNext} />

      {round && board ? (
        <GameScreen
          key={round.salt}
          meta={round.meta}
          board={board}
          mode="practice"
          onAgain={again}
          onFinish={(r) => finish(board, r)}
        />
      ) : (
        <p className="text-center text-mute" role="status">Picking a Chog…</p>
      )}
      <p className="mx-auto mt-6 max-w-[560px] text-center text-[13px] text-mute">
        No wallet needed. Every board uses a fresh random seed, so it is never a daily board. <Link href="/play" className="text-mint underline-offset-2 hover:underline">Play your ranked daily board</Link>
      </p>
    </main>
  );
}
