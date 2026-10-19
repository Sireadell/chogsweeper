"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ChogMeta } from "@/lib/types";
import { CHOG_SUPPLY } from "@/lib/types";
import { generateBoard, getChogMeta } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import GameScreen from "@/components/GameScreen";

const rand = () => 1 + Math.floor(Math.random() * CHOG_SUPPLY);

export default function JudgePage() {
  const [meta, setMeta] = useState<ChogMeta | null>(null);
  const [salt, setSalt] = useState("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const date = todayUTC();

  const load = useCallback(async (id: number, fixedSalt?: string) => {
    setErr("");
    try {
      const m = await getChogMeta(id);
      setMeta(m);
      setSalt(fixedSalt ?? `practice-${Date.now()}-${Math.random()}`);
      setInput(String(id));
    } catch {
      setErr("Could not load that Chog. Try another number.");
    }
  }, []);

  // Judges should be playing within seconds: start a random Chog straight away.
  // A link like /judge?id=420&salt=abc replays the same practice board.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = Number(q.get("id"));
    const fixed = q.get("salt") ?? undefined;
    load(Number.isInteger(id) && id >= 1 && id <= CHOG_SUPPLY ? id : rand(), fixed);
  }, [load]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > CHOG_SUPPLY) {
      setErr(`Type a number from 1 to ${CHOG_SUPPLY}.`);
      return;
    }
    load(n);
  }

  return (
    <main className="page">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
        <span className="flex items-center gap-3">
          <Link href="/practice" className="text-sm font-semibold text-mint underline-offset-2 hover:underline">Endless practice →</Link>
          <span className="rounded-md border border-edge px-2 py-1 text-[12px] font-semibold uppercase tracking-wider text-mute">Judge mode · not ranked</span>
        </span>
      </header>

      <form onSubmit={go} className="mx-auto mb-5 flex w-full max-w-[560px] flex-wrap items-end gap-2">
        <label className="min-w-[140px] flex-1">
          <span className="mb-1 block text-[12px] text-mute">Chog number, 1 to {CHOG_SUPPLY}</span>
          <input
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="h-11 w-full rounded-xl border border-edge bg-panel px-3 text-base text-white outline-none focus:border-chog"
            placeholder="e.g. 420"
          />
        </label>
        <button type="submit" className="btn-main h-11 !py-0">Play</button>
        <button type="button" className="btn-ghost h-11" onClick={() => load(rand())}>🎲 Random</button>
      </form>
      {err && <p className="mx-auto mb-3 max-w-[560px] text-[14px] text-boom" role="alert">{err}</p>}

      {meta && salt ? (
        <GameScreen key={salt} meta={meta} board={generateBoard(meta, date, salt)} mode="practice" onAgain={() => load(rand())} />
      ) : (
        <p className="text-center text-mute" role="status">Picking a Chog…</p>
      )}
    </main>
  );
}
