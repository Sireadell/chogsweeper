import Link from "next/link";
import CotdCard from "@/components/CotdCard";
import StreakChip from "@/components/StreakChip";
import HeroBoard from "@/components/HeroBoard";
import QuickPlay from "@/components/QuickPlay";

const PROOF = [
  { big: "1,969", small: "boards, one for each Chog Genesis NFT" },
  { big: "Daily", small: "new boards at 00:00 UTC, fingerprint on Monad" },
  { big: "No wallet", small: "needed to try any Chog" },
];

const RULES = [
  { ico: "▦", trait: "Tier", rule: "Board size", text: "Common Chogs get 8 by 8 with 10 mines. Legendary Chogs get 14 by 14 with 30." },
  { ico: "👁", trait: "Eyes", rule: "Free peek", text: "Sharp or lively eyes (laser, visor, round, heart and more) mark one safe tile before you start." },
  { ico: "⚑", trait: "Accessory", rule: "Free flag", text: "Any accessory sniffs out one real mine and flags it for you." },
  { ico: "🛡", trait: "Head", rule: "Shield", text: "Caps, hats and helmets take the hit from one mine." },
];

const MODES = [
  { href: "/judge?id=7", title: "Judge mode", tag: "No wallet", text: "Type any Chog from 1 to 1,969 and play a practice board right away.", art: [7, 100, 777] },
  { href: "/practice", title: "Practice", tag: "No wallet", text: "Endless boards. Clear one and the next Chog is lined up. Build a chain.", art: [1500, 69, 333] },
  { href: "/play", title: "My Chogs", tag: "Ranked daily", text: "Connect the wallet that holds your Chogs. Each one gets one ranked board a day.", art: [420, 888, 1000] },
  { href: "/cotd", title: "Chog of the day", tag: "One shared board", text: "Everyone plays the same Chog. Holders get one ranked try, fastest clear wins.", art: [250, 1969, 42] },
  { href: "/wall", title: "Reveal wall", tag: "1,969 Chogs", text: "When anyone clears a Chog on its daily board, it lights up here in full colour.", art: [12, 345, 1234] },
  { href: "/verify", title: "Check a board", tag: "Fairness", text: "Rebuild any past board in your browser and match it against the post on Monad.", art: [555, 900, 1700] },
];

function ArtStack({ ids }: { ids: number[] }) {
  return (
    <div className="flex -space-x-3" aria-hidden>
      {ids.map((id, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={id} src={`/chogs/${id}.webp`} alt="" width={44} height={44} loading="lazy"
          className="h-11 w-11 rounded-xl border-2 border-panel object-cover shadow-lg transition group-hover:translate-y-[-2px]"
          style={{ transform: `rotate(${(i - 1) * 6}deg)`, zIndex: 3 - i }} />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="page">
      {/* Hero: what it is, one main button, and the art turning into a board */}
      <section className="grid items-center gap-x-14 gap-y-8 pb-6 pt-4 sm:pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:pt-12">
        <div className="lg:col-start-1 lg:row-start-1">
          <p className="eyebrow">A daily puzzle for Chog Genesis</p>
          <h1 className="mt-3 text-[44px] font-extrabold leading-[0.98] tracking-[-0.03em] text-white sm:text-[64px] lg:text-[76px]">
            Your Chog is<br /><span className="bg-gradient-to-r from-[#b9abff] via-[#a493ff] to-mint bg-clip-text text-transparent">the board.</span>
          </h1>
          <p className="lead mt-5 max-w-[36ch]">
            Chogsweeper turns each Chog Genesis NFT into its own minesweeper board, new every day. The Chog&apos;s traits change the rules. Clear the board and its art appears.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/judge?id=7" className="btn-main btn-lg w-full sm:w-auto">Try Chog #7 now</Link>
            <Link href="/play" className="btn-ghost !min-h-[56px] w-full !px-5 !text-[15px] sm:w-auto">Play my own Chogs</Link>
          </div>
          <p className="mt-3 text-[13px] text-mute">No wallet, nothing to sign. One board takes about a minute.</p>
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <HeroBoard />
        </div>
        <ul className="grid grid-cols-3 gap-2 self-start lg:col-start-1 lg:row-start-2" aria-label="Quick facts">
          {PROOF.map((p) => (
            <li key={p.big} className="rounded-2xl border border-edge bg-panel/70 px-2.5 py-3 sm:px-3.5">
              <p className="font-display text-[17px] font-extrabold leading-none text-white sm:text-[20px]">{p.big}</p>
              <p className="mt-1 text-[11px] leading-snug text-mute sm:text-[12px]">{p.small}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* One-minute try card */}
      <section id="try" aria-label="Try it in one minute" className="card mt-10 overflow-hidden">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_380px] lg:items-center">
          <div>
            <p className="eyebrow">Try it in one minute, no wallet</p>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Pick a Chog", "Type any number from 1 to 1,969. Chog #7 is a good first board."],
                ["Read its rules", "Its traits set the board size and can give a peek, a flag or a shield."],
                ["Clear the board", "Every safe tile you open shows more of the art. Clear it all to see the whole Chog."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3 sm:block">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-chog font-display text-[15px] font-extrabold text-white shadow-[0_3px_0_#4b33c4]">{i + 1}</span>
                  <div className="sm:mt-3">
                    <p className="font-display text-[16px] font-bold text-white">{t}</p>
                    <p className="mt-0.5 text-[14px] leading-snug text-text2">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-edge2 bg-ink2 p-4">
            <QuickPlay />
            <p className="mt-3 text-[12px] text-mute">Opens Judge mode. Practice boards are not ranked.</p>
          </div>
        </div>
      </section>

      {/* Traits change the rules */}
      <section className="mt-16" aria-labelledby="rules-h">
        <p className="eyebrow">What makes it different</p>
        <h2 id="rules-h" className="mt-2 text-[30px] font-extrabold tracking-[-0.02em] text-white sm:text-[38px]">Traits change the rules</h2>
        <p className="lead mt-2 max-w-[60ch]">The game reads four traits from each NFT and turns them into rules. The screen tells you when one fires.</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RULES.map((r) => (
            <li key={r.trait} className="rule-card flex-col">
              <div className="flex items-center gap-3">
                <span className="rule-ico" aria-hidden>{r.ico}</span>
                <div>
                  <p className="font-display text-[16px] font-bold leading-tight text-white">{r.rule}</p>
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-mute">from {r.trait}</p>
                </div>
              </div>
              <p className="mt-1 text-[14px] leading-snug text-text2">{r.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Today */}
      <section className="mt-16 grid gap-6 lg:grid-cols-[1.4fr_1fr]" aria-label="Today">
        <CotdCard />
        <div className="card flex flex-col justify-between gap-4 p-5">
          <div>
            <p className="eyebrow">Come back tomorrow</p>
            <h2 className="mt-2 text-[24px] font-extrabold tracking-tight text-white">Every board resets at 00:00 UTC</h2>
            <p className="mt-2 text-[14px] leading-snug text-text2">Each Chog gets a fresh board every day. Clear one each day to grow your streak, and watch the reveal wall fill up.</p>
          </div>
          <StreakChip />
          <div className="flex flex-wrap gap-2">
            <Link href="/wall" className="btn-ghost">See the reveal wall</Link>
            <Link href="/hall" className="btn-ghost">Hall of Chogs</Link>
          </div>
        </div>
      </section>

      {/* Every way in */}
      <section className="mt-16" aria-labelledby="modes-h">
        <p className="eyebrow">Ways to play</p>
        <h2 id="modes-h" className="mt-2 text-[30px] font-extrabold tracking-[-0.02em] text-white sm:text-[38px]">Pick how you want to play</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((m) => (
            <li key={m.href}>
              <Link href={m.href} className="card group flex h-full flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:border-chog">
                <div className="flex items-start justify-between gap-3">
                  <ArtStack ids={m.art} />
                  <span className="chip shrink-0">{m.tag}</span>
                </div>
                <div>
                  <p className="font-display text-[19px] font-bold text-white">{m.title} <span className="text-chog transition group-hover:ml-1">→</span></p>
                  <p className="mt-1 text-[14px] leading-snug text-text2">{m.text}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
