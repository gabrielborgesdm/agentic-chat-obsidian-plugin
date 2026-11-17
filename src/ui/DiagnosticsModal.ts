import { App, Modal, Notice, Platform, Setting } from "obsidian";
import type { ShortcutBridge } from "../ai/ShortcutBridge";
import { parseReply } from "../ai/ResponseParser";

interface TestCase {
  name: string;
  prompt: string;
  check: (out: string) => boolean;
  note?: string;
  /** run through the Private Cloud shortcut instead of the on-device one */
  cloud?: boolean;
}

const pad = (n: number) => ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ").repeat(Math.ceil(n / 57)).slice(0, n);

const TESTS: TestCase[] = [
  {
    name: "1. Round trip (x-success + result)",
    prompt: "Reply with exactly the single word: PONG",
    check: (o) => /pong/i.test(o),
  },
  {
    name: "2. Unicode / accents / emoji",
    prompt: "Repeat this text exactly and nothing else: ação coração 日本語 🙂",
    check: (o) => o.includes("ação") && o.includes("🙂"),
  },
  {
    name: "3. JSON contract with the real model",
    prompt:
      'Reply with ONE JSON object and nothing else, exactly: {"type":"final","message":"hello"}',
    check: (o) => {
      const p = parseReply(o);
      return !p.malformed && p.reply.type === "final";
    },
  },
  {
    name: "4. Payload ~4 KB",
    prompt: pad(4000) + "\n\nIgnore the text above. Reply with exactly: OK",
    check: (o) => /ok/i.test(o),
  },
  {
    name: "5. Payload ~10 KB (may exceed model context)",
    prompt: pad(10000) + "\n\nIgnore the text above. Reply with exactly: OK",
    check: (o) => /ok/i.test(o),
    note: "A failure here can be the model's context limit, not the URL transport.",
  },
  {
    name: "6. Private Cloud shortcut (needs internet)",
    prompt:
      'Reply with ONE JSON object and nothing else, exactly: {"type":"final","message":"cloud ok"}',
    check: (o) => {
      const p = parseReply(o);
      return !p.malformed && p.reply.type === "final";
    },
    note: 'Create the Private Cloud shortcut (see the setup help in settings). Without it the plugin uses the on-device model.',
    cloud: true,
  },
];

export class DiagnosticsModal extends Modal {
  private rows: HTMLElement[] = [];
  private report: string[] = [];
  private running = false;
  private tests: TestCase[];

  /** cloudShortcutName is only given for providers that have a Private Cloud Shortcut (Apple). */
  constructor(
    app: App,
    private bridge: ShortcutBridge | null,
    private providerLabel: string,
    private shortcutName: () => string,
    private cloudShortcutName?: () => string
  ) {
    super(app);
    this.tests = TESTS.filter((t) => !t.cloud || !!cloudShortcutName);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText(`${this.providerLabel}: bridge test`);
    if (!this.bridge || !Platform.isMobile) {
      contentEl.createEl("p", {
        text: "This test needs the iPhone: it calls the real Shortcut. On desktop the plugin uses a mock model instead.",
      });
      return;
    }
    contentEl.createEl("p", {
      text: `Runs ${this.tests.length} checks through the "${this.shortcutName()}" Shortcut. Each one briefly switches to the Shortcuts app and back. Approve the iOS prompts the first time.`,
    });
    const list = contentEl.createDiv("la-diag");
    for (const t of this.tests) {
      const row = list.createDiv("la-diag-row");
      row.createSpan({ text: "⏺ " + t.name });
      this.rows.push(row);
    }
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Cold-start check (manual): run test 1, and while the Shortcuts app is open, force-quit Obsidian from the app switcher. The Shortcut should still finish and reopen Obsidian, which then shows a \"Resuming\" notice.",
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Run tests").setCta().onClick(() => void this.runAll(b.buttonEl)))
      .addButton((b) =>
        b.setButtonText("Copy report").onClick(async () => {
          await navigator.clipboard.writeText(this.report.join("\n"));
          new Notice("Report copied");
        })
      );
  }

  private async runAll(btn: HTMLButtonElement): Promise<void> {
    if (this.running || !this.bridge) return;
    this.running = true;
    btn.disabled = true;
    this.report = [`${this.providerLabel} bridge report ${new Date().toISOString()}`];
    for (let i = 0; i < this.tests.length; i++) {
      const t = this.tests[i];
      const row = this.rows[i];
      row.setText("⏳ " + t.name);
      const t0 = Date.now();
      let line: string;
      try {
        const r = await this.bridge.run(t.cloud && this.cloudShortcutName ? this.cloudShortcutName() : this.shortcutName(), t.prompt);
        const ms = Date.now() - t0;
        const pass = t.check(r.result);
        line = `${pass ? "✅" : "❌"} ${t.name} (${(ms / 1000).toFixed(1)}s, sent ${t.prompt.length} chars)\n   → ${r.result.slice(0, 120).replace(/\n/g, " ")}${!pass && t.note ? "\n   " + t.note : ""}`;
      } catch (e: any) {
        line = `❌ ${t.name}\n   → ${e?.kind ?? "error"}: ${e?.message ?? e}${t.note ? "\n   " + t.note : ""}`;
      }
      row.setText(line);
      row.addClass("la-diag-done");
      this.report.push(line);
    }
    this.running = false;
    btn.disabled = false;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
