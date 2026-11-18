import { ItemView, MarkdownRenderer, Menu, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type LocalAgentPlugin from "../main";
import type { Attachment, ChatMessage } from "../types";
import type { ProviderId } from "../settings/defaults";
import { ConversationPicker } from "./ConversationPicker";
import { NotePicker } from "./NotePicker";
import { PROVIDERS, providerOf } from "../providers/providers";
import { MODES, THEMES, applyTheme } from "./themes";
import { openImageViewer } from "./ImageViewer";
import { expandTaskEmbeds, linkTaskLines, splitTaskText, type TaskRef } from "./taskLinks";
import { canSpeak, isSpeaking, speak, stopSpeaking } from "../voice/Voice";

export const VIEW_TYPE = "local-agent-chat";
const LONG_PRESS_MS = 450;

export class ChatView extends ItemView {
  private listEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private strip!: HTMLElement;
  private optionsBtn!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private pending: Attachment[] = [];
  private titleEl2!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private lastMenuAt = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: LocalAgentPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Local Agent";
  }
  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("la-root");

    const header = root.createDiv("la-header");
    this.titleEl2 = header.createDiv({ cls: "la-title", text: "Local Agent" });
    const actions = header.createDiv("la-actions");
    const mk = (icon: string, label: string, fn: (e: MouseEvent) => void) => {
      const b = actions.createEl("button", { cls: "la-icon-btn clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", fn);
      return b;
    };
    // note, provider, report and settings live here instead of a row above the input
    this.optionsBtn = mk("sliders-horizontal", "Chat options", (e) => this.optionsMenu(e));
    mk("history", "Conversations", () =>
      new ConversationPicker(this.app, this.plugin.store.list(), (c) => {
        this.plugin.store.setActive(c.id);
        this.render();
      }).open()
    );
    mk("plus", "New conversation", () => {
      this.plugin.store.create();
      this.render();
    });
    mk("trash-2", "Clear conversation", () => {
      this.plugin.store.clear(this.plugin.store.active());
      this.render();
    });

    this.listEl = root.createDiv("la-messages");
    this.listEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLImageElement && target.closest(".la-bubble")) {
        e.preventDefault();
        e.stopPropagation();
        this.viewImage(target);
        return;
      }
      const a = target.closest("a.internal-link") as HTMLAnchorElement | null;
      if (a) {
        e.preventDefault();
        e.stopPropagation();
        // links inside a task resolve from that task's note ("hospedagem#Edimburgo" → the trip's hospedagem.md);
        // open in a new tab so the chat stays where it was
        const from = a.closest<HTMLElement>("[data-source]")?.dataset.source ?? "";
        void this.app.workspace.openLinkText(a.getAttribute("data-href") ?? a.getAttribute("href") ?? "", from, "tab");
      }
    });

    this.strip = root.createDiv("la-attach-strip");
    const composer = root.createDiv("la-composer");

    this.fileInput = composer.createEl("input", { attr: { type: "file", multiple: "true", style: "display:none" } });
    this.fileInput.addEventListener("change", () => {
      const files = Array.from(this.fileInput.files ?? []);
      this.fileInput.value = "";
      void this.addFiles(files);
    });
    const attachBtn = composer.createEl("button", { cls: "la-mic clickable-icon", attr: { "aria-label": "Attach a note, photo or file" } });
    setIcon(attachBtn, "paperclip");
    attachBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle("Note from your vault…")
          .setIcon("file-text")
          .onClick(() => new NotePicker(this.app, (f) => this.plugin.pinNote(f.path)).open())
      );
      // the file picker must open inside the tap itself, or iOS blocks it
      menu.addItem((i) => i.setTitle("Photo or file…").setIcon("image").onClick(() => this.fileInput.click()));
      menu.showAtMouseEvent(e);
    });

    this.inputEl = composer.createEl("textarea", {
      cls: "la-input",
      attr: { rows: "1", placeholder: "Ask, or type / for commands", enterkeyhint: "send" },
    });
    this.inputEl.addEventListener("input", () => this.autosize());
    this.inputEl.addEventListener("paste", (e) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void this.addFiles(files);
      }
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !Platform.isMobile) {
        e.preventDefault();
        this.submit();
      }
    });
    this.sendBtn = composer.createEl("button", { cls: "la-send mod-cta", attr: { "aria-label": "Send" } });
    this.sendBtn.addEventListener("click", () => (this.plugin.busy ? this.plugin.stop() : this.submit()));

    this.unsubs.push(this.plugin.onChange(() => this.render()));
    // Auto / Match Obsidian modes: re-apply when the device or Obsidian switches light/dark.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (mq) {
      const onScheme = () => this.applyTheme();
      mq.addEventListener("change", onScheme);
      this.unsubs.push(() => mq.removeEventListener("change", onScheme));
    }
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyTheme()));
    this.render();
  }

  /** Opens an image from a bubble (attachment or ![[embed]] in an answer) in the full-screen viewer. */
  private viewImage(img: HTMLImageElement): void {
    if (img.closest(".la-selecting")) return;
    // attachments carry data-path; Markdown embeds sit in a span.internal-embed with src="<link>"
    const link = img.dataset.path ?? img.closest(".internal-embed")?.getAttribute("src") ?? "";
    const file =
      (link && (this.app.vault.getAbstractFileByPath(link) ?? this.app.metadataCache.getFirstLinkpathDest(link.split("|")[0], ""))) || null;
    const tfile = file instanceof TFile ? file : undefined;
    openImageViewer(this.app, {
      src: img.currentSrc || img.src,
      name: tfile?.name ?? img.alt ?? "Image",
      file: tfile,
    });
  }

  private applyTheme(): void {
    applyTheme(this.contentEl, this.plugin.settings.theme, this.plugin.settings.themeMode);
    // the app around the chat (header, area behind the hidden bottom bar) follows the same colors
    this.plugin.syncMobileChrome();
  }

  /** The view's ⋯ menu: theme and light/dark choices. */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const s = this.plugin.settings;
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Copy chat report").setIcon("clipboard-copy").onClick(() => void this.plugin.copyReport()));
    menu.addSeparator();
    for (const t of THEMES) {
      menu.addItem((i) =>
        i
          .setTitle(`Theme: ${t.label}`)
          .setIcon("palette")
          .setChecked(s.theme === t.id)
          .onClick(() => void this.plugin.setAppearance({ theme: t.id }))
      );
    }
    if (s.theme !== "obsidian") {
      menu.addSeparator();
      for (const m of MODES) {
        menu.addItem((i) =>
          i
            .setTitle(m.label)
            .setIcon(m.id === "dark" ? "moon" : m.id === "light" ? "sun" : "sun-moon")
            .setChecked(s.themeMode === m.id)
            .onClick(() => void this.plugin.setAppearance({ themeMode: m.id }))
        );
      }
    }
  }

  async onClose(): Promise<void> {
    this.unsubs.forEach((u) => u());
    stopSpeaking();
  }

  setDraft(text: string): void {
    if (!this.inputEl) return;
    this.inputEl.value = text;
    this.autosize();
    this.inputEl.focus();
  }

  private autosize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 160) + "px";
  }

  private submit(): void {
    const text = this.inputEl.value.trim();
    if ((!text && !this.pending.length) || this.plugin.busy) return;
    const atts = this.pending;
    this.pending = [];
    this.renderStrip();
    this.inputEl.value = "";
    this.autosize();
    void this.plugin.send(text, atts);
  }

  // ---------- attachments ----------

  private async addFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    new Notice(`Saving ${files.length} file(s)…`);
    this.pending.push(...(await this.plugin.saveFiles(files)));
    this.renderStrip();
  }

  private renderStrip(): void {
    this.strip.empty();
    // a note chosen with 📎 → "Note from your vault" shows as a chip, like an attachment
    const pinned = this.plugin.noteIsPinned ? this.plugin.currentPath() : null;
    if (pinned) {
      const chip = this.strip.createDiv({ cls: "la-attach-chip la-note-chip", attr: { "aria-label": `"This note" = ${pinned}` } });
      setIcon(chip.createSpan("la-tool-icon"), "file-text");
      chip.createSpan({ text: (pinned.split("/").pop() ?? pinned).replace(/\.md$/, ""), cls: "la-attach-name" });
      const x = chip.createEl("button", { cls: "la-attach-x clickable-icon", attr: { "aria-label": "Remove note" } });
      setIcon(x, "x");
      x.addEventListener("click", () => this.plugin.pinNote(null));
    }
    this.pending.forEach((a, i) => {
      const chip = this.strip.createDiv("la-attach-chip");
      const icon = chip.createSpan("la-tool-icon");
      setIcon(icon, a.kind === "image" ? "image" : "file");
      chip.createSpan({ text: a.name, cls: "la-attach-name" });
      const x = chip.createEl("button", { cls: "la-attach-x clickable-icon", attr: { "aria-label": "Remove" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.pending.splice(i, 1); // file stays in the vault; it is just not sent
        this.renderStrip();
      });
    });
  }

  // ---------- "this note" pill ----------

  /** Header options button: a dot shows a note is attached; a warning dot shows Private Cloud is paused. */
  private renderCtx(): void {
    const path = this.plugin.currentPath();
    const paused = this.plugin.cloudPauseInfo();
    this.optionsBtn.toggleClass("la-has-note", !!path);
    this.optionsBtn.toggleClass("la-has-warning", !!paused);
    this.optionsBtn.setAttr(
      "aria-label",
      [`Chat options · ${providerOf(this.plugin.settings).label}`, path ? `this note: ${path}` : "no note", paused].filter(Boolean).join(" · ")
    );
  }

  /** Everything that used to sit above the input: the note, the provider, Private Cloud, report, settings. */
  private optionsMenu(e: MouseEvent): void {
    const s = this.plugin.settings;
    const path = this.plugin.currentPath();
    const name = path ? (path.split("/").pop() ?? path).replace(/\.md$/, "") : "";
    const menu = new Menu();

    // choosing a note lives in 📎; here only what's in use, and a way to turn it off
    if (path) {
      menu.addItem((i) => i.setTitle(`This note: ${name}`).setIcon(this.plugin.noteIsPinned ? "pin" : "file-text").setDisabled(true));
      menu.addItem((i) => i.setTitle("Don't use a note").setIcon("file-x").onClick(() => this.plugin.detachNote()));
    } else {
      menu.addItem((i) => i.setTitle("No note in use (📎 to attach one)").setIcon("file-x").setDisabled(true));
    }

    menu.addSeparator();
    for (const p of Object.values(PROVIDERS)) {
      menu.addItem((i) =>
        i
          .setTitle(p.label)
          .setIcon("sparkles")
          .setChecked(p.id === s.provider)
          .setDisabled(this.plugin.busy)
          .onClick(() => void this.plugin.setProvider(p.id))
      );
    }
    const paused = this.plugin.cloudPauseInfo();
    if (paused) {
      menu.addItem((i) =>
        i
          .setTitle("Use Private Cloud again")
          .setIcon("cloud")
          .onClick(() => {
            new Notice(paused);
            this.plugin.resumeCloud();
          })
      );
    }

    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Copy chat report").setIcon("clipboard-copy").onClick(() => void this.plugin.copyReport()));
    menu.addItem((i) => i.setTitle("Settings").setIcon("settings").onClick(() => this.plugin.openSettings()));
    menu.showAtMouseEvent(e);
  }

  // ---------- long-press menu ----------

  /** Long-press (touch) or right-click (desktop) opens a native Obsidian menu. */
  private attachMenu(target: HTMLElement, build: (menu: Menu) => void): void {
    const open = (x: number, y: number) => {
      if (Date.now() - this.lastMenuAt < 700) return; // touch + contextmenu can both fire
      this.lastMenuAt = Date.now();
      const menu = new Menu();
      build(menu);
      menu.showAtPosition({ x, y });
    };
    target.addEventListener("contextmenu", (e) => {
      if (target.hasClass("la-selecting")) return; // let native selection menu work
      e.preventDefault();
      open(e.clientX, e.clientY);
    });
    let timer: number | null = null;
    let sx = 0;
    let sy = 0;
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    target.addEventListener(
      "touchstart",
      (e) => {
        if (target.hasClass("la-selecting") || e.touches.length !== 1) return;
        // taps on a task row check it or open its note: no long-press (and no press animation)
        if ((e.target as HTMLElement | null)?.closest?.(".la-task-row")) return;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        target.addClass("la-pressing");
        timer = window.setTimeout(() => {
          timer = null;
          target.removeClass("la-pressing");
          open(sx, sy);
        }, LONG_PRESS_MS);
      },
      { passive: true }
    );
    target.addEventListener(
      "touchmove",
      (e) => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) {
          cancel();
          target.removeClass("la-pressing");
        }
      },
      { passive: true }
    );
    const end = () => {
      cancel();
      target.removeClass("la-pressing");
    };
    target.addEventListener("touchend", end);
    target.addEventListener("touchcancel", end);
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Copied");
    } catch {
      new Notice("Could not copy. Use “Select text” instead.");
    }
  }

  /** Makes one bubble selectable and selects all of it, so iOS shows its own handles/Copy. */
  private selectText(bubble: HTMLElement): void {
    this.listEl.querySelectorAll(".la-selecting").forEach((el) => el.removeClass("la-selecting"));
    bubble.addClass("la-selecting");
    const body = bubble.querySelector(".la-text") ?? bubble;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(body);
      sel.addRange(range);
    }
  }

  private messageMenu(menu: Menu, m: ChatMessage, bubble: HTMLElement, isLast: boolean): void {
    const hasText = !!m.text && m.text !== "(attachment)";
    if (hasText) menu.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => void this.copy(m.role === "assistant" ? (bubble.querySelector<HTMLElement>(".la-text")?.innerText ?? m.text) : m.text)));

    if (m.role === "assistant" && hasText) {
      if (canSpeak()) {
        const speaking = isSpeaking();
        menu.addItem((i) =>
          i
            .setTitle(speaking ? "Stop reading" : "Read aloud")
            .setIcon(speaking ? "volume-x" : "volume-2")
            .onClick(() => (speaking ? stopSpeaking() : speak(m.text, this.plugin.settings.voiceLanguage)))
        );
      }
      const cur = this.plugin.currentPath();
      menu.addItem((i) =>
        i
          .setTitle(cur ? `Add to “${(cur.split("/").pop() ?? cur).replace(/\.md$/, "")}”` : "Add to current note")
          .setIcon("file-plus")
          .onClick(() => void this.plugin.appendToCurrent(m.text))
      );
      menu.addItem((i) => i.setTitle("Save as new note").setIcon("file-input").onClick(() => void this.plugin.saveAsNote(m.text)));
    }
    if (m.role === "user" && hasText) {
      menu.addItem((i) => i.setTitle("Edit and resend").setIcon("pencil").onClick(() => this.setDraft(m.text)));
    }
    if (m.role === "error" && isLast && !this.plugin.busy) {
      menu.addItem((i) => i.setTitle("Retry").setIcon("rotate-ccw").onClick(() => void this.plugin.retry()));
    }
    if (m.role === "tool") {
      const p = (m.tool?.args?.path ?? m.tool?.args?.newPath) as string | undefined;
      const file = p ? this.plugin.vault2.resolve(p) : null;
      if (file) menu.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)));
      const op = m.tool?.opId ? this.plugin.store.getOp(m.tool.opId) : undefined;
      if (op && !op.rolledBack) menu.addItem((i) => i.setTitle("Undo this change").setIcon("undo-2").onClick(() => void this.plugin.undo(op.id)));
    }
    if (hasText && m.role !== "tool") {
      menu.addItem((i) => i.setTitle("Select text").setIcon("text-cursor").onClick(() => this.selectText(bubble)));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete message").setIcon("trash-2").onClick(() => this.plugin.deleteMessage(m.id)));
  }

  // ---------- rendering ----------

  /** what the message list was last drawn from; see render() */
  private drawn = { key: "", conv: "", count: -1, busy: false };

  render(): void {
    if (!this.listEl) return;
    const conv = this.plugin.store.active();
    this.titleEl2.setText(conv.title);
    this.applyTheme();
    this.renderCtx();
    this.renderStrip();
    this.sendBtn.empty();
    setIcon(this.sendBtn, this.plugin.busy ? "square" : "arrow-up");
    this.sendBtn.setAttr("aria-label", this.plugin.busy ? "Stop" : "Send");

    // Obsidian events (opening a note, settings…) call render() too: redraw the messages only when
    // they changed, and jump to the bottom only for new content, so taps don't make the chat leap.
    const last = conv.messages[conv.messages.length - 1];
    const ops = this.plugin.store.data.ops;
    const key = JSON.stringify([
      conv.id,
      conv.messages.length,
      last?.id,
      last?.text.length,
      this.plugin.busy,
      this.plugin.statusLabel,
      ops.length,
      ops.filter((o) => o.rolledBack).length,
      conv.messages.length ? "" : `${this.plugin.currentPath()}|${this.plugin.settings.provider}`,
    ]);
    if (key === this.drawn.key) return;
    const toBottom = conv.id !== this.drawn.conv || conv.messages.length !== this.drawn.count || this.plugin.busy !== this.drawn.busy;
    const keepTop = this.listEl.scrollTop;
    this.drawn = { key, conv: conv.id, count: conv.messages.length, busy: this.plugin.busy };
    this.listEl.empty();

    if (!conv.messages.length) this.renderWelcome();

    conv.messages.forEach((m, i) => this.renderMessage(m, i === conv.messages.length - 1));

    if (this.plugin.busy) {
      const row = this.listEl.createDiv("la-row la-assistant");
      const b = row.createDiv("la-bubble la-typing");
      b.createSpan({ cls: "la-dot" });
      b.createSpan({ cls: "la-dot" });
      b.createSpan({ cls: "la-dot" });
      if (this.plugin.statusLabel) b.createSpan({ cls: "la-status", text: this.plugin.statusLabel });
    }

    if (toBottom) this.listEl.scrollTop = this.listEl.scrollHeight;
    else {
      // answers render asynchronously: put the scroll back once their content is in place
      const restore = () => (this.listEl.scrollTop = keepTop);
      restore();
      window.setTimeout(restore, 60);
      window.setTimeout(restore, 250);
    }
  }

  /** Start screen of an empty chat: greeting, suggestion cards and the instant commands. */
  private renderWelcome(): void {
    const s = this.plugin.settings;
    const provider = providerOf(s);
    const cur = this.plugin.currentPath();
    const curName = cur ? (cur.split("/").pop() ?? cur).replace(/\.md$/, "") : "";
    const hour = new Date().getHours();
    const greeting = hour < 5 ? "Up late?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const w = this.listEl.createDiv("la-welcome");
    const hero = w.createDiv("la-welcome-hero");
    setIcon(hero.createDiv("la-welcome-mark"), "sparkles");
    hero.createDiv({ cls: "la-welcome-title", text: greeting });
    hero.createDiv({ cls: "la-welcome-sub", text: "Ask about your notes, or tell me what to change." });
    const badge = hero.createDiv({ cls: "la-welcome-badge", attr: { "aria-label": "Change provider" } });
    setIcon(badge.createSpan(), "cpu");
    badge.createSpan({ text: provider.label });
    badge.addEventListener("click", (e) => this.providerMenu(e));

    // [icon, title, subtitle, text, send now?]
    const cards: [string, string, string, string, boolean][] = [
      ...(cur ? ([["file-text", "Summarize", curName, "Summarize this note", true]] as [string, string, string, string, boolean][]) : []),
      ["list-checks", "Open tasks", "What's left to do", "What are my open tasks?", true],
      ["search", "Find in notes", "What did I write about…", "What did I write about ", false],
      ["file-plus", "New note", "I'll suggest the folder", "Create a note about ", false],
      ...(cur ? ([["plus-circle", "Add to note", curName, "/add ", false]] as [string, string, string, string, boolean][]) : []),
      ["calendar-days", "Daily note", "Capture to today", "/daily ", false],
    ];
    // Plain elements, not <button>: Obsidian's button styles would override the theme colors.
    const tappable = (el: HTMLElement, fn: () => void) => {
      el.setAttr("role", "button");
      el.tabIndex = 0;
      el.addEventListener("click", fn);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fn();
        }
      });
    };
    const grid = w.createDiv("la-welcome-grid");
    for (const [icon, title, sub, text, send] of cards) {
      const c = grid.createDiv("la-card");
      setIcon(c.createDiv("la-card-icon"), icon);
      const t = c.createDiv("la-card-text");
      t.createDiv({ cls: "la-card-title", text: title });
      t.createDiv({ cls: "la-card-sub", text: sub });
      tappable(c, () => (send ? void this.plugin.send(text) : this.setDraft(text)));
    }

    const cmds = w.createEl("details", { cls: "la-welcome-cmds" });
    const sum = cmds.createEl("summary");
    setIcon(sum.createSpan("la-cmds-icon"), "zap");
    sum.createSpan({ text: "Instant commands" });
    sum.createSpan({ cls: "la-cmds-hint", text: "no AI, no app switch" });
    const list: [string, string, boolean][] = [
      ["/tasks", "open tasks (/tasks note for one note)", true],
      ["/search ", "search the vault", false],
      ["/read ", "show a note", false],
      ["/add ", "add text to the current note", false],
      ["/new ", "Folder/Title, then the text on a new line", false],
      ["/daily ", "add to today's daily note", false],
      ["/undo", "undo the last change", true],
    ];
    for (const [cmd, desc, send] of list) {
      const row = cmds.createDiv("la-cmd-row");
      row.createSpan({ cls: "la-cmd", text: cmd.trim() });
      row.createSpan({ cls: "la-cmd-desc", text: desc });
      tappable(row, () => (send ? void this.plugin.send(cmd) : this.setDraft(cmd)));
    }
  }

  /** Provider choices (used by the provider pill and the welcome badge). */
  private providerMenu(e: MouseEvent): void {
    const s = this.plugin.settings;
    const menu = new Menu();
    for (const p of Object.values(PROVIDERS)) {
      menu.addItem((i) =>
        i
          .setTitle(p.label)
          .setChecked(p.id === s.provider)
          .setDisabled(this.plugin.busy)
          .onClick(() => void this.plugin.setProvider(p.id))
      );
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Provider settings…").setIcon("settings").onClick(() => this.plugin.openSettings()));
    menu.showAtMouseEvent(e);
  }

  /**
   * Setup tutorial shown in the chat after a provider failure: the provider's steps with the
   * configured Shortcut names, plus buttons to create the Shortcut, test it and retry.
   */
  private renderSetupGuide(providerId: ProviderId, errorText: string): void {
    const s = this.plugin.settings;
    const provider = PROVIDERS[providerId];
    const help = provider.help(s);
    const missing = /could not find the shortcut|not find.*shortcut|did not answer in time/i.test(errorText);
    const name = provider.testShortcut(s);

    const card = this.listEl.createDiv("la-setup");
    const head = card.createDiv("la-setup-head");
    const icon = head.createDiv("la-setup-icon");
    setIcon(icon, "wrench");
    const titles = head.createDiv();
    titles.createDiv({ cls: "la-setup-title", text: missing ? `Set up “${name}”` : `Check your ${provider.label} Shortcut` });
    titles.createDiv({
      cls: "la-setup-sub",
      text: missing
        ? `${provider.label} answers through a Shortcut that doesn't exist yet. It takes about 2 minutes:`
        : "If it keeps failing, compare your Shortcut with these steps:",
    });

    const body = card.createEl("details", { cls: "la-setup-steps" });
    body.open = missing;
    body.createEl("summary", { text: help.title });
    for (const g of help.groups) {
      if (g.heading) body.createDiv({ cls: "la-setup-group", text: g.heading });
      const ol = body.createEl("ol");
      for (const step of g.steps) ol.createEl("li", { text: step });
    }
    if (help.notes.length) {
      const ul = body.createEl("ul", { cls: "la-setup-notes" });
      for (const n of help.notes) ul.createEl("li", { text: n });
    }

    const status = card.createDiv({ cls: "la-setup-status" });
    const actions = card.createDiv("la-setup-actions");
    const btn = (label: string, iconId: string, fn: (b: HTMLButtonElement) => void, cta = false) => {
      const b = actions.createEl("button", { cls: "la-setup-btn" + (cta ? " mod-cta" : "") });
      setIcon(b.createSpan(), iconId);
      b.createSpan({ text: label });
      b.addEventListener("click", () => fn(b));
    };
    if (Platform.isIosApp) btn("Create Shortcut", "plus", () => window.open("shortcuts://create-shortcut"), missing);
    btn("Test", "play", async (b) => {
      b.disabled = true;
      status.setText(`Running “${name}”…`);
      const r = await this.plugin.testProvider();
      status.setText(r.text);
      status.toggleClass("ok", r.ok);
      b.disabled = false;
    });
    btn("Retry", "rotate-ccw", () => void this.plugin.retry(), !missing);
    btn("Settings", "settings", () => this.plugin.openSettings());
  }

  private renderMessage(m: ChatMessage, isLast: boolean): void {
    if (m.role === "tool") {
      const chip = this.listEl.createDiv({ cls: "la-tool " + (m.tool?.ok ? "ok" : "fail") });
      const icon = chip.createSpan("la-tool-icon");
      setIcon(icon, m.tool?.ok ? "check" : "x");
      chip.createSpan({ cls: "la-tool-text", text: m.text });
      const op = m.tool?.opId ? this.plugin.store.getOp(m.tool.opId) : undefined;
      if (op && !op.rolledBack) {
        const undo = chip.createEl("button", { cls: "la-undo", text: "Undo" });
        undo.addEventListener("click", () => void this.plugin.undo(op.id));
      } else if (op?.rolledBack) {
        chip.createSpan({ cls: "la-undone", text: "undone" });
      }
      this.attachMenu(chip, (menu) => this.messageMenu(menu, m, chip, isLast));
      return;
    }
    if (m.role === "error") {
      const row = this.listEl.createDiv("la-row la-assistant");
      const b = row.createDiv("la-bubble la-error");
      b.createSpan({ text: m.text, cls: "la-text" });
      if (m.setupProvider && isLast && !this.plugin.busy) {
        this.attachMenu(b, (menu) => this.messageMenu(menu, m, b, isLast));
        this.renderSetupGuide(m.setupProvider, m.text);
        return;
      }
      if (isLast && !this.plugin.busy) {
        const retry = b.createEl("button", { cls: "la-retry", text: "Retry" });
        retry.addEventListener("click", () => void this.plugin.retry());
      }
      this.attachMenu(b, (menu) => this.messageMenu(menu, m, b, isLast));
      return;
    }
    const row = this.listEl.createDiv("la-row " + (m.role === "user" ? "la-user" : "la-assistant"));
    const bubble = row.createDiv("la-bubble");
    if (m.attachments?.length) {
      const wrap = bubble.createDiv("la-atts");
      for (const a of m.attachments) {
        const file = this.app.vault.getAbstractFileByPath(a.path);
        if (a.kind === "image" && file instanceof TFile) {
          // opened in the image viewer by the click handler on the message list
          wrap.createEl("img", { cls: "la-att-img", attr: { src: this.app.vault.getResourcePath(file), alt: a.name, "data-path": file.path } });
        } else {
          const chip = wrap.createDiv("la-attach-chip");
          const icon = chip.createSpan("la-tool-icon");
          setIcon(icon, "file");
          chip.createSpan({ text: a.name, cls: "la-attach-name" });
          if (file instanceof TFile) chip.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
        }
      }
    }
    if (m.role === "user") {
      if (m.text !== "(attachment)") bubble.createDiv({ text: m.text, cls: "la-text" });
    } else {
      const body = bubble.createDiv("la-text");
      void this.renderAnswer(body, m.text);
    }
    this.attachMenu(bubble, (menu) => this.messageMenu(menu, m, bubble, isLast));
  }

  /**
   * Renders an answer. Vault tasks it lists are drawn as our own checkbox rows (not Obsidian's
   * Markdown checkboxes, which carry their own click handling and layout): the circle checks the
   * task in its note (undoable), the text opens the note at that task. State comes from the note.
   */
  private async renderAnswer(body: HTMLElement, text: string): Promise<void> {
    const mayListTasks = /\.md\s*:\s*\d+|^\s*[-*+]\s+\[[ xX]\]|\{\{\s*tasks?\s*:/im.test(text);
    const tasks = mayListTasks ? await this.plugin.allTasks().catch(() => []) : [];
    const expanded = mayListTasks ? expandTaskEmbeds(text, tasks) : text;
    const linked = mayListTasks ? linkTaskLines(expanded, tasks) : null;
    body.addClass("la-md-body");
    if (!linked) {
      await MarkdownRenderer.render(this.app, expanded, body, "", this);
      polishMarkdown(body);
      return;
    }
    body.addClass("la-tasks");
    let list: HTMLElement | null = null;
    for (const part of linked.parts) {
      if (part.kind === "md") {
        list = null;
        if (part.text.trim()) {
          const el = body.createDiv("la-md");
          await MarkdownRenderer.render(this.app, part.text, el, "", this);
          polishMarkdown(el);
        }
        continue;
      }
      list ??= body.createDiv("la-task-list");
      await this.renderTaskRow(list, part.ref);
    }
  }

  private async renderTaskRow(list: HTMLElement, ref: TaskRef): Promise<void> {
    const row = list.createDiv({ cls: "la-task-row" + (ref.done ? " is-done" : ""), attr: { "data-source": ref.path } });
    const check = row.createDiv({
      cls: "la-check",
      attr: { role: "checkbox", "aria-checked": String(ref.done), tabindex: "0", "aria-label": ref.done ? "Mark as not done" : "Mark as done" },
    });
    const { main, meta } = splitTaskText(ref.text);
    const textEl = row.createDiv("la-task-body");
    const mainEl = textEl.createDiv("la-task-text");
    const hasMd = (s: string) => /\[\[|\*\*|`|\]\(|https?:\/\//.test(s);
    if (hasMd(main)) await MarkdownRenderer.render(this.app, main, mainEl, ref.path, this);
    else mainEl.setText(main);
    if (meta) {
      const metaEl = textEl.createDiv("la-task-meta");
      if (hasMd(meta)) await MarkdownRenderer.render(this.app, meta, metaEl, ref.path, this);
      else metaEl.setText(meta);
    }

    const toggle = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (row.hasClass("is-busy")) return;
      row.addClass("is-busy");
      try {
        ref.done = await this.plugin.toggleTaskRef(ref);
        row.toggleClass("is-done", ref.done);
        check.setAttr("aria-checked", String(ref.done));
        check.setAttr("aria-label", ref.done ? "Mark as not done" : "Mark as done");
      } catch (err: any) {
        new Notice(err?.message ?? String(err));
      } finally {
        row.removeClass("is-busy");
      }
    };
    check.addEventListener("click", toggle);
    check.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") void toggle(e);
    });
    // the bubble's long-press menu must not start from a tap on the circle
    check.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });

    // tapping the task text opens the note scrolled to that task (links inside keep their own behavior)
    textEl.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file, { eState: { line: ref.line - 1 } });
    });
  }
}

/**
 * Makes rendered Markdown fit a chat bubble: tables scroll sideways in their own box instead
 * of squeezing words letter by letter, and bubbles with tables or code use the full width.
 */
function polishMarkdown(el: HTMLElement): void {
  el.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.hasClass("la-table-wrap")) return;
    const wrap = createDiv("la-table-wrap");
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
  if (el.querySelector("table, pre")) el.closest(".la-bubble")?.addClass("la-wide");
}
