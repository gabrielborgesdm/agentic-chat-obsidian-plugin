import { App, FileSystemAdapter, Menu, Notice, Platform, TFile, setIcon } from "obsidian";

export interface ViewerImage {
  src: string;
  name: string;
  /** the vault file, when the image is in the vault (enables the file options) */
  file?: TFile;
}

const MIN = 1;
const MAX = 8;

/**
 * Full-screen image viewer: pinch / scroll to zoom, drag to pan, double tap to zoom in or out.
 * The ⋯ button offers file actions (open in Obsidian, copy folder path, show in folder, open with app).
 */
export function openImageViewer(app: App, image: ViewerImage): void {
  new ImageViewer(app, image).open();
}

class ImageViewer {
  private root!: HTMLElement;
  private stage!: HTMLElement;
  private img!: HTMLImageElement;
  private scale = 1;
  private x = 0;
  private y = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; scale: number; mid: { x: number; y: number }; x: number; y: number } | null = null;
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private lastTap = 0;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
  };

  constructor(private app: App, private image: ViewerImage) {}

  open(): void {
    this.root = document.body.createDiv("la-viewer");
    const bar = this.root.createDiv("la-viewer-bar");
    const back = bar.createEl("button", { cls: "la-viewer-btn la-viewer-back", attr: { "aria-label": "Back" } });
    setIcon(back.createSpan(), "chevron-left");
    back.createSpan({ text: "Back" });
    back.addEventListener("click", () => this.close());
    bar.createDiv({ cls: "la-viewer-title", text: this.image.name });
    const more = bar.createEl("button", { cls: "la-viewer-btn", attr: { "aria-label": "Options" } });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (e) => this.options(e));

    this.stage = this.root.createDiv("la-viewer-stage");
    this.img = this.stage.createEl("img", { cls: "la-viewer-img", attr: { src: this.image.src, alt: this.image.name, draggable: "false" } });

    this.stage.addEventListener("pointerdown", (e) => this.down(e));
    this.stage.addEventListener("pointermove", (e) => this.move(e));
    this.stage.addEventListener("pointerup", (e) => this.up(e));
    this.stage.addEventListener("pointercancel", (e) => this.up(e));
    this.stage.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.stage.addEventListener("dblclick", (e) => this.toggleZoom(e.clientX, e.clientY));
    document.addEventListener("keydown", this.onKey);
    requestAnimationFrame(() => this.root.addClass("is-open"));
  }

  /** Shrinks and fades the viewer away, back to the chat. */
  close(): void {
    if (this.closing) return;
    this.closing = true;
    document.removeEventListener("keydown", this.onKey);
    this.root.removeClass("is-open");
    this.root.addClass("is-closing");
    this.root.style.removeProperty("--la-viewer-dim");
    window.setTimeout(() => this.root.remove(), 220);
  }
  private closing = false;

  // ---------- options ----------

  private options(e: MouseEvent): void {
    const menu = new Menu();
    const file = this.image.file;
    const app = this.app as any;
    if (file) {
      menu.addItem((i) =>
        i.setTitle("Open in Obsidian").setIcon("file-image").onClick(() => {
          this.close();
          void this.app.workspace.getLeaf("tab").openFile(file);
        })
      );
      menu.addItem((i) => i.setTitle("Copy folder path").setIcon("folder").onClick(() => void this.copyFolderPath(file)));
      if (Platform.isDesktopApp && typeof app.showInFolder === "function") {
        menu.addItem((i) =>
          i.setTitle(Platform.isMacOS ? "Show in Finder" : "Show in file explorer").setIcon("folder-open").onClick(() => app.showInFolder(file.path))
        );
      }
      if (typeof app.openWithDefaultApp === "function") {
        menu.addItem((i) =>
          i.setTitle("Open with app").setIcon("external-link").onClick(() => {
            try {
              app.openWithDefaultApp(file.path);
            } catch (err: any) {
              new Notice("Could not open it: " + (err?.message ?? err));
            }
          })
        );
      }
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle("Reset zoom").setIcon("maximize").onClick(() => this.set(1, 0, 0, true)));
    menu.showAtMouseEvent(e);
  }

  /** Full folder path on desktop (for the file explorer); vault-relative on mobile. */
  private async copyFolderPath(file: TFile): Promise<void> {
    const folder = file.parent?.path && file.parent.path !== "/" ? file.parent.path : "";
    const adapter = this.app.vault.adapter;
    const text =
      adapter instanceof FileSystemAdapter ? adapter.getFullPath(folder) || adapter.getBasePath() : folder || "/";
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`Copied: ${text}`);
    } catch {
      new Notice("Could not copy the path.");
    }
  }

  // ---------- zoom / pan ----------

  private set(scale: number, x: number, y: number, animate = false): void {
    this.scale = Math.min(MAX, Math.max(MIN, scale));
    if (this.scale === MIN) {
      x = 0;
      y = 0;
    }
    // keep the image covering the stage: no panning past its edges
    const w = this.img.offsetWidth * this.scale;
    const h = this.img.offsetHeight * this.scale;
    const mx = Math.max(0, (w - this.stage.clientWidth) / 2);
    const my = Math.max(0, (h - this.stage.clientHeight) / 2);
    this.x = Math.min(mx, Math.max(-mx, x));
    this.y = Math.min(my, Math.max(-my, y));
    this.img.toggleClass("is-animating", animate);
    this.img.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.stage.toggleClass("is-zoomed", this.scale > 1);
  }

  /** Point relative to the stage center. */
  private rel(cx: number, cy: number): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
  }

  /** Zooms to `scale` keeping the point under (cx, cy) still. */
  private zoomAt(scale: number, cx: number, cy: number, animate = false): void {
    const s = Math.min(MAX, Math.max(MIN, scale));
    const p = this.rel(cx, cy);
    const k = s / this.scale;
    this.set(s, p.x - (p.x - this.x) * k, p.y - (p.y - this.y) * k, animate);
  }

  private toggleZoom(cx: number, cy: number): void {
    if (this.scale > 1) this.set(1, 0, 0, true);
    else this.zoomAt(2.5, cx, cy, true);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoomAt(this.scale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
  }

  private down(e: PointerEvent): void {
    this.stage.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: this.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        x: this.x,
        y: this.y,
      };
    } else if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, tx: this.x, ty: this.y, moved: false };
    }
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.gesture && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const g = this.gesture;
      const s = Math.min(MAX, Math.max(MIN, (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // zoom around the starting midpoint, then follow the fingers as they move
      const p = this.rel(g.mid.x, g.mid.y);
      const k = s / g.scale;
      this.set(s, p.x - (p.x - g.x) * k + (mid.x - g.mid.x), p.y - (p.y - g.y) * k + (mid.y - g.mid.y));
      return;
    }
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.drag.moved = true;
      if (this.scale > 1) this.set(this.scale, this.drag.tx + dx, this.drag.ty + dy);
      else if (e.pointerType !== "mouse" && dy > 0) {
        // not zoomed: swipe down to dismiss (the image follows the finger, the backdrop fades)
        this.img.removeClass("is-animating");
        this.img.style.transform = `translate(${dx * 0.4}px, ${dy}px) scale(${Math.max(0.75, 1 - dy / 1200)})`;
        this.root.style.setProperty("--la-viewer-dim", String(Math.max(0.25, 1 - dy / 400)));
      }
    }
  }

  /** Ends a swipe-down: dismiss if it went far enough, otherwise snap back. */
  private endSwipe(dy: number): boolean {
    if (this.scale > 1) return false;
    if (dy > 110) {
      this.close();
      return true;
    }
    this.root.style.removeProperty("--la-viewer-dim");
    this.set(1, 0, 0, true);
    return false;
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (this.pointers.size === 1) {
      // one finger left after a pinch: continue as a pan from here
      const [p] = [...this.pointers.values()];
      this.drag = { x: p.x, y: p.y, tx: this.x, ty: this.y, moved: true };
      return;
    }
    if (this.pointers.size > 0 || !this.drag) return;
    const tap = !this.drag.moved;
    const dy = e.clientY - this.drag.y;
    this.drag = null;
    if (!tap && e.pointerType !== "mouse" && this.endSwipe(dy)) return;
    if (!tap || e.pointerType === "mouse") return; // mouse uses dblclick
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.lastTap = 0;
      this.toggleZoom(e.clientX, e.clientY);
    } else {
      this.lastTap = now;
    }
  }
}
