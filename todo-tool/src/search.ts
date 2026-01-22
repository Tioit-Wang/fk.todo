import type { Task } from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function buildTaskSearchText(task: Task): string {
  const parts: string[] = [];
  parts.push(task.title);
  if (task.notes) parts.push(task.notes);
  task.steps.forEach((step) => parts.push(step.title));
  task.tags.forEach((tag) => parts.push(tag));
  return normalize(parts.join("\n"));
}

export function taskMatchesQuery(task: Task, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const text = buildTaskSearchText(task);
  return tokens.every((rawToken) => {
    const token = rawToken.startsWith("#") ? rawToken.slice(1) : rawToken;
    return token ? text.includes(token) : true;
  });
}
