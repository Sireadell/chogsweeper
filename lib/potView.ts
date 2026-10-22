// Shape of GET /api/pot. Types only, safe to import in the browser.
// Token amounts are strings of the token's smallest unit (use BigInt on them).

export type PotStandingView = { rank: number; wallet: string; seconds: number; payout: string | null };

export type PotSummary = {
  deployed: boolean;
  contract: string | null;
  chainId: number;
  day: number;
  date: string;
  tokenId: number;
  meta: { id: number; name: string; image: string };
  endsAt: number; // ms, midnight UTC
  entryClosesAt: number; // ms, this page stops offering entry
  settleAfter: number; // ms, the earliest the settle job looks at today
  token: { address: string; symbol: string; decimals: number } | null;
  minEntry: string | null;
  potSize: string | null;
  carriedIn: string | null;
  entrants: number | null;
  paused: boolean;
  clears: number;
  standings: PotStandingView[];
  yesterday: {
    day: number;
    date: string;
    tokenId: number;
    settled: boolean | null;
    refundOpen: boolean | null;
    potSize: string | null;
    entrants: number | null;
    winners: { rank: number; wallet: string; amount: string }[]; // from the contract once settled
    standings: PotStandingView[]; // from the server's records, before settling
  };
  mine?: {
    entered: boolean;
    entry: string;
    claimable: string;
    allowance: string;
    balance: string;
    run: { started: boolean; finished: boolean; won?: boolean; seconds?: number; rank: number | null; reason?: string } | null;
    refunds: { day: number; date: string; amount: string; open: boolean }[];
  };
  chainError?: string;
};
