import { ItemView, MarkdownRenderer, Menu, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type LocalAgentPlugin from "../main";
import type { Attachment, ChatMessage } from "../types";
import { ConversationPicker } from "./ConversationPicker";
import { NotePicker } from "./NotePicker";
import { PROVIDERS, providerOf } from "../providers/providers";
import { canSpeak, isSpeaking, speak, stopSpeaking } from "../voice/Voice";

export const VIEW_TYPE = "local-agent-chat";
const LONG_PRESS_MS = 450;

export class ChatView extends ItemView {
  private listEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private strip!: HTMLElement;
  private ctxBar!: HTMLElement;
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
    const mk = (icon: string, label: string, fn: () => void) => {
      const b = actions.createEl("button", { cls: "la-icon-btn clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", fn);
    };
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
      const a = (e.target as HTMLElement).closest("a.internal-link") as HTMLAnchorElement | null;
      if (a) {
        e.preventDefault();
        void this.app.workspace.openLinkText(a.getAttribute("data-href") ?? a.getAttribute("href") ?? "", "", false);
      }
    });

    this.ctxBar = root.createDiv("la-ctx");
    this.strip = root.createDiv("la-attach-strip");
    const composer = root.createDiv("la-composer");

    this.fileInput = composer.createEl("input", { attr: { type: "file", multiple: "true", style: "display:none" } });
    this.fileInput.addEventListener("change", () => {
      const files = Array.from(this.fileInput.files ?? []);
      this.fileInput.value = "";
      void this.addFiles(files);
    });
    const attachBtn = composer.createEl("button", { cls: "la-mic clickable-icon", attr: { "aria-label": "Attach files or photos" } });
    setIcon(attachBtn, "paperclip");
    attachBtn.addEventListener("click", () => this.fileInput.click());

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
    this.render();
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

  private renderCtx(): void {
    this.ctxBar.empty();
    const path = this.plugin.currentPath();
    const pill = this.ctxBar.createDiv({ cls: "la-ctx-pill" + (path ? "" : " off") });
    const icon = pill.createSpan("la-tool-icon");
    setIcon(icon, path ? (this.plugin.noteIsPinned ? "pin" : "file-text") : "file-x");
    pill.createSpan({
      cls: "la-ctx-name",
      text: path ? (path.split("/").pop() ?? path).replace(/\.md$/, "") : "No note — tap to choose",
    });
    pill.setAttr("aria-label", path ? `"This note" = ${path}. Tap to change.` : "Choose a note");
    pill.addEventListener("click", () => new NotePicker(this.app, (f) => this.plugin.pinNote(f.path)).open());
    if (path) {
      const x = this.ctxBar.createEl("button", { cls: "la-ctx-x clickable-icon", attr: { "aria-label": "Don't use a note" } });
      setIcon(x, "x");
      x.addEventListener("click", () => this.plugin.detachNote());
    }
    const paused = this.plugin.cloudPauseInfo();
    if (paused) {
      const warn = this.ctxBar.createDiv({ cls: "la-ctx-pill la-ctx-warn", attr: { "aria-label": paused + ". Tap to retry now." } });
      const wi = warn.createSpan("la-tool-icon");
      setIcon(wi, "cloud-off");
      warn.createSpan({ cls: "la-ctx-name", text: "on-device · tap for Cloud" });
      warn.addEventListener("click", () => {
        new Notice(paused);
        this.plugin.resumeCloud();
      });
    }
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
    if (hasText) menu.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => void this.copy(m.text)));

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

  render(): void {
    if (!this.listEl) return;
    const conv = this.plugin.store.active();
    this.titleEl2.setText(conv.title);
    this.listEl.empty();
    this.renderCtx();

    if (!conv.messages.length) {
      const empty = this.listEl.createDiv("la-empty");
      empty.createEl("h3", { text: "Local Agent" });
      empty.createEl("p", { text: providerOf(this.plugin.settings).tagline });
      const cur = this.plugin.currentPath();
      const examples: [string, boolean][] = [
        ...(cur ? ([["Summarize this note", true]] as [string, boolean][]) : []),
        ["/tasks", true],
        ["What did I write about travel?", true],
        ["/add ", false],
        ["/help", true],
      ];
      for (const [ex, send] of examples) {
        const chip = empty.createEl("button", { cls: "la-suggestion", text: ex.trim() });
        chip.addEventListener("click", () => {
          if (send) void this.plugin.send(ex);
          else this.setDraft(ex);
        });
      }
      empty.createEl("p", { cls: "la-hint", text: "Press and hold a message for options." });
    }

    conv.messages.forEach((m, i) => this.renderMessage(m, i === conv.messages.length - 1));

    if (this.plugin.busy) {
      const row = this.listEl.createDiv("la-row la-assistant");
      const b = row.createDiv("la-bubble la-typing");
      b.createSpan({ cls: "la-dot" });
      b.createSpan({ cls: "la-dot" });
      b.createSpan({ cls: "la-dot" });
      if (this.plugin.statusLabel) b.createSpan({ cls: "la-status", text: this.plugin.statusLabel });
    }

    this.sendBtn.empty();
    setIcon(this.sendBtn, this.plugin.busy ? "square" : "arrow-up");
    this.sendBtn.setAttr("aria-label", this.plugin.busy ? "Stop" : "Send");
    this.listEl.scrollTop = this.listEl.scrollHeight;
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
        const setup = b.createEl("button", { cls: "la-retry", text: `Set up ${PROVIDERS[m.setupProvider].label}` });
        setup.addEventListener("click", () => this.plugin.openSettings());
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
          const img = wrap.createEl("img", { cls: "la-att-img", attr: { src: this.app.vault.getResourcePath(file), alt: a.name } });
          img.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
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
      void MarkdownRenderer.render(this.app, m.text, body, "", this);
    }
    this.attachMenu(bubble, (menu) => this.messageMenu(menu, m, bubble, isLast));
  }
}
