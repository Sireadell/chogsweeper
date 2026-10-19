"use client";
import type { Board, FiredRule } from "@/lib/types";
import type { GameState } from "./gameLogic";

const ICON: Record<string, string> = { "tier-size": "▦", "eyes-peek": "👁", "accessory-flag": "⚑", "head-shield": "🛡" };
const TITLE: Record<string, string> = {
  "tier-size": "Board size",
  "eyes-peek": "Free peek",
  "accessory-flag": "Free flag",
  "head-shield": "Shield",
};

function status(r: FiredRule, b: Board, s: GameState): string {
  if (r.id === "eyes-peek") return "Fired. Look for the ringed tile.";
  if (r.id === "accessory-flag") return "Fired. One mine is already flagged.";
  if (r.id === "tier-size") return `${b.cols} by ${b.rows}, ${b.mines} mines.`;
  if (r.id === "head-shield") return s.shieldedAt.length ? "Used. It saved you once." : s.shields > 0 ? "Ready. It saves you once." : "Spent.";
  return "";
}

// Each rule that fired for this Chog, with the plain reason it fired.
export default function RuleCards({ board, state }: { board: Board; state: GameState }) {
  if (!board.rules.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Rules from this Chog's traits">
      {board.rules.map((r, k) => {
        const used = r.id === "head-shield" && state.shieldedAt.length > 0;
        return (
          <li key={r.id} className={`rule-card ${used ? "rule-used" : ""}`} style={{ animationDelay: `${k * 110}ms` }}>
            <span className="rule-ico" aria-hidden>{ICON[r.id] ?? "✦"}</span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-white">
                {TITLE[r.id] ?? r.id} <span className="font-normal text-mute">from {r.trait}: {r.value}</span>
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-[#cfc9ea]">{r.why}</p>
              <p className="mt-1 text-[12px] font-medium text-mint">{status(r, board, state)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
