"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Board, ChogMeta } from "@/lib/types";
import { getOwnedChogMetas } from "@/components/deps";
import { todayUTC } from "@/components/dailySalt";
import { useWallet } from "@/components/useWallet";
import ChogArt from "@/components/ChogArt";
import GameScreen from "@/components/GameScreen";

export default function PlayPage() {
  const { address, error, busy, connect, disconnect } = useWallet();
  const [chogs, setChogs] = useState<ChogMeta[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [picked, setPicked] = useState<ChogMeta | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardErr, setBoardErr] = useState(false);
  const date = todayUTC();

  useEffect(() => {
    if (!address) return;
    let live = true;
    setChogs(null);
    setLoadErr(false);
    getOwnedChogMetas(address)
      .then((m) => live && setChogs(m))
      .catch(() => live && setLoadErr(true));
    return () => { live = false; };
  }, [address]);

  // The server builds today's board (it holds the salt), so the browser never sees a dev salt.
  useEffect(() => {
    if (!picked) return;
    let live = true;
    setBoard(null);
    setBoardErr(false);
    fetch(`/api/board?token=${picked.id}&date=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Board>) : Promise.reject(new Error("bad"))))
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoardErr(true));
    return () => { live = false; };
  }, [picked, date]);

  return (
    <main className="page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
        {address && (
          <button onClick={disconnect} className="btn-ghost" title="Disconnect wallet">
            {address.slice(0, 6)}…{address.slice(-4)} · Disconnect
          </button>
        )}
      </header>

      {!address && (
        <section className="mx-auto max-w-[560px] text-center">
          <h1 className="text-3xl font-black tracking-tight text-white">Pick your Chog</h1>
          <p className="mt-2 text-[15px] text-[#cfc9ea]">Connect the wallet that holds your Chog Genesis NFTs. Each Chog gets its own board every day.</p>
          <button className="btn-main mt-5" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
          {error && <p className="mt-3 text-[14px] text-boom" role="alert">{error}</p>}
          <p className="mt-6 text-[14px] text-mute">No wallet? <Link href="/judge" className="text-mint underline-offset-2 hover:underline">Try Judge mode</Link>, it works with any Chog.</p>
        </section>
      )}

      {address && !picked && (
        <section className="mx-auto max-w-[760px]">
          <h1 className="text-2xl font-black tracking-tight text-white">Pick your Chog</h1>
          <p className="mt-1 text-[14px] text-mute">Each Chog has one ranked board per day. Pick one to play today's.</p>
          {!chogs && !loadErr && <p className="mt-6 text-[14px] text-mute" role="status">Looking for your Chogs…</p>}
          {loadErr && <p className="mt-6 text-[14px] text-boom" role="alert">Could not read your Chogs right now. Refresh to try again.</p>}
          {chogs && chogs.length === 0 && (
            <div className="mt-6 rounded-2xl border border-edge bg-panel p-5">
              <p className="text-white">This wallet holds no Chog Genesis NFTs.</p>
              <p className="mt-1 text-[14px] text-mute">You can still try any Chog in practice, no wallet needed.</p>
              <Link href="/judge" className="btn-main mt-4 inline-block">Try Judge mode</Link>
            </div>
          )}
          {chogs && chogs.length > 0 && (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {chogs.map((c) => (
                <li key={c.id}>
                  <button className="pick-card" onClick={() => setPicked(c)}>
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl [container-type:inline-size]">
                      <ChogArt src={c.image} tokenId={c.id} className="h-full w-full" />
                    </div>
                    <span className="mt-2 block truncate text-sm font-semibold text-white">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {address && picked && (
        <>
          <button className="btn-ghost mb-4" onClick={() => setPicked(null)}>← Switch Chog</button>
          {board ? <GameScreen meta={picked} board={board} mode="daily" address={address} /> : boardErr ? (
            <p className="text-boom" role="alert">Could not load today's board. Check your connection and press Switch Chog, then pick again.</p>
          ) : <p className="text-mute" role="status">Loading today's board…</p>}
        </>
      )}
    </main>
  );
}
