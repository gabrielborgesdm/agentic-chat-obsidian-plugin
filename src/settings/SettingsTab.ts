import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LocalAgentPlugin from "../main";
import { DEFAULT_SETTINGS, type AgentSettings, type ModelMode, type ProviderId } from "./defaults";
import { MODES, THEMES, type ThemeId, type ThemeMode } from "../ui/themes";
import { OLD_CLOUD_NAME, PROVIDERS, providerOf, type HelpSection } from "../providers/providers";

export class AgentSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: LocalAgentPlugin) {
    super(app, plugin);
  }

  /** Redraws the page without jumping back to the top. */
  private redraw(): void {
    const scrollers = [this.containerEl, this.containerEl.parentElement].filter((e): e is HTMLElement => !!e);
    const tops = scrollers.map((e) => e.scrollTop);
    this.display();
    scrollers.forEach((e, i) => (e.scrollTop = tops[i]));
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

    this.appearanceSection(containerEl, s);
    this.agentSection(containerEl, s, save);
    this.providerSection(containerEl, s, save);
    this.linkAndDebugSection(containerEl);
  }

  private appearanceSection(containerEl: HTMLElement, s: AgentSettings): void {
    new Setting(containerEl).setName("Appearance").setHeading();
    let modeRow: Setting | null = null;
    new Setting(containerEl)
      .setName("Chat theme")
      .setDesc("Colors of the chat view. Also in the chat's ⋯ menu.")
      .addDropdown((d) => {
        for (const t of THEMES) d.addOption(t.id, t.label);
        d.setValue(s.theme).onChange((v) => {
          void this.plugin.setAppearance({ theme: v as ThemeId });
          // show/hide the light-dark row in place: no redraw, no jump to the top
          modeRow?.settingEl.toggle(v !== "obsidian");
        });
      });
    modeRow = new Setting(containerEl)
      .setName("Light or dark")
      .setDesc("Auto follows the device's light/dark setting.")
      .addDropdown((d) => {
        for (const m of MODES) d.addOption(m.id, m.label);
        d.setValue(s.themeMode).onChange((v) => void this.plugin.setAppearance({ themeMode: v as ThemeMode }));
      });
    modeRow.settingEl.toggle(s.theme !== "obsidian");
    new Setting(containerEl)
      .setName("Full-screen chat on iPhone")
      .setDesc("Hides Obsidian's floating bottom bar (search, new, tabs, menu) while the chat is open. It comes back when you open a note.")
      .addToggle((t) =>
        t.setValue(s.hideMobileNavbar).onChange((v) => {
          s.hideMobileNavbar = v;
          void this.plugin.saveSettings();
          this.plugin.syncMobileChrome();
        })
      );
  }

  private providerSection(containerEl: HTMLElement, s: AgentSettings, save: () => void): void {
    new Setting(containerEl).setName("AI provider").setHeading();
    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Every provider runs through an iOS Shortcut that you create once. The setup steps for the selected provider are right below.")
      .addDropdown((d) => {
        for (const p of Object.values(PROVIDERS)) d.addOption(p.id, p.label);
        d.setValue(s.provider).onChange((v) => {
          s.provider = v as ProviderId;
          save();
          this.redraw();
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
  }

  private linkAndDebugSection(containerEl: HTMLElement): void {
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

    new Setting(containerEl).setName("Debugging").setHeading();
    new Setting(containerEl)
      .setName("Copy chat report")
      .setDesc(
        "Copies the current chat for debugging: messages, settings, each prompt sent to the model, its raw reply, and tool results. It includes the text of notes the agent read, so check it before sharing."
      )
      .addButton((b) => b.setButtonText("Copy report").onClick(() => void this.plugin.copyReport()));
  }

  private agentSection(containerEl: HTMLElement, s: AgentSettings, save: () => void): void {
    new Setting(containerEl).setName("Agent").setHeading();
    this.limitSetting(containerEl, {
      name: "Limit steps per request",
      desc: "Off: the agent keeps going until it's done (tap Stop to end it). Each step switches to the Shortcuts app and back.",
      get: () => s.maxSteps,
      set: (v) => (s.maxSteps = v),
      on: 4,
      min: 1,
      max: 20,
      step: 1,
      save,
    });
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
      .setName("Create notes without asking")
      .setDesc("Off (recommended): you see the suggested folder and name for each new note, and can accept or change them. Existing notes are never overwritten by creation.")
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
    box.open = false; // collapsed so the provider section stays short
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
            this.redraw();
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
            this.redraw();
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
    this.limitSetting(el, {
      name: "Limit Private Cloud prompt length",
      desc: "Off: whole notes and the full chat are sent. Turn on only if Private Cloud fails on long requests.",
      get: () => s.cloudPromptCharBudget,
      set: (v) => (s.cloudPromptCharBudget = v),
      on: 16000,
      min: 8000,
      max: 60000,
      step: 1000,
      save,
    });
  }

  /** A toggle that turns a numeric limit on (with a slider) or off (stored as 0). */
  private limitSetting(
    el: HTMLElement,
    o: { name: string; desc: string; get: () => number; set: (v: number) => void; on: number; min: number; max: number; step: number; save: () => void }
  ): void {
    const limited = o.get() > 0;
    const setting = new Setting(el)
      .setName(o.name)
      .setDesc(o.desc)
      .addToggle((t) =>
        t.setValue(limited).onChange((v) => {
          o.set(v ? o.on : 0);
          o.save();
          this.redraw();
        })
      );
    if (limited)
      setting.addSlider((sl) =>
        sl.setLimits(o.min, o.max, o.step).setValue(o.get()).setDynamicTooltip().onChange((v) => {
          o.set(v);
          o.save();
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
    this.limitSetting(el, {
      name: "Limit ChatGPT prompt length",
      desc: "Off: whole notes and the full chat are sent. Turn on if requests get slow.",
      get: () => s.chatgptPromptCharBudget,
      set: (v) => (s.chatgptPromptCharBudget = v),
      on: 30000,
      min: 8000,
      max: 100000,
      step: 2000,
      save,
    });
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
        if (!this.plugin.shortcut) {
          new Notice("The test needs the iPhone: on desktop the plugin uses a mock model.");
          return;
        }
        b.setDisabled(true);
        setting.setDesc(`Running “${provider.testShortcut(this.plugin.settings)}”…`);
        const r = await this.plugin.testProvider();
        setting.setDesc(r.ok ? r.text : `${r.text} Check the setup steps above.`);
        b.setDisabled(false);
      })
    );
    setting.addButton((b) => b.setButtonText("More checks").onClick(() => this.plugin.openDiagnostics()));
  }
}
