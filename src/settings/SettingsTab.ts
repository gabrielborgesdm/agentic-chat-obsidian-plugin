import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LocalAgentPlugin from "../main";
import { DEFAULT_SETTINGS, type AgentSettings, type ModelMode, type ProviderId } from "./defaults";
import { OLD_CLOUD_NAME, PROVIDERS, providerOf, type HelpSection } from "../providers/providers";

export class AgentSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: LocalAgentPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `${this.plugin.manifest.name} v${this.plugin.manifest.version}`,
    });

    // ---------------- provider ----------------
    new Setting(containerEl).setName("AI provider").setHeading();
    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Every provider runs through an iOS Shortcut that you create once. The setup steps for the selected provider are right below.")
      .addDropdown((d) => {
        for (const p of Object.values(PROVIDERS)) d.addOption(p.id, p.label);
        d.setValue(s.provider).onChange((v) => {
          s.provider = v as ProviderId;
          save();
          this.display();
        });
      });

    this.renderHelp(containerEl, providerOf(s).help(s));

    if (s.provider === "apple") this.appleFields(containerEl, s, save);
    else this.chatgptFields(containerEl, s, save);

    this.renderTest(containerEl);
    new Setting(containerEl)
      .setName("Response timeout (seconds)")
      .addSlider((sl) =>
        sl.setLimits(30, 300, 10).setValue(s.timeoutSec).setDynamicTooltip().onChange((v) => {
          s.timeoutSec = v;
          save();
        })
      );

    // ---------------- deep link ----------------
    new Setting(containerEl).setName("Deep link to the chat").setHeading();
    const link = this.plugin.deepLink();
    new Setting(containerEl)
      .setName("Open chat link")
      .setDesc(`${link}  (add &new=1 for a fresh conversation, &q=your%20text to prefill, plus &send=1 to send it)`)
      .addButton((b) =>
        b.setButtonText("Copy").onClick(async () => {
          await navigator.clipboard.writeText(link);
          new Notice("Link copied");
        })
      );

    // ---------------- agent ----------------
    new Setting(containerEl).setName("Agent").setHeading();
    new Setting(containerEl)
      .setName("Max steps per request")
      .setDesc("Each model call switches to the Shortcuts app and back, so keep this low.")
      .addSlider((sl) =>
        sl.setLimits(1, 8, 1).setValue(s.maxSteps).setDynamicTooltip().onChange((v) => {
          s.maxSteps = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("On-device prompt budget (characters)")
      .setDesc("Apple's on-device model has a small context window. Lower this if you see errors on long chats.")
      .addSlider((sl) =>
        sl.setLimits(3000, 12000, 500).setValue(s.promptCharBudget).setDynamicTooltip().onChange((v) => {
          s.promptCharBudget = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("Automatic context retrieval")
      .setDesc("Search the vault before the first model call so most answers need only one round trip.")
      .addToggle((t) =>
        t.setValue(s.autoRetrieve).onChange((v) => {
          s.autoRetrieve = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("Custom instructions")
      .setDesc("Standing instructions added to every request (keep them short).")
      .addTextArea((t) =>
        t.setValue(s.customInstructions).onChange((v) => {
          s.customInstructions = v;
          save();
        })
      );

    // ---------------- voice ----------------
    new Setting(containerEl).setName("Read aloud").setHeading();
    new Setting(containerEl)
      .setName("Voice language")
      .setDesc('"auto" detects the language of each answer. Or force one, e.g. en-US, pt-BR, es-ES. To dictate, use the 🎤 key on the iPhone keyboard.')
      .addText((t) =>
        t.setPlaceholder("auto").setValue(s.voiceLanguage).onChange((v) => {
          s.voiceLanguage = v.trim() || "auto";
          save();
        })
      );
    new Setting(containerEl)
      .setName("Read answers aloud automatically")
      .setDesc("Uses the device's built-in voices, offline. You can also press and hold any answer → Read aloud.")
      .addToggle((t) =>
        t.setValue(s.autoSpeak).onChange((v) => {
          s.autoSpeak = v;
          save();
        })
      );

    // ---------------- permissions ----------------
    new Setting(containerEl).setName("Permissions").setHeading();
    new Setting(containerEl)
      .setName("Create notes automatically")
      .setDesc("When off, you approve each new note. Existing notes are never overwritten by creation.")
      .addToggle((t) =>
        t.setValue(s.autoCreate).onChange((v) => {
          s.autoCreate = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("Append to notes automatically")
      .addToggle((t) =>
        t.setValue(s.autoAppend).onChange((v) => {
          s.autoAppend = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("Edit existing notes without asking")
      .setDesc("Off (recommended): you see a before/after preview and approve each edit. Every change can be undone from the chat.")
      .addToggle((t) =>
        t.setValue(s.autoEdit).onChange((v) => {
          s.autoEdit = v;
          save();
        })
      );
    new Setting(containerEl)
      .setName("Rename/move without asking")
      .addToggle((t) =>
        t.setValue(s.autoRename).onChange((v) => {
          s.autoRename = v;
          save();
        })
      );
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Deleting always requires your confirmation (notes go to the trash).",
    });

    // ---------------- attachments ----------------
    new Setting(containerEl).setName("Attachments").setHeading();
    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc("Photos and files you attach in the chat are saved here (never overwriting existing files).")
      .addText((t) =>
        t.setValue(s.attachmentFolder).onChange((v) => {
          s.attachmentFolder = v.trim();
          save();
        })
      );
  }

  // ---------- provider helpers ----------

  /** Setup steps for the selected provider, shown right under the dropdown. */
  private renderHelp(el: HTMLElement, help: HelpSection): void {
    const box = el.createEl("details", { cls: "la-help" });
    box.open = true;
    box.createEl("summary", { text: help.title });
    for (const g of help.groups) {
      if (g.heading) box.createEl("p", { cls: "la-help-heading", text: g.heading });
      const ol = box.createEl("ol");
      for (const step of g.steps) ol.createEl("li", { text: step });
    }
    if (help.notes.length) {
      const ul = box.createEl("ul", { cls: "setting-item-description" });
      for (const n of help.notes) ul.createEl("li", { text: n });
    }
  }

  private appleFields(el: HTMLElement, s: AgentSettings, save: () => void): void {
    const paused = this.plugin.cloudPauseInfo();
    if (paused) {
      new Setting(el)
        .setName("⚠️ " + paused)
        .setDesc("Requests use the on-device model until then.")
        .addButton((b) =>
          b.setButtonText("Use Private Cloud now").setCta().onClick(() => {
            this.plugin.resumeCloud();
            this.display();
          })
        );
    }

    new Setting(el)
      .setName("Model")
      .setDesc(
        "Private Cloud Compute: Apple's larger model, free, private (not stored by Apple), needs internet. Falls back to the on-device model automatically when it fails or you're offline. On-device only: fully offline, but weaker at following instructions."
      )
      .addDropdown((d) =>
        d
          .addOption("cloud", "Private Cloud, on-device fallback")
          .addOption("local", "On-device only")
          .setValue(s.modelMode)
          .onChange((v) => {
            s.modelMode = v as ModelMode;
            save();
          })
      );
    new Setting(el)
      .setName("Private Cloud shortcut name")
      .setDesc('Shortcut with "Use Model → Cloud Pro" (recommended: larger context, best at following instructions) or "Cloud". If you use Cloud Pro, raise the Private Cloud prompt budget below to ~30000.')
      .addText((t) =>
        t.setValue(s.cloudShortcutName).onChange((v) => {
          s.cloudShortcutName = v.trim() || DEFAULT_SETTINGS.cloudShortcutName;
          save();
        })
      );
    if (s.cloudShortcutName === OLD_CLOUD_NAME) {
      new Setting(el)
        .setName(`Rename to “${DEFAULT_SETTINGS.cloudShortcutName}”`)
        .setDesc(
          `Your Private Cloud Shortcut is still called “${OLD_CLOUD_NAME}”. New installs use “${DEFAULT_SETTINGS.cloudShortcutName}”. Rename the Shortcut in the Shortcuts app first, then tap Switch.`
        )
        .addButton((b) =>
          b.setButtonText("Switch").onClick(() => {
            s.cloudShortcutName = DEFAULT_SETTINGS.cloudShortcutName;
            save();
            this.display();
          })
        );
    }
    new Setting(el)
      .setName("On-device shortcut name")
      .setDesc('Shortcut with "Use Model → On-Device".')
      .addText((t) =>
        t.setValue(s.shortcutName).onChange((v) => {
          s.shortcutName = v.trim() || DEFAULT_SETTINGS.shortcutName;
          save();
        })
      );
    new Setting(el)
      .setName("Private Cloud prompt budget (characters)")
      .addSlider((sl) =>
        sl.setLimits(8000, 40000, 1000).setValue(s.cloudPromptCharBudget).setDynamicTooltip().onChange((v) => {
          s.cloudPromptCharBudget = v;
          save();
        })
      );
  }

  private chatgptFields(el: HTMLElement, s: AgentSettings, save: () => void): void {
    new Setting(el)
      .setName("ChatGPT shortcut name")
      .setDesc('Shortcut with the ChatGPT app\'s "Ask ChatGPT" action.')
      .addText((t) =>
        t.setValue(s.chatgptShortcutName).onChange((v) => {
          s.chatgptShortcutName = v.trim() || DEFAULT_SETTINGS.chatgptShortcutName;
          save();
        })
      );
    new Setting(el)
      .setName("ChatGPT prompt budget (characters)")
      .setDesc("ChatGPT has a large context window. Lower this if requests are slow.")
      .addSlider((sl) =>
        sl.setLimits(8000, 60000, 2000).setValue(s.chatgptPromptCharBudget).setDynamicTooltip().onChange((v) => {
          s.chatgptPromptCharBudget = v;
          save();
        })
      );
    new Setting(el)
      .setName("Fall back to Apple on-device")
      .setDesc(
        `If the ChatGPT Shortcut fails, answer with the on-device Shortcut “${s.shortcutName}” instead (set it up under Apple Intelligence).`
      )
      .addToggle((t) =>
        t.setValue(s.chatgptFallback).onChange((v) => {
          s.chatgptFallback = v;
          save();
        })
      );
  }

  /** Runs a quick round trip on the selected provider's Shortcut and shows the result inline. */
  private renderTest(el: HTMLElement): void {
    const provider = providerOf(this.plugin.settings);
    const setting = new Setting(el)
      .setName(`Test ${provider.label}`)
      .setDesc(
        this.plugin.shortcut
          ? "Runs the Shortcut once. It briefly switches to the Shortcuts app and back."
          : "Needs the iPhone: it calls the real Shortcut."
      );
    setting.addButton((b) =>
      b.setButtonText("Test").setCta().onClick(async () => {
        const sc = this.plugin.shortcut;
        if (!sc) {
          new Notice("The test needs the iPhone: on desktop the plugin uses a mock model.");
          return;
        }
        const name = provider.testShortcut(this.plugin.settings);
        b.setDisabled(true);
        setting.setDesc(`Running “${name}”…`);
        const t0 = Date.now();
        try {
          const r = await sc.run(name, "Reply with exactly the single word: PONG");
          const secs = ((Date.now() - t0) / 1000).toFixed(1);
          setting.setDesc(
            /pong/i.test(r.result)
              ? `✅ “${name}” works (${secs}s).`
              : `⚠️ “${name}” answered, but not as expected: ${r.result.slice(0, 80).replace(/\n/g, " ")}. Check the last steps above.`
          );
        } catch (e: any) {
          setting.setDesc(`❌ “${name}” failed: ${e?.message ?? e}. Check the setup steps above.`);
        } finally {
          b.setDisabled(false);
        }
      })
    );
    setting.addButton((b) => b.setButtonText("More checks").onClick(() => this.plugin.openDiagnostics()));
  }
}
