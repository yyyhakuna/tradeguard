import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { Finding, TraceEntry, Verdict } from "./types.ts";

/**
 * Append-only, hash-chained trace store.
 *
 * Each entry's `hash = sha256(prevHash + canonical(entry-without-hash))`, so any
 * after-the-fact edit to an earlier entry breaks every hash downstream. This is
 * what stops the audited agent (or anyone) from forging a clean history — the
 * same "scorer must not be gameable" principle, enforced by the data structure.
 */
export class TraceStore {
  private seq = 0;
  private lastHash = "GENESIS";
  private readonly sink?: string;
  private readonly entries: TraceEntry[] = [];

  /** @param sink optional JSONL file path to persist entries. */
  constructor(sink?: string) {
    this.sink = sink;
  }

  /** All entries appended so far (in order). */
  all(): TraceEntry[] {
    return this.entries;
  }

  append(input: {
    phase: "pre" | "post";
    toolCallId: string;
    toolName: string;
    reasoningExcerpt: string;
    args: unknown;
    findings: Finding[];
    verdict: Verdict;
  }): TraceEntry {
    const base = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      prevHash: this.lastHash,
      ...input,
    };
    const hash = this.digest(base);
    const entry: TraceEntry = { ...base, hash };
    this.lastHash = hash;
    this.entries.push(entry);
    if (this.sink) appendFileSync(this.sink, JSON.stringify(entry) + "\n");
    return entry;
  }

  /** Recompute the chain and report the first tampered entry, if any. */
  verify(entries: TraceEntry[]): { ok: boolean; brokenAtSeq?: number } {
    let prev = "GENESIS";
    for (const e of entries) {
      const { hash, ...rest } = e;
      if (rest.prevHash !== prev || this.digest(rest) !== hash) {
        return { ok: false, brokenAtSeq: e.seq };
      }
      prev = hash;
    }
    return { ok: true };
  }

  private digest(entryWithoutHash: Omit<TraceEntry, "hash">): string {
    return createHash("sha256").update(canonical(entryWithoutHash)).digest("hex");
  }
}

/** Stable stringify (sorted keys) so the hash is deterministic. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
