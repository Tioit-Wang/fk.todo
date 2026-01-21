import { describe, expect, it } from "vitest";

import { visibleQuickTasks } from "../src/logic";
import type { ReminderConfig, RepeatRule, Task } from "../src/types";

function toTs(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

const baseReminder: ReminderConfig = {
  kind: "none",
  forced_dismissed: false,
};

const baseRepeat: RepeatRule = { type: "none" };

function makeTask(partial: Partial<Task>): Task {
  const now = partial.updated_at ?? partial.created_at ?? toTs(new Date(2026, 0, 21, 10, 0, 0));
  return {
    id: partial.id ?? "task",
    title: partial.title ?? "task",
    due_at: partial.due_at ?? now,
    important: partial.important ?? false,
    completed: partial.completed ?? false,
    completed_at: partial.completed_at,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    sort_order: partial.sort_order ?? now,
    quadrant: partial.quadrant ?? 1,
    notes: partial.notes,
    steps: partial.steps ?? [],
    reminder: partial.reminder ?? baseReminder,
    repeat: partial.repeat ?? baseRepeat,
  };
}

describe("visibleQuickTasks", () => {
  it("shows overdue + today for the todo tab and excludes future tasks", () => {
    const now = new Date(2026, 0, 21, 10, 0, 0);
    const overdue = makeTask({
      id: "overdue",
      due_at: toTs(new Date(2026, 0, 20, 18, 0, 0)),
    });
    const today = makeTask({
      id: "today",
      due_at: toTs(new Date(2026, 0, 21, 12, 0, 0)),
    });
    const future = makeTask({
      id: "future",
      due_at: toTs(new Date(2026, 0, 22, 12, 0, 0)),
    });
    const done = makeTask({
      id: "done",
      due_at: toTs(new Date(2026, 0, 21, 9, 0, 0)),
      completed: true,
      completed_at: toTs(new Date(2026, 0, 21, 9, 30, 0)),
    });

    const result = visibleQuickTasks([overdue, today, future, done], "todo", now, "default");
    expect(result.map((task) => task.id)).toEqual(["overdue", "today"]);
  });

  it("shows only today for the today tab", () => {
    const now = new Date(2026, 0, 21, 10, 0, 0);
    const overdue = makeTask({
      id: "overdue",
      due_at: toTs(new Date(2026, 0, 20, 18, 0, 0)),
    });
    const today = makeTask({
      id: "today",
      due_at: toTs(new Date(2026, 0, 21, 12, 0, 0)),
    });

    const result = visibleQuickTasks([overdue, today], "today", now, "default");
    expect(result.map((task) => task.id)).toEqual(["today"]);
  });

  it("orders done tasks by most recent completion first by default", () => {
    const now = new Date(2026, 0, 21, 10, 0, 0);
    const older = makeTask({
      id: "older",
      completed: true,
      completed_at: toTs(new Date(2026, 0, 20, 8, 0, 0)),
      updated_at: toTs(new Date(2026, 0, 20, 8, 0, 0)),
    });
    const newer = makeTask({
      id: "newer",
      completed: true,
      completed_at: toTs(new Date(2026, 0, 21, 9, 0, 0)),
      updated_at: toTs(new Date(2026, 0, 21, 9, 0, 0)),
    });
    const noCompletedAt = makeTask({
      id: "fallback",
      completed: true,
      completed_at: undefined,
      updated_at: toTs(new Date(2026, 0, 19, 9, 0, 0)),
    });

    const result = visibleQuickTasks([older, newer, noCompletedAt], "done", now, "default");
    expect(result.map((task) => task.id)).toEqual(["newer", "older", "fallback"]);
  });
});
