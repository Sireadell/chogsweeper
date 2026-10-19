import Link from "next/link";
import RevealWall from "@/components/RevealWall";

export const metadata = { title: "Reveal wall" };

export default function WallPage() {
  return (
    <main className="page">
      <header className="mb-5">
        <Link href="/" className="text-sm font-semibold text-mute hover:text-white">← Chogsweeper</Link>
      </header>
      <RevealWall />
    </main>
  );
}
