import { useEffect, useMemo } from "react";

import { formatDue } from "../date";
import { useI18n } from "../i18n";
import { formatRepeatRule } from "../repeat";
import { isOverdue } from "../scheduler";
import type { Task } from "../types";
import type { SnoozePresetId } from "../snooze";

import { Icons } from "./icons";

function formatSpan(seconds: number, t: (key: string, params?: Record<string, string | number>) => string) {
  const abs = Math.max(0, Math.floor(Math.abs(seconds)));
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  const remHours = hours % 24;
  const remMins = mins % 60;

  if (days > 0) {
    if (remHours > 0) return t("forced.time.daysHours", { days, hours: remHours });
    return t("forced.time.days", { days });
  }
  if (hours > 0) {
    if (remMins > 0) return t("forced.time.hoursMins", { hours, mins: remMins });
    return t("forced.time.hours", { hours });
  }
  if (mins > 0) return t("forced.time.mins", { mins });
  return t("forced.time.lessThanMin");
}

export function ForcedReminderOverlay({
  task,
  color,
  queueIndex,
  queueTotal,
  onDismiss,
  onSnooze,
  onComplete,
}: {
  task: Task | null;
  color: string;
  queueIndex: number;
  queueTotal: number;
  onDismiss: () => void;
  onSnooze: (preset: SnoozePresetId) => void;
  onComplete: () => void;
}) {
  const { t } = useI18n();
  const now = Math.floor(Date.now() / 1000);
  const overdue = task ? isOverdue(task, now) : false;

  const relative = useMemo(() => {
    if (!task) return "";
    const delta = task.due_at - now;
    if (delta === 0) return t("forced.relative.now");
    if (delta > 0) {
      if (delta < 60) return t("forced.relative.soon");
      return t("forced.relative.in", { span: formatSpan(delta, t) });
    }
    return t("forced.relative.overdue", { span: formatSpan(delta, t) });
  }, [task, now, t]);

  useEffect(() => {
    if (!task) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onComplete();
        return;
      }
      if (event.key === "Escape") {
        // Safer default than “关闭提醒”: Esc = snooze and revisit soon.
        event.preventDefault();
        onSnooze("m5");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [task, onComplete, onSnooze]);

  if (!task) return null;

  return (
    <div className="forced-reminder" style={{ ["--forced-color" as any]: color }}>
      <div className="forced-reminder-scrim" aria-hidden="true" />

      <div className="forced-reminder-sheet" role="alertdialog" aria-label={t("forced.title")}>
        <div className="forced-reminder-accent" style={{ backgroundColor: color }} />

        <div className="forced-reminder-inner">
          <div className="forced-reminder-icon" aria-hidden="true">
            <Icons.AlertCircle />
          </div>

          <div className="forced-reminder-main">
            <div className="forced-reminder-toprow">
              <span className="forced-reminder-badge">
                <span className="forced-reminder-dot" style={{ backgroundColor: color }} />
                {t("forced.title")}
              </span>
              {queueTotal > 1 && (
                <span className="forced-reminder-queue" title={t("forced.queue")}>
                  {queueIndex}/{queueTotal}
                </span>
              )}
            </div>

            <div className="forced-reminder-title">{task.title}</div>

            <div className="forced-reminder-meta">
              <span className={`forced-reminder-relative ${overdue ? "overdue" : ""}`}>
                {relative}
              </span>
              <span className="forced-reminder-chip">
                <Icons.Clock />
                {formatDue(task.due_at)}
              </span>
              {task.important && (
                <span className="forced-reminder-chip important">
                  <Icons.Star />
                  {t("forced.tag.important")}
                </span>
              )}
              {task.repeat.type !== "none" && (
                <span className="forced-reminder-chip">
                  <Icons.Repeat />
                  {formatRepeatRule(task.repeat, t)}
                </span>
              )}
            </div>
          </div>

          <div className="forced-reminder-actions">
            <button type="button" className="forced-btn ghost" onClick={onDismiss}>
              {t("forced.action.dismiss")}
            </button>
            <button type="button" className="forced-btn secondary" onClick={() => onSnooze("m5")}>
              <Icons.Snooze />
              {t("forced.action.snooze5")}
            </button>
            <button type="button" className="forced-btn secondary" onClick={() => onSnooze("m15")}>
              <Icons.Snooze />
              {t("forced.action.snooze15")}
            </button>
            <button type="button" className="forced-btn secondary" onClick={() => onSnooze("h1")}>
              <Icons.Snooze />
              {t("forced.action.snooze1h")}
            </button>
            <button
              type="button"
              className="forced-btn secondary"
              onClick={() => onSnooze("tomorrow0900")}
            >
              <Icons.Snooze />
              {t("forced.action.snoozeTomorrowMorning")}
            </button>
            <button type="button" className="forced-btn primary" onClick={onComplete}>
              <Icons.Check />
              {t("forced.action.complete")}
            </button>
            <div className="forced-reminder-hint">{t("forced.hint")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

