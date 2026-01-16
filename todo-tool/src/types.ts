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
}

export type CloseBehavior = "hide_to_tray" | "exit";

export interface Step {
  id: string;
  title: string;
  completed: boolean;
  created_at: number;
  completed_at?: number;
}

export interface Task {
  id: string;
  title: string;
  due_at: number;
  important: boolean;
  completed: boolean;
  completed_at?: number;
  created_at: number;
  updated_at: number;
  quadrant: number;
  notes?: string;
  steps: Step[];
  reminder: ReminderConfig;
  repeat: RepeatRule;
}

export interface Settings {
  shortcut: string;
  theme: string;
  sound_enabled: boolean;
  close_behavior: CloseBehavior;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
