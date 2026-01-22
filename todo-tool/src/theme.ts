export type ThemeId = "retro" | "tech" | "calm" | "vscode";

const knownThemes = new Set<ThemeId>(["retro", "tech", "calm", "vscode"]);

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (!value) return "retro";
  if (knownThemes.has(value as ThemeId)) return value as ThemeId;
  if (value === "light" || value === "dark") return "retro";
  return "retro";
}
