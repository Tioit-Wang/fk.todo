export type ReminderKind = "none" | "normal" | "forced";

export type RepeatRule =
  | { type: "none" }
  | { type: "daily"; workday_only: boolean }
  | { type: "weekly"; days: number[] }
  | { type: "monthly"; day: number }
  | { type: "yearly"; month: number; day: number };

export interface ReminderConfig {
  kind: ReminderKind;
  remind_at?: number;
  snoozed_until?: number;
  forced_dismissed: boolean;
  last_fired_at?: number;
  repeat_fired_count?: number;
}

export type CloseBehavior = "hide_to_tray" | "exit";
export type MinimizeBehavior = "hide_to_tray" | "minimize";
export type BackupSchedule = "none" | "daily" | "weekly" | "monthly";
export type UpdateBehavior = "auto" | "next_restart" | "disabled";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Step {
  id: string;
  title: string;
  completed: boolean;
  created_at: number;
  completed_at?: number;
}

export interface Project {
  id: string;
  name: string;
  pinned: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
  sample_tag?: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  due_at: number;
  important: boolean;
  completed: boolean;
  completed_at?: number;
  created_at: number;
  updated_at: number;
  sort_order: number;
  quadrant: number;
  notes?: string;
  steps: Step[];
  tags: string[];
  sample_tag?: string;
  reminder: ReminderConfig;
  repeat: RepeatRule;
}

export interface Settings {
  shortcut: string;
  theme: string;
  ui_radius: "theme" | "sharp" | "round";
  ui_border: "theme" | "thin" | "thick";
  ui_shadow: "theme" | "none" | "soft" | "strong";
  language: "auto" | "zh" | "en";
  ai_enabled: boolean;
  deepseek_api_key: string;
  ai_model: string;
  ai_prompt: string;
  update_behavior: UpdateBehavior;
  sound_enabled: boolean;
  close_behavior: CloseBehavior;
  minimize_behavior: MinimizeBehavior;
  quick_always_on_top: boolean;
  quick_blur_enabled: boolean;
  quick_bounds?: WindowBounds;
  quick_tab: string;
  quick_sort: string;
  forced_reminder_color: string;
  backup_schedule: BackupSchedule;
  last_backup_at?: number;
  today_focus_date?: string;
  today_focus_ids: string[];
  today_prompted_date?: string;
  reminder_repeat_interval_sec: number;
  reminder_repeat_max_times: number;
}

export interface StatePayload {
  tasks: Task[];
  projects: Project[];
  settings: Settings;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
