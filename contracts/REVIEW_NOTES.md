# ChogPot review notes (2026-10-21)

Internal notes for the owner and for an outside auditor. Not for the public README.

## What the contract does

- `enter(day, amount)`: pay at least the day's minimum in CHOG to join today's pot. One entry per wallet per UTC day. `day` must be today, so a transaction that lands after midnight fails instead of joining the wrong day.
- `settle(day, winners)`: the settler posts up to 3 entrants of a finished day, best first. 60/25/15, 70/30 or 100. Rounding dust goes to first place. Zero winners moves the whole pot into today's pot. One time only.
- `claim()`: winners pull what they are owed, across all days.
- `refund(day)` then `claimRefund(day)`: once a day has gone unsettled for 7 full days after it ended, anyone opens refunds and each entrant pulls back their own entry.
- Owner can only: change the settler, schedule a new minimum (starts next UTC day), pause new entries, hand over ownership in two steps. No withdraw, no fee.

## Choices made where the brief was unsafe or unclear (safer option picked)

1. **Rollover goes to "today", not strictly "day + 1".** If day 5 is settled late (on day 8) and day 6 is already settled, sending day 5's money to day 6 would strand it. The contract always rolls into the day the settle transaction lands on, which is still open and cannot be closed yet. Settled promptly after midnight, today is day + 1, so normal behaviour matches the brief.
2. **Settle and refund never overlap.** The settler can settle only inside the 7 days after a day ends. From that moment on, only refunds. No race where a late settle and a refund fight.
3. **Money that had rolled into a refunded day moves forward to today** when refunds open. Entrants get back exactly what they paid, nothing more, and rolled money is never stuck.
4. **The current settler wallet cannot enter**, so it cannot name itself.
5. **Fee-on-transfer tokens are refused** at entry (balance before and after must differ by exactly the amount).
6. **Minimum entry can never be 0**, so every entrant has paid something.
7. **Refund cannot be opened on a day with nothing in it** (stops pointless event spam).

## What was tested (54 contract tests, Hardhat local chain, all passing)

Entry rules (minimum, more than minimum, double entry, wrong day, after midnight, settler blocked, no approval, fee token), pause (blocks entries only; settle, claim, refund still work), all three splits, rounding dust, single entrant day, non-entrant winner, winner from another day, zero address winner, duplicates, more than 3, double settle, new settler cannot redo a day, settle before day ends, last second of the window and the second after, double claim, claims across days, rollover, rollover chain over 3 empty days, late rollover target, empty day settle, refund timing to the second, refund twice, refund of settled day, refund of empty day, refund claim twice, refund by non-entrant, carried money moving on after refund, minimum change timing (4 cases), owner only checks, two-step ownership, reentry into `claim` and `claimRefund` from a hostile token, a 20-day seeded random run that checks after every day that the contract holds exactly what it owes, and that the website ABI file matches the compiled contract. The list of state-changing functions is pinned by a test, so a new withdraw-style function cannot slip in silently.

TypeScript side: 11 new vitest tests for `pickPotWinners`, the `POT_ENABLED` flag and the ABI.

## What was NOT tested

- The real CHOG token on Monad mainnet (`0x3500...7777`). I did not read its code. If it has transfer fees, a blocklist, pausing, hooks or an upgradeable proxy, the pot's behaviour changes. A blocked winner address could never claim.
- Any real deploy, on testnet or mainnet. Monad specific behaviour (timestamps, gas charged by limit) was not checked on a live chain.
- Fuzzing with many random inputs per function (only one seeded random run), formal verification, gas limits under load.
- Tokens that return `false` instead of reverting (SafeERC20 should handle this, but no test).
- Any server route or page: none was built, by design. The server side that feeds `pickPotWinners` and calls `settle` does not exist yet.

## Known risks (trust that remains)

- **The settler is trusted to pick the right winners.** The contract only checks that winners paid in. It cannot check the game result. A bad or hacked settler could pay a friend who entered, or post zero winners to roll the pot on. It can never pay a non-entrant or take money itself.
- **The owner can swap the settler at any time.** Owner plus settler together could pay a sock-puppet entrant. A multisig owner (and maybe a timelock on `setSettler`) would reduce this.
- **The settler block only covers the current settler wallet.** The owner, or a future settler, can enter.
- **Rolled money with no future players stays in the contract** until someone enters and wins. There is no rescue function, on purpose.
- **Clock edges.** The day comes from block time. The game server uses its own clock. Near midnight a player could pay on one day and play on another. The server must use the day the player actually entered on chain (`hasEntered(day, wallet)`) and pass the on-chain entrant list to `pickPotWinners`.
- `renounceOwnership` is left in from OpenZeppelin. If used, the settler can never be changed again. Refunds still protect players.

## What an outside audit should look at

1. Every path that moves tokens: `enter`, `claim`, `claimRefund`, and the accounting in `settle`, `refund`, `_rollForward`.
2. That `sum(claimable) + open pots + unrefunded entries == token balance` holds in every order of calls.
3. The window boundaries (`dayEnd(day) + 7 days`) at the exact second.
4. The real CHOG token's code and admin powers.
5. Whether the owner and settler keys should be a multisig, and whether `setSettler` should have a delay.
