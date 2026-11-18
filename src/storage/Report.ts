import type { AgentSettings } from "../settings/defaults";
import type { Conversation } from "../types";
import type { TraceEntry } from "./Trace";

export interface ReportInput {
  version: string;
  platform: string;
  settings: AgentSettings;
  /** e.g. "Cloud Agent (budget none) → fallback Local Agent (budget 7000)" */
  route: string;
  conv: Conversation;
  trace: TraceEntry[];
  now: Date;
}

const time = (ts: number) => new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");

/** Wraps text in a code fence longer than any backtick run inside it. */
function fenced(text: string, lang = "text"): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

const json = (v: unknown) => JSON.stringify(v);

/** Markdown report of one chat: settings, messages, and every model call with its raw prompt and reply. */
export function buildReport(r: ReportInput): string {
  const { conv, settings } = r;
  const out: string[] = [];
  out.push(`# Local Agent chat report`);
  out.push(
    [
      `- Created: ${time(r.now.getTime())}`,
      `- Plugin: v${r.version} · ${r.platform}`,
      `- Provider: ${settings.provider} · route: ${r.route}`,
      `- Chat: "${conv.title}" (${conv.id}) · ${conv.messages.length} messages · started ${time(conv.created)}`,
    ].join("\n")
  );

  out.push(`## Settings\n${fenced(JSON.stringify(settings, null, 2), "json")}`);

  const msgs = conv.messages.map((m) => {
    const head = `[${time(m.ts)}] ${m.role}`;
    if (m.role === "tool" && m.tool) return `${head} ${m.tool.ok ? "OK" : "FAILED"} ${m.tool.name} ${json(m.tool.args)}${m.tool.ok ? "" : ` · ${m.text}`}`;
    const atts = m.attachments?.length ? `\n  attachments: ${m.attachments.map((a) => `${a.path} (${a.kind}, ${a.size} B)`).join(", ")}` : "";
    return `${head}: ${m.text}${atts}`;
  });
  out.push(`## Messages\n${fenced(msgs.join("\n\n") || "(none)")}`);
  if (conv.summary.trim()) out.push(`## Summary of older messages\n${fenced(conv.summary)}`);

  const lines: string[] = [];
  let n = 0;
  for (const e of r.trace) {
    if (e.kind === "model") {
      n++;
      const status = e.error
        ? `ERROR ${e.error}`
        : e.reply === undefined
          ? "no reply recorded (app restarted or still waiting)"
          : `${e.ms !== undefined ? (e.ms / 1000).toFixed(1) + "s" : ""}${e.resumed ? " · resumed after app restart" : ""}`;
      lines.push(`### Model call ${n} · step ${e.step + 1} · ${e.tier} · "${e.shortcut}" · ${time(e.ts)} · ${status}`);
      lines.push(`Prompt (${e.prompt.length} chars):\n${fenced(e.prompt)}`);
      if (e.reply !== undefined) lines.push(`Raw reply (${e.reply.length} chars):\n${fenced(e.reply)}`);
    } else if (e.kind === "tool") {
      lines.push(`### Tool ${e.ok ? "OK" : "FAILED"}: ${e.tool} · ${time(e.ts)}\nArguments: \`${json(e.args)}\`\n\nResult (${e.output.length} chars):\n${fenced(e.output)}`);
    } else {
      lines.push(`### Event · ${time(e.ts)}\n${e.text}`);
    }
  }
  out.push(
    `## Model calls and tool results\n` +
      (lines.length ? lines.join("\n\n") : "(none recorded: the trace starts with v0.3.3, older requests are not included)")
  );
  return out.join("\n\n") + "\n";
}
