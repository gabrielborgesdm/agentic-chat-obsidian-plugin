import { BridgeError, type ModelBridge } from "../types";

export interface BridgeOptions {
  getShortcutName: () => string;
  getTimeoutMs: () => number;
  vaultName: () => string;
  /** opens a URL (window.open on device; injectable for tests) */
  openUrl?: (url: string) => void;
  /** a callback arrived for a request this session does not know (app was killed/reloaded) */
  onOrphan: (info: { rid: string; status: string; result: string }) => void;
}

interface Pending {
  resolve: (s: string) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
  wentHidden: boolean;
}

const GRACE_MS = 20000;

/**
 * Talks to an iOS Shortcut via x-callback-url:
 *   shortcuts://x-callback-url/run-shortcut?name=..&input=text&text=<prompt>
 *       &x-success=obsidian://local-agent?rid=..&status=success   (Shortcuts appends &result=<output>)
 *       &x-cancel=...&status=cancel  &x-error=...&status=error
 * Obsidian receives it through registerObsidianProtocolHandler("local-agent").
 */
export class ShortcutBridge implements ModelBridge {
  private pending = new Map<string, Pending>();
  private onVis = () => this.visibilityChanged();

  constructor(private o: BridgeOptions) {
    document.addEventListener("visibilitychange", this.onVis);
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.onVis);
    for (const [rid, p] of this.pending) this.settle(rid, p, new BridgeError("cancelled", "Plugin unloaded"));
  }

  ask(prompt: string, signal?: AbortSignal): Promise<string> {
    return this.run(this.o.getShortcutName(), prompt, signal).then((r) => r.result);
  }

  /** Runs any shortcut with text input and returns its output text. */
  run(shortcut: string, text: string, signal?: AbortSignal): Promise<{ rid: string; result: string }> {
    const rid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new BridgeError("cancelled", "Cancelled"));
      const timer = setTimeout(() => {
        const p = this.pending.get(rid);
        if (p) this.settle(rid, p, new BridgeError("timeout", "The Shortcut did not respond in time."));
      }, this.o.getTimeoutMs());
      this.pending.set(rid, {
        resolve: (result) => resolve({ rid, result }),
        reject,
        timer,
        wentHidden: false,
      });
      signal?.addEventListener("abort", () => {
        const p = this.pending.get(rid);
        if (p) this.settle(rid, p, new BridgeError("cancelled", "Cancelled"));
      });
      try {
        (this.o.openUrl ?? ((u) => void window.open(u)))(this.buildUrl(rid, shortcut, text));
      } catch (e: any) {
        const p = this.pending.get(rid);
        if (p) this.settle(rid, p, new BridgeError("error", "Could not open Shortcuts: " + (e?.message ?? e)));
      }
    });
  }

  buildUrl(rid: string, shortcut: string, text: string): string {
    const cb = (status: string) =>
      `obsidian://local-agent?vault=${encodeURIComponent(this.o.vaultName())}&rid=${rid}&status=${status}`;
    return (
      "shortcuts://x-callback-url/run-shortcut" +
      `?name=${encodeURIComponent(shortcut)}` +
      "&input=text" +
      `&text=${encodeURIComponent(text)}` +
      `&x-success=${encodeURIComponent(cb("success"))}` +
      `&x-cancel=${encodeURIComponent(cb("cancel"))}` +
      `&x-error=${encodeURIComponent(cb("error"))}`
    );
  }

  /** Called by the obsidian:// protocol handler. */
  handleCallback(params: Record<string, string>): void {
    const rid = params.rid ?? "";
    const status = params.status ?? "success";
    const result = params.result ?? "";
    const p = this.pending.get(rid);
    if (!p) {
      this.o.onOrphan({ rid, status, result });
      return;
    }
    if (status === "cancel") this.settle(rid, p, new BridgeError("cancelled", "Shortcut was cancelled."));
    else if (status === "error")
      this.settle(rid, p, new BridgeError("error", `The Shortcut reported an error${params.errorMessage ? ": " + params.errorMessage : "."}`));
    else if (!result.trim())
      this.settle(
        rid,
        p,
        new BridgeError("no-response", 'The Shortcut returned no text. Check that it ends with "Stop and Output" of the model response.')
      );
    else this.settle(rid, p, result);
  }

  private settle(rid: string, p: Pending, v: string | Error): void {
    clearTimeout(p.timer);
    if (p.grace) clearTimeout(p.grace);
    this.pending.delete(rid);
    if (typeof v === "string") p.resolve(v);
    else p.reject(v);
  }

  /**
   * When Obsidian comes back to the foreground without a callback (user
   * dismissed the Shortcuts app, or the callback was dropped), fail soon so the
   * UI can offer Retry instead of waiting for the full timeout.
   */
  private visibilityChanged(): void {
    const hidden = document.visibilityState === "hidden";
    for (const [rid, p] of this.pending) {
      if (hidden) {
        p.wentHidden = true;
      } else if (p.wentHidden) {
        if (p.grace) clearTimeout(p.grace);
        p.grace = setTimeout(() => {
          const cur = this.pending.get(rid);
          if (cur) this.settle(rid, cur, new BridgeError("no-response", "Came back from Shortcuts without a response. Tap Retry."));
        }, GRACE_MS);
      }
    }
  }
}
