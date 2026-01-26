import type { Translator } from "./i18n";
import type { ReminderKind, Task } from "./types";

// Reminder helpers are shared by composer + edit modal (and need to match backend semantics).
export type ReminderKindOption = { id: ReminderKind; label: string };
export type ReminderOffsetPreset = {
  id: string;
  label: string;
  minutes: number;
};

// Must match backend scheduler semantics:
// snoozed_until > remind_at > default_target (normal: due-10min; forced: due)
export function getReminderTargetTime(task: Task): number | null {
  const reminder = task.reminder;
  if (reminder.kind === "none") return null;

  const defaultTarget =
    reminder.kind === "normal" ? task.due_at - 10 * 60 : task.due_at;
  return reminder.snoozed_until ?? reminder.remind_at ?? defaultTarget;
}

export function buildReminderKindOptions(t: Translator): ReminderKindOption[] {
  return [
    { id: "none", label: t("reminder.kind.none") },
    { id: "normal", label: t("reminder.kind.normal") },
    { id: "forced", label: t("reminder.kind.forced") },
  ];
}

// UI-oriented presets for "minutes before due". These work for both normal + forced reminders.
// (If a task is due sooner than the offset, the backend/logic will effectively fire "as soon as possible".)
export function buildReminderOffsetPresets(
  t: Translator,
): ReminderOffsetPreset[] {
  return [
    { id: "due", label: t("reminder.offset.due"), minutes: 0 },
    { id: "5m", label: t("reminder.offset.5m"), minutes: 5 },
    { id: "10m", label: t("reminder.offset.10m"), minutes: 10 },
    { id: "30m", label: t("reminder.offset.30m"), minutes: 30 },
    { id: "1h", label: t("reminder.offset.1h"), minutes: 60 },
    { id: "2h", label: t("reminder.offset.2h"), minutes: 120 },
  ];
}

export function getReminderOffsetMinutes(task: Task): number {
  if (task.reminder.kind === "none") return 0;

  // Default offset: normal = due-10min; forced = due.
  const defaultRemindAt =
    task.reminder.kind === "normal" ? task.due_at - 10 * 60 : task.due_at;
  const remindAt = task.reminder.remind_at ?? defaultRemindAt;

  const offset = Math.round((task.due_at - remindAt) / 60);
  return Math.max(0, offset);
}

export function buildReminderConfig(
  kind: ReminderKind,
  dueAtSeconds: number,
  offsetMinutes: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Task["reminder"] {
  if (kind === "none") {
    return { kind: "none", forced_dismissed: false };
  }

  const remindAt = Math.max(dueAtSeconds - offsetMinutes * 60, nowSeconds);
  return {
    kind,
    remind_at: remindAt,
    snoozed_until: undefined,
    forced_dismissed: false,
    last_fired_at: undefined,
  };
}
