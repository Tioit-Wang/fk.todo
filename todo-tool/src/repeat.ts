import type { RepeatRule } from "./types";

// Repeat rules are edited in multiple places (composer + edit modal) and shown on task cards.
// Keeping option lists + helpers in one module avoids drift across the UI.
export const REPEAT_TYPE_OPTIONS = [
  { id: "none", label: "不循环" },
  { id: "daily", label: "每日" },
  { id: "weekly", label: "每周" },
  { id: "monthly", label: "每月" },
  { id: "yearly", label: "每年" },
] as const;

export const WEEKDAY_OPTIONS = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 7, label: "日" },
] as const;

export function defaultRepeatRule(type: RepeatRule["type"]): RepeatRule {
  const now = new Date();
  switch (type) {
    case "daily":
      return { type: "daily", workday_only: false };
    case "weekly":
      return { type: "weekly", days: [1, 2, 3, 4, 5] };
    case "monthly":
      return { type: "monthly", day: Math.min(31, Math.max(1, now.getDate())) };
    case "yearly":
      return { type: "yearly", month: now.getMonth() + 1, day: now.getDate() };
    case "none":
    default:
      return { type: "none" };
  }
}

export function formatRepeatRule(rule: RepeatRule): string {
  switch (rule.type) {
    case "none":
      return "不循环";
    case "daily":
      return rule.workday_only ? "每日(仅工作日)" : "每日";
    case "weekly":
      return `每周(${rule.days
        .map((day) => WEEKDAY_OPTIONS.find((opt) => opt.id === day)?.label ?? day)
        .join(",")})`;
    case "monthly":
      return `每月(${rule.day}号)`;
    case "yearly":
      return `每年(${rule.month}-${rule.day})`;
  }
}
