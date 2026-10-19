// SHARED CONTRACT. Every session codes against these types. Change only with the lead session's OK.

export const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763" as const;
export const MONAD_CHAIN_ID = 143;
export const MONAD_RPC = "https://rpc.monad.xyz";
export const CHOG_SUPPLY = 1969;

export type Trait = { trait_type: string; value: string };

// One Chog as stored in data/chogs.json (cached at build time so Pinata outages cannot hurt us)
export type ChogMeta = {
  id: number;            // token id
  name: string;
  image: string;         // https gateway URL of the art
  traits: Trait[];       // the 12 traits
};

export type Cell = { mine: boolean; adj: number };

export type RuleId = "tier-size" | "eyes-peek" | "accessory-flag" | "head-shield";

// A trait rule that fired for this Chog (shown on screen with `why`)
export type FiredRule = { id: RuleId; trait: string; value: string; why: string };

export type Board = {
  tokenId: number;
  date: string;          // UTC date YYYY-MM-DD
  cols: number;
  rows: number;
  mines: number;
  cells: Cell[];         // row-major, length cols*rows
  rules: FiredRule[];
  freePeek?: number;     // cell index revealed safe by Eyes rule
  freeFlag?: number;     // cell index of a mine pre-flagged by Accessory rule
  shields: number;       // lives from Head rule (0 or 1)
  commit: string;        // 0x keccak of the salt used (the public fingerprint)
};

// engine API (lib/engine.ts, owned by the ENGINE session):
//   generateBoard(meta: ChogMeta, date: string, salt: string): Board
//   saltCommit(salt: string): string
// chain API (lib/chain.ts, owned by the CHAIN session):
//   getOwnedChogs(address: string): Promise<number[]>
//   getChogMeta(id: number): Promise<ChogMeta>      // reads data/chogs.json first
