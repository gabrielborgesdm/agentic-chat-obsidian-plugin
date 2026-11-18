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

/** Obsidian color variables the chat theme also lends to the whole app while the chat is in front. */
const APP_VARS = [
  "--background-primary",
  "--background-primary-alt",
  "--background-secondary",
  "--background-secondary-alt",
  "--background-modifier-border",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--text-accent",
  "--interactive-accent",
  "--interactive-accent-hover",
  "--interactive-normal",
  "--interactive-hover",
  "--text-on-accent",
  "--icon-color",
];

/**
 * Paints Obsidian itself (view header, the area behind the hidden bottom bar and its fade)
 * with the chat theme's colors, read from `source`. null restores Obsidian's own colors.
 */
export function paintApp(source: HTMLElement | null): void {
  const body = document.body;
  if (!source) {
    if (!body.hasClass("la-app-painted")) return;
    for (const v of APP_VARS) body.style.removeProperty(v);
    body.removeClass("la-app-painted");
    return;
  }
  const cs = getComputedStyle(source);
  for (const v of APP_VARS) {
    const value = cs.getPropertyValue(v).trim();
    if (value) body.style.setProperty(v, value);
  }
  body.style.setProperty("--icon-color", cs.getPropertyValue("--text-muted").trim());
  body.addClass("la-app-painted");
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
