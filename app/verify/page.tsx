import ProofSteps from "@/components/ProofSteps";

export const metadata = { title: "Check a board | Chogsweeper" };

export default function VerifyPage() {
  return (
    <main className="page">
      <h1 className="text-[28px] font-bold text-white">Check the board in 60 seconds</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-[#cfc9ea]">
        Three steps, no wallet needed. Every morning we post a fingerprint of that day's secret on Monad. After the day ends the secret is shown, and your browser rebuilds the board to see if it matches.
      </p>
      <ProofSteps />
    </main>
  );
}
