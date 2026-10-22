import { replay, type Move } from "./game";
import type { Board } from "./types";

// Daily Pot run check. Money rides on the result, so nothing the browser says about time is trusted:
// the server rebuilds the board, replays every move, and measures the time on its own clock.
export type PotCheck =
  | { ok: true; seconds: number; moves: number }
  | { ok: false; error: string };

const MAX_MOVES = 5000;
// Fastest believable clear: no human or script round trip finishes a board in less than this.
export const MIN_POT_SECONDS = 3;

function cleanMoves(raw: unknown, cells: number): Move[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MOVES) return null;
  const out: Move[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { action, idx } = m as { action?: unknown; idx?: unknown };
    if (action !== "reveal" && action !== "flag" && action !== "chord") return null;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= cells) return null;
    out.push({ action, idx });
  }
  return out;
}

export function checkPotRun(board: Board, rawMoves: unknown, startedAt: number, now: number): PotCheck {
  const moves = cleanMoves(rawMoves, board.cols * board.rows);
  if (!moves) return { ok: false, error: "The move list is not valid." };
  const final = replay(board, moves);
  if (final.status !== "won") return { ok: false, error: "Those moves do not clear the board." };
  const seconds = Math.round(((now - startedAt) / 1000) * 10) / 10;
  if (seconds < MIN_POT_SECONDS) return { ok: false, error: "That run finished faster than a real try can." };
  return { ok: true, seconds, moves: moves.filter((m) => m.action !== "flag").length };
}
