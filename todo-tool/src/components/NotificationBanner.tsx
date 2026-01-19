import type { Task } from "../types";

export function NotificationBanner({
  tasks,
  onSnooze,
  onComplete,
}: {
  tasks: Task[];
  onSnooze: (task: Task) => void;
  onComplete: (task: Task) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="notification-banner">
      <div className="notification-title">普通提醒</div>
      {tasks.map((task) => (
        <div key={task.id} className="notification-item">
          <span className="notification-text">{task.title}</span>
          <div className="notification-actions">
            <button type="button" className="pill" onClick={() => onSnooze(task)}>
              稍后 5 分钟
            </button>
            <button type="button" className="pill" onClick={() => onComplete(task)}>
              完成
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

