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
}

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: "apple",
  chatgptShortcutName: "ChatGPT Agent",
  chatgptPromptCharBudget: 30000,
  chatgptFallback: false,
  modelMode: "cloud",
  shortcutName: "Local Agent",
  cloudShortcutName: "Cloud Agent",
  maxSteps: 4,
  timeoutSec: 120,
  autoCreate: true,
  autoAppend: true,
  autoEdit: false,
  autoRename: false,
  attachmentFolder: "anexos",
  voiceLanguage: "auto",
  autoSpeak: false,
  customInstructions: "",
  promptCharBudget: 7000,
  cloudPromptCharBudget: 16000,
  autoRetrieve: true,
};
