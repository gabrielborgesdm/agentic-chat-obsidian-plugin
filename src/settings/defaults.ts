import type { ThemeId, ThemeMode } from "../ui/themes";

export type ModelMode = "cloud" | "local";
export type ProviderId = "apple" | "chatgpt";

export interface AgentSettings {
  /** which AI provider answers (every provider runs through an iOS Shortcut) */
  provider: ProviderId;
  /** Shortcut that runs the ChatGPT app's "Ask ChatGPT" action */
  chatgptShortcutName: string;
  /** prompt budget in characters for ChatGPT (large context) */
  chatgptPromptCharBudget: number;
  /** when ChatGPT fails, retry on the Apple on-device Shortcut */
  chatgptFallback: boolean;
  /**
   * "cloud": Apple Private Cloud Compute first (smarter, free, needs internet), on-device as fallback.
   * "local": on-device only (works offline, weaker).
   */
  modelMode: ModelMode;
  /** Shortcut running "Use Model → On-Device" */
  shortcutName: string;
  /** Shortcut running "Use Model → Private Cloud Compute" */
  cloudShortcutName: string;
  /** model calls per request; 0 = no limit */
  maxSteps: number;
  timeoutSec: number;
  autoCreate: boolean;
  autoAppend: boolean;
  /** skip the confirmation dialog for editing existing notes (default off) */
  autoEdit: boolean;
  /** skip the confirmation dialog for rename/move (default off) */
  autoRename: boolean;
  /** vault folder where attached files are saved */
  attachmentFolder: string;
  /** "auto" (detect from the text / device) or a fixed tag like pt-BR, en-US */
  voiceLanguage: string;
  /** read every answer aloud */
  autoSpeak: boolean;
  customInstructions: string;
  /** prompt budget in characters for the on-device model (small context window) */
  promptCharBudget: number;
  /** prompt budget in characters for Private Cloud Compute (much larger context) */
  cloudPromptCharBudget: number;
  autoRetrieve: boolean;
  /** chat colors: "obsidian" uses the vault's own theme */
  theme: ThemeId;
  /** light/dark for the chat theme: auto = follow the device */
  themeMode: ThemeMode;
  /** mobile: hide Obsidian's floating bottom bar while the chat is in front */
  hideMobileNavbar: boolean;
  /** prompt size (characters) each Shortcut was found to accept after failing on a longer one */
  learnedLimits: Record<string, number>;
  /** plugin version that last ran, to announce updates */
  lastVersion: string;
  /** old default limits (16000 / 30000 / 4 steps) were switched off once */
  limitsMigrated: boolean;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  theme: "obsidian",
  themeMode: "auto",
  hideMobileNavbar: true,
  learnedLimits: {},
  lastVersion: "",
  limitsMigrated: false,
  provider: "apple",
  chatgptShortcutName: "ChatGPT Agent",
  chatgptPromptCharBudget: 0,
  chatgptFallback: false,
  modelMode: "cloud",
  shortcutName: "Local Agent",
  cloudShortcutName: "Cloud Agent",
  maxSteps: 0,
  timeoutSec: 120,
  autoCreate: false,
  autoAppend: true,
  autoEdit: false,
  autoRename: false,
  attachmentFolder: "anexos",
  voiceLanguage: "auto",
  autoSpeak: false,
  customInstructions: "",
  promptCharBudget: 7000,
  cloudPromptCharBudget: 0,
  autoRetrieve: true,
};
