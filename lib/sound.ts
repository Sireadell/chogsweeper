// Tiny sound effects made with the Web Audio API, so there are no audio files to load.
// Browsers keep sound off until the person has tapped something, so the audio context is
// only created and resumed from a tap (see unlockAudio). Mute is remembered in localStorage.

export type Note = { freq: number; start: number; dur: number; gain: number; type: OscillatorType };
export type SoundKind = "win" | "lose" | "tap" | "open" | "flag" | "unflag" | "shield";

const MUTE_KEY = "chogsweeper:muted";

// Win: a quick rising major arpeggio ending on a held top note. Lose: two soft falling notes.
const WIN_FREQS = [523.25, 659.25, 783.99, 1046.5];

export function notesFor(kind: SoundKind): Note[] {
  if (kind === "win") {
    return [
      ...WIN_FREQS.map((freq, i): Note => ({ freq, start: i * 0.11, dur: i === 3 ? 0.7 : 0.2, gain: 0.18, type: "triangle" })),
      { freq: 1568, start: 0.33, dur: 0.6, gain: 0.06, type: "sine" },
    ];
  }
  if (kind === "tap") {
    // One short, soft click for a single square opening.
    return [{ freq: 660, start: 0, dur: 0.06, gain: 0.07, type: "triangle" }];
  }
  if (kind === "open") {
    // A quick rising run for a patch of squares opening at once.
    return [
      { freq: 440, start: 0, dur: 0.07, gain: 0.07, type: "triangle" },
      { freq: 587.33, start: 0.05, dur: 0.07, gain: 0.07, type: "triangle" },
      { freq: 783.99, start: 0.1, dur: 0.12, gain: 0.07, type: "triangle" },
    ];
  }
  if (kind === "flag") {
    return [
      { freq: 392, start: 0, dur: 0.05, gain: 0.07, type: "square" },
      { freq: 523.25, start: 0.05, dur: 0.07, gain: 0.07, type: "square" },
    ];
  }
  if (kind === "unflag") {
    return [{ freq: 330, start: 0, dur: 0.07, gain: 0.06, type: "square" }];
  }
  if (kind === "shield") {
    // A bright ping, then a low note: the hit was absorbed.
    return [
      { freq: 880, start: 0, dur: 0.12, gain: 0.1, type: "sine" },
      { freq: 196, start: 0.05, dur: 0.3, gain: 0.1, type: "sine" },
    ];
  }
  return [
    { freq: 293.66, start: 0, dur: 0.22, gain: 0.12, type: "sine" },
    { freq: 220, start: 0.18, dur: 0.4, gain: 0.12, type: "sine" },
    { freq: 110, start: 0, dur: 0.35, gain: 0.12, type: "triangle" },
  ];
}

export type MoveSummary = { revealed: number; flagged: number; shielded: number; over: boolean };

// Which small sound a move earns, from the counts before and after it. Wins and losses have
// their own sounds, so a move that ends the game stays quiet here. A drop in revealed squares
// means the board was reset, which also stays quiet.
export function soundForMove(prev: MoveSummary, next: MoveSummary): SoundKind | null {
  if (next.over || prev.over) return null;
  if (next.revealed < prev.revealed) return null;
  if (next.shielded > prev.shielded) return "shield";
  const opened = next.revealed - prev.revealed;
  if (opened >= 4) return "open";
  if (opened >= 1) return "tap";
  if (next.flagged > prev.flagged) return "flag";
  if (next.flagged < prev.flagged) return "unflag";
  return null;
}

export function totalDuration(notes: Note[]): number {
  return notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function store(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readMuted(s: StorageLike | null = store()): boolean {
  try {
    return s?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean, s: StorageLike | null = store()): void {
  try {
    s?.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch { /* storage blocked, the choice just lasts for this visit */ }
}

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

// Call from a tap or key press. Until this has run once, play() stays silent.
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === "suspended") void c.resume().catch(() => {});
}

export function play(kind: SoundKind, muted: boolean): void {
  if (muted || !unlocked || !ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    for (const n of notesFor(kind)) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type;
      osc.frequency.value = n.freq;
      g.gain.setValueAtTime(0.0001, t0 + n.start);
      g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + n.start);
      osc.stop(t0 + n.start + n.dur + 0.05);
    }
  } catch { /* sound is a bonus, never break the game */ }
}
