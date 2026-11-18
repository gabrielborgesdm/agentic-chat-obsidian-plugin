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

describe("retry the primary model with a shorter prompt", () => {
  /** builds prompts of `budget` characters (default 11400, like the real failing Private Cloud request) */
  function makeSized(primary: ModelBridge, fallback: ModelBridge | undefined, log: { tier: Tier; budget?: number }[], learned: number[]) {
    return new AgentLoop({
      bridge: primary,
      fallbackBridge: fallback,
      tools: new Map(),
      settings: DEFAULT_SETTINGS,
      toolCtx: { currentPath: () => null },
      buildPrompt: (_s, _n, tier, budget) => {
        log.push({ tier, budget });
        return "x".repeat(budget ?? 11400);
      },
      approve: async () => true,
      onEvent: () => {},
      onShorterWorked: (b) => learned.push(b),
    });
  }

  it("answers with the same model when the shorter prompt fits, and reports the size that worked", async () => {
    const log: { tier: Tier; budget?: number }[] = [];
    const learned: number[] = [];
    const primary: ModelBridge = {
      ask: async (p) => {
        if (p.length > 8000) throw new BridgeError("error", "Your request can’t be completed.");
        return final("cloud, shorter");
      },
    };
    const r = await makeSized(primary, { ask: async () => final("local") }, log, learned).run();
    expect(r.message).toBe("cloud, shorter");
    expect(log).toEqual([{ tier: "primary", budget: undefined }, { tier: "primary", budget: 6270 }]);
    expect(learned).toEqual([6270]);
  });

  it("falls back when the shorter prompt fails too", async () => {
    const log: { tier: Tier; budget?: number }[] = [];
    const r = await makeSized(
      { ask: async () => { throw new BridgeError("error", "down"); } },
      { ask: async () => final("local") },
      log,
      []
    ).run();
    expect(r.message).toBe("local");
    expect(log.map((l) => l.tier)).toEqual(["primary", "primary", "fallback"]);
  });

  it("does not retry shorter after a timeout or for short prompts", async () => {
    const log: { tier: Tier; budget?: number }[] = [];
    await makeSized({ ask: async () => { throw new BridgeError("timeout", "slow"); } }, { ask: async () => final("local") }, log, []).run();
    expect(log.map((l) => l.tier)).toEqual(["primary", "fallback"]);
  });
});
