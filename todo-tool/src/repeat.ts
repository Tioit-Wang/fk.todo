import type { Translator } from "./i18n";
import type { RepeatRule } from "./types";

// Repeat rules are edited in multiple places (composer + edit modal) and shown on task cards.
// Keeping option lists + helpers in one module avoids drift across the UI.
export type RepeatTypeOption = { id: RepeatRule["type"]; label: string };
export type WeekdayOption = { id: number; label: string };

export function buildRepeatTypeOptions(t: Translator): RepeatTypeOption[] {
  return [
    { id: "none", label: t("repeat.none") },
    { id: "daily", label: t("repeat.daily") },
    { id: "weekly", label: t("repeat.weekly") },
    { id: "monthly", label: t("repeat.monthly") },
    { id: "yearly", label: t("repeat.yearly") },
  ];
}

export function buildWeekdayOptions(t: Translator): WeekdayOption[] {
  return [
    { id: 1, label: t("weekday.1") },
    { id: 2, label: t("weekday.2") },
    { id: 3, label: t("weekday.3") },
    { id: 4, label: t("weekday.4") },
    { id: 5, label: t("weekday.5") },
    { id: 6, label: t("weekday.6") },
    { id: 7, label: t("weekday.7") },
  ];
}

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

export function formatRepeatRule(rule: RepeatRule, t: Translator): string {
  const weekdayOptions = buildWeekdayOptions(t);
  switch (rule.type) {
    case "none":
      return t("repeat.format.none");
    case "daily":
      return rule.workday_only ? t("repeat.format.dailyWorkday") : t("repeat.format.daily");
    case "weekly":
      return t("repeat.format.weekly", {
        days: rule.days
          .map((day) => weekdayOptions.find((opt) => opt.id === day)?.label ?? String(day))
          .join(", "),
      });
    case "monthly":
      return t("repeat.format.monthly", { day: rule.day });
    case "yearly":
      return t("repeat.format.yearly", { month: rule.month, day: rule.day });
  }
}
