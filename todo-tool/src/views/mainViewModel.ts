import { isDueToday, isOverdue } from "../scheduler";
import { taskMatchesQuery } from "../search";
import type { Task } from "../types";

export type MainSortId = "due" | "created" | "manual";
export type ListTabId = "all" | "open" | "done";

export type MainScope =
  | { kind: "today" }
  | { kind: "important" }
  | { kind: "project"; projectId: string };

export type ManualReorderDirection = "up" | "down";

export function cycleMainSort(current: MainSortId): MainSortId {
  if (current === "due") return "created";
  if (current === "created") return "manual";
  return "due";
}

export function findManualReorderTargetIndex(
  list: Task[],
  taskId: string,
  direction: ManualReorderDirection,
): number | null {
  const index = list.findIndex((item) => item.id === taskId);
  if (index < 0) return null;

  const task = list[index];
  const step = direction === "up" ? -1 : 1;
  let targetIndex = index + step;
  while (targetIndex >= 0 && targetIndex < list.length) {
    const candidate = list[targetIndex];
    // Manual reordering must respect "pinned important" and completion grouping.
    if (
      candidate.important === task.important &&
      candidate.completed === task.completed
    ) {
      return targetIndex;
    }
    targetIndex += step;
  }
  return null;
}

export function filterTasksByScope(
  tasks: Task[],
  scope: MainScope,
  now: Date,
): Task[] {
  if (scope.kind === "today") {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return tasks.filter(
      (task) => isDueToday(task, now) || isOverdue(task, nowSeconds),
    );
  }
  if (scope.kind === "important") {
    return tasks.filter((task) => task.important);
  }
  return tasks.filter((task) => task.project_id === scope.projectId);
}

export function filterTasksByQuery(tasks: Task[], query: string): Task[] {
  const trimmed = query.trim();
  if (!trimmed) return tasks;
  return tasks.filter((task) => taskMatchesQuery(task, trimmed));
}

export function sortTasksWithPinnedImportant(
  tasks: Task[],
  sort: MainSortId,
): Task[] {
  const list = [...tasks];
  list.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;

    if (sort === "created") {
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      if (a.due_at !== b.due_at) return a.due_at - b.due_at;
      return a.id.localeCompare(b.id);
    }

    if (sort === "manual") {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      if (a.due_at !== b.due_at) return a.due_at - b.due_at;
      return a.id.localeCompare(b.id);
    }

    // "due" (default)
    if (a.due_at !== b.due_at) return a.due_at - b.due_at;
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return a.id.localeCompare(b.id);
  });
  return list;
}

export function buildCompletionSections(
  tasks: Task[],
): Record<ListTabId, Task[]> {
  const open = tasks.filter((task) => !task.completed);
  const done = tasks.filter((task) => task.completed);
  return { all: [...open, ...done], open, done };
}
