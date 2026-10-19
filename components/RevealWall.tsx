"use client";
import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import { getOwnedChogMetas } from "./deps";
import { useWallet } from "./useWallet";
import StreakChip, { readWallet, rememberWallet, type KnownWallet } from "./StreakChip";

const TOTAL = 1969;
type Wall = { total: number; cleared: number[] };
type Tab = "mine" | "all";

// One cell. Cleared Chogs show their art, owned but uncleared Chogs show a dark silhouette,
// everything else is an empty tile with no image request at all.
const Cell = memo(function Cell({ id, cleared, owned }: { id: number; cleared: boolean; owned: boolean }) {
  const label = cleared ? `Chog ${id}, cleared` : owned ? `Chog ${id}, not cleared yet` : `Chog ${id}`;
  if (!cleared && !owned) return <div className="wall-cell" title={`#${id}`} aria-label={label} />;
  return (
    <div className={`wall-cell ${owned ? "wall-owned" : ""}`} title={`#${id}`} aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/chogs/${id}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        width={64}
        height={64}
        style={cleared ? undefined : { filter: "brightness(0) invert(1) opacity(0.22)" }}
      />
    </div>
  );
});

export default function RevealWall() {
  const { address, connect, busy, error } = useWallet();
  const [wall, setWall] = useState<Wall | null>(null);
  const [wallErr, setWallErr] = useState(false);
  const [known, setKnown] = useState<KnownWallet | null>(null);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    let live = true;
    fetch("/api/wall", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Wall>) : Promise.reject(new Error("bad"))))
      .then((d) => live && setWall(d))
      .catch(() => live && setWallErr(true));
    const w = readWallet();
    if (w) { setKnown(w); setTab("mine"); }
    return () => { live = false; };
  }, []);

  // A wallet connected on this page replaces the remembered one.
  useEffect(() => {
    if (!address) return;
    let live = true;
    getOwnedChogMetas(address)
      .then((m) => {
        if (!live) return;
        const ids = m.map((c) => c.id);
        rememberWallet(address, ids);
        setKnown({ address, ids });
        setTab("mine");
      })
      .catch(() => { /* keep whatever we had */ });
    return () => { live = false; };
  }, [address]);

  const cleared = useMemo(() => new Set(wall?.cleared ?? []), [wall]);
  const owned = useMemo(() => new Set(tab === "mine" ? known?.ids ?? [] : []), [tab, known]);
  const mineCleared = (known?.ids ?? []).filter((id) => cleared.has(id)).length;
  const ids = useMemo(() => Array.from({ length: TOTAL }, (_, i) => i + 1), []);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-white">Reveal wall</h1>
        <Link href="/hall" className="text-sm font-semibold text-mute hover:text-white">Hall of Chogs →</Link>
      </div>
      <p className="mt-1 text-[14px] text-[#cfc9ea]">Every cleared board opens its Chog. The wall fills in as the community clears them.</p>

      <div className="mt-4 flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} className={`btn-ghost ${tab === "mine" ? "btn-on" : ""}`} onClick={() => setTab("mine")}>My Chogs</button>
        <button role="tab" aria-selected={tab === "all"} className={`btn-ghost ${tab === "all" ? "btn-on" : ""}`} onClick={() => setTab("all")}>Everyone</button>
      </div>

      <div className="mt-4 rounded-2xl border border-edge bg-panel p-4" role="status">
        {wallErr ? (
          <p className="text-boom">Could not read the wall right now. Refresh to try again.</p>
        ) : !wall ? (
          <p className="text-mute">Counting cleared Chogs…</p>
        ) : tab === "all" ? (
          <>
            <p className="text-3xl font-black tabular-nums text-white">{wall.cleared.length} <span className="text-lg font-semibold text-mute">of {wall.total.toLocaleString()} cleared</span></p>
            <p className="mt-1 text-[13px] text-mute">
              {wall.cleared.length === 0 ? "0 so far. The first clear lights up the wall." : "A Chog counts once any board of it has been cleared."}
            </p>
          </>
        ) : known && known.ids.length > 0 ? (
          <>
            <p className="text-3xl font-black tabular-nums text-white">{mineCleared} <span className="text-lg font-semibold text-mute">of your {known.ids.length} cleared</span></p>
            <p className="mt-1 text-[13px] text-mute">Your Chogs are outlined. Dark shapes are ones still waiting for you.</p>
            <StreakChip className="mt-3" />
          </>
        ) : known ? (
          <p className="text-[14px] text-[#cfc9ea]">This wallet holds no Chog Genesis NFTs. The Everyone tab still shows the whole wall.</p>
        ) : (
          <div>
            <p className="text-[14px] text-[#cfc9ea]">Connect your wallet to see your own Chogs on the wall. No wallet? The Everyone tab works without one.</p>
            <button className="btn-main mt-3 !py-2" onClick={connect} disabled={busy}>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
            {error && <p className="mt-2 text-[13px] text-boom" role="alert">{error}</p>}
          </div>
        )}
      </div>

      <div className="wall-grid mt-4" aria-label="All 1,969 Chogs">
        {ids.map((id) => (
          <Cell key={id} id={id} cleared={cleared.has(id)} owned={owned.has(id)} />
        ))}
      </div>
    </>
  );
}
