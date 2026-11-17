export type Permission = "read" | "create" | "append" | "edit" | "rename" | "delete";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ModelReply =
  | { type: "final"; message: string }
  | { type: "tool_calls"; calls: ToolCall[] };

export interface ParsedReply {
  reply: ModelReply;
  /** true when the text looked like an attempted JSON reply but could not be parsed */
  malformed: boolean;
}

export type OpKind = "create" | "update" | "append" | "rename" | "delete";

export interface OperationRecord {
  id: string;
  ts: number;
  kind: OpKind;
  path: string;
  /** previous path for renames/moves */
  oldPath?: string;
  before?: string;
  after?: string;
  rolledBack?: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  op?: OperationRecord;
}

export interface ToolContext {
  /** the note the user was last looking at */
  currentPath: () => string | null;
}

export interface ToolDef {
  name: string;
  /** one-line signature + description shown to the model */
  signature: string;
  permission: Permission;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  /** human-readable preview shown in the approval dialog */
  preview?(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  ts: number;
  /** for role=tool */
  tool?: { name: string; args: Record<string, unknown>; ok: boolean; opId?: string };
  /** files the user attached (already saved inside the vault) */
  attachments?: Attachment[];
  /** for role=error: the provider whose Shortcut setup help the error should offer */
  setupProvider?: "apple" | "chatgpt";
}

export interface Attachment {
  /** vault path of the saved file */
  path: string;
  name: string;
  kind: "image" | "text" | "other";
  size: number;
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
  /** compressed text of older messages that no longer fit in the prompt */
  summary: string;
}

export interface ScratchEntry {
  call: ToolCall;
  result: string;
}

export interface ModelBridge {
  ask(prompt: string, signal?: AbortSignal): Promise<string>;
}

export class BridgeError extends Error {
  constructor(public kind: "cancelled" | "timeout" | "error" | "no-response", message: string) {
    super(message);
  }
}
