import type { ChatMessage, Conversation, OperationRecord, ScratchEntry } from "../types";
import { compressForSummary } from "../ai/PromptBuilder";

export interface PendingState {
  rid: string;
  convId: string;
  scratch: ScratchEntry[];
  step: number;
  ts: number;
}

export interface StoreData {
  v: 1;
  conversations: Conversation[];
  activeId: string | null;
  ops: OperationRecord[];
  pending: PendingState | null;
}

export interface StoreIO {
  read(): Promise<string | null>;
  write(s: string): Promise<void>;
}

const MAX_MESSAGES = 200;
const MAX_CONVERSATIONS = 40;
const MAX_OPS = 100;
const KEEP_RECENT = 12;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Persists conversations, the operation history and the in-flight request
 * (so a request survives iOS killing Obsidian while the Shortcut runs).
 */
export class ConversationStore {
  data: StoreData = { v: 1, conversations: [], activeId: null, ops: [], pending: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private io: StoreIO) {}

  async load(): Promise<void> {
    try {
      const raw = await this.io.read();
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 1) this.data = { ...this.data, ...d };
      }
    } catch (e) {
      console.error("[local-agent] could not read store, starting fresh", e);
    }
  }

  save(immediate = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (immediate) return this.flush();
    this.timer = setTimeout(() => void this.flush(), 400);
    return Promise.resolve();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const json = JSON.stringify(this.data);
    this.writing = this.writing.then(() => this.io.write(json)).catch((e) => console.error("[local-agent] save failed", e));
    return this.writing;
  }

  // ----- conversations -----

  list(): Conversation[] {
    return [...this.data.conversations].sort((a, b) => b.updated - a.updated);
  }

  get(id: string | null | undefined): Conversation | undefined {
    return this.data.conversations.find((c) => c.id === id);
  }

  active(): Conversation {
    let c = this.get(this.data.activeId);
    if (!c) c = this.create();
    return c;
  }

  create(): Conversation {
    const now = Date.now();
    const c: Conversation = { id: uid(), title: "New chat", created: now, updated: now, messages: [], summary: "" };
    this.data.conversations.push(c);
    this.data.activeId = c.id;
    if (this.data.conversations.length > MAX_CONVERSATIONS) {
      const oldest = this.list().slice(MAX_CONVERSATIONS);
      this.data.conversations = this.data.conversations.filter((x) => !oldest.includes(x));
    }
    void this.save();
    return c;
  }

  setActive(id: string): void {
    if (this.get(id)) {
      this.data.activeId = id;
      void this.save();
    }
  }

  remove(id: string): void {
    this.data.conversations = this.data.conversations.filter((c) => c.id !== id);
    if (this.data.activeId === id) this.data.activeId = null;
    void this.save();
  }

  clear(c: Conversation): void {
    c.messages = [];
    c.summary = "";
    c.title = "New chat";
    c.updated = Date.now();
    void this.save();
  }

  add(c: Conversation, m: Omit<ChatMessage, "id" | "ts"> & Partial<Pick<ChatMessage, "id" | "ts">>): ChatMessage {
    const msg: ChatMessage = { id: m.id ?? uid(), ts: m.ts ?? Date.now(), role: m.role, text: m.text, tool: m.tool };
    c.messages.push(msg);
    c.updated = msg.ts;
    if (c.title === "New chat" && msg.role === "user") c.title = msg.text.replace(/\s+/g, " ").slice(0, 40) || "New chat";
    if (c.messages.length > MAX_MESSAGES) c.messages.splice(0, c.messages.length - MAX_MESSAGES);
    void this.save();
    return msg;
  }

  /** Folds messages older than the recent window into the heuristic summary. */
  compact(c: Conversation): void {
    const done = (c as any).summarized as number | undefined;
    const start = Math.min(done ?? 0, c.messages.length);
    const end = Math.max(0, c.messages.length - KEEP_RECENT);
    if (end > start) {
      c.summary = compressForSummary(c.summary, c.messages.slice(start, end));
      (c as any).summarized = end;
      void this.save();
    }
  }

  // ----- operations -----

  addOp(op: OperationRecord): void {
    this.data.ops.push(op);
    if (this.data.ops.length > MAX_OPS) this.data.ops.splice(0, this.data.ops.length - MAX_OPS);
    void this.save();
  }

  getOp(id: string): OperationRecord | undefined {
    return this.data.ops.find((o) => o.id === id);
  }

  lastUndoable(): OperationRecord | undefined {
    for (let i = this.data.ops.length - 1; i >= 0; i--) if (!this.data.ops[i].rolledBack) return this.data.ops[i];
    return undefined;
  }

  // ----- pending -----

  setPending(p: PendingState | null): Promise<void> {
    this.data.pending = p;
    return this.save(true);
  }
}
