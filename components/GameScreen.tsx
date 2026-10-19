"use client";
import { useEffect, useState } from "react";
import type { Board as BoardT, ChogMeta } from "@/lib/types";
import { chord, flag, initGame, minesLeft, reveal, seconds, type GameState } from "./gameLogic";
import Board from "./Board";
import ChogArt from "./ChogArt";
import BonusChip from "./BonusChip";
import CommitChip from "./CommitChip";
import { pickSafeHint, type BonusInfo } from "@/lib/chogToken";
import RuleCards from "./RuleCards";
import ShareButton from "./ShareButton";

export type Mode = "daily" | "practice" | "cotd";
type Saved = { won: boolean; seconds: number; moves: number; usedHint?: boolean };

const RULE_ICON: Record<string, string> = { "tier-size": "▦", "eyes-peek": "👁", "accessory-flag": "⚑", "head-shield": "🛡" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function untilTomorrow(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.max(0, Math.floor((next - now.getTime()) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function GameScreen({
  meta, board, mode, onAgain, address, onFinish, footer,
}: { meta: ChogMeta; board: BoardT; mode: Mode; onAgain?: () => void; address?: string | null; onFinish?: (r: { won: boolean; seconds: number; moves: number }) => void; footer?: React.ReactNode }) {
  const date = board.date;
  const [state, setState] = useState<GameState>(() => initGame(board));
  const [flagMode, setFlagMode] = useState(false);
  const [bonus, setBonus] = useState<BonusInfo | null>(null);
  const [hint, setHint] = useState<number | null>(null);
  const [usedHint, setUsedHint] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [, tick] = useState(0);
  const storeKey = `chogsweeper:${meta.id}:${date}`;

  useEffect(() => {
    setState(initGame(board));
    setSaved(null);
    setHint(null);
    setUsedHint(false);
    if (mode === "daily") {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) setSaved(JSON.parse(raw) as Saved);
      } catch { /* storage may be blocked, play still works */ }
    }
  }, [board, mode, storeKey]);

  useEffect(() => {
    if (state.status !== "playing") return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [state.status]);

  // Save the finished day once.
  useEffect(() => {
    if ((mode === "cotd" || mode === "practice") && (state.status === "won" || state.status === "lost")) {
      onFinish?.({ won: state.status === "won", seconds: seconds(state), moves: state.moves });
      return;
    }
    if (mode !== "daily" || (state.status !== "won" && state.status !== "lost")) return;
    const result: Saved = { won: state.status === "won", seconds: seconds(state), moves: state.moves, ...(usedHint ? { usedHint: true } : {}) };
    try { localStorage.setItem(storeKey, JSON.stringify(result)); } catch { /* ignore */ }
    fetch("/api/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId: meta.id, date, ...result }),
    }).catch(() => { /* route may not exist yet, fail silently */ });
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = state.status === "won" || state.status === "lost";
  const view: GameState | null = saved ? null : state;
  const hintsLeft = Math.max(0, (bonus?.hints ?? 0) - (usedHint ? 1 : 0));
  const canHint = mode === "daily" && !done && state.status === "playing" && hintsLeft > 0;
  function useHint() {
    const i = pickSafeHint(state.g.board, state.revealed, state.flagged);
    if (i === null) return;
    setHint(i);
    setUsedHint(true);
  }

  const finished = saved ?? (done ? { won: state.status === "won", seconds: seconds(state), moves: state.moves } : null);

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-extrabold tracking-tight text-white">{meta.name}</h2>
          <p className="text-[13px] text-mute">
            Token #{meta.id} · {mode === "daily" ? `today's board, ${date} (UTC)` : mode === "cotd" ? `Chog of the day, ranked, ${date} (UTC)` : "practice board, not ranked"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-right tabular-nums">
          <Stat label="Mines left" value={view ? String(minesLeft(board, view)) : String(board.mines)} />
          <Stat label="Time" value={fmt(view ? seconds(view) : saved!.seconds)} />
        </div>
      </div>

      {!saved && board.rules.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Active rules">
          {board.rules.map((r) => (
            <li key={r.id} className="chip">{RULE_ICON[r.id] ?? "✦"} {r.trait}: {r.value}</li>
          ))}
        </ul>
      )}

      {saved ? (
        <SavedDay meta={meta} saved={saved} />
      ) : (
        <>
          <Board
            board={board}
            meta={meta}
            state={state}
            flagMode={flagMode}
            hint={hint}
            onReveal={(i) => setState((s) => reveal(board, s, i))}
            onFlag={(i) => setState((s) => flag(s, i))}
            onChord={(i) => setState((s) => chord(board, s, i))}
          />
          {!done && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                aria-pressed={flagMode}
                onClick={() => setFlagMode((f) => !f)}
                className={`btn-ghost ${flagMode ? "btn-on" : ""}`}
              >
                ⚑ Flag mode {flagMode ? "on" : "off"}
              </button>
              <p className="text-right text-[12px] leading-snug text-mute">
                Tap to dig. Hold a tile to flag.<br />Tap a number to clear around it.
              </p>
            </div>
          )}
          {state.shieldedAt.length > 0 && !done && (
            <p className="toast" role="status">🛡 Your Head shield took that hit. It is used up now.</p>
          )}
        </>
      )}

      {mode === "daily" && !saved && !done && (
        <div className="mt-3 space-y-2">
          <BonusChip address={address} hintsLeft={hintsLeft} onInfo={setBonus} />
          {canHint && (
            <button type="button" className="btn-ghost" onClick={useHint}>
              Use my $CHOG hint
            </button>
          )}
          {hint !== null && state.status === "playing" && !state.revealed[hint] && (
            <p className="text-[12px] text-mute" role="status">
              Row {Math.floor(hint / board.cols) + 1}, column {(hint % board.cols) + 1} is safe. Your record will be marked as hinted.
            </p>
          )}
        </div>
      )}

      {finished && (
        <Outcome meta={meta} won={finished.won} secs={finished.seconds} moves={finished.moves} mode={mode} onAgain={onAgain}
          rules={board.rules.map((r) => `${r.trait}: ${r.value}`)} />
      )}
      {finished?.won && (
        <ShareButton name={meta.name} params={{ token: meta.id, date, time: Math.round(finished.seconds) }} cols={board.cols} rows={board.rows} />
      )}

      {footer}

      <div className="mt-5 space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-mute">Rules from this Chog</h3>
        <RuleCards board={board} state={state} />
        <CommitChip commit={board.commit} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[68px] rounded-xl border border-edge bg-panel px-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="text-lg font-bold leading-tight text-white">{value}</div>
    </div>
  );
}

function Outcome({ meta, won, secs, moves, mode, onAgain, rules }: {
  meta: ChogMeta; won: boolean; secs: number; moves: number; mode: Mode; onAgain?: () => void; rules: string[];
}) {
  if (won) {
    return (
      <section className="reveal-card mt-4" aria-live="polite">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-mint">Board cleared</p>
        <h3 className="mt-1 text-3xl font-black tracking-tight text-white">{meta.name}</h3>
        <p className="mt-1 text-[14px] text-[#cfc9ea]">
          Cleared in {fmt(secs)} with {moves} moves.{mode === "practice" ? " Practice runs are not ranked." : ""}
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {rules.map((r) => (<li key={r} className="chip">{r}</li>))}
        </ul>
        {mode === "practice" && onAgain && <button className="btn-main mt-4" onClick={onAgain}>Play another Chog</button>}
        {mode !== "practice" && <p className="mt-3 text-[13px] text-mute">Next board in {untilTomorrow()}.</p>}
      </section>
    );
  }
  return (
    <section className="lost-card mt-4" aria-live="polite">
      <h3 className="text-2xl font-black text-white">Boom.</h3>
      <p className="mt-1 text-[14px] text-[#e7c9d0]">
        {mode !== "practice"
          ? `${meta.name} stays hidden today. A fresh board opens in ${untilTomorrow()}. Come back tomorrow.`
          : "That one got you. Practice boards are free, so try again."}
      </p>
      {mode === "practice" && onAgain && <button className="btn-main mt-4" onClick={onAgain}>Try again</button>}
    </section>
  );
}

function SavedDay({ meta, saved }: { meta: ChogMeta; saved: Saved }) {
  return (
    <div className="board-wrap" data-status={saved.won ? "won" : "lost"} style={{ aspectRatio: "1 / 1" }}>
      <ChogArt src={meta.image} tokenId={meta.id} className="board-art absolute inset-0 h-full w-full" />
      <div className="board-shade" />
      {saved.won && <div className="board-sheen" aria-hidden />}
    </div>
  );
}
