# Chogsweeper: a daily minesweeper where your Chog is the board

Chogsweeper is a daily puzzle game for the Chog Genesis NFT collection on Monad.
Every one of the 1,969 Chogs gets its own minesweeper board each day, its traits change the rules, and clearing the board reveals that Chog's art.

I built it because I wanted the Chog to be the game itself, not a picture pasted on top of one. [founder: confirm or replace with your own reason]

> **Can you clear your Chog today?**

Live: **https://chogsweeper.vercel.app**

## Try it in one minute, no wallet

1. Open **https://chogsweeper.vercel.app/judge**
2. Type any Chog number from 1 to 1969 (try 7).
3. Read the rule cards, then play. Tap to open a tile. To flag, right-click, or turn on Flag mode on a phone.
4. Clear the board and the Chog's art appears.

Want more? **/practice** gives unlimited boards for any Chog, and every win chains into the next one.

## How a board works

You open your Chog's board for today. It is the same board for everyone who opens that Chog today, and it changes at midnight UTC.

Under the tiles sits the Chog's own artwork. Each tile you clear opens a little window onto it. Clear them all and you see the whole Chog.

Hit a mine and the board is lost for the day. Come back tomorrow for a new one.

## Traits change the rules

Each Chog's traits are read from the collection's own metadata. Four of them change how the board plays, and every rule that fires shows up on screen with the reason.

| Trait | What it does | Chogs it applies to |
|---|---|---|
| Tier | Sets the board size. Common 8 by 8 with 10 mines, up to Legendary 14 by 14 with 30 | All 1,969 |
| Eyes | Sharp or lively eyes give a free safe peek before you start | 939 of 1,969 |
| Head | A solid hat, cap or helmet takes one hit for you | 1,147 of 1,969 |
| Accessory | Any accessory flags one real mine for you | 195 of 1,969 |

Board sizes across the collection: 1,279 Chogs play 8 by 8, 590 play 9 by 9, 60 play 10 by 10, 30 play 12 by 12 and 10 play 14 by 14.

So a Common Chog with sleepy eyes and no hat plays very differently from an Epic Chog wearing a helmet and a visor.

## Fairness you can check yourself

A daily puzzle is only fun if nobody can change the board after seeing who played. So each day works like a sealed envelope:

1. **Morning:** the site makes a secret for the day and posts only its fingerprint on Monad. The fingerprint is a short code that matches that one secret and no other.
2. **During the day:** the secret stays hidden, so nobody can work out where the mines are.
3. **After the day ends:** the secret is published. Anyone can check it matches the fingerprint posted that morning, then rebuild any Chog's board and compare.

Check a past day at **https://chogsweeper.vercel.app/verify**. It takes about a minute: pick a day and a Chog, and the page shows match or mismatch.

What this proves: the boards were fixed before anyone played and were not changed afterwards.
What it does not prove: the site itself can see the secret during the day.

The fingerprints are posted from a small wallet as a plain data post, at about 00:05 UTC every day.

## Reasons to come back

| Feature | What it is |
|---|---|
| Daily board | One board per Chog per day. Its record and streak belong to the Chog, so they stay with it if it is sold |
| Chog of the day | One shared board for everyone. Holders sign a message with a wallet that holds any Chog to get one ranked try. Fastest clear wins. The day's Chog is picked from the date and the public fingerprint, so anyone can work it out |
| Streaks | Current and best streak, with a "clear today to keep it" reminder |
| Reveal wall | All 1,969 Chogs, filling in with art as players clear them |
| Hall | Today's top 10 and yesterday's winner |
| Share card | A picture of the revealed Chog with the board size, time, date and that day's fingerprint, plus a link that previews in Discord and X |
| Practice | Unlimited unranked boards for any Chog, no wallet |

## $CHOG

Hold at least 1,000 $CHOG and you get one safe-tile hint per board. The tile glows blue, and your result is marked "hinted" so rankings stay fair. Nothing is spent. The site only reads your balance.

## For the judges

**Is the Chog essential?** Remove the NFT and there is no board. The token number picks the board, the traits set the rules, the art is the prize, and holding a Chog is what gets you a ranked try.

**Novelty.** The Chog is the puzzle, not a skin on it. Every trait combination plays differently, and the board's fairness can be checked on Monad.

**Fun.** Minesweeper takes seconds to learn. The rule cards add a small surprise to each Chog, and clearing a board ends with the art.

**Retention.** A new board every day for every Chog, a shared Chog of the day with a ranked try, streaks, and a wall the whole community fills in together.

**Clarity.** No wallet needed to play. Judge mode and practice work for anyone in under a minute.

**Execution.** Live on Vercel, reading Monad mainnet directly. 116 automated tests. Daily fingerprints posted on Monad since October 19.

## What this is not

- **No real holder has played a ranked run yet.** I tested the holder check and message signing against the real chain with a throwaway wallet, not yet with a real holder.
- **No contract of my own.** The game reads the existing Chog Genesis collection and the $CHOG token, and posts one small data message a day. Nothing is minted and no token is spent.
- **The fairness check has a limit.** It proves boards were not changed afterwards, not that the site never saw the secret.
- **The trait rules are my design.** The collection does not define them.
- **Records live on a free database.** That is fine for now, but it is not built for a large crowd.
- **The reveal wall starts empty.** It fills only as people clear boards.

## Run it locally

Install dependencies:

```bash
npm install
```

Start the site (a local secret is created for you the first time):

```bash
npm run dev
```

Run the tests:

```bash
npm test
```

Preview a day's fingerprint post without sending anything:

```bash
npx tsx scripts/post-commit.ts --dry-run
```

No wallet or keys are needed to run or test the game locally. Records are saved to a local file unless an Upstash database is set.

## Built with

| Part | Role |
|---|---|
| Monad mainnet | Holds the Chog Genesis collection, the $CHOG token and the daily fingerprints |
| Chog Genesis (0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763) | Token numbers, traits and art for all 1,969 Chogs, cached in the repo so boards load even if the image host is slow |
| $CHOG (0x350035555E10d9AfAF1566AaebfCeD5BA6C27777) | Balance read for the hint |
| Next.js and viem | The site and the chain reads |
| Upstash Redis | Records, streaks, the wall and Chog of the day |
| Vercel | Hosting and the daily timer |

Built for Chogathon 2026. The board engine started from my earlier minesweeper project, ghostsweeper.

> **Can you clear your Chog today?** https://chogsweeper.vercel.app
