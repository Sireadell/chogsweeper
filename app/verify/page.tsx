"use client";

import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { generateBoard } from "@/lib/engine";
import { MONAD_RPC, type Board, type ChogMeta } from "@/lib/types";

type Api = {
  tokenId: number;
  date: string;
  revealed: boolean;
  commit: string;
  salt: string | null;
  meta: ChogMeta | null;
  chain: { found: boolean; data?: string; timestamp?: number; txHash?: string; error?: string };
};

type Check = { label: string; state: "pass" | "fail" | "wait"; note: string };
type Result = { verdict: "pass" | "fail" | "wait" | "partial"; headline: string; checks: Check[]; board?: Board; api: Api };

const EXPLORER = "https://monadvision.com/tx/";
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const dayEnd = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000 + 86_400;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Ask Monad directly from this browser, so the answer does not rely on our server.
async function readChain(hash: string, fallback: Api["chain"]): Promise<Api["chain"]> {
  try {
    const call = async (method: string, params: unknown[]) =>
      (await (await fetch(MONAD_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
    const tx = await call("eth_getTransactionByHash", [hash]);
    const block = await call("eth_getBlockByNumber", [tx.blockNumber, false]);
    return { found: true, data: tx.input, timestamp: Number(BigInt(block.timestamp)), txHash: hash };
  } catch {
    return fallback;
  }
}

async function run(tokenId: string, date: string): Promise<Result> {
  const res = await fetch(`/api/verify?token=${encodeURIComponent(tokenId)}&date=${encodeURIComponent(date)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
  const api = body as Api;
  const checks: Check[] = [];

  if (!api.revealed) {
    const chain = api.chain.txHash ? await readChain(api.chain.txHash, api.chain) : api.chain;
    checks.push({
      label: "Fingerprint posted on Monad",
      state: chain.found && same(chain.data, api.commit) ? "pass" : chain.found ? "fail" : "wait",
      note: chain.found
        ? same(chain.data, api.commit)
          ? "Monad holds the same fingerprint our server shows now."
          : "The fingerprint on Monad is different from the one our server shows."
        : "No post found for this day yet.",
    });
    const bad = checks.some((c) => c.state === "fail");
    return {
      verdict: bad ? "fail" : "wait",
      headline: bad
        ? "The fingerprint on Monad does not match."
        : `This day is still live. Its secret is revealed after 00:00 UTC on ${new Date(dayEnd(date) * 1000).toISOString().slice(0, 10)}, and then you can check the board here.`,
      checks,
      api,
    };
  }

  const salt = api.salt as string;
  const recomputed = keccak256(toBytes(salt));
  checks.push({
    label: "Secret matches the fingerprint",
    state: same(recomputed, api.commit) ? "pass" : "fail",
    note: same(recomputed, api.commit) ? "Hashing the revealed secret gives the same fingerprint." : "Hashing the revealed secret gives a different fingerprint.",
  });

  let board: Board | undefined;
  if (api.meta) {
    board = generateBoard(api.meta, date, salt);
    checks.push({
      label: "Board rebuilt from the secret",
      state: same(board.commit, recomputed) ? "pass" : "fail",
      note: `Rebuilt this Chog's board in your browser: ${board.cols} by ${board.rows}, ${board.mines} mines.`,
    });
  } else {
    checks.push({ label: "Board rebuilt from the secret", state: "wait", note: "This Chog's art data was not available, so the layout could not be drawn." });
  }

  const chain = api.chain.txHash ? await readChain(api.chain.txHash, api.chain) : api.chain;
  if (!chain.found) {
    checks.push({ label: "Fingerprint was posted on Monad before the day ended", state: "wait", note: chain.error ?? "No post found for this day." });
  } else {
    const dataOk = same(chain.data, recomputed);
    const timeOk = (chain.timestamp ?? Infinity) < dayEnd(date);
    checks.push({
      label: "Fingerprint was posted on Monad before the day ended",
      state: dataOk && timeOk ? "pass" : "fail",
      note: !dataOk
        ? "The fingerprint on Monad is different from this secret's fingerprint."
        : !timeOk
          ? "It was posted after the day was already over."
          : `Posted ${new Date((chain.timestamp as number) * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC.`,
    });
  }

  const failed = checks.some((c) => c.state === "fail");
  const waiting = checks.some((c) => c.state === "wait");
  return {
    verdict: failed ? "fail" : waiting ? "partial" : "pass",
    headline: failed
      ? "This board does NOT check out."
      : waiting
        ? "The maths checks out, but one proof is missing (see below)."
        : "This board is exactly the one that was promised that morning.",
    checks,
    board,
    api: { ...api, chain },
  };
}

const COLORS = { pass: "var(--mint)", fail: "var(--boom)", wait: "#f5c96b", partial: "#f5c96b" } as const;
const MARK = { pass: "✓", fail: "✗", wait: "…" } as const;

export default function VerifyPage() {
  const [token, setToken] = useState("1");
  const [date, setDate] = useState(yesterday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<Result | null>(null);

  async function go() {
    setBusy(true);
    setErr("");
    setOut(null);
    try {
      setOut(await run(token.trim(), date));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field = { background: "var(--panel)", border: "1px solid var(--edge)", borderRadius: 8, padding: "10px 12px", color: "inherit", font: "inherit" } as const;

  return (
    <main className="page">
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Check a board</h1>
      <p style={{ opacity: 0.8, marginTop: 8, lineHeight: 1.5 }}>
        Every morning we post a fingerprint of that day's secret on Monad. The secret itself is shown after the day ends. Pick a Chog and a day, press the button, and your browser checks that the board was not changed.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20, alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Chog number
          <input style={{ ...field, width: 120 }} inputMode="numeric" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Day (UTC)
          <input style={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button
          onClick={go}
          disabled={busy}
          style={{ background: "var(--chog)", color: "#fff", border: 0, borderRadius: 8, padding: "11px 20px", font: "inherit", fontWeight: 600, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Checking..." : "Check this board"}
        </button>
      </div>

      {err && <p style={{ color: "var(--boom)", marginTop: 16 }}>{err}</p>}

      {out && (
        <section style={{ marginTop: 24, background: "var(--panel)", border: `1px solid ${COLORS[out.verdict]}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span style={{ fontSize: 40, lineHeight: 1, color: COLORS[out.verdict] }} aria-hidden>
              {out.verdict === "pass" ? "✓" : out.verdict === "fail" ? "✗" : "…"}
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{out.headline}</h2>
          </div>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 16, display: "grid", gap: 10 }}>
            {out.checks.map((c) => (
              <li key={c.label} style={{ display: "flex", gap: 10 }}>
                <span style={{ color: COLORS[c.state], width: 18 }}>{MARK[c.state]}</span>
                <span>
                  <strong>{c.label}.</strong> <span style={{ opacity: 0.8 }}>{c.note}</span>
                </span>
              </li>
            ))}
          </ul>

          <dl style={{ marginTop: 16, display: "grid", gap: 6, fontSize: 12, opacity: 0.85, wordBreak: "break-all" }}>
            <div><dt style={{ display: "inline", opacity: 0.7 }}>Fingerprint: </dt><dd style={{ display: "inline", fontFamily: "ui-monospace, monospace" }}>{out.api.commit}</dd></div>
            {out.api.salt && <div><dt style={{ display: "inline", opacity: 0.7 }}>Secret: </dt><dd style={{ display: "inline", fontFamily: "ui-monospace, monospace" }}>{out.api.salt}</dd></div>}
            {out.api.chain.txHash && (
              <div>
                <dt style={{ display: "inline", opacity: 0.7 }}>Monad post: </dt>
                <dd style={{ display: "inline" }}><a style={{ textDecoration: "underline" }} href={EXPLORER + out.api.chain.txHash} target="_blank" rel="noreferrer">{out.api.chain.txHash}</a></dd>
              </div>
            )}
          </dl>

          {out.board && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
                Mine layout for Chog #{out.api.tokenId} on {out.api.date} (● is a mine, numbers count mines next to a square):
              </p>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${out.board.cols}, minmax(0, 28px))`, gap: 2, overflowX: "auto" }}>
                {out.board.cells.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      aspectRatio: "1",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      borderRadius: 4,
                      background: c.mine ? "var(--boom)" : "var(--ink)",
                      border: "1px solid var(--edge)",
                      color: c.mine ? "#fff" : "#b9b2e0",
                    }}
                  >
                    {c.mine ? "●" : c.adj > 0 ? c.adj : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
