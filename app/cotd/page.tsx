"use client";
import Link from "next/link";
import { useState } from "react";
import type { Board, ChogMeta } from "@/lib/types";
import { useWallet } from "@/components/useWallet";
import GameScreen from "@/components/GameScreen";
import CotdCard from "@/components/CotdCard";
import { cotdMessage } from "@/lib/cotd-message";
import { todayUTC } from "@/components/dailySalt";

type Phase = "ready" | "signing" | "playing";
type Result = { rank: number | null; won: boolean } | { error: string };
type Eth = { request(a: { method: string; params: unknown[] }): Promise<string> };

function toHex(s: string): string {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function CotdPage() {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [phase, setPhase] = useState<Phase>("ready");
  const [msg, setMsg] = useState("");
  const [game, setGame] = useState<{ board: Board; meta: ChogMeta; date: string; sig: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function start() {
    if (!address) return;
    setMsg("");
    setPhase("signing");
    let sig: string;
    try {
      const eth = window.ethereum as unknown as Eth;
      sig = await eth.request({ method: "personal_sign", params: [toHex(cotdMessage(todayUTC())), address] });
    } catch {
      setMsg("No signature was given, so no try was started. Press Start to try again.");
      setPhase("ready");
      return;
    }
    try {
      const r = await fetch("/api/cotd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", address, signature: sig }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error ?? "Could not start.");
        setPhase("ready");
        return;
      }
      setGame({ board: j.board, meta: j.meta, date: j.board.date, sig });
      setPhase("playing");
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
      setPhase("ready");
    }
  }

  async function finish(r: { won: boolean; seconds: number; moves: number }) {
    if (!game || !address) return;
    try {
      const res = await fetch("/api/cotd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finish", address, signature: game.sig, date: game.date, ...r }),
      });
      const j = await res.json();
      setResult(res.ok ? { rank: j.rank, won: r.won } : { error: j.error ?? "Could not record the result." });
    } catch {
      setResult({ error: "Could not reach the server to record your result." });
    }
  }

  const footer = result && (
    <section className="cotd-card mt-4" role="status">
      {"error" in result ? (
        <p className="text-boom">{result.error}</p>
      ) : result.won ? (
        <p className="text-white">
          Recorded. {result.rank ? <>You are <b>#{result.rank}</b> on today's board.</> : "Your time is on the board."}{" "}
          <Link href="/hall" className="text-mint underline-offset-2 hover:underline">See the Hall</Link>
        </p>
      ) : (
        <p className="text-white">
          Your ranked try is used. Come back for tomorrow's Chog.{" "}
          <Link href="/hall" className="text-mint underline-offset-2 hover:underline">See the Hall</Link>
        </p>
      )}
    </section>
  );

  return (
    <main className="page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
        {address && (
          <button onClick={disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        )}
      </header>

      {phase !== "playing" && (
        <section className="mx-auto max-w-[620px]">
          <CotdCard hideActions />
          <div className="mt-5 text-center">
            {!address ? (
              <>
                <p className="text-[15px] text-[#cfc9ea]">Connect a wallet that holds any Chog Genesis NFT to take today's ranked try.</p>
                <button className="btn-main mt-4" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
                {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
                <p className="mt-5 text-[14px] text-mute">
                  No wallet? <Link href="/judge" className="text-mint underline-offset-2 hover:underline">Judge mode</Link> lets you practice any Chog.
                </p>
              </>
            ) : (
              <>
                <p className="text-[14px] text-mute">
                  You get one ranked try. Your wallet signs a short message (free, no transaction) and the clock starts on the server. Leaving the page uses up the try.
                </p>
                <button className="btn-main mt-4" onClick={start} disabled={phase === "signing"}>
                  {phase === "signing" ? "Check your wallet…" : "Start my ranked try"}
                </button>
                {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
              </>
            )}
          </div>
        </section>
      )}

      {phase === "playing" && game && (
        <GameScreen meta={game.meta} board={game.board} mode="cotd" address={address} onFinish={finish} footer={footer} />
      )}
    </main>
  );
}
