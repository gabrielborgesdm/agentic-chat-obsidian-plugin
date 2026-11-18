import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";
import { ensureMd, parentFolder } from "../vault/paths";

const ROOT_LABEL = "Vault root";
const OTHER = "\u0000other";

export interface CreateLocationInput {
  /** path the model proposed */
  path: string;
  content: string;
  /** folders holding similar notes, best first ("" = root) */
  suggestions: string[];
  /** every folder in the vault */
  folders: string[];
}

/**
 * Shows where a new note will go and lets the user accept it, pick another folder or rename it.
 * Resolves to the final path, or null if cancelled.
 */
export function askCreateLocation(app: App, input: CreateLocationInput): Promise<string | null> {
  return new Promise((resolve) => new CreateNoteModal(app, input, resolve).open());
}

class CreateNoteModal extends Modal {
  private decided = false;
  private folder: string;
  private name: string;
  private suggested: string[];

  constructor(app: App, private input: CreateLocationInput, private done: (path: string | null) => void) {
    super(app);
    const proposed = parentFolder(input.path);
    // Prefer the model's folder; if it fell back to the root, use the folder of similar notes instead.
    this.folder = proposed || input.suggestions[0] || "";
    this.name = (input.path.split("/").pop() ?? input.path).replace(/\.md$/i, "");
    this.suggested = [...new Set([this.folder, proposed, ...input.suggestions])];
  }

  onOpen(): void {
    this.titleEl.setText("Create note?");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("la-approval");

    new Setting(contentEl).setName("Name").addText((t) =>
      t.setValue(this.name).onChange((v) => {
        this.name = v;
      })
    );

    new Setting(contentEl)
      .setName("Folder")
      .setDesc(this.suggested.length > 1 ? "Suggested from where similar notes are." : "")
      .addDropdown((d) => {
        for (const f of this.suggested) d.addOption(f, f || ROOT_LABEL);
        if (!this.suggested.includes(this.folder)) d.addOption(this.folder, this.folder || ROOT_LABEL);
        d.addOption(OTHER, "Other folder…");
        d.setValue(this.folder).onChange((v) => {
          if (v !== OTHER) {
            this.folder = v;
            return;
          }
          d.setValue(this.folder);
          new FolderPicker(this.app, ["", ...this.input.folders], (f) => {
            this.folder = f;
            if (!this.suggested.includes(f)) this.suggested.push(f);
            this.render();
          }).open();
        });
      });

    if (this.input.content.trim()) {
      const text = this.input.content.length > 800 ? this.input.content.slice(0, 800) + "…" : this.input.content;
      contentEl.createEl("pre", { text, cls: "la-approval-preview" });
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
      .addButton((b) =>
        b
          .setButtonText("Create")
          .setCta()
          .onClick(() => {
            const name = this.name.trim().replace(/^\/+|\/+$/g, "") || "Untitled";
            this.finish(ensureMd((this.folder ? this.folder + "/" : "") + name));
          })
      );
  }

  private finish(path: string | null): void {
    if (this.decided) return;
    this.decided = true;
    this.done(path);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) {
      this.decided = true;
      this.done(null);
    }
  }
}

class FolderPicker extends FuzzySuggestModal<string> {
  constructor(app: App, private folders: string[], private onPick: (f: string) => void) {
    super(app);
    this.setPlaceholder("Choose a folder");
  }
  getItems(): string[] {
    return this.folders;
  }
  getItemText(f: string): string {
    return f || ROOT_LABEL;
  }
  onChooseItem(f: string): void {
    this.onPick(f);
  }
}
