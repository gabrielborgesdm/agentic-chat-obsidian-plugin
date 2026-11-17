import { App, Modal, Setting } from "obsidian";

const TITLES: Record<string, string> = {
  create: "Create note?",
  append: "Add to note?",
  edit: "Edit note?",
  rename: "Rename / move note?",
  delete: "Delete note?",
};

/** Resolves true on Approve, false on Reject or dismiss. */
export function askApproval(app: App, permission: string, toolName: string, preview: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ToolApprovalModal(app, permission, toolName, preview, resolve).open();
  });
}

class ToolApprovalModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private permission: string,
    private toolName: string,
    private preview: string,
    private done: (ok: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("la-approval");
    this.titleEl.setText(TITLES[this.permission] ?? "Allow action?");
    contentEl.createEl("p", { text: `The agent wants to run ${this.toolName}.`, cls: "la-approval-sub" });
    contentEl.createEl("pre", { text: this.preview, cls: "la-approval-preview" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Reject").onClick(() => this.finish(false)))
      .addButton((b) =>
        b
          .setButtonText("Approve")
          .setCta()
          .onClick(() => this.finish(true))
      );
  }

  private finish(ok: boolean): void {
    if (this.decided) return;
    this.decided = true;
    this.done(ok);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) {
      this.decided = true;
      this.done(false);
    }
  }
}
