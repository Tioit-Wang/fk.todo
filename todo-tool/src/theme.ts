export type ThemeId =
  | "retro"
  | "elegant"
  | "web90s"
  | "tech"
  | "calm"
  | "vscode"
  | "cyberpunk";

const knownThemes = new Set<ThemeId>([
  "retro",
  "elegant",
  "web90s",
  "tech",
  "calm",
  "vscode",
  "cyberpunk",
]);

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (!value) return "retro";
  if (knownThemes.has(value as ThemeId)) return value as ThemeId;
  if (value === "light" || value === "dark") return "retro";
  return "retro";
}
