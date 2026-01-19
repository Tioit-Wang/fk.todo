import { useEffect, useMemo } from "react";

import { formatDue } from "../date";
import { formatRepeatRule } from "../repeat";
import { isOverdue } from "../scheduler";
import type { Task } from "../types";

import { Icons } from "./icons";

function formatSpan(seconds: number) {
  const abs = Math.max(0, Math.floor(Math.abs(seconds)));
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  const remHours = hours % 24;
  const remMins = mins % 60;

  if (days > 0) {
    if (remHours > 0) return `${days}天 ${remHours}小时`;
    return `${days}天`;
  }
  if (hours > 0) {
    if (remMins > 0) return `${hours}小时 ${remMins}分`;
    return `${hours}小时`;
  }
  if (mins > 0) return `${mins}分`;
  return "不到 1 分钟";
}

export function ForcedReminderOverlay({
  task,
  color,
  queueIndex,
  queueTotal,
  onDismiss,
  onSnooze5,
  onComplete,
}: {
  task: Task | null;
  color: string;
  queueIndex: number;
  queueTotal: number;
  onDismiss: () => void;
  onSnooze5: () => void;
  onComplete: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const overdue = task ? isOverdue(task, now) : false;

  const relative = useMemo(() => {
    if (!task) return "";
    const delta = task.due_at - now;
    if (delta === 0) return "现在到期";
    if (delta > 0) {
      if (delta < 60) return "即将到期";
      return `还有 ${formatSpan(delta)}`;
    }
    return `已逾期 ${formatSpan(delta)}`;
  }, [task, now]);

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
        onSnooze5();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [task, onComplete, onSnooze5]);

  if (!task) return null;

  return (
    <div className="forced-reminder" style={{ ["--forced-color" as any]: color }}>
      <div className="forced-reminder-scrim" aria-hidden="true" />

      <div className="forced-reminder-sheet" role="alertdialog" aria-label="强制提醒">
        <div className="forced-reminder-accent" style={{ backgroundColor: color }} />

        <div className="forced-reminder-inner">
          <div className="forced-reminder-icon" aria-hidden="true">
            <Icons.AlertCircle />
          </div>

          <div className="forced-reminder-main">
            <div className="forced-reminder-toprow">
              <span className="forced-reminder-badge">
                <span className="forced-reminder-dot" style={{ backgroundColor: color }} />
                强制提醒
              </span>
              {queueTotal > 1 && (
                <span className="forced-reminder-queue" title="提醒队列">
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
                  重要
                </span>
              )}
              {task.repeat.type !== "none" && (
                <span className="forced-reminder-chip">
                  <Icons.Repeat />
                  {formatRepeatRule(task.repeat)}
                </span>
              )}
            </div>
          </div>

          <div className="forced-reminder-actions">
            <button type="button" className="forced-btn ghost" onClick={onDismiss}>
              关闭提醒
            </button>
            <button type="button" className="forced-btn secondary" onClick={onSnooze5}>
              <Icons.Snooze />
              稍后 5 分钟
            </button>
            <button type="button" className="forced-btn primary" onClick={onComplete}>
              <Icons.Check />
              立即完成
            </button>
            <div className="forced-reminder-hint">Enter 完成 · Esc 稍后 5 分钟</div>
          </div>
        </div>
      </div>
    </div>
  );
}

