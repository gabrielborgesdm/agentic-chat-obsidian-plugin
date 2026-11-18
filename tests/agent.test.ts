import { describe, expect, it } from "vitest";
import { AgentLoop, needsApproval, type AgentEvent } from "../src/ai/AgentLoop";
import { buildPrompt } from "../src/ai/PromptBuilder";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import { BridgeError, type ModelBridge, type Permission, type ToolDef } from "../src/types";
import { lineDiff } from "../src/vault/diff";

const tool = (name: string, permission: Permission, log: string[]): ToolDef => ({
  name,
  signature: `${name}()`,
  permission,
  async run(args) {
    log.push(name + ":" + JSON.stringify(args));
    return { ok: true, output: `ran ${name}` };
  },
});

function scripted(replies: (string | Error)[], prompts: string[] = []): ModelBridge {
  let i = 0;
  return {
    async ask(p, signal) {
      prompts.push(p);
      if (signal?.aborted) throw new BridgeError("cancelled", "Cancelled");
      const r = replies[i++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

function make(
  bridge: ModelBridge,
  tools: ToolDef[],
  opts: { approve?: boolean | { arguments: Record<string, unknown> }; settings?: Partial<typeof DEFAULT_SETTINGS>; events?: AgentEvent[] } = {}
) {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const approvals: string[] = [];
  const agent = new AgentLoop({
    bridge,
    tools: new Map(tools.map((t) => [t.name, t])),
    settings,
    toolCtx: { currentPath: () => null },
    buildPrompt: (scratch, note) => `PROMPT scratch=${scratch.length} note=${note ?? ""}`,
    approve: async (call) => {
      approvals.push(call.name);
      return opts.approve ?? true;
    },
    onEvent: (e) => opts.events?.push(e),
  });
  return { agent, approvals };
}

const final = (m: string) => JSON.stringify({ type: "final", message: m });
const call = (name: string, args: object = {}) => JSON.stringify({ type: "tool_calls", calls: [{ name, arguments: args }] });

describe("AgentLoop", () => {
  it("returns a direct final answer in one step", async () => {
    const { agent } = make(scripted([final("hi")]), []);
    const r = await agent.run();
    expect(r).toMatchObject({ message: "hi", steps: 1, hitLimit: false });
  });

  it("runs a tool then answers, feeding results back", async () => {
    const log: string[] = [];
    const prompts: string[] = [];
    const { agent } = make(scripted([call("search_notes", { query: "x" }), final("done")], prompts), [tool("search_notes", "read", log)]);
    const r = await agent.run();
    expect(log).toEqual(['search_notes:{"query":"x"}']);
    expect(r.message).toBe("done");
    expect(prompts[1]).toContain("scratch=1");
  });

  it("stops at maxSteps", async () => {
    const log: string[] = [];
    const { agent } = make(scripted(Array(10).fill(call("search_notes"))), [tool("search_notes", "read", log)], { settings: { maxSteps: 3 } });
    const r = await agent.run();
    expect(r.hitLimit).toBe(true);
    expect(log).toHaveLength(3);
  });

  it("repairs malformed JSON once without consuming a step", async () => {
    const prompts: string[] = [];
    const { agent } = make(scripted(['{"type":"final","message":"oops', final("fixed")], prompts), [], { settings: { maxSteps: 1 } });
    const r = await agent.run();
    expect(r.message).toBe("fixed");
    expect(prompts[1]).toContain("reply was invalid");
  });

  it("gives up gracefully on repeated malformed JSON (shows raw text, runs nothing)", async () => {
    const log: string[] = [];
    const bad = '{"type":"tool_calls","calls":[{"name":"delete_note"';
    const { agent } = make(scripted([bad, bad]), [tool("delete_note", "delete", log)]);
    const r = await agent.run();
    expect(log).toEqual([]);
    expect(r.message).toContain("delete_note");
  });

  it("reports unknown tools to the model instead of crashing", async () => {
    const prompts: string[] = [];
    const { agent } = make(scripted([call("hack"), final("ok")], prompts), []);
    await agent.run();
    expect(prompts[1]).toContain("scratch=1");
  });

  it("asks for approval on edit/rename/delete and honours rejection", async () => {
    const log: string[] = [];
    const { agent, approvals } = make(scripted([call("update_note"), final("ok")]), [tool("update_note", "edit", log)], { approve: false });
    await agent.run();
    expect(approvals).toEqual(["update_note"]);
    expect(log).toEqual([]);
  });

  it("creates the note where the user moved it in the approval dialog", async () => {
    const log: string[] = [];
    const { agent } = make(
      scripted([call("create_note", { path: "Malas.md", content: "x" }), final("ok")]),
      [tool("create_note", "create", log)],
      { approve: { arguments: { path: "Viagens/Malas.md", content: "x" } } }
    );
    await agent.run();
    expect(log).toEqual(['create_note:{"path":"Viagens/Malas.md","content":"x"}']);
  });

  it("runs approved edits", async () => {
    const log: string[] = [];
    const { agent } = make(scripted([call("update_note"), final("ok")]), [tool("update_note", "edit", log)], { approve: true });
    await agent.run();
    expect(log).toHaveLength(1);
  });

  it("asks where to create by default, not for read/append, and follows the settings", async () => {
    const t = (p: Permission) => tool("t", p, []);
    expect(needsApproval(t("read"), DEFAULT_SETTINGS)).toBe(false);
    expect(needsApproval(t("create"), DEFAULT_SETTINGS)).toBe(true);
    expect(needsApproval(t("append"), DEFAULT_SETTINGS)).toBe(false);
    expect(needsApproval(t("create"), { ...DEFAULT_SETTINGS, autoCreate: true })).toBe(false);
    expect(needsApproval(t("append"), { ...DEFAULT_SETTINGS, autoAppend: false })).toBe(true);
    expect(needsApproval(t("delete"), DEFAULT_SETTINGS)).toBe(true);
    expect(needsApproval(t("rename"), DEFAULT_SETTINGS)).toBe(true);
  });

  it("propagates bridge cancellation and timeout", async () => {
    const { agent } = make(scripted([new BridgeError("timeout", "slow")]), []);
    await expect(agent.run()).rejects.toMatchObject({ kind: "timeout" });
    const ac = new AbortController();
    ac.abort();
    const { agent: a2 } = make(scripted([final("x")]), []);
    await expect(a2.run({ signal: ac.signal })).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("resumes from an injected reply without calling the bridge", async () => {
    const prompts: string[] = [];
    const { agent } = make(scripted([], prompts), []);
    const r = await agent.run({ injectedFirstReply: final("resumed"), startStep: 1 });
    expect(r.message).toBe("resumed");
    expect(prompts).toHaveLength(0);
  });

  it("turns a throwing tool into an ERROR result", async () => {
    const bad: ToolDef = { ...tool("boom", "read", []), run: async () => { throw new Error("nope"); } };
    const prompts: string[] = [];
    const events: AgentEvent[] = [];
    const { agent } = make(scripted([call("boom"), final("ok")], prompts), [bad], { events });
    await agent.run();
    expect(events.some((e) => e.kind === "tool_end" && !e.ok)).toBe(true);
  });
});

describe("buildPrompt", () => {
  const base = {
    settings: DEFAULT_SETTINGS,
    tools: [tool("search_notes", "read", [])],
    summary: "",
    context: "",
    scratch: [],
    today: "2026-01-01",
  };
  it("stays within the budget even with huge context/history", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      id: String(i), ts: i, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "x".repeat(900),
    }));
    history.push({ id: "last", ts: 99, role: "user", text: "latest question" });
    const p = buildPrompt({ ...base, history, context: "c".repeat(20000), summary: "s".repeat(5000) });
    expect(p.length).toBeLessThanOrEqual(DEFAULT_SETTINGS.promptCharBudget + 400);
    expect(p).toContain("latest question");
    expect(p).toContain("search_notes()");
  });
  it("keeps tool results from this turn", () => {
    const p = buildPrompt({
      ...base,
      history: [{ id: "1", ts: 1, role: "user", text: "q" }],
      scratch: [{ call: { name: "read_note", arguments: { path: "a.md" } }, result: "CONTENT-XYZ" }],
    });
    expect(p).toContain("CONTENT-XYZ");
  });
  const longNote = "# Viagem/checklist.md\n" + "a".repeat(10000) + "ROUPAS-AT-THE-END";
  const readScratch = [{ call: { name: "read_note", arguments: { path: "Viagem/checklist.md" } }, result: longNote }];
  it("sends a whole long note when the budget is 0 (no limit)", () => {
    const p = buildPrompt({
      ...base,
      settings: { ...DEFAULT_SETTINGS, promptCharBudget: 0 },
      history: [{ id: "1", ts: 1, role: "user", text: "q" }],
      scratch: readScratch,
    });
    expect(p).toContain("ROUPAS-AT-THE-END");
  });
  it("tells the model where to continue when a note is cut to fit a budget", () => {
    const p = buildPrompt({
      ...base,
      settings: { ...DEFAULT_SETTINGS, promptCharBudget: 7000 },
      history: [{ id: "1", ts: 1, role: "user", text: "q" }],
      scratch: readScratch,
    });
    expect(p).not.toContain("ROUPAS-AT-THE-END");
    const m = p.match(/Call read_note with offset=(\d+)/);
    expect(m).not.toBeNull();
    const shownAs = p.slice(p.indexOf("# Viagem/checklist.md\n") + "# Viagem/checklist.md\n".length).match(/^a+/)![0].length;
    expect(Number(m![1])).toBe(shownAs);
  });
});

describe("lineDiff", () => {
  it("shows added and removed lines", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc");
    expect(d).toContain("- b");
    expect(d).toContain("+ B");
  });
});

describe("edit/rename permission toggles and attachments in prompt", () => {
  const t = (p: Permission) => tool("t", p, []);
  it("autoEdit / autoRename skip confirmation, delete never does", () => {
    const s = { ...DEFAULT_SETTINGS, autoEdit: true, autoRename: true };
    expect(needsApproval(t("edit"), s)).toBe(false);
    expect(needsApproval(t("rename"), s)).toBe(false);
    expect(needsApproval(t("delete"), s)).toBe(true);
  });
  it("lists attachments for the model", () => {
    const p = buildPrompt({
      settings: DEFAULT_SETTINGS,
      tools: [],
      summary: "",
      context: "",
      scratch: [],
      today: "2026-01-01",
      history: [
        { id: "1", ts: 1, role: "user", text: "save this", attachments: [{ path: "anexos/foto.jpg", name: "foto.jpg", kind: "image", size: 10 }] },
      ],
    });
    expect(p).toContain("anexos/foto.jpg");
    expect(p).toContain("image");
  });
});
