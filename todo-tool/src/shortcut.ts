type ShortcutCaptureError = "need_key" | "need_modifier";

const modifierKeys = new Set(["Alt", "Control", "Meta", "Shift"]);

const keyAlias: Record<string, string> = {
  " ": "Space",
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

function normalizeShortcutKey(key: string): string | null {
  if (!key || key === "Dead" || key === "Unidentified") return null;
  if (key.length === 1) return key.toUpperCase();
  return keyAlias[key] ?? key;
}

export function captureShortcutFromEvent(
  event: KeyboardEvent,
): { shortcut: string } | { error: ShortcutCaptureError } {
  if (modifierKeys.has(event.key)) {
    return { error: "need_key" };
  }

  const key = normalizeShortcutKey(event.key);
  if (!key) return { error: "need_key" };

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    parts.push("CommandOrControl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (parts.length === 0) {
    return { error: "need_modifier" };
  }

  parts.push(key);
  return { shortcut: parts.join("+") };
}
