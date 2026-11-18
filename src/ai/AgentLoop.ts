import type {
  ModelBridge,
  OperationRecord,
  ScratchEntry,
  ToolCall,
  ToolContext,
  ToolDef,
} from "../types";
import { BridgeError } from "../types";
import type { AgentSettings } from "../settings/defaults";
import { parseReply } from "./ResponseParser";
import { claimsChange } from "./ClaimGuard";

/** primary = preferred model (Private Cloud by default); fallback = used when primary fails */
export type Tier = "primary" | "fallback";

export type AgentEvent =
  | { kind: "thinking"; step: number; tier: Tier }
  | { kind: "fallback"; reason: string }
  | { kind: "tool_start"; call: ToolCall }
  | { kind: "tool_end"; call: ToolCall; ok: boolean; output: string; op?: OperationRecord }
  | { kind: "tool_rejected"; call: ToolCall };

export interface AgentDeps {
  bridge: ModelBridge;
  /** used for the rest of the turn if `bridge` throws (not on user cancel) */
  fallbackBridge?: ModelBridge;
  tools: Map<string, ToolDef>;
  settings: AgentSettings;
  toolCtx: ToolContext;
  /** builds the prompt for the current scratch state */
  buildPrompt(scratch: ScratchEntry[], note: string | undefined, tier: Tier): string | Promise<string>;
  /** ask the user; resolves true to run */
  /** false = rejected; true = approved as is; { arguments } = approved with the user's changes (e.g. another folder). */
  approve(call: ToolCall, tool: ToolDef, preview: string): Promise<boolean | { arguments: Record<string, unknown> }>;
  onEvent(e: AgentEvent): void;
  /** called right before each model request so state can survive an app kill */
  persistPending?(scratch: ScratchEntry[], step: number): void | Promise<void>;
}

export interface AgentResult {
  message: string;
  steps: number;
  hitLimit: boolean;
}

export function needsApproval(tool: ToolDef, s: AgentSettings): boolean {
  switch (tool.permission) {
    case "read":
      return false;
    case "create":
      return !s.autoCreate;
    case "append":
      return !s.autoAppend;
    case "edit":
      return !s.autoEdit;
    case "rename":
      return !s.autoRename;
    default:
      return true; // delete always asks
  }
}

const MAX_CALLS_PER_STEP = 3;

export class AgentLoop {
  constructor(private deps: AgentDeps) {}

  /**
   * @param opts.injectedFirstReply when resuming after the app was killed, the
   *        model reply that arrived from the callback.
   */
  async run(
    opts: {
      signal?: AbortSignal;
      scratch?: ScratchEntry[];
      startStep?: number;
      injectedFirstReply?: string;
    } = {}
  ): Promise<AgentResult> {
    const d = this.deps;
    const scratch: ScratchEntry[] = opts.scratch ?? [];
    let injected = opts.injectedFirstReply;
    let repaired = false;
    let claimRepaired = false;
    let tier: Tier = "primary";
    let note: string | undefined;
    // 0 = no step limit (the Stop button still ends a request)
    const max = d.settings.maxSteps > 0 ? d.settings.maxSteps : Infinity;

    for (let step = opts.startStep ?? 0; step < max; step++) {
      if (opts.signal?.aborted) throw new BridgeError("cancelled", "Cancelled");
      d.onEvent({ kind: "thinking", step, tier });

      let raw: string;
      if (injected !== undefined) {
        raw = injected;
        injected = undefined;
      } else {
        const ask = async () => {
          const prompt = await d.buildPrompt(scratch, note, tier);
          await d.persistPending?.(scratch, step);
          return (tier === "primary" ? d.bridge : d.fallbackBridge!).ask(prompt, opts.signal);
        };
        try {
          raw = await ask();
        } catch (e) {
          const cancelled = e instanceof BridgeError && e.kind === "cancelled";
          if (tier !== "primary" || !d.fallbackBridge || cancelled) throw e;
          // Primary model unavailable (e.g. offline for Private Cloud): same request on the fallback model.
          tier = "fallback";
          d.onEvent({ kind: "fallback", reason: (e as Error)?.message ?? String(e) });
          d.onEvent({ kind: "thinking", step, tier });
          raw = await ask();
        }
      }
      note = undefined;

      const parsed = parseReply(raw);
      if (parsed.malformed && !repaired) {
        repaired = true;
        note =
          'Your last reply was invalid. Reply with ONE JSON object: {"type":"final","message":"<plain text answer>"} or {"type":"tool_calls","calls":[...]}. The message must be plain text, not JSON. If you need data from the vault, call a tool.';
        step--; // a repair attempt does not consume a tool step
        continue;
      }
      if (parsed.reply.type === "final") {
        const message = parsed.reply.message.trim() || "(empty response)";
        if (claimsChange(message) && !this.wroteSomething(scratch)) {
          // The model claims a change but never called a write tool: do not relay a false claim.
          if (!claimRepaired) {
            claimRepaired = true;
            const cur = d.toolCtx.currentPath() ?? "Note.md";
            note = `You said you changed something but you called NO tool, so NOTHING was changed. To change a note you must call a tool, for example: {"type":"tool_calls","calls":[{"name":"append_to_note","arguments":{"path":"${cur}","content":"text to add"}}]}. Do it now, or answer without claiming any change.`;
            step--;
            continue;
          }
          return {
            message:
              "I couldn't make that change: the model replied without actually modifying anything, so **nothing was changed**. Try again with something like: *add \"your text\" to this note*.",
            steps: step + 1,
            hitLimit: false,
          };
        }
        return { message, steps: step + 1, hitLimit: false };
      }

      for (const call of parsed.reply.calls.slice(0, MAX_CALLS_PER_STEP)) {
        const result = await this.execute(call);
        scratch.push({ call, result });
      }
    }
    const last = scratch[scratch.length - 1];
    return {
      message:
        "I reached the step limit before finishing." +
        (last ? ` Last action: ${last.call.name}.` : "") +
        " You can ask me to continue.",
      steps: max,
      hitLimit: true,
    };
  }

  /** True if a non-read tool already succeeded in this turn. */
  private wroteSomething(scratch: ScratchEntry[]): boolean {
    return scratch.some((s) => {
      const t = this.deps.tools.get(s.call.name);
      return !!t && t.permission !== "read" && !s.result.startsWith("ERROR") && !s.result.startsWith("The user REJECTED");
    });
  }

  /** Runs tool calls decided by the plugin itself (no model round trip) and reports the outcome. */
  async runDirect(calls: ToolCall[], format?: (tool: string, output: string) => string): Promise<AgentResult> {
    const lines: string[] = [];
    for (const call of calls) {
      const r = await this.execute(call);
      const isRead = this.deps.tools.get(call.name)?.permission === "read";
      if (r.startsWith("The user REJECTED")) lines.push("Cancelled. Nothing was changed.");
      else if (r.startsWith("ERROR: ")) lines.push("⚠️ " + r.slice(7));
      else if (isRead) lines.push(format ? format(call.name, r) : r);
      else lines.push("✅ " + r);
    }
    return { message: lines.join("\n"), steps: 0, hitLimit: false };
  }

  private async execute(call: ToolCall): Promise<string> {
    const d = this.deps;
    const tool = d.tools.get(call.name);
    if (!tool) {
      const msg = `Unknown tool "${call.name}". Available: ${[...d.tools.keys()].join(", ")}`;
      d.onEvent({ kind: "tool_end", call, ok: false, output: msg });
      return "ERROR: " + msg;
    }
    try {
      if (needsApproval(tool, d.settings)) {
        const preview = tool.preview
          ? await tool.preview(call.arguments, d.toolCtx)
          : JSON.stringify(call.arguments, null, 2);
        const decision = await d.approve(call, tool, preview);
        if (!decision) {
          d.onEvent({ kind: "tool_rejected", call });
          return "The user REJECTED this action. Do not retry it; tell the user it was not done.";
        }
        // The user changed something (e.g. picked another folder): run and report what they chose.
        if (typeof decision === "object") call.arguments = decision.arguments;
      }
      d.onEvent({ kind: "tool_start", call });
      const res = await tool.run(call.arguments, d.toolCtx);
      d.onEvent({ kind: "tool_end", call, ok: res.ok, output: res.output, op: res.op });
      return (res.ok ? "" : "ERROR: ") + res.output;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      d.onEvent({ kind: "tool_end", call, ok: false, output: msg });
      return "ERROR: " + msg;
    }
  }
}
