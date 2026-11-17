import { Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { AgentLoop, type AgentEvent } from "./ai/AgentLoop";
import { MockBridge } from "./ai/MockBridge";
import { buildPrompt } from "./ai/PromptBuilder";
import { detectFastPath } from "./ai/FastPath";
import { formatToolOutput, parseSlash } from "./ai/SlashCommands";
import { ShortcutBridge } from "./ai/ShortcutBridge";
import { AgentSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, type AgentSettings } from "./settings/defaults";
import { providerOf, sanitizeSettings, type Route, type RouteTier } from "./providers/providers";
import { ConversationStore } from "./storage/ConversationStore";
import { rollbackOperation } from "./storage/OperationLog";
import { buildTools, toolMap } from "./tools/registry";
import { BridgeError, type Attachment, type ToolCall, type Conversation, type ModelBridge, type ScratchEntry, type ToolDef } from "./types";
import { ChatView, VIEW_TYPE } from "./ui/ChatView";
import { DiagnosticsModal } from "./ui/DiagnosticsModal";
import { askApproval } from "./ui/ToolApproval";
import { buildContext } from "./vault/ContextBuilder";
import { speak, stopSpeaking } from "./voice/Voice";
import { VaultService } from "./vault/VaultService";

const CLOUD_PAUSE_MS = 10 * 60 * 1000;

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} (${wd})`;
};

export default class LocalAgentPlugin extends Plugin {
  settings: AgentSettings = { ...DEFAULT_SETTINGS };
  store!: ConversationStore;
  vault2!: VaultService;
  shortcut: ShortcutBridge | null = null;
  private bridge!: ModelBridge;
  private tools: ToolDef[] = [];
  private lastFile: TFile | null = null;
  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();

  busy = false;
  statusLabel = "";

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, await this.loadData()));

    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const file = `${dir}/store.json`;
    const adapter = this.app.vault.adapter;
    this.store = new ConversationStore({
      read: async () => ((await adapter.exists(file)) ? adapter.read(file) : null),
      write: (s) => adapter.write(file, s),
    });
    await this.store.load();

    this.vault2 = new VaultService(this.app);
    this.tools = buildTools(this.vault2);

    if (Platform.isMobile) {
      this.shortcut = new ShortcutBridge({
        getShortcutName: () => this.settings.shortcutName,
        getTimeoutMs: () => this.settings.timeoutSec * 1000,
        vaultName: () => this.app.vault.getName(),
        onOrphan: (info) => void this.handleOrphan(info),
      });
      this.bridge = this.shortcut;
    } else {
      // Desktop has no Shortcuts: use a scripted mock so the UI and tools can be tested on Windows.
      this.bridge = new MockBridge();
    }

    this.registerObsidianProtocolHandler("local-agent", (params) => {
      this.shortcut?.handleCallback(params as Record<string, string>);
    });

    // Deep link: obsidian://local-agent-chat?vault=<vault>[&new=1][&q=<text>[&send=1]]
    this.registerObsidianProtocolHandler("local-agent-chat", (params) => {
      void this.openFromLink(params as Record<string, string>);
    });

    this.lastFile = this.app.workspace.getActiveFile();
    this.registerEvent(
      this.app.workspace.on("file-open", (f) => {
        if (f) {
          this.lastFile = f;
          // opening a note re-attaches note context (unless one is pinned)
          if (!this.pinnedPath) this.noteContextOff = false;
          this.emit();
        }
      })
    );

    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-circle", "Open Local Agent", () => void this.activateView());
    this.addSettingTab(new AgentSettingsTab(this.app, this));

    this.addCommand({ id: "open", name: "Open chat", callback: () => void this.activateView() });
    this.addCommand({
      id: "new-chat",
      name: "New conversation",
      callback: () => {
        this.store.create();
        this.emit();
        void this.activateView();
      },
    });
    this.addCommand({ id: "undo", name: "Undo last change made by the agent", callback: () => void this.undo() });
    this.addCommand({
      id: "resume-cloud",
      name: "Use Private Cloud again",
      callback: () => {
        this.resumeCloud();
        new Notice(`Next request will use "${this.settings.cloudShortcutName}".`);
      },
    });
    this.addCommand({
      id: "test-bridge",
      name: "Test provider (Shortcut round trip)",
      callback: () => this.openDiagnostics(),
    });

    this.app.workspace.onLayoutReady(() => {
      // An interrupted request whose callback never arrived: offer Retry instead of hanging.
      // Wait long enough that a cold-start callback can still arrive and resume the request first.
      window.setTimeout(() => void this.recoverInterrupted(), 15000);
    });
  }

  onunload(): void {
    this.abort?.abort();
    stopSpeaking();
    this.shortcut?.destroy();
    void this.store.flush();
  }

  async saveSettings(): Promise<void> {
    this.cloudPausedUntil = 0; // e.g. the cloud shortcut name was just fixed: try it again
    await this.saveData(this.settings);
  }

  /** Opens the bridge test for the selected provider. */
  openDiagnostics(): void {
    const s = this.settings;
    const apple = s.provider === "apple";
    new DiagnosticsModal(
      this.app,
      this.shortcut,
      providerOf(s).label,
      () => (apple ? s.shortcutName : s.chatgptShortcutName),
      apple ? () => s.cloudShortcutName : undefined
    ).open();
  }

  /** Opens this plugin's page in Obsidian's settings (the setup help lives there). */
  openSettings(): void {
    const setting = (this.app as any).setting;
    if (setting?.open && setting?.openTabById) {
      setting.open();
      setting.openTabById(this.manifest.id);
    } else {
      new Notice(`Open Settings → ${this.manifest.name} for the setup steps.`);
    }
  }

  /** Clears the 10-minute pause after a Private Cloud failure. */
  resumeCloud(): void {
    this.cloudPausedUntil = 0;
    this.lastCloudError = "";
    this.emit();
  }

  /** For the UI: why the cloud model is currently skipped (empty if it isn't). */
  cloudPauseInfo(): string {
    if (this.settings.provider !== "apple" || this.settings.modelMode !== "cloud" || Date.now() >= this.cloudPausedUntil) return "";
    const min = Math.ceil((this.cloudPausedUntil - Date.now()) / 60000);
    return `Private Cloud paused for ${min} min after an error${this.lastCloudError ? `: ${this.lastCloudError}` : ""}`;
  }

  // ---------- view helpers ----------

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  deepLink(extra = ""): string {
    return `obsidian://local-agent-chat?vault=${encodeURIComponent(this.app.vault.getName())}${extra}`;
  }

  private async openFromLink(p: Record<string, string>): Promise<void> {
    if (p.new === "1" && !this.busy) this.store.create();
    await this.activateView();
    const q = (p.q ?? "").trim();
    if (!q) {
      this.emit();
      return;
    }
    if (p.send === "1" && !this.busy) {
      await this.send(q);
    } else {
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (view instanceof ChatView) view.setDraft(q);
    }
  }

  // ---------- model routing ----------

  /** after a Private Cloud failure, skip it for a while to avoid an extra app switch per request */
  private cloudPausedUntil = 0;
  private lastCloudError = "";

  /** A bridge that runs the named Shortcut (on desktop there are no Shortcuts: the mock answers). */
  private bridgeFor(name: string): ModelBridge {
    const sb = this.shortcut;
    if (!sb) return this.bridge;
    return { ask: (p, signal) => sb.run(name, p, signal).then((r) => r.result) };
  }

  /** The selected provider's route: which Shortcut answers, and what it falls back to. */
  private modelRoute(): { primary: RouteTier & { bridge: ModelBridge }; fallback?: RouteTier & { bridge: ModelBridge } } {
    const r: Route = providerOf(this.settings).route(this.settings, Date.now(), this.cloudPausedUntil);
    const withBridge = (t: RouteTier) => ({ ...t, bridge: this.bridgeFor(t.shortcut) });
    return { primary: withBridge(r.primary), fallback: r.fallback && withBridge(r.fallback) };
  }

  // ---------- "this note" ----------

  /** note chosen explicitly in the chat (📄 pill); overrides the last opened note */
  private pinnedPath: string | null = null;
  /** user detached note context entirely */
  private noteContextOff = false;

  currentPath = (): string | null => {
    if (this.noteContextOff) return null;
    const exists = (p: string | null | undefined) => !!p && !!this.app.vault.getAbstractFileByPath(p);
    if (exists(this.pinnedPath)) return this.pinnedPath;
    const f = this.app.workspace.getActiveFile() ?? this.lastFile;
    return f && exists(f.path) ? f.path : null;
  };

  get noteIsPinned(): boolean {
    return !!this.pinnedPath && !this.noteContextOff;
  }

  pinNote(path: string | null): void {
    this.pinnedPath = path;
    this.noteContextOff = false;
    this.emit();
  }

  detachNote(): void {
    this.noteContextOff = true;
    this.pinnedPath = null;
    this.emit();
  }

  private resolveNote = (name: string): string | null => this.vault2.resolve(name)?.path ?? null;

  // ---------- message actions (long-press menu) ----------

  /** Appends text to the current note, recorded so it can be undone. */
  async appendToCurrent(text: string): Promise<void> {
    const path = this.currentPath();
    if (!path) {
      new Notice("No note is open. Pick one with the 📄 button above the input.");
      return;
    }
    await this.runDirectFromUi([{ name: "append_to_note", arguments: { path, content: text } }]);
  }

  /** Saves text as a new note next to Obsidian's default new-note location and opens it. */
  async saveAsNote(text: string): Promise<void> {
    const firstLine = text.split("\n").find((l) => l.trim()) ?? "Local Agent";
    const title =
      firstLine
        .replace(/[#*_`>[\]|<>:"/\\?]/g, "")
        .trim()
        .slice(0, 50) || "Local Agent";
    const parent = this.app.fileManager.getNewFileParent(this.currentPath() ?? "");
    const base = (parent.path && parent.path !== "/" ? parent.path + "/" : "") + title;
    let path = base + ".md";
    for (let n = 1; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} (${n}).md`;
    await this.runDirectFromUi([{ name: "create_note", arguments: { path, content: text } }]);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f);
  }

  deleteMessage(id: string): void {
    const conv = this.store.active();
    conv.messages = conv.messages.filter((m) => m.id !== id);
    void this.store.save();
    this.emit();
  }

  private async runDirectFromUi(calls: ToolCall[]): Promise<void> {
    if (this.busy) {
      new Notice("Wait for the current request to finish.");
      return;
    }
    await this.runLoop(this.store.active(), undefined, calls, { silent: true });
  }

  // ---------- conversation actions ----------

  /** Saves picked/pasted files into the vault so the agent can link or read them. */
  async saveFiles(files: File[]): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const f of files) {
      try {
        const name = f.name || `Pasted file ${Date.now()}`;
        const saved = await this.vault2.saveAttachment(this.settings.attachmentFolder, name, await f.arrayBuffer());
        out.push({ path: saved.path, name: saved.name, kind: VaultService.kindOf(saved.name), size: f.size });
      } catch (e: any) {
        new Notice(`Could not attach ${f.name}: ${e?.message ?? e}`, 6000);
      }
    }
    return out;
  }

  async send(text: string, attachments: Attachment[] = []): Promise<void> {
    if (this.busy) return;
    const conv = this.store.active();
    const msg = this.store.add(conv, { role: "user", text: text || "(attachment)" });
    if (attachments.length) msg.attachments = attachments;

    // 1) Slash commands: instant, deterministic, no model.
    const slash = parseSlash(text, this.currentPath());
    if (slash) {
      if (slash.kind === "message") {
        this.store.add(conv, { role: "assistant", text: slash.text });
        this.emit();
      } else if (slash.kind === "undo") {
        await this.undo();
        this.store.add(conv, { role: "assistant", text: "Undo requested (see the notice)." });
        this.emit();
      } else {
        await this.runLoop(conv, undefined, slash.calls);
      }
      return;
    }
    // 2) Common write requests are handled deterministically instead of trusting the small model.
    const direct = detectFastPath(text, attachments, this.currentPath(), this.resolveNote);
    await this.runLoop(conv, undefined, direct ?? undefined);
  }

  async retry(): Promise<void> {
    if (this.busy) return;
    const conv = this.store.active();
    // Drop the error bubble(s) but KEEP tool results: a change that already happened must not be
    // repeated (e.g. appending the same text twice). The model sees them as "Already done".
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role === "error") conv.messages.pop();
    let i = conv.messages.length - 1;
    while (i >= 0 && conv.messages[i].role === "tool") i--;
    const last = conv.messages[i];
    if (!last || last.role !== "user") {
      this.emit();
      return;
    }
    const alreadyChanged = conv.messages.slice(i + 1).some((m) => m.tool?.ok && m.tool.opId);
    const direct = alreadyChanged ? null : detectFastPath(last.text, last.attachments ?? [], this.currentPath(), this.resolveNote);
    await this.runLoop(conv, undefined, direct ?? undefined);
  }

  stop(): void {
    this.abort?.abort();
  }

  async undo(opId?: string): Promise<void> {
    const op = opId ? this.store.getOp(opId) : this.store.lastUndoable();
    if (!op) {
      new Notice("Nothing to undo.");
      return;
    }
    try {
      const msg = await rollbackOperation(op, this.vault2);
      op.rolledBack = true;
      void this.store.save();
      new Notice(msg);
    } catch (e: any) {
      new Notice("Undo failed: " + (e?.message ?? e), 6000);
    }
    this.emit();
  }

  // ---------- agent ----------

  private async runLoop(
    conv: Conversation,
    resume?: { scratch: ScratchEntry[]; step: number; injected: string },
    direct?: ToolCall[],
    opts: { silent?: boolean } = {}
  ): Promise<void> {
    // Messages created during this run (tool chips) are sent via the scratchpad, not the history.
    const historyEnd = conv.messages.length;
    this.busy = true;
    this.statusLabel = "Thinking…";
    this.abort = new AbortController();
    this.emit();
    try {
      const lastUser = [...conv.messages].reverse().find((m) => m.role === "user");
      let context = await buildContext(this.vault2, lastUser?.text ?? "", this.currentPath(), {
        retrieve: this.settings.autoRetrieve,
      });
      const excerpts: string[] = [];
      for (const a of lastUser?.attachments ?? []) {
        if (a.kind !== "text") continue;
        const t = await this.vault2.textExcerpt(a.path, 1500);
        if (t) excerpts.push(`Attached ${a.path}:\n${t}`);
      }
      // Exact, copy-ready tool calls work far better than prose with a small model.
      const cur = this.currentPath();
      for (const a of lastUser?.attachments ?? []) {
        const emb = a.kind === "image" ? `![[${a.path}]]` : `[[${a.path}]]`;
        excerpts.push(
          `To put attachment ${a.path} into a note, reply exactly: {"type":"tool_calls","calls":[{"name":"append_to_note","arguments":{"path":"${cur ?? "<note path>"}","content":"${emb}"}}]}`
        );
      }
      if (excerpts.length) context = excerpts.join("\n\n") + (context ? "\n\n" + context : "");
      const route = this.modelRoute();
      const agent = new AgentLoop({
        bridge: route.primary.bridge,
        fallbackBridge: route.fallback?.bridge,
        tools: toolMap(this.tools),
        settings: this.settings,
        toolCtx: { currentPath: this.currentPath },
        buildPrompt: (scratch, note, tier) =>
          buildPrompt({
            settings: {
              ...this.settings,
              promptCharBudget: (tier === "primary" ? route.primary : route.fallback ?? route.primary).budget,
            },
            tools: this.tools,
            history: conv.messages.slice(0, historyEnd).filter((m) => m.role !== "error"),
            summary: conv.summary,
            context,
            scratch,
            note,
            today: today(),
          }),
        approve: (_call, tool, preview) => {
          this.statusLabel = "Waiting for your approval…";
          this.emit();
          return askApproval(this.app, tool.permission, tool.name, preview);
        },
        onEvent: (e) => {
          if (e.kind === "thinking") {
            const label = (e.tier === "primary" ? route.primary : route.fallback ?? route.primary).label;
            this.statusLabel = `Thinking${e.step ? ` (step ${e.step + 1})` : ""} · ${label}…`;
            this.emit();
            return;
          }
          if (e.kind === "fallback") {
            // Don't keep bouncing to a cloud model that just failed (offline, missing shortcut...).
            if (route.primary.pausable) {
              this.cloudPausedUntil = Date.now() + CLOUD_PAUSE_MS;
              this.lastCloudError = e.reason;
              new Notice(
                `"${route.primary.shortcut}" failed, using the on-device model for 10 min.\n${e.reason}\n(Command: "Use Private Cloud again" to retry now.)`,
                8000
              );
            } else {
              new Notice(`"${route.primary.shortcut}" failed, using the on-device model for this request.\n${e.reason}`, 8000);
            }
            return;
          }
          this.onAgentEvent(conv, e);
        },
        persistPending: (scratch, step) =>
          this.store.setPending({
            rid: "",
            convId: conv.id,
            scratch: scratch.map((s) => ({ call: s.call, result: s.result.slice(0, 1500) })),
            step,
            ts: Date.now(),
          }),
      });
      const res = direct
        ? await agent.runDirect(direct, formatToolOutput)
        : await agent.run({
            signal: this.abort.signal,
            scratch: resume?.scratch,
            startStep: resume?.step,
            injectedFirstReply: resume?.injected,
          });
      if (!opts.silent) this.store.add(conv, { role: "assistant", text: res.message });
      else new Notice(res.message.replace(/[✅⚠️]/gu, "").trim(), 5000);
      this.store.compact(conv);
      if (this.settings.autoSpeak && !opts.silent && !direct) speak(res.message, this.settings.voiceLanguage);
    } catch (e: any) {
      const kind = e instanceof BridgeError ? e.kind : "error";
      const provider = providerOf(this.settings);
      const text =
        kind === "cancelled"
          ? "Stopped."
          : kind === "timeout"
            ? `${provider.label} did not answer in time. Check that the Shortcut exists and runs on its own, then retry.`
            : e?.message ?? String(e);
      // A missing or broken Shortcut shows up as a timeout, an error or an empty reply: offer the setup help.
      const needsSetup = e instanceof BridgeError && kind !== "cancelled";
      this.store.add(conv, { role: "error", text, ...(needsSetup ? { setupProvider: provider.id } : {}) });
    } finally {
      this.busy = false;
      this.statusLabel = "";
      this.abort = null;
      await this.store.setPending(null);
      this.emit();
    }
  }

  private onAgentEvent(conv: Conversation, e: AgentEvent): void {
    switch (e.kind) {
      case "tool_start":
        this.statusLabel = `Running ${e.call.name}…`;
        break;
      case "tool_end": {
        if (e.op) this.store.addOp(e.op);
        const first = Object.values(e.call.arguments).find((v) => typeof v === "string") as string | undefined;
        const arg = first ? `(${first.replace(/\s+/g, " ").slice(0, 40)}${first.length > 40 ? "…" : ""})` : "()";
        const detail = e.ok ? "" : ` — ${e.output.slice(0, 120)}`;
        this.store.add(conv, {
          role: "tool",
          text: `${e.call.name}${arg}${detail}`,
          tool: { name: e.call.name, args: e.call.arguments, ok: e.ok, opId: e.op?.id },
        });
        break;
      }
      case "tool_rejected":
        this.store.add(conv, {
          role: "tool",
          text: `${e.call.name}: rejected by you`,
          tool: { name: e.call.name, args: e.call.arguments, ok: false },
        });
        break;
    }
    this.emit();
  }

  // ---------- resume after the app was killed ----------

  private async handleOrphan(info: { rid: string; status: string; result: string }): Promise<void> {
    const p = this.store.data.pending;
    if (!p || this.busy) return;
    const conv = this.store.get(p.convId);
    if (info.status !== "success" || !info.result.trim() || !conv || Date.now() - p.ts > 60 * 60 * 1000) {
      await this.store.setPending(null);
      return;
    }
    new Notice("Local Agent: resuming your request…");
    void this.activateView();
    await this.runLoop(conv, { scratch: p.scratch, step: p.step, injected: info.result });
  }

  private async recoverInterrupted(): Promise<void> {
    const p = this.store.data.pending;
    if (!p || this.busy) return;
    const conv = this.store.get(p.convId);
    await this.store.setPending(null);
    if (conv) {
      this.store.add(conv, { role: "error", text: `The app restarted while waiting for ${providerOf(this.settings).label}.` });
      this.emit();
    }
  }
}
