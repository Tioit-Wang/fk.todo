import { defaultDueAt, isDueToday, isOverdue, sortByDue } from "./scheduler";
import type { ReminderConfig, RepeatRule, Task } from "./types";

export type QuickTab = "todo" | "done" | "all";

export type SortMode = "due" | "created";

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
    quadrant: 1,
    notes: undefined,
    steps: [],
    reminder: defaultReminder(),
    repeat: { type: "none" },
  };
}

export function defaultReminder(): ReminderConfig {
  return {
    kind: "none",
    forced_dismissed: false,
  };
}

export function setReminder(task: Task, kind: "none" | "normal" | "forced"): Task {
  const now = Math.floor(Date.now() / 1000);
  const next = { ...task };
  next.reminder = { ...next.reminder, kind, forced_dismissed: false };

  if (kind === "none") {
    delete next.reminder.remind_at;
    delete next.reminder.snoozed_until;
    delete next.reminder.last_fired_at;
    return next;
  }

  if (kind === "normal") {
    // default: due - 10 minutes
    next.reminder.remind_at = Math.max(task.due_at - 10 * 60, now);
    return next;
  }

  // forced: default at due
  next.reminder.remind_at = task.due_at;
  return next;
}

export function setRepeat(task: Task, repeat: RepeatRule): Task {
  return { ...task, repeat };
}

export function toggleImportant(task: Task): Task {
  return { ...task, important: !task.important };
}

export function toggleCompleted(task: Task, now: Date): Task {
  const ts = Math.floor(now.getTime() / 1000);
  if (task.completed) {
    return { ...task, completed: false, completed_at: undefined, updated_at: ts };
  }
  return { ...task, completed: true, completed_at: ts, updated_at: ts };
}

export function visibleQuickTasks(tasks: Task[], tab: QuickTab, now: Date): Task[] {
  const ts = Math.floor(now.getTime() / 1000);
  let list = tasks;
  if (tab === "todo") list = tasks.filter((t) => !t.completed);
  if (tab === "done") list = tasks.filter((t) => t.completed);

  // quick window default: overdue + today for todo tab; for other tabs show all
  if (tab === "todo") {
    list = list.filter((t) => isOverdue(t, ts) || isDueToday(t, now));
  }

  // sort: overdue first, then due asc, important first, created asc
  return list
    .slice()
    .sort((a, b) => {
      const ao = isOverdue(a, ts) ? 1 : 0;
      const bo = isOverdue(b, ts) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      if (a.due_at !== b.due_at) return a.due_at - b.due_at;
      if (a.important !== b.important) return a.important ? -1 : 1;
      return a.created_at - b.created_at;
    });
}

export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  if (mode === "created") {
    return tasks.slice().sort((a, b) => a.created_at - b.created_at);
  }
  return sortByDue(tasks);
}
