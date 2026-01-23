import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Settings, Task } from "./types";

export interface BackupEntry {
  name: string;
  modified_at: number;
}

export async function loadState() {
  return invoke<CommandResult<[Task[], Settings]>>("load_state");
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
  return invoke<CommandResult<boolean>>("swap_sort_order", { firstId, secondId });
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
  return invoke<CommandResult<boolean>>("set_shortcut_capture_active", { active });
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
