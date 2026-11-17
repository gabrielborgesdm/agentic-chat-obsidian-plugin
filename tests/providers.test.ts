import { describe, expect, it } from "vitest";
import { OLD_CLOUD_NAME, PROVIDERS, providerOf, sanitizeSettings } from "../src/providers/providers";
import { DEFAULT_SETTINGS, type AgentSettings } from "../src/settings/defaults";

const S = (o: Partial<AgentSettings> = {}): AgentSettings => ({ ...DEFAULT_SETTINGS, ...o });

describe("defaults and migration", () => {
  it("an old data.json without provider keys keeps Apple and its saved names", () => {
    const saved = { modelMode: "local", shortcutName: "Mine", cloudShortcutName: OLD_CLOUD_NAME } as Partial<AgentSettings>;
    const s = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, saved));
    expect(s.provider).toBe("apple");
    expect(s.modelMode).toBe("local");
    expect(s.shortcutName).toBe("Mine");
    expect(s.cloudShortcutName).toBe(OLD_CLOUD_NAME); // saved name is never rewritten
  });

  it("a fresh install uses Cloud Agent and ChatGPT Agent", () => {
    expect(DEFAULT_SETTINGS.cloudShortcutName).toBe("Cloud Agent");
    expect(DEFAULT_SETTINGS.chatgptShortcutName).toBe("ChatGPT Agent");
    expect(DEFAULT_SETTINGS.provider).toBe("apple");
    expect(DEFAULT_SETTINGS.chatgptFallback).toBe(false);
    expect(DEFAULT_SETTINGS.chatgptPromptCharBudget).toBe(30000);
  });

  it("an unknown provider id falls back to Apple", () => {
    expect(sanitizeSettings(S({ provider: "nope" as any })).provider).toBe("apple");
    expect(providerOf({ provider: "nope" as any }).id).toBe("apple");
  });
});

describe("Apple routing (unchanged behavior)", () => {
  it("Private Cloud first with on-device fallback", () => {
    const r = PROVIDERS.apple.route(S(), 0, 0);
    expect(r.primary).toMatchObject({ shortcut: "Cloud Agent", label: "Private Cloud", pausable: true, budget: 16000 });
    expect(r.fallback).toMatchObject({ shortcut: "Local Agent", label: "on-device", pausable: false, budget: 7000 });
  });

  it("on-device only has no fallback", () => {
    const r = PROVIDERS.apple.route(S({ modelMode: "local" }), 0, 0);
    expect(r.primary.label).toBe("on-device");
    expect(r.fallback).toBeUndefined();
  });

  it("skips Private Cloud while it is paused", () => {
    const r = PROVIDERS.apple.route(S(), 1000, 5000);
    expect(r.primary.label).toBe("on-device");
    expect(r.fallback).toBeUndefined();
  });
});

describe("ChatGPT routing", () => {
  it("runs the ChatGPT Shortcut with its own budget and no fallback by default", () => {
    const r = PROVIDERS.chatgpt.route(S({ provider: "chatgpt" }), 0, 0);
    expect(r.primary).toMatchObject({ shortcut: "ChatGPT Agent", label: "ChatGPT", budget: 30000, pausable: false });
    expect(r.fallback).toBeUndefined();
  });

  it("uses a custom Shortcut name", () => {
    const r = PROVIDERS.chatgpt.route(S({ provider: "chatgpt", chatgptShortcutName: "My GPT" }), 0, 0);
    expect(r.primary.shortcut).toBe("My GPT");
  });

  it("falls back to the on-device Shortcut and its smaller budget when enabled", () => {
    const r = PROVIDERS.chatgpt.route(S({ provider: "chatgpt", chatgptFallback: true }), 0, 0);
    expect(r.fallback).toMatchObject({ shortcut: "Local Agent", budget: 7000, label: "on-device" });
  });

  it("is never paused, even if a Private Cloud pause is active", () => {
    const r = PROVIDERS.chatgpt.route(S({ provider: "chatgpt" }), 1000, 99999);
    expect(r.primary.label).toBe("ChatGPT");
  });
});

describe("setup help", () => {
  it("Apple help names both configured Shortcuts and mentions Cloud Pro", () => {
    const h = PROVIDERS.apple.help(S({ shortcutName: "A1", cloudShortcutName: "C1" }));
    const text = JSON.stringify(h);
    expect(text).toContain("A1");
    expect(text).toContain("C1");
    expect(text).toContain("Cloud Pro");
    expect(h.groups).toHaveLength(2);
  });

  it("ChatGPT help names the configured Shortcut, Ask ChatGPT, the app switch and OpenAI", () => {
    const h = PROVIDERS.chatgpt.help(S({ chatgptShortcutName: "G1" }));
    const text = JSON.stringify(h);
    expect(text).toContain("G1");
    expect(text).toContain("Ask ChatGPT");
    expect(text).toContain("Shortcuts app and back");
    expect(text).toContain("OpenAI");
  });

  it("test targets follow the provider", () => {
    expect(PROVIDERS.chatgpt.testShortcut(S({ chatgptShortcutName: "G1" }))).toBe("G1");
    expect(PROVIDERS.apple.testShortcut(S())).toBe("Cloud Agent");
    expect(PROVIDERS.apple.testShortcut(S({ modelMode: "local" }))).toBe("Local Agent");
  });
});
