import { App, SuggestModal } from "obsidian";
import type { Conversation } from "../types";

export class ConversationPicker extends SuggestModal<Conversation> {
  constructor(
    app: App,
    private items: Conversation[],
    private onPick: (c: Conversation) => void
  ) {
    super(app);
    this.setPlaceholder("Switch conversation…");
  }

  getSuggestions(q: string): Conversation[] {
    const s = q.toLowerCase();
    return this.items.filter((c) => c.title.toLowerCase().includes(s));
  }

  renderSuggestion(c: Conversation, el: HTMLElement): void {
    el.createDiv({ text: c.title });
    el.createEl("small", { text: `${new Date(c.updated).toLocaleString()} · ${c.messages.length} messages` });
  }

  onChooseSuggestion(c: Conversation): void {
    this.onPick(c);
  }
}
