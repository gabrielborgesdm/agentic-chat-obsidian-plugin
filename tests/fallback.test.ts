import { describe, expect, it } from "vitest";
import { AgentLoop, type AgentEvent, type Tier } from "../src/ai/AgentLoop";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import { BridgeError, type ModelBridge } from "../src/types";

const final = (m: string) => JSON.stringify({ type: "final", message: m });

function make(primary: ModelBridge, fallback: ModelBridge | undefined, events: AgentEvent[], tiers: Tier[]) {
  return new AgentLoop({
    bridge: primary,
    fallbackBridge: fallback,
    tools: new Map(),
    settings: DEFAULT_SETTINGS,
    toolCtx: { currentPath: () => null },
    buildPrompt: (_s, _n, tier) => {
      tiers.push(tier);
      return "p";
    },
    approve: async () => true,
    onEvent: (e) => events.push(e),
  });
}

describe("Private Cloud first, on-device fallback", () => {
  it("uses the primary (cloud) model when it works", async () => {
    const events: AgentEvent[] = [];
    const tiers: Tier[] = [];
    const r = await make({ ask: async () => final("cloud") }, { ask: async () => final("local") }, events, tiers).run();
    expect(r.message).toBe("cloud");
    expect(tiers).toEqual(["primary"]);
  });

  it("falls back to on-device when the cloud shortcut fails (offline / missing)", async () => {
    const events: AgentEvent[] = [];
    const tiers: Tier[] = [];
    const r = await make(
      { ask: async () => { throw new BridgeError("error", "offline"); } },
      { ask: async () => final("local answer") },
      events,
      tiers
    ).run();
    expect(r.message).toBe("local answer");
    expect(tiers).toEqual(["primary", "fallback"]); // fallback prompt uses the smaller budget
    expect(events.some((e) => e.kind === "fallback")).toBe(true);
  });

  it("does not fall back when the user cancels", async () => {
    const r = make(
      { ask: async () => { throw new BridgeError("cancelled", "x"); } },
      { ask: async () => final("local") },
      [],
      []
    ).run();
    await expect(r).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("surfaces the error when there is no fallback", async () => {
    const r = make({ ask: async () => { throw new BridgeError("timeout", "slow"); } }, undefined, [], []).run();
    await expect(r).rejects.toMatchObject({ kind: "timeout" });
  });
});
