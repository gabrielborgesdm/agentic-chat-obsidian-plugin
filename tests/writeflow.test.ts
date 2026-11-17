import { describe, expect, it } from "vitest";
import { AgentLoop } from "../src/ai/AgentLoop";
import { claimsChange } from "../src/ai/ClaimGuard";
import { detectFastPath } from "../src/ai/FastPath";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import type { Attachment, ModelBridge, ToolDef } from "../src/types";

const img: Attachment = { path: "anexos/foto.jpg", name: "foto.jpg", kind: "image", size: 1 };

describe("claimsChange", () => {
  it("flags claims from the screenshot", () => {
    expect(claimsChange("The image was added to the current note: Untitled.md")).toBe(true);
    expect(claimsChange("Adicionei a imagem na nota.")).toBe(true);
  });
  it("ignores negations and plain answers", () => {
    expect(claimsChange("I couldn't add it")).toBe(false);
    expect(claimsChange("Não adicionei nada.")).toBe(false);
    expect(claimsChange("Here are your open tasks")).toBe(false);
  });
});

describe("detectFastPath", () => {
  it("embeds an attached image into the current note", () => {
    expect(detectFastPath("add this to the note", [img], "Untitled.md")).toEqual([
      { name: "append_to_note", arguments: { path: "Untitled.md", content: "![[anexos/foto.jpg]]" } },
    ]);
  });
  it("handles a photo sent with no text", () => {
    expect(detectFastPath("(attachment)", [img], "Untitled.md")?.[0].name).toBe("append_to_note");
  });
  it("handles the exact message from the screenshot", () => {
    const r = detectFastPath("Add hello World\nTo that note", [], "Untitled.md");
    expect(r).toEqual([{ name: "append_to_note", arguments: { path: "Untitled.md", content: "hello World" } }]);
  });
  it("handles Portuguese", () => {
    const r = detectFastPath('adiciona "comprar leite" na nota atual', [], "Casa/Lista.md");
    expect(r?.[0].arguments).toEqual({ path: "Casa/Lista.md", content: "comprar leite" });
  });
  it("falls back to the daily note when no note is open, and ignores questions", () => {
    expect(detectFastPath("add hello to that note", [], null)).toEqual([{ name: "append_to_daily_note", arguments: { content: "hello" } }]);
    expect(detectFastPath("what did I write about travel?", [], "a.md")).toBeNull();
  });

  // Exact messages from the 02:25 screenshot
  it("'Adiciona hello world nas notas' acts instead of asking for a path", () => {
    expect(detectFastPath("Adiciona hello world nas notas", [], "A.md")).toEqual([
      { name: "append_to_note", arguments: { path: "A.md", content: "hello world" } },
    ]);
    expect(detectFastPath("Adiciona hello world nas notas", [], null)?.[0].name).toBe("append_to_daily_note");
  });
  it("'Create a hello world at the root' creates the note", () => {
    expect(detectFastPath("Create a hello world at the root", [], null)).toEqual([
      { name: "create_note", arguments: { path: "hello world", content: "" } },
    ]);
  });
  it("create with folder and content (Portuguese)", () => {
    expect(detectFastPath("cria uma nota chamada Ideias na pasta Quick Notes com o texto comprar café", [], null)).toEqual([
      { name: "create_note", arguments: { path: "Quick Notes/Ideias", content: "comprar café" } },
    ]);
  });
  it("leaves content-generation requests to the model", () => {
    expect(detectFastPath("create a summary of my trip", [], "a.md")).toBeNull();
    expect(detectFastPath("create a note summarizing my trip", [], "a.md")).toBeNull();
  });
});

function loop(replies: string[], log: string[]) {
  let i = 0;
  const bridge: ModelBridge = { ask: async () => replies[i++] };
  const append: ToolDef = {
    name: "append_to_note",
    signature: "append_to_note(path, content)",
    permission: "append",
    run: async (a) => {
      log.push(JSON.stringify(a));
      return { ok: true, output: "Appended to " + a.path };
    },
  };
  return new AgentLoop({
    bridge,
    tools: new Map([[append.name, append]]),
    settings: DEFAULT_SETTINGS,
    toolCtx: { currentPath: () => "Untitled.md" },
    buildPrompt: (_s, note) => note ?? "",
    approve: async () => true,
    onEvent: () => {},
  });
}

const final = (m: string) => JSON.stringify({ type: "final", message: m });

describe("claim guard in the loop", () => {
  it("never relays a false 'added' claim; says nothing changed", async () => {
    const log: string[] = [];
    const r = await loop([final("I added it to Untitled.md"), final("Done, I added it.")], log).run();
    expect(log).toEqual([]);
    expect(r.message).toContain("nothing was changed");
  });
  it("recovers when the model calls the tool after the nudge", async () => {
    const log: string[] = [];
    const call = JSON.stringify({ type: "tool_calls", calls: [{ name: "append_to_note", arguments: { path: "Untitled.md", content: "hi" } }] });
    const r = await loop([final("I added it"), call, final("Added hi to Untitled.md")], log).run();
    expect(log).toHaveLength(1);
    expect(r.message).toContain("Added hi");
  });
  it("allows a truthful claim after a real tool call", async () => {
    const log: string[] = [];
    const call = JSON.stringify({ type: "tool_calls", calls: [{ name: "append_to_note", arguments: { path: "a.md", content: "x" } }] });
    const r = await loop([call, final("I added it to a.md")], log).run();
    expect(r.message).toBe("I added it to a.md");
  });
});

describe("runDirect", () => {
  it("runs calls without asking the model and reports success", async () => {
    const log: string[] = [];
    const r = await loop([], log).runDirect([{ name: "append_to_note", arguments: { path: "Untitled.md", content: "hello" } }]);
    expect(log).toHaveLength(1);
    expect(r.message).toContain("✅");
  });
});
