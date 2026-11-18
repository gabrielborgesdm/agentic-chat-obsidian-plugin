import type { AgentSettings, ProviderId } from "../settings/defaults";

/** One model call target: a Shortcut plus how much prompt it can take. Pure data, no bridge. */
export interface RouteTier {
  shortcut: string;
  /** prompt budget in characters */
  budget: number;
  /** shown in the status line, e.g. "Thinking · ChatGPT…" */
  label: string;
  /** a failure pauses this tier for a while (Private Cloud) */
  pausable: boolean;
}

export interface Route {
  primary: RouteTier;
  fallback?: RouteTier;
}

export interface HelpSection {
  title: string;
  /** numbered steps, grouped; a group with a heading is one Shortcut */
  groups: { heading?: string; steps: string[] }[];
  notes: string[];
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** one line for the chat's empty state */
  tagline: string;
  route(s: AgentSettings, now: number, cloudPausedUntil: number): Route;
  help(s: AgentSettings): HelpSection;
  /** Shortcut used by the Test button / command */
  testShortcut(s: AgentSettings): string;
}

/** The default Private Cloud Shortcut name before it was renamed to "Cloud Agent". */
export const OLD_CLOUD_NAME = "Local Agent Cloud";

const apple: ProviderDef = {
  id: "apple",
  label: "Apple Intelligence",
  tagline: "Apple Intelligence, on your device. Try:",
  route(s, now, cloudPausedUntil) {
    const local: RouteTier = { shortcut: s.shortcutName, budget: s.promptCharBudget, label: "on-device", pausable: false };
    if (s.modelMode === "local" || now < cloudPausedUntil) return { primary: local };
    return {
      primary: { shortcut: s.cloudShortcutName, budget: s.cloudPromptCharBudget, label: "Private Cloud", pausable: true },
      fallback: local,
    };
  },
  help(s) {
    const common = (name: string, model: string) => [
      `In the Shortcuts app, create a new Shortcut named “${name}”.`,
      "Tap ⓘ and set Receive to Text.",
      `Add “Use Model”. Set the model to ${model} and the prompt to Shortcut Input.`,
      "Add “Stop and Output” and choose the Response from the step above.",
    ];
    return {
      title: "Apple Intelligence setup",
      groups: [
        { heading: `On-device Shortcut “${s.shortcutName}” (offline, small model)`, steps: common(s.shortcutName, "On-Device") },
        {
          heading: `Private Cloud Shortcut “${s.cloudShortcutName}” (larger model, needs internet, recommended)`,
          steps: common(s.cloudShortcutName, "Private Cloud Compute"),
        },
      ],
      notes: [
        "Set up both: the plugin falls back to the on-device Shortcut when Private Cloud is unavailable.",
        "If your device offers Cloud Pro, pick it for the Private Cloud model and raise the Private Cloud prompt budget to about 30000.",
        "Needs a device with Apple Intelligence turned on. Nothing leaves Apple's systems.",
        "The first time, iOS asks you to allow the Shortcut. Approve it.",
      ],
    };
  },
  testShortcut: (s) => (s.modelMode === "cloud" ? s.cloudShortcutName : s.shortcutName),
};

const chatgpt: ProviderDef = {
  id: "chatgpt",
  label: "ChatGPT",
  tagline: "ChatGPT, through Shortcuts. Try:",
  route(s) {
    const primary: RouteTier = {
      shortcut: s.chatgptShortcutName,
      budget: s.chatgptPromptCharBudget,
      label: "ChatGPT",
      pausable: false,
    };
    if (!s.chatgptFallback) return { primary };
    return {
      primary,
      fallback: { shortcut: s.shortcutName, budget: s.promptCharBudget, label: "on-device", pausable: false },
    };
  },
  help(s) {
    return {
      title: "ChatGPT setup",
      groups: [
        {
          heading: `Shortcut “${s.chatgptShortcutName}”`,
          steps: [
            "Install the ChatGPT app from the App Store and sign in.",
            `In the Shortcuts app, create a new Shortcut named “${s.chatgptShortcutName}”.`,
            "Tap ⓘ and set Receive to Text.",
            "Add the “Ask ChatGPT” action (it appears once the ChatGPT app is installed). Set its message to Shortcut Input. If it offers to show or ask for a prompt, turn that off.",
            "Add “Stop and Output” and choose ChatGPT's response from the step above.",
            "Back here, tap Test to check it works.",
          ],
        },
      ],
      notes: [
        "Each request switches to the Shortcuts app and back, and ChatGPT can take a few seconds. Approve the iOS prompts the first time.",
        "The text of your question and the notes the agent reads are sent to OpenAI.",
        "Turn on “Fall back to Apple on-device” if you want requests to still work when ChatGPT is unavailable.",
      ],
    };
  },
  testShortcut: (s) => s.chatgptShortcutName,
};

export const PROVIDERS: Record<ProviderId, ProviderDef> = { apple, chatgpt };

export function providerOf(s: Pick<AgentSettings, "provider">): ProviderDef {
  return PROVIDERS[s.provider] ?? PROVIDERS.apple;
}

/** Fixes values loaded from an older or hand-edited data.json. */
export function sanitizeSettings(s: AgentSettings): AgentSettings {
  if (!(s.provider in PROVIDERS)) s.provider = "apple";
  if (!["obsidian", "cherry", "graphite", "ocean", "sage"].includes(s.theme)) s.theme = "obsidian";
  if (!["auto", "obsidian", "light", "dark"].includes(s.themeMode)) s.themeMode = "auto";
  if (!s.learnedLimits || typeof s.learnedLimits !== "object") s.learnedLimits = {};
  return s;
}
