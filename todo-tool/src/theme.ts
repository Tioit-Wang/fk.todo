export type ThemeId =
  | "retro"
  | "elegant"
  | "web90s"
  | "tech"
  | "calm"
  | "cyberpunk";

const knownThemes = new Set<ThemeId>([
  "retro",
  "elegant",
  "web90s",
  "tech",
  "calm",
  "cyberpunk",
]);

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (!value) return "retro";
  // Backward compatibility: VSCode theme is removed; fall back to the closest dark theme.
  if (value === "vscode") return "tech";
  if (knownThemes.has(value as ThemeId)) return value as ThemeId;
  if (value === "light" || value === "dark") return "retro";
  return "retro";
}
