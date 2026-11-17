import { App, FuzzySuggestModal, TFile } from "obsidian";

/** Lets the user choose which note "this note" refers to. */
export class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Which note should the agent work with?");
  }
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  getItemText(f: TFile): string {
    return f.path;
  }
  onChooseItem(f: TFile): void {
    this.onPick(f);
  }
}
