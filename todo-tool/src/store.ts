import type { Settings, Task } from "./types";

const TASKS_KEY = "todo.tasks.v1";
const SETTINGS_KEY = "todo.settings.v1";

export function loadLocalTasks(): Task[] {
  const raw = localStorage.getItem(TASKS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

export function saveLocalTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function loadLocalSettings(): Settings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

export function saveLocalSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
