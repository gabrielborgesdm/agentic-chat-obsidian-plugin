export type ThemeId = "obsidian" | "cherry" | "graphite" | "ocean" | "sage";
export type ThemeMode = "auto" | "obsidian" | "light" | "dark";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "obsidian", label: "Obsidian (your theme)" },
  { id: "cherry", label: "Cherry" },
  { id: "graphite", label: "Graphite" },
  { id: "ocean", label: "Ocean" },
  { id: "sage", label: "Sage" },
];

export const MODES: { id: ThemeMode; label: string }[] = [
  { id: "auto", label: "Auto (follow the device)" },
  { id: "obsidian", label: "Match Obsidian" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Resolves the mode to light/dark right now. */
export function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (mode === "obsidian") return document.body.classList.contains("theme-dark") ? "dark" : "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Sets the data attributes the CSS themes key off. */
export function applyTheme(el: HTMLElement, theme: ThemeId, mode: ThemeMode): void {
  if (theme === "obsidian") {
    delete el.dataset.laTheme;
    delete el.dataset.laMode;
    return;
  }
  el.dataset.laTheme = theme;
  el.dataset.laMode = resolveMode(mode);
}
