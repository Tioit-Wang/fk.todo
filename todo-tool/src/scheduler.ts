import type { Task } from "./types";

export function sortByDue(tasks: Task[]) {
  return [...tasks].sort((a, b) => a.due_at - b.due_at);
}

export function isOverdue(task: Task, now: number) {
  return !task.completed && task.due_at < now;
}

export function isDueToday(task: Task, now: Date) {
  const due = new Date(task.due_at * 1000);
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

export function defaultDueAt(now: Date) {
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now.getTime() > target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return Math.floor(target.getTime() / 1000);
}
