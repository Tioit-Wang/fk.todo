import type { Task } from "../types";
import { useI18n } from "../i18n";
import type { SnoozePresetId } from "../snooze";

export function NotificationBanner({
  tasks,
  onSnooze,
  onComplete,
}: {
  tasks: Task[];
  onSnooze: (task: Task, preset: SnoozePresetId) => void;
  onComplete: (task: Task) => void;
}) {
  const { t } = useI18n();
  if (tasks.length === 0) return null;
  return (
    <div className="notification-banner">
      <div className="notification-title">{t("banner.normalReminder")}</div>
      {tasks.map((task) => (
        <div key={task.id} className="notification-item">
          <span className="notification-text">{task.title}</span>
          <div className="notification-actions">
            <button
              type="button"
              className="pill"
              onClick={() => onSnooze(task, "m5")}
            >
              {t("banner.snooze5")}
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => onSnooze(task, "m15")}
            >
              {t("banner.snooze15")}
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => onSnooze(task, "h1")}
            >
              {t("banner.snooze1h")}
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => onSnooze(task, "tomorrow0900")}
            >
              {t("banner.snoozeTomorrowMorning")}
            </button>
            <button type="button" className="pill" onClick={() => onComplete(task)}>
              {t("banner.complete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

