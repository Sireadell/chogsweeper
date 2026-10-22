// Daily Pot helpers that are safe in the browser (no server code, no secrets).

export const DAY_MS = 86_400_000;
// A run started just before midnight UTC may still finish this long after it.
// The settle job never runs for a day until this grace has passed.
export const POT_FINISH_GRACE_MS = 15 * 60_000;
// The page stops offering entry this long before midnight, so a new entrant still has time to play.
export const POT_ENTRY_CUTOFF_MS = 10 * 60_000;
// The contract's settle window: after this, only refunds are possible.
export const POT_SETTLE_WINDOW_MS = 7 * DAY_MS;

// The contract's day number: whole UTC days since 1970 (block.timestamp / 1 days).
export function potDayOf(ms: number): number {
  return Math.floor(ms / DAY_MS);
}
export function potDateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
export function potDayOfDate(date: string): number {
  return potDayOf(Date.parse(`${date}T00:00:00Z`));
}
// Milliseconds when the day ends (00:00 UTC of the next day), same as dayEnd() on chain.
export function potDayEndMs(day: number): number {
  return (day + 1) * DAY_MS;
}

// The sentence a wallet signs to start its one counted pot run for a day (no gas, no transaction).
export function potMessage(date: string): string {
  return `Chogsweeper Daily Pot ${date}\nI am starting my one counted run for this pot day.`;
}
