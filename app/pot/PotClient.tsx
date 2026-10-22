"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, formatUnits, type EIP1193Provider, type Hex } from "viem";
import type { Board, ChogMeta } from "@/lib/types";
import { MONAD_CHAIN_ID, MONAD_RPC } from "@/lib/types";
import type { Move } from "@/lib/game";
import type { PotSummary } from "@/lib/potView";
import { chogPotAbi } from "@/lib/potAbi";
import { potMessage } from "@/lib/pot-message";
import { useWallet } from "@/components/useWallet";
import GameScreen from "@/components/GameScreen";
import ChogArt from "@/components/ChogArt";
import { chogLabel } from "@/lib/names";
import { generateBoard, getChogMeta } from "@/components/deps";
import { PREVIEW_STATES, previewSummary, type PreviewState } from "./fixture";

const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

type Eth = EIP1193Provider & { on?: (e: string, f: (x: unknown) => void) => void; removeListener?: (e: string, f: (x: unknown) => void) => void };
type Game = { board: Board; meta: ChogMeta; day: number; sig: string };
type RunResult = { counted: boolean; seconds?: number; rank: number | null; reason?: string | null } | { error: string };

const secs = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round((s - m * 60) * 10) / 10;
  return m > 0 ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${r.toFixed(1)}s`;
};

function toHex(s: string): string {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Whole tokens with at most 2 decimals, cut not rounded, with thousands separators.
function tok(raw: string | null | undefined, decimals = 18): string {
  if (raw == null) return "...";
  const [w, f = ""] = formatUnits(BigInt(raw), decimals).split(".");
  const frac = f.slice(0, 2).replace(/0+$/, "");
  return `${BigInt(w).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

function useClock(target: number | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!target || now === null) return { left: null as number | null, text: "--:--:--" };
  const left = Math.max(0, Math.floor((target - now) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return { left, text: `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}` };
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : String(e);
  if (/reject|denied|cancel/i.test(m)) return "You closed the wallet request. Nothing was sent.";
  if (/WrongDay/.test(m)) return "The UTC day changed before your payment landed, so it was refused and nothing was taken. Reload for the new day.";
  if (/AlreadyEntered/.test(m)) return "This wallet already entered today's pot.";
  if (/BelowMinEntry/.test(m)) return "That amount is below today's minimum entry.";
  if (/EnforcedPause/.test(m)) return "New entries are paused right now.";
  if (/insufficient|exceeds balance/i.test(m)) return "Not enough CHOG, or not enough MON for the network fee.";
  return "The wallet request failed. Nothing was taken. Try again.";
}

export default function PotClient({ dev }: { dev: boolean }) {
  const wallet = useWallet();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [data, setData] = useState<PotSummary | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "approve" | "enter" | "start" | "claim" | "refund" | "switch">("");
  const [msg, setMsg] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  // Development only: ?preview=STATE shows a page state with made-up numbers.
  useEffect(() => {
    if (!dev) return;
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p && (PREVIEW_STATES as readonly string[]).includes(p)) setPreview(p as PreviewState);
  }, [dev]);

  const address = preview ? (preview === "not-deployed" || preview === "connect" ? null : "0x07bd5b2e00000000000000000000000000c011e9") : wallet.address;
  const activeChain = preview ? (preview === "wrong-network" ? 1 : MONAD_CHAIN_ID) : chainId;

  const load = useCallback(async () => {
    if (preview) {
      setData(previewSummary(preview));
      return;
    }
    try {
      const q = wallet.address ? `?address=${wallet.address}` : "";
      const r = await fetch(`/api/pot${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error("bad");
      setData((await r.json()) as PotSummary);
      setLoadErr("");
    } catch {
      setLoadErr("Could not load the Daily Pot. Check your connection and reload.");
    }
  }, [preview, wallet.address]);

  useEffect(() => { void load(); }, [load]);

  // Preview "playing" opens a practice board so the game screen can be seen.
  useEffect(() => {
    if (preview !== "playing" || !data) return;
    getChogMeta(7)
      .then((meta) => setGame({ meta, board: generateBoard(meta, data.date, "preview-salt"), day: data.day, sig: "" }))
      .catch(() => undefined);
  }, [preview, data]);

  // Track the wallet's network so a switch away from Monad shows at once.
  useEffect(() => {
    const eth = (typeof window !== "undefined" ? window.ethereum : undefined) as Eth | undefined;
    if (!eth || !wallet.address) { setChainId(null); return; }
    const set = (v: unknown) => setChainId(typeof v === "string" ? parseInt(v, 16) : null);
    eth.request({ method: "eth_chainId" }).then(set).catch(() => setChainId(null));
    eth.on?.("chainChanged", set);
    return () => eth.removeListener?.("chainChanged", set);
  }, [wallet.address]);

  const clock = useClock(data?.endsAt);
  const entryClock = useClock(data?.entryClosesAt);

  function clients() {
    const eth = window.ethereum as Eth;
    return {
      w: createWalletClient({ chain: monad, transport: custom(eth) }),
      p: createPublicClient({ chain: monad, transport: custom(eth) }),
    };
  }

  async function send(kind: "approve" | "enter" | "claim" | "refund", run: () => Promise<Hex[]>) {
    if (preview) { setMsg("Preview only. Nothing is sent."); return; }
    setMsg("");
    setBusy(kind);
    try {
      const hashes = await run();
      const { p } = clients();
      for (const h of hashes) {
        const r = await p.waitForTransactionReceipt({ hash: h });
        if (r.status !== "success") throw new Error("reverted");
      }
      await load();
    } catch (e) {
      setMsg(friendly(e));
    } finally {
      setBusy("");
    }
  }

  const approve = () => send("approve", async () => {
    const { w } = clients();
    const hash = await w.writeContract({ account: address as `0x${string}`, address: data!.token!.address as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [data!.contract as `0x${string}`, BigInt(data!.minEntry!)] });
    return [hash];
  });
  const enter = () => send("enter", async () => {
    const { w } = clients();
    const hash = await w.writeContract({ account: address as `0x${string}`, address: data!.contract as `0x${string}`, abi: chogPotAbi, functionName: "enter", args: [BigInt(data!.day), BigInt(data!.minEntry!)] });
    return [hash];
  });
  const claim = () => send("claim", async () => {
    const { w } = clients();
    return [await w.writeContract({ account: address as `0x${string}`, address: data!.contract as `0x${string}`, abi: chogPotAbi, functionName: "claim", args: [] })];
  });
  const takeBack = (day: number, open: boolean) => send("refund", async () => {
    const { w, p } = clients();
    const acct = address as `0x${string}`;
    const pot = data!.contract as `0x${string}`;
    if (!open) {
      const h = await w.writeContract({ account: acct, address: pot, abi: chogPotAbi, functionName: "refund", args: [BigInt(day)] });
      await p.waitForTransactionReceipt({ hash: h });
    }
    return [await w.writeContract({ account: acct, address: pot, abi: chogPotAbi, functionName: "claimRefund", args: [BigInt(day)] })];
  });

  async function switchNet() {
    setBusy("switch");
    setMsg("");
    try {
      const { w } = clients();
      try { await w.switchChain({ id: MONAD_CHAIN_ID }); } catch { await w.addChain({ chain: monad }); await w.switchChain({ id: MONAD_CHAIN_ID }); }
    } catch (e) {
      setMsg(friendly(e));
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (preview) { setMsg("Preview only. Open ?preview=playing to see the board."); return; }
    if (!address || !data) return;
    setMsg("");
    setBusy("start");
    let sig: string;
    try {
      sig = await (window.ethereum as Eth).request({ method: "personal_sign", params: [toHex(potMessage(data.date)) as Hex, address as `0x${string}`] });
    } catch {
      setMsg("No signature was given, so your run has not started. Press Start when you are ready.");
      setBusy("");
      return;
    }
    try {
      const r = await fetch("/api/pot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", address, signature: sig, day: data.day }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Could not start."); return; }
      setResult(null);
      setGame({ board: j.board, meta: j.meta, day: j.day, sig });
    } catch {
      setMsg("Could not reach the server. Nothing was used up. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function finish(r: { won: boolean; seconds: number; moves: number; moveList?: Move[] }) {
    if (!game || preview) { setResult({ counted: r.won, seconds: r.seconds, rank: r.won ? 2 : null }); return; }
    try {
      const res = await fetch("/api/pot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finish", address, signature: game.sig, day: game.day, moves: r.moveList ?? [] }),
      });
      const j = await res.json();
      setResult(res.ok ? { counted: j.counted, seconds: j.seconds, rank: j.rank, reason: j.reason } : { error: j.error ?? "Could not record your run." });
      void load();
    } catch {
      setResult({ error: "Could not reach the server to record your run. Reload the page to see if it was saved." });
    }
  }

  // ---------------------------------------------------------------- render

  if (!data) {
    return (
      <main className="page">
        <section className="mx-auto max-w-[720px] pt-2">
          <p className="eyebrow">Optional · real CHOG</p>
          <h1 className="mb-4 mt-2 font-display text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Daily Pot</h1>
          <p className="text-[15px] text-mute" role="status">{loadErr || "Loading today's pot…"}</p>
        </section>
      </main>
    );
  }

  const d = data;
  const sym = d.token?.symbol ?? "CHOG";
  const dec = d.token?.decimals ?? 18;
  const min = d.minEntry ? BigInt(d.minEntry) : null;
  const me = d.mine;
  const playing = !!game;

  const resultCard = result && (
    <section className="cotd-card mt-4" role="status">
      {"error" in result ? (
        <p className="text-boom">{result.error}</p>
      ) : result.counted ? (
        <p className="text-white">
          Counted. The server timed your clear at <b>{secs(result.seconds ?? 0)}</b>
          {result.rank ? <> and you are <b>#{result.rank}</b> in today's pot.</> : "."} Winners are posted after midnight UTC.
        </p>
      ) : (
        <p className="text-white">
          This run does not count{result.reason ? `: ${result.reason.replace(/\.$/, "")}` : ""}. Your try for today is used. Your entry stays in the pot.
        </p>
      )}
      <button className="btn-ghost mt-3" onClick={() => { setGame(null); }}>Back to the pot</button>
    </section>
  );

  if (playing && game) {
    return (
      <main className="page">
        {preview && <PreviewBar state={preview} />}
        <p className="mx-auto mb-4 max-w-[1060px] rounded-xl border border-edge bg-panel px-4 py-2.5 text-[13px] text-text2">
          <b className="text-white">Daily Pot run.</b> Your time is the server's clock, from when this board opened to when your last move arrives, so it runs a little longer than the clock below. Hitting a mine or leaving the page uses up your run.
        </p>
        <GameScreen meta={game.meta} board={game.board} mode="cotd" address={address} onFinish={finish} footer={resultCard} />
      </main>
    );
  }

  // What the main card should show.
  let step: "not-deployed" | "connect" | "wrong-network" | "paused" | "closed" | "low" | "enter" | "start" | "unfinished" | "done";
  if (!d.deployed) step = "not-deployed";
  else if (!address) step = "connect";
  else if (activeChain !== null && activeChain !== MONAD_CHAIN_ID) step = "wrong-network";
  else if (me?.run?.finished) step = "done";
  else if (me?.run?.started) step = "unfinished";
  else if (me?.entered) step = "start";
  else if (d.paused) step = "paused";
  else if ((preview === "closed") || (entryClock.left !== null && entryClock.left <= 0)) step = "closed";
  else if (me && min !== null && BigInt(me.balance) < min) step = "low";
  else step = "enter";

  const approved = !!(me && min !== null && BigInt(me.allowance) >= min);
  const claimable = me ? BigInt(me.claimable) : 0n;

  return (
    <main className="page">
      {preview && <PreviewBar state={preview} />}
      {address && !preview && (
        <header className="mb-5 flex items-center justify-end gap-3">
          <button onClick={wallet.disconnect} className="btn-ghost">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>
        </header>
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8">
        {/* Left: what this is and the one thing to do next */}
        <div className="min-w-0">
          <p className="eyebrow">Optional · real CHOG</p>
          <h1 className="mt-2 font-display text-[32px] font-extrabold tracking-tight text-white sm:text-[40px]">Daily Pot</h1>
          <p className="lead mt-3 max-w-[60ch]">
            The Daily Pot is an optional race on today's Chog of the day board. You pay a CHOG entry and get one counted run. When the UTC day ends, the three fastest clears split everything paid in.
          </p>

          {claimable > 0n && (
            <div className="card mt-5 border-mint/60 p-5" data-testid="claim">
              <p className="eyebrow">You won</p>
              <p className="mt-1 font-display text-[30px] font-extrabold text-white tabular-nums">{tok(me!.claimable, dec)} {sym}</p>
              <p className="mt-1 text-[14px] text-text2">is waiting for you in the pot contract.</p>
              <button className="btn-main mt-4" onClick={claim} disabled={busy === "claim"}>{busy === "claim" ? "Check your wallet…" : `Collect ${tok(me!.claimable, dec)} ${sym}`}</button>
              <p className="mt-2 text-[13px] text-mute">Your wallet asks you to confirm. It sends your winnings to this wallet and costs a small MON network fee.</p>
            </div>
          )}

          {me && me.refunds.length > 0 && (
            <div className="card mt-5 p-5">
              <p className="eyebrow !text-gold">Entry you can take back</p>
              {me.refunds.map((r) => (
                <div key={r.day} className="mt-2">
                  <p className="text-[14px] text-text2">
                    Winners for {r.date} were never posted, so your entry of <b className="text-white">{tok(r.amount, dec)} {sym}</b> can come back to you.
                  </p>
                  <button className="btn-ghost mt-3" onClick={() => takeBack(r.day, r.open)} disabled={busy === "refund"}>
                    {busy === "refund" ? "Check your wallet…" : `Take back ${tok(r.amount, dec)} ${sym}`}
                  </button>
                  <p className="mt-2 text-[13px] text-mute">
                    {r.open ? "One wallet request" : "Two wallet requests: the first opens refunds for that day, the second sends your entry back"}. Each costs a small MON network fee.
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="card mt-5 p-5 sm:p-6">
            {step === "not-deployed" && (
              <>
                <h2 className="text-[20px] font-bold text-white">The Daily Pot is not open yet</h2>
                <p className="mt-2 text-[15px] text-text2">Its contract is not on Monad yet, so nobody can enter today. The free game works as usual.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/cotd" className="btn-main">Play Chog of the day</Link>
                  <Link href={`/judge?id=${d.tokenId}`} className="btn-ghost">Practice today's Chog</Link>
                </div>
              </>
            )}

            {step === "connect" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Connect a wallet to enter</h2>
                <p className="mt-2 text-[15px] text-text2">You need a wallet on Monad with at least {tok(d.minEntry, dec)} {sym} and a little MON for network fees.</p>
                <button className="btn-main btn-lg mt-4" onClick={wallet.connect} disabled={wallet.busy}>{wallet.busy ? "Waiting for your wallet…" : "Connect wallet"}</button>
                {wallet.error && <p className="mt-3 text-[14px] text-boom" role="alert">{wallet.error}</p>}
                <p className="mt-4 text-[14px] text-mute">
                  Want to try the board first? <Link href={`/judge?id=${d.tokenId}`} className="link">Practice today's Chog</Link> for free.
                </p>
              </>
            )}

            {step === "wrong-network" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Switch your wallet to Monad</h2>
                <p className="mt-2 text-[15px] text-text2">Your wallet is on another network. The pot contract is on Monad.</p>
                <button className="btn-main mt-4" onClick={switchNet} disabled={busy === "switch"}>{busy === "switch" ? "Check your wallet…" : "Switch to Monad"}</button>
              </>
            )}

            {step === "paused" && (
              <>
                <h2 className="text-[20px] font-bold text-white">New entries are paused</h2>
                <p className="mt-2 text-[15px] text-text2">Nobody can enter right now. Claims and refunds still work.</p>
              </>
            )}

            {step === "closed" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Entry for today has closed</h2>
                <p className="mt-2 text-[15px] text-text2">
                  This page stops taking entries 10 minutes before midnight UTC, so there is time to play. A new pot opens in <b className="tabular-nums text-white">{clock.text}</b>.
                </p>
              </>
            )}

            {step === "low" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Not enough {sym} to enter</h2>
                <p className="mt-2 text-[15px] text-text2">
                  This wallet holds {tok(me!.balance, dec)} {sym}. Today's entry is {tok(d.minEntry, dec)} {sym}.
                </p>
              </>
            )}

            {step === "enter" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Enter today's pot: {tok(d.minEntry, dec)} {sym}</h2>
                <p className="mt-1 text-[14px] text-mute">Two wallet requests, then you play. Each request costs a small MON network fee.</p>
                <ol className="mt-4 space-y-4">
                  <Step n={1} done={approved} title={`Allow the pot to take ${tok(d.minEntry, dec)} ${sym}`}>
                    Your wallet asks you to approve this amount for the pot contract. It only gives permission. No {sym} moves yet.
                    {!approved && (
                      <div><button className="btn-main mt-3" onClick={approve} disabled={busy !== ""}>{busy === "approve" ? "Check your wallet…" : "Approve"}</button></div>
                    )}
                  </Step>
                  <Step n={2} done={false} title={`Pay ${tok(d.minEntry, dec)} ${sym} into today's pot`}>
                    Your wallet asks you to confirm the payment. This sends real {sym} to the pot contract and cannot be undone.
                    {approved && (
                      <div><button className="btn-main mt-3" onClick={enter} disabled={busy !== ""}>{busy === "enter" ? "Check your wallet…" : `Pay ${tok(d.minEntry, dec)} ${sym}`}</button></div>
                    )}
                  </Step>
                  <Step n={3} done={false} title="Play your one counted run">
                    After paying, you sign a short message to start. Signing is free and sends nothing.
                  </Step>
                </ol>
                {entryClock.left !== null && entryClock.left < 3600 && (
                  <p className="mt-4 text-[13px] text-gold">Entry on this page closes in {entryClock.text}.</p>
                )}
              </>
            )}

            {step === "start" && (
              <>
                <p className="eyebrow">You're in</p>
                <h2 className="mt-1 text-[20px] font-bold text-white">Start your counted run</h2>
                <p className="mt-2 text-[15px] text-text2">
                  You get one run today. Your wallet signs a short message (free, nothing is sent) and the board opens. If you hit a mine or leave the page, the run is used up.
                </p>
                <button className="btn-main btn-lg mt-4" onClick={start} disabled={busy === "start"}>{busy === "start" ? "Check your wallet…" : "Start my run"}</button>
              </>
            )}

            {step === "unfinished" && (
              <>
                <h2 className="text-[20px] font-bold text-white">Your run was started but not finished</h2>
                <p className="mt-2 text-[15px] text-text2">The page was left before the board was cleared, so this run does not count. Your entry stays in the pot.</p>
              </>
            )}

            {step === "done" && me?.run && (
              me.run.won ? (
                <>
                  <p className="eyebrow">Run counted</p>
                  <h2 className="mt-1 text-[20px] font-bold text-white">Cleared in {secs(me.run.seconds ?? 0)}{me.run.rank ? `, #${me.run.rank} today` : ""}</h2>
                  <p className="mt-2 text-[15px] text-text2">
                    The server replayed your moves and timed the run on its own clock.
                    {me.run.rank && me.run.rank <= 3 ? " If the day ended now you would get the amount shown next to your place." : " Only the top 3 are paid."}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-[20px] font-bold text-white">This run did not clear the board</h2>
                  <p className="mt-2 text-[15px] text-text2">It does not count, and your try for today is used. Your entry stays in the pot. A new pot opens in <b className="tabular-nums text-white">{clock.text}</b>.</p>
                </>
              )
            )}

            {msg && <p className="mt-3 text-[14px] text-boom" role="alert">{msg}</p>}
            {d.chainError && <p className="mt-3 text-[14px] text-gold" role="alert">{d.chainError}</p>}
          </div>
        </div>

        {/* Right: today's pot in numbers, then the standings */}
        <aside className="min-w-0 space-y-4" aria-label="Today's pot">
          <div className="cotd-card">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 border-chog/60 [container-type:inline-size]">
                <ChogArt src={d.meta.image} tokenId={d.meta.id} className="h-full w-full" />
              </div>
              <div className="min-w-0">
                <p className="eyebrow">Today's board · {d.date}</p>
                <p className="truncate text-[18px] font-bold text-white">{chogLabel(d.meta.id)}</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="stat-label">Pot today</p>
              <p className="font-display text-[40px] font-extrabold leading-none tracking-tight text-white tabular-nums">
                {d.potSize ? tok(d.potSize, dec) : "0"} <span className="text-[18px] text-text2">{sym}</span>
              </p>
              {d.carriedIn && BigInt(d.carriedIn) > 0n && (
                <p className="mt-1 text-[13px] text-mute">Includes {tok(d.carriedIn, dec)} {sym} rolled over from earlier days.</p>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="stat-tile"><dt className="stat-label">Entrants</dt><dd className="stat-value">{d.entrants ?? "0"}</dd></div>
              <div className="stat-tile"><dt className="stat-label">Entry</dt><dd className="stat-value !text-[16px] !leading-[28px]">{d.minEntry ? tok(d.minEntry, dec) : "..."}</dd></div>
              <div className="stat-tile"><dt className="stat-label">Ends in</dt><dd className="stat-value !text-[16px] !leading-[28px]">{clock.text}</dd></div>
            </dl>
            <p className="mt-3 text-[12px] text-mute">The day ends at midnight UTC. Winners are posted to the contract soon after.</p>
          </div>

          <div className="card p-5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">Fastest clears today</h2>
            <Standings rows={d.standings} sym={sym} dec={dec} empty="Nobody has cleared today's pot board yet." />
            {d.standings.some((s) => s.payout) && (
              <p className="mt-2 text-[12px] text-mute">Amounts are what each place would get if the day ended now.</p>
            )}
          </div>
        </aside>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="card p-5 sm:p-6">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">Yesterday · {d.yesterday.date}</h2>
          <Yesterday y={d.yesterday} sym={sym} dec={dec} />
        </div>

        <div className="card p-5 sm:p-6">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-mute">How the pot works</h2>
          <ol className="mt-3 space-y-3 text-[14px] text-text2">
            <li><b className="text-white">1. Enter.</b> Pay the entry in {sym} from your wallet. It is real {sym} and it goes into the pot contract on Monad. There is no fee.</li>
            <li><b className="text-white">2. Play once.</b> You get one counted run on today's Chog of the day board. A run that does not clear the board loses the try.</li>
            <li><b className="text-white">3. Fastest wins.</b> After midnight UTC the top 3 split the pot 60%, 25% and 15%. With two clears it is 70% and 30%. With one, it all goes to that player. If nobody clears, the whole pot rolls into the next day.</li>
            <li><b className="text-white">4. Collect.</b> Winners press Collect on this page to move their share to their wallet.</li>
          </ol>
          <h3 className="mt-5 text-[13px] font-bold uppercase tracking-[0.14em] text-mute">What to know</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] text-text2">
            <li>Every winning run is checked by replaying its moves on the server. The time comes from the server's clock, not your browser.</li>
            <li>Our server posts the winners to the contract. The contract only accepts wallets that entered that day, and it cannot send the money anywhere else.</li>
            <li>If winners are not posted within 7 days after a day ends, everyone who entered that day can take their entry back.</li>
            <li>Skill contests with an entry fee are not allowed everywhere. Check that they are allowed where you live before you enter.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[13px] font-bold ${done ? "border-mint bg-mint/15 text-mint" : "border-edge2 text-text2"}`} aria-hidden>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-white">{title}{done && <span className="sr-only"> (done)</span>}</p>
        <div className="mt-0.5 text-[14px] text-text2">{children}</div>
      </div>
    </li>
  );
}

function Standings({ rows, sym, dec, empty }: { rows: PotSummary["standings"]; sym: string; dec: number; empty: string }) {
  if (rows.length === 0) return <p className="mt-3 rounded-xl border border-dashed border-edge2 px-3 py-2.5 text-[14px] text-text2">{empty}</p>;
  return (
    <ol className="mt-3 divide-y divide-edge text-[14px]">
      {rows.map((r) => (
        <li key={r.rank} className="flex items-center justify-between gap-3 py-2 tabular-nums">
          <span className="min-w-0 truncate text-white"><span className="inline-block w-6 text-mute">{r.rank}</span>{r.wallet}</span>
          <span className="shrink-0 text-right">
            <span className="text-[#cfc9ea]">{secs(r.seconds)}</span>
            {r.payout && <span className="ml-3 font-semibold text-mint">{tok(r.payout, dec)} {sym}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Yesterday({ y, sym, dec }: { y: PotSummary["yesterday"]; sym: string; dec: number }) {
  if (y.settled && y.winners.length > 0) {
    return (
      <>
        <p className="mt-2 text-[14px] text-text2">Pot of {tok(y.potSize, dec)} {sym} from {y.entrants} {y.entrants === 1 ? "entrant" : "entrants"}. Paid by the contract:</p>
        <ol className="mt-2 divide-y divide-edge text-[14px]">
          {y.winners.map((w) => (
            <li key={w.rank} className="flex justify-between gap-3 py-2 tabular-nums">
              <span className="text-white"><span className="inline-block w-6 text-mute">{w.rank}</span>{w.wallet}</span>
              <span className="font-semibold text-mint">{tok(w.amount, dec)} {sym}</span>
            </li>
          ))}
        </ol>
      </>
    );
  }
  if (y.settled) {
    return <p className="mt-2 text-[14px] text-text2">Nobody cleared the board, so the pot of {tok(y.potSize, dec)} {sym} rolled into the next day.</p>;
  }
  if (y.refundOpen) {
    return <p className="mt-2 text-[14px] text-text2">Winners were not posted in time, so everyone who entered can take their entry back.</p>;
  }
  if (y.entrants === 0) return <p className="mt-2 text-[14px] text-text2">Nobody entered yesterday's pot.</p>;
  return (
    <>
      <p className="mt-2 text-[14px] text-text2">Winners have not been posted to the contract yet. These are the server's results. The amounts become final once posted.</p>
      <Standings rows={y.standings} sym={sym} dec={dec} empty="Nobody cleared yesterday's board." />
    </>
  );
}

function PreviewBar({ state }: { state: PreviewState }) {
  return (
    <p className="mb-4 rounded-xl border border-gold/50 bg-gold/10 px-4 py-2 text-[13px] text-gold">
      Preview with made-up numbers ({state}). Nothing is sent and no wallet is used. Development only.
    </p>
  );
}
