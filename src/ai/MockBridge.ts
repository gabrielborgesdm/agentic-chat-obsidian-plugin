import type { ModelBridge } from "../types";

/**
 * Desktop-only stand-in for Apple Intelligence so the UI, tools and approval
 * flow can be exercised on Windows. Understands a few commands:
 *   search <text>    create <path> :: <content>    append <path> :: <content>
 *   read <path>      delete <path>                 anything else -> echo
 */
export class MockBridge implements ModelBridge {
  async ask(prompt: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 400));
    const userMatch = [...prompt.matchAll(/^User: (.*)$/gm)].pop();
    const user = userMatch ? userMatch[1].trim() : "";
    const scratchIdx = prompt.indexOf("This turn so far:");
    if (scratchIdx >= 0) {
      const results = prompt.slice(scratchIdx).split("\n").filter((l) => l.startsWith("Result:"));
      return JSON.stringify({ type: "final", message: "[mock] Done. " + results.join(" ").slice(0, 400) });
    }
    const call = (name: string, args: object) => JSON.stringify({ type: "tool_calls", calls: [{ name, arguments: args }] });
    let m: RegExpMatchArray | null;
    if ((m = user.match(/^search (.+)/i))) return call("search_notes", { query: m[1] });
    if ((m = user.match(/^read (.+)/i))) return call("read_note", { path: m[1] });
    if ((m = user.match(/^delete (.+)/i))) return call("delete_note", { path: m[1] });
    if ((m = user.match(/^create (.+?) :: (.*)$/i))) return call("create_note", { path: m[1], content: m[2] });
    if ((m = user.match(/^append (.+?) :: (.*)$/i))) return call("append_to_note", { path: m[1], content: m[2] });
    if ((m = user.match(/^update (.+?) :: (.*)$/i))) return call("update_note", { path: m[1], content: m[2] });
    return JSON.stringify({ type: "final", message: `[mock] You said: ${user}` });
  }
}
