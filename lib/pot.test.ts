import { describe, expect, it } from "vitest";
import { generateBoard } from "./engine";
import { newGame, reveal, type Move } from "./game";
import { checkPotRun } from "./pot";
import { fakeChog } from "./engine.test";

const D = "2026-10-20";

// Play a real win: reveal a safe cell, then every other safe cell the replayed game says is safe.
function winningMoves(board: ReturnType<typeof generateBoard>): Move[] {
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

describe("daily pot run check", () => {
  const board = generateBoard(fakeChog(5, "Common"), D, "pot-salt");
  const moves = winningMoves(board);

  it("accepts a real win and takes the time from the server clock", () => {
    const r = checkPotRun(board, moves, 1_000_000, 1_000_000 + 41_300);
    expect(r).toMatchObject({ ok: true, seconds: 41.3 });
  });
  it("rejects a move list that does not clear the board", () => {
    expect(checkPotRun(board, moves.slice(0, 2), 0, 60_000).ok).toBe(false);
  });
  it("rejects a run faster than a real try", () => {
    expect(checkPotRun(board, moves, 0, 1_000).ok).toBe(false);
  });
  it("rejects junk move lists", () => {
    expect(checkPotRun(board, "x", 0, 60_000).ok).toBe(false);
    expect(checkPotRun(board, [], 0, 60_000).ok).toBe(false);
    expect(checkPotRun(board, [{ action: "reveal", idx: 9999 }], 0, 60_000).ok).toBe(false);
    expect(checkPotRun(board, [{ action: "nuke", idx: 1 }], 0, 60_000).ok).toBe(false);
  });
});
