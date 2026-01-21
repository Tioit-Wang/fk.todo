import type { Task } from "../types";
import { useI18n } from "../i18n";

export function NotificationBanner({
  tasks,
  onSnooze,
  onComplete,
}: {
  tasks: Task[];
  onSnooze: (task: Task) => void;
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
            <button type="button" className="pill" onClick={() => onSnooze(task)}>
              {t("banner.snooze5")}
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

