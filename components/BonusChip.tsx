"use client";
import { useEffect, useState } from "react";
import type { BonusInfo } from "@/lib/chogToken";

// Shows the $CHOG bonus status. A perk only, never required to play.
export default function BonusChip({ address, hintsLeft, onInfo }: {
  address?: string | null;
  hintsLeft?: number;
  onInfo?: (info: BonusInfo | null) => void;
}) {
  const [info, setInfo] = useState<BonusInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInfo(null);
    onInfo?.(null);
    if (!address) return;
    let live = true;
    setLoading(true);
    fetch(`/api/bonus?address=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? (r.json() as Promise<BonusInfo>) : null))
      .catch(() => null)
      .then((d) => { if (live) { setInfo(d); onInfo?.(d); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  let text: string;
  if (!address) text = "$CHOG bonus: connect a wallet that holds 1,000 CHOG to unlock one safe-tile hint per board. Playing never needs it.";
  else if (loading) text = "Checking your $CHOG balance...";
  else if (!info || !info.available) text = "$CHOG bonus: could not read your balance right now. Playing works the same without it.";
  else if (info.tier === "holder")
    text = `${info.balance} CHOG held. Bonus on: ${hintsLeft ?? info.hints} safe-tile hint(s) left this board. A hinted run is marked as using a hint.`;
  else text = `${info.balance} CHOG held. Hold ${info.threshold.toLocaleString("en-US")} CHOG for one safe-tile hint per board. It is a bonus, not needed to play.`;

  return (
    <p className="rounded-xl border border-edge bg-panel px-3 py-2 text-[12px] leading-snug text-mute" role="status">
      {text}
    </p>
  );
}
