/**
 * Debug trace: what was actually sent to the model and what came back, plus tool results.
 * Saved to its own file (not store.json) so it survives iOS killing Obsidian mid-request.
 * Only used to build the "Copy chat report" text.
 */
export type TraceEntry =
  | {
      kind: "model";
      convId: string;
      ts: number;
      step: number;
      tier: "primary" | "fallback";
      shortcut: string;
      prompt: string;
      /** undefined while waiting (or if the app was killed before the reply arrived) */
      reply?: string;
      error?: string;
      ms?: number;
      /** the reply arrived after the app restarted */
      resumed?: boolean;
    }
  | { kind: "tool"; convId: string; ts: number; tool: string; args: Record<string, unknown>; ok: boolean; output: string }
  | { kind: "event"; convId: string; ts: number; text: string };

export type ModelTrace = Extract<TraceEntry, { kind: "model" }>;

const MAX_ENTRIES = 40;
/** kept small: the file lives in the iCloud vault and is rewritten after every message */
const MAX_CHARS = 250_000;

export class Trace {
  entries: TraceEntry[] = [];
  private timer: number | null = null;

  constructor(private io: { read: () => Promise<string | null>; write: (s: string) => Promise<void> }) {}

  async load(): Promise<void> {
    try {
      const s = await this.io.read();
      if (s) this.entries = JSON.parse(s);
    } catch {
      this.entries = [];
    }
  }

  add<T extends TraceEntry>(e: T): T {
    this.entries.push(e);
    this.trim();
    this.changed();
    return e;
  }

  /** Call after mutating an entry returned by add(). */
  changed(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 500);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await this.io.write(JSON.stringify(this.entries));
    } catch {
      /* debugging aid only: never break a request over it */
    }
  }

  /** Entries of one conversation since `since` (so a cleared chat doesn't show old calls). */
  forConversation(convId: string, since: number): TraceEntry[] {
    return this.entries.filter((e) => e.convId === convId && e.ts >= since);
  }

  /** Last model call of a conversation still waiting for its reply. */
  pendingModel(convId: string): ModelTrace | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.convId === convId && e.kind === "model") return e.reply === undefined && !e.error ? e : undefined;
    }
    return undefined;
  }

  private trim(): void {
    while (this.entries.length > MAX_ENTRIES) this.entries.shift();
    let size = this.entries.reduce((n, e) => n + JSON.stringify(e).length, 0);
    while (size > MAX_CHARS && this.entries.length > 1) size -= JSON.stringify(this.entries.shift()).length;
  }
}
