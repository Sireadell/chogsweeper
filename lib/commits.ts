import { readFile } from "node:fs/promises";
import path from "node:path";

export type CommitPost = { date: string; commit: string; txHash: string | null };

const FILE = () => path.join(process.cwd(), "data", "commits.json");

export async function readCommits(): Promise<CommitPost[]> {
  try {
    const raw = JSON.parse(await readFile(FILE(), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function findCommit(date: string): Promise<CommitPost | undefined> {
  return (await readCommits()).find((c) => c.date === date);
}
