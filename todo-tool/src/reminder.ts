import type { ReminderKind, Task } from "./types";

// Reminder helpers are shared by composer + edit modal (and need to match backend semantics).
export const REMINDER_KIND_OPTIONS = [
  { id: "none", label: "不提醒" },
  { id: "normal", label: "普通" },
  { id: "forced", label: "强制" },
] as const;

// UI-oriented presets for "minutes before due". These work for both normal + forced reminders.
// (If a task is due sooner than the offset, the backend/logic will effectively fire "as soon as possible".)
export const REMINDER_OFFSET_PRESETS = [
  { id: "due", label: "到期时", minutes: 0 },
  { id: "5m", label: "5分钟", minutes: 5 },
  { id: "10m", label: "10分钟", minutes: 10 },
  { id: "30m", label: "30分钟", minutes: 30 },
  { id: "1h", label: "1小时", minutes: 60 },
  { id: "2h", label: "2小时", minutes: 120 },
] as const;

export function getReminderOffsetMinutes(task: Task): number {
  if (task.reminder.kind === "none") return 0;

  // Default offset: normal = due-10min; forced = due.
  const defaultRemindAt = task.reminder.kind === "normal" ? task.due_at - 10 * 60 : task.due_at;
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
