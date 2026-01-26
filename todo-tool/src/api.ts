import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  Project,
  ReminderKind,
  RepeatRule,
  Settings,
  StatePayload,
  Task,
} from "./types";

export interface BackupEntry {
  name: string;
  modified_at: number;
}

export async function loadState() {
  return invoke<CommandResult<StatePayload>>("load_state");
}

export async function createProject(project: Project) {
  return invoke<CommandResult<Project>>("create_project", { project });
}

export async function updateProject(project: Project) {
  return invoke<CommandResult<Project>>("update_project", { project });
}

export async function swapProjectSortOrder(firstId: string, secondId: string) {
  return invoke<CommandResult<boolean>>("swap_project_sort_order", {
    firstId,
    secondId,
  });
}

export async function deleteProject(projectId: string) {
  return invoke<CommandResult<boolean>>("delete_project", { projectId });
}

export async function createTask(task: Task) {
  return invoke<CommandResult<Task>>("create_task", { task });
}

export async function updateTask(task: Task) {
  return invoke<CommandResult<Task>>("update_task", { task });
}

export async function bulkUpdateTasks(tasks: Task[]) {
  return invoke<CommandResult<boolean>>("bulk_update_tasks", { tasks });
}

export async function swapSortOrder(firstId: string, secondId: string) {
  return invoke<CommandResult<boolean>>("swap_sort_order", {
    firstId,
    secondId,
  });
}

export async function completeTask(taskId: string) {
  return invoke<CommandResult<Task>>("complete_task", { taskId });
}

export async function bulkCompleteTasks(taskIds: string[]) {
  return invoke<CommandResult<boolean>>("bulk_complete_tasks", { taskIds });
}

export async function updateSettings(settings: Settings) {
  return invoke<CommandResult<Settings>>("update_settings", { settings });
}

export async function showSettingsWindow() {
  return invoke<CommandResult<boolean>>("show_settings_window");
}

export async function setShortcutCaptureActive(active: boolean) {
  return invoke<CommandResult<boolean>>("set_shortcut_capture_active", {
    active,
  });
}

export async function snoozeTask(taskId: string, until: number) {
  return invoke<CommandResult<boolean>>("snooze_task", { taskId, until });
}

export async function dismissForced(taskId: string) {
  return invoke<CommandResult<boolean>>("dismiss_forced", { taskId });
}

export async function deleteTask(taskId: string) {
  return invoke<CommandResult<boolean>>("delete_task", { taskId });
}

export async function deleteTasks(taskIds: string[]) {
  return invoke<CommandResult<boolean>>("delete_tasks", { taskIds });
}

export async function listBackups() {
  return invoke<CommandResult<BackupEntry[]>>("list_backups");
}

export async function deleteBackup(filename: string) {
  return invoke<CommandResult<boolean>>("delete_backup", { filename });
}

export async function createBackup() {
  return invoke<CommandResult<boolean>>("create_backup");
}

export async function restoreBackup(name: string) {
  return invoke<CommandResult<Task[]>>("restore_backup", { filename: name });
}

export async function importBackup(path: string) {
  return invoke<CommandResult<Task[]>>("import_backup", { path });
}

export async function exportTasksJson() {
  return invoke<CommandResult<string>>("export_tasks_json");
}

export async function exportTasksCsv() {
  return invoke<CommandResult<string>>("export_tasks_csv");
}

export async function exportTasksMarkdown() {
  return invoke<CommandResult<string>>("export_tasks_markdown");
}

export interface AiPlanRequest {
  raw_input: string;
  title: string;
  project_id: string;
  tags: string[];
  due_at: number;
  important: boolean;
  repeat: RepeatRule;
  reminder_kind: ReminderKind;
  reminder_offset_minutes: number;
}

export interface AiPlan {
  project_id: string;
  title: string;
  due_at: string | null;
  important: boolean | null;
  notes: string | null;
  // Backward compatible: older prompts may still return string[].
  steps: Array<string | { title: string }>;
  tags: string[];
  sample_tag: string | null;
  reminder:
    | {
        kind: ReminderKind | null;
        remind_at: string | null;
        forced_dismissed: boolean | null;
      }
    | null;
  repeat: RepeatRule | null;
}

export async function aiPlanTask(request: AiPlanRequest) {
  try {
    const data = await invoke<AiPlan>("ai_plan_task", { request });
    return { ok: true, data } satisfies CommandResult<AiPlan>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message } satisfies CommandResult<AiPlan>;
  }
}
