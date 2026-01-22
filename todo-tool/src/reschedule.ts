import type { Task } from "./types";

import { buildReminderConfig, getReminderOffsetMinutes } from "./reminder";
import { nextWorkdayAtLocalTime, tomorrowAtLocalTime } from "./timePresets";

export type ReschedulePresetId =
  | "plus10m"
  | "plus1h"
  | "tomorrow1800"
  | "nextWorkday0900";

export function computeRescheduleDueAt(task: Task, preset: ReschedulePresetId, now: Date = new Date()): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const base = Math.max(task.due_at, nowSeconds);

  if (preset === "plus10m") return base + 10 * 60;
  if (preset === "plus1h") return base + 60 * 60;
  if (preset === "tomorrow1800") return tomorrowAtLocalTime(now, 18, 0);
  return nextWorkdayAtLocalTime(now, 9, 0);
}

export function rescheduleTask(task: Task, nextDueAt: number, nowSeconds: number): Task {
  const kind = task.reminder.kind;
  const offset = getReminderOffsetMinutes(task);
  const reminder = buildReminderConfig(kind, nextDueAt, offset, nowSeconds);

  return {
    ...task,
    due_at: nextDueAt,
    reminder,
    updated_at: nowSeconds,
  };
}

