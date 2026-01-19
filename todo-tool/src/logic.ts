import { defaultDueAt, isDueToday, isOverdue } from "./scheduler";
import type { ReminderConfig, Task } from "./types";

export type QuickTab = "todo" | "done" | "all";
export type QuickSortMode = "default" | "created";

export function newTask(title: string, now: Date): Task {
  const ts = Math.floor(now.getTime() / 1000);
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    due_at: defaultDueAt(now),
    important: false,
    completed: false,
    completed_at: undefined,
    created_at: ts,
    updated_at: ts,
    sort_order: Date.now(),
    quadrant: 1,
    notes: undefined,
    steps: [],
    reminder: defaultReminder(),
    repeat: { type: "none" },
  };
}

function defaultReminder(): ReminderConfig {
  return {
    kind: "none",
    forced_dismissed: false,
  };
}

export function visibleQuickTasks(tasks: Task[], tab: QuickTab, now: Date, sortMode: QuickSortMode): Task[] {
  const ts = Math.floor(now.getTime() / 1000);
  let list = tasks;
  if (tab === "todo") list = tasks.filter((t) => !t.completed);
  if (tab === "done") list = tasks.filter((t) => t.completed);

  // quick window default: overdue + today for todo tab; for other tabs show all
  if (tab === "todo") {
    list = list.filter((t) => isOverdue(t, ts) || isDueToday(t, now));
  }

  const sorted = list.slice();
  if (sortMode === "created") {
    return sorted.sort((a, b) => a.created_at - b.created_at);
  }
  // default: overdue first, then due asc, important first, created asc
  return sorted.sort((a, b) => {
    const ao = isOverdue(a, ts) ? 1 : 0;
    const bo = isOverdue(b, ts) ? 1 : 0;
    if (ao !== bo) return bo - ao;
    if (a.due_at !== b.due_at) return a.due_at - b.due_at;
    if (a.important !== b.important) return a.important ? -1 : 1;
    return a.created_at - b.created_at;
  });
}
