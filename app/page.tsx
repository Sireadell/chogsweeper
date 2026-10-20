import Link from "next/link";
import CotdCard from "@/components/CotdCard";
import StreakChip from "@/components/StreakChip";

// A decorative mini board: purple tiles with a few "cleared" windows showing a glow of art.
const SHAPE = "1111111/1100011/1000001/1001101/1000001/1100011/1111111";

export default function Home() {
  const rows = SHAPE.split("/");
  return (
    <main className="page flex min-h-[100svh] flex-col justify-center">
      <section aria-label="Try it in one minute" className="mb-8 rounded-2xl border border-chog/60 bg-panel p-5 sm:p-6">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-mint">Try it in one minute, no wallet</h2>
        <ol className="mt-3 grid gap-2 text-[15px] leading-snug text-[#cfc9ea] sm:grid-cols-3 sm:gap-4">
          <li><b className="text-white">1.</b> Type any Chog number from 1 to 1969 (try 7).</li>
          <li><b className="text-white">2.</b> Read the rule cards, then play.</li>
          <li><b className="text-white">3.</b> Clear the board and the Chog's art appears.</li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/judge?id=7" className="btn-main !w-full !py-4 text-center text-lg sm:!w-auto sm:!px-8">Try Chog 7</Link>
          <Link href="/practice" className="text-[14px] text-chog underline-offset-2 hover:underline">Play unlimited, no wallet</Link>
        </div>
      </section>

      <div className="grid items-center gap-8 md:grid-cols-[1.1fr_0.9fr]">
        <section>
          <p className="text-[12px] font-bold uppercase tracking-[0.25em] text-mint">Chogsweeper · a daily puzzle</p>
          <h1 className="mt-3 text-[40px] font-black leading-[1.02] tracking-tight text-white sm:text-6xl">
            Your Chog is<br />the board.
          </h1>
          <p className="mt-4 max-w-[34ch] text-[17px] leading-relaxed text-[#cfc9ea]">
            Every Chog gets its own minesweeper board, new every day. Its traits change the rules. Clear the board and your Chog's artwork appears.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/play" className="btn-main !px-8 !py-4 text-lg">Play</Link>
            <Link href="/practice" className="btn-ghost !px-5 !text-[15px]">Play unlimited, no wallet</Link>
            <Link href="/judge" className="btn-ghost !px-5 !text-[15px]">Judge mode</Link>
          </div>
          <p className="mt-4 text-[13px] text-mute">
            Judge mode: type any Chog from 1 to 1969 and play a practice board. <Link href="/verify" className="text-chog underline-offset-2 hover:underline">Check a board was fair</Link>
          </p>
        </section>

        <section aria-hidden className="mx-auto w-full max-w-[360px]">
          <div className="relative aspect-square overflow-hidden rounded-[22px] border border-edge shadow-[0_30px_80px_-30px_rgba(131,110,249,0.8)]"
            style={{ background: "radial-gradient(circle at 40% 35%, #c4b5fd, #7c3aed 40%, #8bf5c0 120%)" }}>
            <div className="absolute inset-0 grid grid-cols-7 grid-rows-7">
              {rows.flatMap((row, y) =>
                row.split("").map((c, x) => (
                  <div key={`${x}-${y}`}
                    className={c === "1" ? "tile" : "tile tile-open"}
                    style={{ ["--d" as string]: "0s", animation: c === "1" ? `pulse 3s ${(x + y) * 0.12}s ease-in-out infinite` : undefined }} />
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <StreakChip />
        <Link href="/wall" className="btn-ghost">Reveal wall</Link>
      </div>

      <div className="mt-6"><CotdCard /></div>

      <ol className="mt-12 grid gap-3 text-[14px] text-[#cfc9ea] sm:grid-cols-3">
        <li className="rounded-xl border border-edge bg-panel p-4"><b className="text-white">1. Dig.</b> Tap a tile. Numbers tell you how many mines touch it.</li>
        <li className="rounded-xl border border-edge bg-panel p-4"><b className="text-white">2. Use your traits.</b> Eyes, accessory and head each bend a rule, and the screen tells you when one fires.</li>
        <li className="rounded-xl border border-edge bg-panel p-4"><b className="text-white">3. Reveal.</b> Every cleared tile opens a window onto your Chog.</li>
      </ol>
    </main>
  );
}
