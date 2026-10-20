import { describe, expect, it } from "vitest";
import { notesFor, play, readMuted, totalDuration, unlockAudio, writeMuted } from "./sound";

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("sound notes", () => {
  it("win is short and rises", () => {
    const n = notesFor("win");
    expect(totalDuration(n)).toBeLessThan(1.2);
    const lead = n.filter((x) => x.type === "triangle").map((x) => x.freq);
    expect(lead).toEqual([...lead].sort((a, b) => a - b));
  });
  it("loss is softer and shorter than the win", () => {
    const win = notesFor("win"), lose = notesFor("lose");
    expect(Math.max(...lose.map((x) => x.gain))).toBeLessThan(Math.max(...win.map((x) => x.gain)));
    expect(totalDuration(lose)).toBeLessThan(totalDuration(win));
    const f = lose.map((x) => x.freq);
    expect(f).toEqual([...f].sort((a, b) => b - a));
  });
});

describe("mute memory", () => {
  it("defaults to sound on and round-trips", () => {
    const s = fakeStore();
    expect(readMuted(s)).toBe(false);
    writeMuted(true, s);
    expect(readMuted(s)).toBe(true);
    writeMuted(false, s);
    expect(readMuted(s)).toBe(false);
  });
  it("survives blocked storage", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readMuted(bad)).toBe(false);
    expect(() => writeMuted(true, bad)).not.toThrow();
    expect(readMuted(null)).toBe(false);
  });
});

describe("autoplay rule", () => {
  it("stays silent and does not throw before any tap", () => {
    expect(() => play("win", false)).not.toThrow();
    expect(() => unlockAudio()).not.toThrow();
  });
});
