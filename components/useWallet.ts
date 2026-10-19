"use client";
import { useCallback, useState } from "react";
import { createWalletClient, custom, defineChain, type EIP1193Provider } from "viem";
import { MONAD_CHAIN_ID, MONAD_RPC } from "@/lib/types";

const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setError(null);
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth) {
      setError("No wallet found in this browser. Install a wallet like MetaMask or Rabby, or try Judge mode, which needs no wallet.");
      return;
    }
    setBusy(true);
    try {
      const client = createWalletClient({ chain: monad, transport: custom(eth) });
      const [addr] = await client.requestAddresses();
      const current = await client.getChainId();
      if (current !== MONAD_CHAIN_ID) {
        try {
          await client.switchChain({ id: MONAD_CHAIN_ID });
        } catch {
          await client.addChain({ chain: monad });
          await client.switchChain({ id: MONAD_CHAIN_ID });
        }
      }
      setAddress(addr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/reject|denied/i.test(msg) ? "You closed the wallet request. Press Connect to try again." : "Could not connect. Check your wallet and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { address, error, busy, connect, disconnect: () => setAddress(null) };
}
